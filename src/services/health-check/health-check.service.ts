/**
 * Health Check Service (HLD/LLD #1)
 * Named checks with per-check timeout, liveness/readiness probes and pass/warn/fail aggregation.
 * Checks marked non-critical can only degrade the result to "warn", never fail readiness.
 */
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  healthy: boolean;
  message?: string;
  degraded?: boolean;
  details?: Record<string, unknown>;
}

interface RegisteredCheck {
  fn: () => Promise<CheckResult>;
  critical: boolean;
}

export interface HealthReport {
  status: CheckStatus;
  timestamp: string;
  duration: number;
  checks: Record<string, { status: CheckStatus; message: string; duration: number; critical: boolean; details?: Record<string, unknown> }>;
}

export class HealthCheckService {
  private checks = new Map<string, RegisteredCheck>();
  private lastReport: HealthReport | null = null;

  constructor(private readonly timeoutMs = 10000) {}

  registerCheck(name: string, fn: () => Promise<CheckResult>, options: { critical?: boolean } = {}): void {
    this.checks.set(name, { fn, critical: options.critical ?? true });
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); },
      );
    });
  }

  async performHealthCheck(): Promise<HealthReport> {
    const startTime = Date.now();
    const entries = await Promise.all(
      [...this.checks].map(async ([name, check]) => {
        const checkStart = Date.now();
        try {
          const result = await this.withTimeout(check.fn());
          const status: CheckStatus = result.healthy ? (result.degraded ? 'warn' : 'pass') : check.critical ? 'fail' : 'warn';
          return [name, { status, message: result.message ?? '', duration: Date.now() - checkStart, critical: check.critical, details: result.details }] as const;
        } catch (error) {
          return [name, {
            status: (check.critical ? 'fail' : 'warn') as CheckStatus,
            message: error instanceof Error ? error.message : String(error),
            duration: Date.now() - checkStart,
            critical: check.critical,
          }] as const;
        }
      }),
    );

    const checks = Object.fromEntries(entries);
    this.lastReport = {
      status: this.determineOverallStatus(Object.values(checks).map((c) => c.status)),
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
      checks,
    };
    return this.lastReport;
  }

  async performLivenessCheck() {
    return { status: 'pass' as CheckStatus, timestamp: new Date().toISOString(), uptime: process.uptime() };
  }

  async performReadinessCheck() {
    const report = await this.performHealthCheck();
    return { status: (report.status === 'fail' ? 'fail' : 'pass') as CheckStatus, timestamp: report.timestamp, checks: report.checks };
  }

  getLastReport(): HealthReport | null {
    return this.lastReport;
  }

  determineOverallStatus(statuses: CheckStatus[]): CheckStatus {
    if (statuses.includes('fail')) return 'fail';
    if (statuses.includes('warn')) return 'warn';
    return 'pass';
  }
}
