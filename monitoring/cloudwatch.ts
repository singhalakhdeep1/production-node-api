// AWS CloudWatch integration: per-minute request metrics, log shipping and alarms (AWS SDK v3).
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  PutMetricAlarmCommand,
  PutMetricDataCommand,
  type ComparisonOperator,
  type Dimension,
  type MetricDatum,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import Transport from 'winston-transport';
import { config } from '../src/config';
import { externalSinkRequests } from '../src/metrics';
import type { RequestSample } from '../src/observability/hooks';
import { CircuitBreakerService } from '../src/services/circuit-breaker/circuit-breaker.service';

interface Aggregate {
  count: number;
  errors: number;
  sum: number;
  min: number;
  max: number;
}

export class CloudWatchService {
  readonly cloudwatch: CloudWatchClient;
  readonly cloudwatchLogs: CloudWatchLogsClient;
  readonly breaker = new CircuitBreakerService({ name: 'cloudwatch', failureThreshold: 3, resetTimeout: 60000 });
  private aggregates = new Map<string, Aggregate>();
  private timer: NodeJS.Timeout | null = null;
  private ensuredStreams = new Set<string>();
  published = 0;

  constructor(region = config.monitoring.cloudwatchRegion, private readonly namespace = config.monitoring.cloudwatchNamespace) {
    const endpoint = config.monitoring.cloudwatchEndpoint;
    this.cloudwatch = new CloudWatchClient({ region, endpoint });
    this.cloudwatchLogs = new CloudWatchLogsClient({ region, endpoint });
  }

  private async call<T>(op: () => Promise<T>): Promise<T> {
    try {
      const result = await this.breaker.execute(op);
      externalSinkRequests.inc({ sink: 'cloudwatch', result: 'success' });
      return result;
    } catch (error) {
      externalSinkRequests.inc({ sink: 'cloudwatch', result: 'failure' });
      throw error;
    }
  }

  async putMetric(metricName: string, value: number, unit: StandardUnit = 'Count', dimensions: Dimension[] = [], namespace = this.namespace) {
    return this.putMetricData([{ MetricName: metricName, Value: value, Unit: unit, Timestamp: new Date(), Dimensions: dimensions }], namespace);
  }

  async putCustomMetric(metricName: string, value: number, unit: StandardUnit = 'Count', dimensions: Dimension[] = []) {
    return this.putMetric(metricName, value, unit, dimensions, `${this.namespace}/Custom`);
  }

  async putMetricData(data: MetricDatum[], namespace = this.namespace) {
    for (let i = 0; i < data.length; i += 1000) {
      await this.call(() => this.cloudwatch.send(new PutMetricDataCommand({ Namespace: namespace, MetricData: data.slice(i, i + 1000) })));
    }
    this.published += data.length;
    return { success: true };
  }

  async createLogGroup(logGroupName: string) {
    try {
      await this.call(() => this.cloudwatchLogs.send(new CreateLogGroupCommand({ logGroupName })));
      return { success: true };
    } catch (error) {
      if ((error as { name?: string }).name === 'ResourceAlreadyExistsException') return { success: true, exists: true };
      throw error;
    }
  }

  private async ensureStream(logGroupName: string, logStreamName: string): Promise<void> {
    const id = `${logGroupName}/${logStreamName}`;
    if (this.ensuredStreams.has(id)) return;
    await this.createLogGroup(logGroupName);
    try {
      await this.call(() => this.cloudwatchLogs.send(new CreateLogStreamCommand({ logGroupName, logStreamName })));
    } catch (error) {
      if ((error as { name?: string }).name !== 'ResourceAlreadyExistsException') throw error;
    }
    this.ensuredStreams.add(id);
  }

  async putLogEvents(logGroupName: string, events: { message: string; timestamp?: number }[], logStreamName = `${config.serviceName}-${config.instance}`) {
    await this.ensureStream(logGroupName, logStreamName);
    const logEvents = events.map((e) => ({ message: e.message, timestamp: e.timestamp ?? Date.now() })).sort((a, b) => a.timestamp - b.timestamp);
    await this.call(() => this.cloudwatchLogs.send(new PutLogEventsCommand({ logGroupName, logStreamName, logEvents })));
    return { success: true };
  }

