// AWS CloudWatch integration for production-node-api

const AWS = require('aws-sdk');

class CloudWatchService {
  constructor(region = 'us-east-1') {
    this.cloudwatch = new AWS.CloudWatch({ region: region });
    this.cloudwatchLogs = new AWS.CloudWatchLogs({ region: region });
  }

  async putMetric(metricName, value, namespace = 'NodeAPI', dimensions = []) {
    const params = {
      Namespace: namespace,
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Timestamp: new Date(),
          Dimensions: dimensions
        }
      ]
    };

    try {
      await this.cloudwatch.putMetricData(params).promise();
      return { success: true };
    } catch (error) {
      console.error('Error sending metric to CloudWatch:', error);
      return { success: false, error: error.message };
    }
  }

  async putCustomMetric(metricName, value, unit = 'Count', dimensions = []) {
    return this.putMetric(metricName, value, 'NodeAPI/Custom', dimensions);
  }

  async createLogGroup(logGroupName) {
    const params = {
      logGroupName: logGroupName
    };

    try {
      await this.cloudwatchLogs.createLogGroup(params).promise();
      return { success: true };
    } catch (error) {
      if (error.code === 'ResourceAlreadyExistsException') {
        return { success: true, exists: true };
      }
      console.error('Error creating log group:', error);
      return { success: false, error: error.message };
    }
  }

  async putLogEvents(logGroupName, logEvents) {
    const params = {
      logGroupName: logGroupName,
      logEvents: logEvents.map(event => ({
        message: JSON.stringify(event),
        timestamp: event.timestamp || Date.now()
      }))
    };

    try {
      await this.cloudwatchLogs.putLogEvents(params).promise();
      return { success: true };
    } catch (error) {
      console.error('Error sending logs to CloudWatch:', error);
      return { success: false, error: error.message };
    }
  }

  async getMetricStatistics(metricName, namespace = 'NodeAPI', period = 300) {
    const params = {
      Namespace: namespace,
      MetricName: metricName,
      StartTime: new Date(Date.now() - 3600000),
      EndTime: new Date(),
      Period: period,
      Statistics: ['Average', 'Maximum', 'Minimum', 'SampleCount']
    };

    try {
      const result = await this.cloudwatch.getMetricStatistics(params).promise();
      return { success: true, data: result.Datapoints };
    } catch (error) {
      console.error('Error getting metric statistics:', error);
      return { success: false, error: error.message };
    }
  }

  async createAlarm(alarmName, metricName, threshold, comparisonOperator) {
    const params = {
      AlarmName: alarmName,
      AlarmDescription: `Alert for ${metricName}`,
      Namespace: 'NodeAPI',
      MetricName: metricName,
      Threshold: threshold,
      ComparisonOperator: comparisonOperator,
      EvaluationPeriods: 1,
      Period: 300,
      Statistic: 'Average'
    };

    try {
      await this.cloudwatch.putMetricAlarm(params).promise();
      return { success: true };
    } catch (error) {
      console.error('Error creating alarm:', error);
      return { success: false, error: error.message };
    }
  }

  async logRequest(req, res, next) {
    const logEvent = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      responseTime: res.responseTime,
      userAgent: req.headers['user-agent'],
      ip: req.ip
    };

    await this.putLogEvents('node-api-logs', [logEvent]);
    next();
  }

  async trackRequestCount(req, res, next) {
    await this.putMetric('RequestCount', 1, 'NodeAPI', [
      { Name: 'Method', Value: req.method },
      { Name: 'Path', Value: req.path }
    ]);
    next();
  }

  async trackResponseTime(req, res, next) {
    const startTime = Date.now();
    
    res.on('finish', async () => {
      const responseTime = Date.now() - startTime;
      await this.putMetric('ResponseTime', responseTime, 'NodeAPI', [
        { Name: 'Method', Value: req.method },
        { Name: 'Path', Value: req.path },
        { Name: 'StatusCode', Value: res.statusCode.toString() }
      ]);
    });
    
    next();
  }
}

module.exports = CloudWatchService;
