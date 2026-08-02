// PagerDuty integration for production-node-api

const axios = require('axios');

class PagerDutyService {
  constructor(apiKey, integrationKey) {
    this.apiKey = apiKey;
    this.integrationKey = integrationKey;
    this.baseUrl = 'https://api.pagerduty.com';
  }

  async triggerIncident(incident) {
    const payload = {
      routing_key: this.integrationKey,
      event_action: 'trigger',
      dedup_key: incident.dedupKey,
      payload: {
        summary: incident.summary,
        severity: incident.severity || 'critical',
        source: incident.source || 'node-api',
        timestamp: new Date().toISOString(),
        custom_details: incident.details || {}
      }
    };

    try {
      const response = await axios.post(
        'https://events.pagerduty.com/v2/enqueue',
        payload
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error triggering PagerDuty incident:', error);
      return { success: false, error: error.message };
    }
  }

  async acknowledgeIncident(incidentId) {
    const payload = {
      routing_key: this.integrationKey,
      event_action: 'acknowledge',
      dedup_key: incidentId
    };

    try {
      const response = await axios.post(
        'https://events.pagerduty.com/v2/enqueue',
        payload
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error acknowledging PagerDuty incident:', error);
      return { success: false, error: error.message };
    }
  }

  async resolveIncident(incidentId) {
    const payload = {
      routing_key: this.integrationKey,
      event_action: 'resolve',
      dedup_key: incidentId
    };

    try {
      const response = await axios.post(
        'https://events.pagerduty.com/v2/enqueue',
        payload
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error resolving PagerDuty incident:', error);
      return { success: false, error: error.message };
    }
  }

  async getIncidents(serviceId, status = 'triggered') {
    const headers = {
      'Accept': 'application/vnd.pagerduty+json;version=2',
      'Authorization': `Token token=${this.apiKey}`
    };

    try {
      const response = await axios.get(
        `${this.baseUrl}/incidents`,
        {
          headers: headers,
          params: {
            service_ids: [serviceId],
            statuses: [status]
          }
        }
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error getting PagerDuty incidents:', error);
      return { success: false, error: error.message };
    }
  }

  async createService(serviceConfig) {
    const headers = {
      'Accept': 'application/vnd.pagerduty+json;version=2',
      'Content-Type': 'application/json',
      'Authorization': `Token token=${this.apiKey}`
    };

    const payload = {
      service: {
        name: serviceConfig.name,
        type: serviceConfig.type || 'api',
        description: serviceConfig.description || '',
        escalation_policy: serviceConfig.escalationPolicy
      }
    };

    try {
      const response = await axios.post(
        `${this.baseUrl}/services`,
        payload,
        { headers }
      );
      return { success: true, data: response.data };
    } catch (error) {
      console.error('Error creating PagerDuty service:', error);
      return { success: false, error: error.message };
    }
  }

  async triggerErrorAlert(error, context = {}) {
    return this.triggerIncident({
      summary: `Error in Node API: ${error.message}`,
      severity: 'critical',
      source: 'node-api',
      dedupKey: `error-${error.message}`,
      details: {
        error: error.message,
        stack: error.stack,
        ...context
      }
    });
  }

  async triggerHighLatencyAlert(latency, threshold, context = {}) {
    return this.triggerIncident({
      summary: `High latency detected: ${latency}ms (threshold: ${threshold}ms)`,
      severity: 'warning',
      source: 'node-api',
      dedupKey: `latency-${context.endpoint || 'unknown'}`,
      details: {
        latency: latency,
        threshold: threshold,
        ...context
      }
    });
  }

  async triggerHighErrorRateAlert(errorRate, threshold, context = {}) {
    return this.triggerIncident({
      summary: `High error rate detected: ${errorRate}% (threshold: ${threshold}%)`,
      severity: 'critical',
      source: 'node-api',
      dedupKey: `error-rate-${context.endpoint || 'unknown'}`,
      details: {
        errorRate: errorRate,
        threshold: threshold,
        ...context
      }
    });
  }
}

module.exports = PagerDutyService;
