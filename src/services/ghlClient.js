const axios = require('axios');

class GHLClient {
  constructor(config) {
    this.locationId = config.locationId;
    this.apiToken = config.apiToken;
    this.apiEndpoint = config.apiEndpoint || 'https://rest.gohighlevel.com/v1';
  }

  /**
   * Make a request to GHL API
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} endpoint - API endpoint path
   * @param {Object} data - Request body data
   * @returns {Promise<Object>} - API response
   */
  async makeRequest(method, endpoint, data = null) {
    try {
      const config = {
        method,
        url: `${this.apiEndpoint}${endpoint}`,
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 30000
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error(`GHL API Error: ${error.message}`);
      throw {
        statusCode: error.response?.status || 500,
        message: error.response?.data?.message || error.message,
        details: error.response?.data
      };
    }
  }

  /**
   * Get location details
   * @returns {Promise<Object>} - Location information
   */
  async getLocation() {
    return this.makeRequest('GET', `/locations/${this.locationId}`);
  }

  /**
   * Create a pipeline for payments
   * @param {Object} pipelineData - Pipeline configuration
   * @returns {Promise<Object>} - Created pipeline
   */
  async createPipeline(pipelineData) {
    return this.makeRequest('POST', `/locations/${this.locationId}/pipelines`, {
      name: pipelineData.name,
      stages: pipelineData.stages || [],
      description: pipelineData.description
    });
  }

  /**
   * Create a task/deal for payment tracking
   * @param {Object} taskData - Task information
   * @returns {Promise<Object>} - Created task
   */
  async createTask(taskData) {
    return this.makeRequest('POST', `/locations/${this.locationId}/tasks`, {
      title: taskData.title,
      description: taskData.description,
      dueDate: taskData.dueDate,
      assignedTo: taskData.assignedTo,
      customFields: taskData.customFields || {}
    });
  }

  /**
   * Create a custom field for storing payment data
   * @param {Object} fieldData - Field configuration
   * @returns {Promise<Object>} - Created field
   */
  async createCustomField(fieldData) {
    return this.makeRequest('POST', `/locations/${this.locationId}/custom-fields`, {
      name: fieldData.name,
      type: fieldData.type,
      description: fieldData.description
    });
  }

  /**
   * Get contacts for a location
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} - List of contacts
   */
  async getContacts(filters = {}) {
    let url = `/locations/${this.locationId}/contacts`;
    
    if (Object.keys(filters).length > 0) {
      const queryParams = new URLSearchParams(filters).toString();
      url += `?${queryParams}`;
    }

    return this.makeRequest('GET', url);
  }

  /**
   * Update contact with payment information
   * @param {string} contactId - Contact ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} - Updated contact
   */
  async updateContact(contactId, updateData) {
    return this.makeRequest('PUT', `/locations/${this.locationId}/contacts/${contactId}`, updateData);
  }

  /**
   * Create a note for contact (payment record)
   * @param {string} contactId - Contact ID
   * @param {Object} noteData - Note information
   * @returns {Promise<Object>} - Created note
   */
  async createNote(contactId, noteData) {
    return this.makeRequest('POST', `/locations/${this.locationId}/contacts/${contactId}/notes`, {
      body: noteData.body,
      type: noteData.type || 'general'
    });
  }

  /**
   * Create a custom value for a contact
   * @param {string} contactId - Contact ID
   * @param {string} fieldName - Custom field name
   * @param {string} value - Field value
   * @returns {Promise<Object>} - Updated contact
   */
  async setCustomField(contactId, fieldName, value) {
    return this.makeRequest('PUT', `/locations/${this.locationId}/contacts/${contactId}`, {
      customFields: {
        [fieldName]: value
      }
    });
  }

  /**
   * Get webhooks for location
   * @returns {Promise<Object>} - List of webhooks
   */
  async getWebhooks() {
    return this.makeRequest('GET', `/locations/${this.locationId}/webhooks`);
  }

  /**
   * Register a webhook for payment events
   * @param {Object} webhookData - Webhook configuration
   * @returns {Promise<Object>} - Created webhook
   */
  async registerWebhook(webhookData) {
    return this.makeRequest('POST', `/locations/${this.locationId}/webhooks`, {
      url: webhookData.url,
      events: webhookData.events,
      description: webhookData.description
    });
  }
}

module.exports = GHLClient;
