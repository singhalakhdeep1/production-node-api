// Tempo tracing integration for production-node-api

const axios = require('axios');

class TempoService {
  constructor(tempoUrl = 'http://localhost:3200') {
    this.tempoUrl = tempoUrl;
  }

  async sendTrace(trace) {
    try {
      await axios.post(`${this.tempoUrl}/api/v1/traces`, trace, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      return { success: true };
    } catch (error) {
      console.error('Error sending trace to Tempo:', error);
      return { success: false, error: error.message };
    }
  }

  async getTrace(traceId) {
    try {
      const response = await axios.get(`${this.tempoUrl}/api/traces/${traceId}`);
      return response.data;
    } catch (error) {
      console.error('Error getting trace from Tempo:', error);
      return { success: false, error: error.message };
    }
  }

  async searchTraces(query) {
    try {
      const response = await axios.get(`${this.tempoUrl}/api/search`, {
        params: query
      });
      return response.data;
    } catch (error) {
      console.error('Error searching traces in Tempo:', error);
      return { success: false, error: error.message };
    }
  }

  createSpan(operationName, parentSpanId = null, startTime = Date.now()) {
    return {
      traceID: this._generateTraceId(),
      spanID: this._generateSpanId(),
      parentSpanID: parentSpanId,
      operationName: operationName,
      startTime: startTime,
      duration: 0,
      tags: [],
      logs: []
    };
  }

  finishSpan(span, tags = [], logs = []) {
    span.duration = Date.now() - span.startTime;
    span.tags = tags;
    span.logs = logs;
    return span;
  }

  async sendSpan(span) {
    const trace = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: 'node-api' },
              { key: 'service.version', value: '1.0.0' }
            ]
          },
          scopeSpans: [
            {
              scope: {
                name: 'node-api'
              },
              spans: [span]
            }
          ]
        }
      ]
    };
    return this.sendTrace(trace);
  }

  _generateTraceId() {
    return Array.from({ length: 16 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  _generateSpanId() {
    return Array.from({ length: 8 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  async traceMiddleware(req, res, next) {
    const span = this.createSpan(`${req.method} ${req.path}`);
    req.span = span;
    
    const startTime = Date.now();
    
    res.on('finish', () => {
      const tags = [
        { key: 'http.method', value: req.method },
        { key: 'http.url', value: req.url },
        { key: 'http.status_code', value: res.statusCode.toString() }
      ];
      
      const logs = [
        {
          timestamp: Date.now(),
          fields: [
            { key: 'message', value: 'Request completed' }
          ]
        }
      ];
      
      this.finishSpan(span, tags, logs);
      this.sendSpan(span);
    });
    
    next();
  }
}

module.exports = TempoService;
