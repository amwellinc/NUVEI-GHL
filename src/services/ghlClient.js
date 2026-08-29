const axios = require('axios');

class GHLClient {
  constructor(config) {
    this.locationId = config.locationId;
    this.apiToken = config.apiToken;
    // v2 API endpoint for Custom App / Private Integration
    this.apiEndpoint = config.apiEndpoint || 'https://services.leadconnectorhq.com';
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
          'Accept': 'application/json',
          'Version': '2021-07-28'
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
   * Get contacts for a location (v2 API)
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} - List of contacts
   */
  async getContacts(filters = {}) {
    const params = new URLSearchParams({ locationId: this.locationId, ...filters });
    return this.makeRequest('GET', `/contacts/?${params.toString()}`);
  }

  /**
   * Update contact with payment information (v2 API)
   * @param {string} contactId - Contact ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} - Updated contact
   */
  async updateContact(contactId, updateData) {
    return this.makeRequest('PUT', `/contacts/${contactId}`, updateData);
  }

  /**
   * Create a note for contact (payment record) (v2 API)
   * @param {string} contactId - Contact ID
   * @param {Object} noteData - Note information
   * @returns {Promise<Object>} - Created note
   */
  async createNote(contactId, noteData) {
    return this.makeRequest('POST', `/contacts/${contactId}/notes`, {
      body: noteData.body,
      userId: process.env.GHL_USER_ID || ''
    });
  }

  /**
   * Set a custom field value on a contact (v2 API)
   * @param {string} contactId - Contact ID
   * @param {string} fieldKey - Custom field key
   * @param {string} value - Field value
   * @returns {Promise<Object>} - Updated contact
   */
  async setCustomField(contactId, fieldKey, value) {
    return this.makeRequest('PUT', `/contacts/${contactId}`, {
      customFields: [{ key: fieldKey, field_value: value }]
    });
  }

  /**
   * Associate a contact to a company (one-to-many support)
   * @param {string} contactId - Contact ID
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} - Updated contact
   */
  async updateContactCompany(contactId, companyId) {
    return this.updateContact(contactId, { companyId });
  }

  /**
   * Associate multiple contacts to one company
   * @param {string} companyId - Company ID
   * @param {Array<string>} contactIds - Array of contact IDs
   * @returns {Promise<Object[]>} - Updated contacts array
   */
  async associateContactsToCompany(companyId, contactIds = []) {
    if (!companyId) {
      throw { statusCode: 400, message: 'companyId is required' };
    }
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      throw { statusCode: 400, message: 'contactIds must be a non-empty array' };
    }

    const results = [];
    for (const contactId of contactIds) {
      const updated = await this.updateContactCompany(contactId, companyId);
      results.push({ contactId, updated });
    }
    return results;
  }

  /**
   * Get webhooks for location (v2 API)
   * @returns {Promise<Object>} - List of webhooks
   */
  async getWebhooks() {
    return this.makeRequest('GET', `/locations/${this.locationId}/webhooks`);
  }

  /**
   * Register a webhook for payment events (v2 API)
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
