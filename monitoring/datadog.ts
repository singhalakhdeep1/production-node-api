// Datadog APM integration for production-node-api

const tracer = require('dd-trace').init({
  service: 'node-api',
  env: 'production',
  logInjection: true,
  analytics: true
});

class DatadogService {
  constructor() {
    this.tracer = tracer;
  }

  startSpan(operationName, options = {}) {
    return this.tracer.startSpan(operationName, options);
  }

  async traceAsync(operationName, fn) {
    const span = this.startSpan(operationName);
    try {
      const result = await fn(span);
      span.finish();
      return result;
    } catch (error) {
      span.setTag('error', true);
      span.setTag('error.message', error.message);
      span.finish();
      throw error;
    }
  }

  traceMiddleware(req, res, next) {
    const span = this.tracer.startSpan('http.request', {
      tags: {
        'http.url': req.url,
        'http.method': req.method,
        'span.type': 'web'
      }
    });

    req.span = span;

    res.on('finish', () => {
      span.setTag('http.status_code', res.statusCode);
      span.finish();
    });

    next();
  }

  addTags(span, tags) {
    if (span && typeof span.setTag === 'function') {
      Object.entries(tags).forEach(([key, value]) => {
        span.setTag(key, value);
      });
    }
  }

  addError(span, error) {
    if (span && typeof span.setTag === 'function') {
      span.setTag('error', true);
      span.setTag('error.message', error.message);
      span.setTag('error.stack', error.stack);
    }
  }

  async sendMetric(metricName, value, type = 'count', tags = {}) {
    const statsd = require('node-dogstatsd').StatsD;
    const client = new statsd('localhost', 8125);
    
    return new Promise((resolve, reject) => {
      const tagString = Object.entries(tags)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      
      client[metric](metricName, value, tagString, (err) => {
        if (err) {
          reject({ success: false, error: err.message });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  async incrementCounter(metricName, value = 1, tags = {}) {
    return this.sendMetric(metricName, value, 'count', tags);
  }

  async gauge(metricName, value, tags = {}) {
    return this.sendMetric(metricName, value, 'gauge', tags);
  }

  async histogram(metricName, value, tags = {}) {
    return this.sendMetric(metricName, value, 'histogram', tags);
  }

  async timing(metricName, value, tags = {}) {
    return this.sendMetric(metricName, value, 'timing', tags);
  }

  async traceDatabaseQuery(query, dbType, fn) {
    const span = this.startSpan('database.query', {
      tags: {
        'db.type': dbType,
        'db.system': dbType,
        'span.type': 'sql'
      }
    });

    span.setTag('db.query', query);

    try {
      const result = await fn(span);
      span.finish();
      return result;
    } catch (error) {
      this.addError(span, error);
      span.finish();
      throw error;
    }
  }

  async traceExternalCall(url, method, fn) {
    const span = this.startSpan('http.client', {
      tags: {
        'http.url': url,
        'http.method': method,
        'span.type': 'http'
      }
    });

    try {
      const result = await fn(span);
      span.finish();
      return result;
    } catch (error) {
      this.addError(span, error);
      span.finish();
      throw error;
    }
  }
}

module.exports = DatadogService;
