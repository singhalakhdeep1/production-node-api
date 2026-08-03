/**
 * Health Check Service for Production Node API
 * Implements comprehensive health checking for production monitoring
 */
class HealthCheckService {
  constructor() {
    this.checks = new Map();
  }

  registerCheck(name, checkFunction) {
    this.checks.set(name, checkFunction);
  }

  async performHealthCheck() {
    const results = {};
    const startTime = Date.now();

    for (const [name, checkFunction] of this.checks) {
      try {
        const checkStartTime = Date.now();
        const result = await checkFunction();
        const duration = Date.now() - checkStartTime;

        results[name] = {
          status: result.healthy ? 'pass' : 'fail',
          message: result.message || '',
          duration
        };
      } catch (error) {
        results[name] = {
          status: 'fail',
          message: error.message,
          duration: Date.now() - startTime
        };
      }
    }

    const overallStatus = this.determineOverallStatus(results);
    const totalDuration = Date.now() - startTime;

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      duration: totalDuration,
      checks: results
    };
  }

  async performLivenessCheck() {
    // Simplified liveness - just check if server is responding
    return {
      status: 'pass',
      timestamp: new Date().toISOString()
    };
  }

  async performReadinessCheck() {
    // Readiness - check if all critical checks pass
    const healthCheck = await this.performHealthCheck();
    return {
      status: healthCheck.status === 'pass' ? 'pass' : 'fail',
      timestamp: new Date().toISOString()
    };
  }

  determineOverallStatus(results) {
    const statuses = Object.values(results).map(r => r.status);

    if (statuses.some(s => s === 'fail')) {
      return 'fail';
    }

    if (statuses.some(s => s === 'warn')) {
      return 'warn';
    }

    return 'pass';
  }
}

module.exports = HealthCheckService;