  async getMetricStatistics(metricName: string, period = 300, dimensions: Dimension[] = []) {
    const result = await this.call(() => this.cloudwatch.send(new GetMetricStatisticsCommand({
      Namespace: this.namespace,
      MetricName: metricName,
      Dimensions: dimensions,
      StartTime: new Date(Date.now() - 3600000),
      EndTime: new Date(),
      Period: period,
      Statistics: ['Average', 'Maximum', 'Minimum', 'SampleCount', 'Sum'],
    })));
    return result.Datapoints ?? [];
  }

  async createAlarm(alarmName: string, metricName: string, threshold: number, comparisonOperator: ComparisonOperator, alarmActions: string[] = []) {
    await this.call(() => this.cloudwatch.send(new PutMetricAlarmCommand({
      AlarmName: alarmName,
      AlarmDescription: `Alert for ${metricName}`,
      Namespace: this.namespace,
      MetricName: metricName,
      Threshold: threshold,
      ComparisonOperator: comparisonOperator,
      EvaluationPeriods: 1,
      Period: 300,
      Statistic: 'Average',
      AlarmActions: alarmActions,
    })));
    return { success: true };
  }

  /** Request hook: aggregates in memory; `flush()` publishes one datum set per route per minute. */
  record(sample: RequestSample): void {
    const key = `${sample.method} ${sample.route}`;
    const agg = this.aggregates.get(key) ?? { count: 0, errors: 0, sum: 0, min: Infinity, max: 0 };
    agg.count++;
    if (sample.status >= 500) agg.errors++;
    agg.sum += sample.durationMs;
    agg.min = Math.min(agg.min, sample.durationMs);
    agg.max = Math.max(agg.max, sample.durationMs);
    this.aggregates.set(key, agg);
  }

  start(intervalMs = 60000): void {
    this.timer = setInterval(() => void this.flush().catch(() => undefined), intervalMs);
    this.timer.unref();
  }

  async flush(): Promise<number> {
    if (this.aggregates.size === 0) return 0;
    const snapshot = [...this.aggregates];
    this.aggregates.clear();
    const timestamp = new Date();
    const data: MetricDatum[] = snapshot.flatMap(([key, agg]) => {
      const [method, route] = key.split(' ');
      const dims = [{ Name: 'Method', Value: method }, { Name: 'Route', Value: route }];
      return [
        { MetricName: 'RequestCount', Value: agg.count, Unit: 'Count', Timestamp: timestamp, Dimensions: dims },
        { MetricName: 'ServerErrors', Value: agg.errors, Unit: 'Count', Timestamp: timestamp, Dimensions: dims },
        {
          MetricName: 'ResponseTime',
          Unit: 'Milliseconds',
          Timestamp: timestamp,
          Dimensions: dims,
          StatisticValues: { SampleCount: agg.count, Sum: agg.sum, Minimum: agg.min, Maximum: agg.max },
        },
      ] as MetricDatum[];
    });
    await this.putMetricData(data);
    return data.length;
  }
}

/** Winston transport that ships logs to a CloudWatch Logs group in batches. */
export class CloudWatchLogsTransport extends Transport {
  private buffer: { message: string; timestamp: number }[] = [];
  private timer: NodeJS.Timeout;

  constructor(private readonly cw: CloudWatchService, private readonly logGroup: string, opts?: Transport.TransportStreamOptions) {
    super(opts);
    this.timer = setInterval(() => void this.flush(), 5000);
    this.timer.unref();
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    if (this.buffer.length < 10000) this.buffer.push({ message: JSON.stringify(info), timestamp: Date.now() });
    callback();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, 1000);
    await this.cw.putLogEvents(this.logGroup, batch).catch(() => undefined);
  }

  close(): void {
    clearInterval(this.timer);
    void this.flush();
  }
}
