/**
 * Circuit Breaker Service for Production Node API
 * Implements circuit breaker pattern for fault tolerance
 */
class CircuitBreakerService {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    this.state = 'closed'; // closed, open, half-open
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
  }

  async execute(operation) {
    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        console.log('Circuit breaker transitioning to half-open');
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.reset();
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.trip();
    }
  }

  trip() {
    this.state = 'open';
    console.log(`Circuit breaker opened after ${this.failureCount} failures`);
  }

  reset() {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    console.log('Circuit breaker reset to closed');
  }

  shouldAttemptReset() {
    return this.lastFailureTime && (Date.now() - this.lastFailureTime) > this.resetTimeout;
  }

  getState() {
    return this.state;
  }

  getFailureCount() {
    return this.failureCount;
  }

  manualReset() {
    this.reset();
  }

  manualTrip() {
    this.trip();
  }
}

module.exports = CircuitBreakerService;
