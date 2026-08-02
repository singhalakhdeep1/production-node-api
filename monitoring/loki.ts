// Grafana Loki integration for production-node-api

const axios = require('axios');

class LokiService {
  constructor(lokiUrl = 'http://localhost:3100') {
    this.lokiUrl = lokiUrl;
  }

  async sendLog(logEntry) {
    const stream = {
      stream: {
        job: logEntry.job || 'node-api',
        level: logEntry.level || 'info',
        environment: logEntry.environment || 'production'
      },
      values: [
        [
          Date.now().toString(),
          JSON.stringify(logEntry.message)
        ]
      ]
    };

    try {
      await axios.post(`${this.lokiUrl}/loki/api/v1/push`, {
        streams: [stream]
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending log to Loki:', error);
      return { success: false, error: error.message };
    }
  }

  async queryLogs(query, limit = 100, timeRange = '1h') {
    try {
      const response = await axios.get(`${this.lokiUrl}/loki/api/v1/query_range`, {
        params: {
          query: query,
          limit: limit,
          start: this._getStartTime(timeRange),
          end: Date.now()
        }
      });
      return response.data;
    } catch (error) {
      console.error('Error querying logs from Loki:', error);
      return { success: false, error: error.message };
    }
  }

  async getLabels() {
    try {
      const response = await axios.get(`${this.lokiUrl}/loki/api/v1/labels`);
      return response.data;
    } catch (error) {
      console.error('Error getting labels from Loki:', error);
      return { success: false, error: error.message };
    }
  }

  async getLabelValues(label) {
    try {
      const response = await axios.get(`${this.lokiUrl}/loki/api/v1/label/${label}/values`);
      return response.data;
    } catch (error) {
      console.error('Error getting label values from Loki:', error);
      return { success: false, error: error.message };
    }
  }

  _getStartTime(timeRange) {
    const ranges = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000
    };
    return Date.now() - (ranges[timeRange] || ranges['1h']);
  }

  async createStructuredLog(level, message, context = {}) {
    return this.sendLog({
      job: context.job || 'node-api',
      level: level,
      environment: context.environment || 'production',
      message: {
        level: level,
        message: message,
        timestamp: new Date().toISOString(),
        ...context
      }
    });
  }

  async info(message, context = {}) {
    return this.createStructuredLog('info', message, context);
  }

  async warn(message, context = {}) {
    return this.createStructuredLog('warn', message, context);
  }

  async error(message, context = {}) {
    return this.createStructuredLog('error', message, context);
  }

  async debug(message, context = {}) {
    return this.createStructuredLog('debug', message, context);
  }
}

module.exports = LokiService;
