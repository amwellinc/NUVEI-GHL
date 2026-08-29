# GoHighLevel (GHL) Integration Guide

This guide explains how the GHL-NUVEI Custom App integrates with GoHighLevel to process payments within your GHL workflows.

## 📋 Overview

The GHL integration allows you to:
- Process NUVEI payments directly from GHL contacts
- Store payment information in GHL contact records
- Track transaction history within GHL
- Manage refunds and payment statuses
- Sync payment data between NUVEI and GHL

## ⚙️ Configuration

### Step 1: Get Your GHL Credentials

1. **Location ID**: Navigate to your GHL location settings
2. **API Token**: Generate from GHL Settings > Integrations > API

### Step 2: Set Environment Variables

Add to your `.env` file or Railway dashboard:

```
GHL_LOCATION_ID=YOUR_GHL_LOCATION_ID
GHL_API_TOKEN=YOUR_GHL_API_TOKEN
GHL_API_ENDPOINT=https://rest.gohighlevel.com/v1
```

### Step 3: Verify Integration

```bash
curl -X GET http://localhost:3000/api/ghl/status \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "GHL integration active",
  "location": {
    "id": "YOUR_GHL_LOCATION_ID",
    "name": "Your Location Name",
    "email": "location@example.com"
  }
}
```

---

## 🚀 GHL Integration Endpoints

### 1. Check Integration Status

**Endpoint:** `GET /api/ghl/status`

Verifies that your GHL location is accessible and the integration is working.

**Response:**
```json
{
  "success": true,
  "message": "GHL integration active",
  "location": {
    "id": "YOUR_GHL_LOCATION_ID",
    "name": "Location Name",
    "email": "contact@location.com"
  }
}
```

---

### 2. Create Payment & Link to GHL Contact

**Endpoint:** `POST /api/ghl/payment/create`

Creates a NUVEI payment and automatically records it in the GHL contact record.

**Request Body:**
```json
{
  "contactId": "ghl-contact-id-123",
  "amount": 149.99,
  "currency": "USD",
  "description": "Product Purchase",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "ccNumber": "4111111111111111",
  "ccExpMonth": "12",
  "ccExpYear": "2025",
  "ccCvv": "123"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment processed and linked to GHL contact",
  "payment": {
    "transactionId": "12345678",
    "status": "SUCCESS",
    "amount": 149.99,
    "currency": "USD",
    "ghlContactId": "ghl-contact-id-123"
  },
  "data": {
    "transactionId": "12345678",
    "status": "SUCCESS",
    ...
  }
}
```

**What Happens Automatically:**
- ✅ Processes payment through NUVEI
- ✅ Creates a note in the GHL contact record with transaction details
- ✅ Stores transaction ID in custom field (if field exists)

---

### 3. Process Refund & Update GHL

**Endpoint:** `POST /api/ghl/payment/refund`

Refunds a payment and updates the GHL contact record.

**Request Body:**
```json
{
  "transactionId": "12345678",
  "contactId": "ghl-contact-id-123",
  "amount": 149.99,
  "currency": "USD",
  "description": "Customer requested refund"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Refund processed and recorded in GHL",
  "refund": {
    "transactionId": "12345678",
    "refundStatus": "SUCCESS",
    "amount": 149.99,
    "ghlContactId": "ghl-contact-id-123"
  }
}
```

---

### 4. Get All Contacts

**Endpoint:** `GET /api/ghl/contacts?limit=100&offset=0`

Fetch all contacts from your GHL location for payment operations.

**Query Parameters:**
- `limit`: Number of contacts to return (default: 100)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "contacts": [
    {
      "id": "contact-123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+1234567890",
      "customFields": {}
    },
    ...
  ],
  "totalCount": 250
}
```

---

### 5. Get Specific Contact Details

**Endpoint:** `GET /api/ghl/contacts/:contactId`

Fetch details for a specific contact.

**Response:**
```json
{
  "success": true,
  "contact": {
    "id": "contact-123",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "customFields": {
      "nuvei_transaction_id": "12345678"
    }
  }
}
```

---

### 6. Handle Payment Status Webhooks

**Endpoint:** `POST /api/ghl/webhook/payment-status`

Accepts webhook callbacks when payment status changes.

**Request Body:**
```json
{
  "transactionId": "12345678",
  "status": "SUCCESS",
  "contactId": "ghl-contact-id-123",
  "amount": 149.99
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed",
  "transactionId": "12345678",
  "status": "SUCCESS"
}
```

---

## 🔄 Workflow Examples

### Example 1: Complete Payment Workflow

```bash
# 1. Get a contact from GHL
curl -X GET "http://localhost:3000/api/ghl/contacts" \
  -H "Content-Type: application/json"

# 2. Create payment for that contact
curl -X POST "http://localhost:3000/api/ghl/payment/create" \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "contact-123",
    "amount": 99.99,
    "currency": "USD",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "ccNumber": "4111111111111111",
    "ccExpMonth": "12",
    "ccExpYear": "2025",
    "ccCvv": "123"
  }'

# 3. Check contact to see payment recorded
curl -X GET "http://localhost:3000/api/ghl/contacts/contact-123" \
  -H "Content-Type: application/json"
```

### Example 2: Process Refund

```bash
curl -X POST "http://localhost:3000/api/ghl/payment/refund" \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "12345678",
    "contactId": "contact-123",
    "amount": 99.99,
    "currency": "USD",
    "description": "Customer refund request"
  }'
```

---

## 📊 Data Synchronization

### What Gets Stored in GHL

When you create a payment through the GHL integration:

1. **Payment Note** - Automatically created on contact
   - Transaction ID
   - Amount and currency
   - Payment status
   - Timestamp

2. **Custom Field** (if configured)
   - `nuvei_transaction_id` - Transaction ID for lookup

3. **Contact History** - All actions logged in contact timeline

### Retrieving Payment Data from GHL

To find payments for a contact:

```bash
# Get contact details (includes payment notes)
curl -X GET "http://localhost:3000/api/ghl/contacts/contact-123"
```

Payment history is stored in the contact's notes and custom fields.

---

## 🔒 Security Considerations

### API Token Security
- Store `GHL_API_TOKEN` securely in environment variables
- Never commit to version control
- Rotate tokens regularly
- Use Railway's environment vault in production

### Request Validation
- All endpoints validate required fields
- Invalid requests return 400 Bad Request
- Missing credentials return 500 error

### Error Handling
- Detailed error messages in development
- Generic messages in production
- All errors logged for debugging

---

## 🐛 Troubleshooting

### "GHL credentials not configured"
```
Error: GHL_LOCATION_ID and GHL_API_TOKEN must be set
```
**Solution:** Verify environment variables are set correctly:
```bash
echo $GHL_LOCATION_ID
echo $GHL_API_TOKEN
```

### "Failed to connect to GHL"
```
Error: Status 401 - Unauthorized
```
**Solution:** 
- Verify API token is correct
- Check token hasn't expired (regenerate if needed)
- Ensure Location ID matches the token's location

### "Contact not found"
```
Error: Status 404 - Contact not found
```
**Solution:**
- Verify contact ID is correct
- Use `/api/ghl/contacts` to list available contacts
- Check contact hasn't been deleted

### Payment recorded in NUVEI but not in GHL
**Possible Causes:**
- GHL API token invalid (check API response)
- Contact ID typo or doesn't exist
- Note creation failed (app continues, but note not created)

**Solution:**
- Check app logs for GHL API errors
- Verify contact exists in GHL
- Use GHL dashboard to create note manually

---

## 🔗 Integration with GoHighLevel UI

To process payments through GHL:

1. **Custom Workflow Trigger**
   - Create automation that calls `/api/ghl/payment/create`
   - Pass contact ID from workflow context

2. **Embedded API Call**
   - Use GHL webhooks to call your NUVEI app
   - Process payment and receive response

3. **Custom Field Integration**
   - Display transaction ID from `nuvei_transaction_id` field
   - Show payment status in contact record

---

## 📈 Future Enhancements

Potential additions to GHL integration:

- [ ] Payment plans/recurring billing
- [ ] Group payment processing
- [ ] Advanced custom fields
- [ ] Reporting dashboard integration
- [ ] Automated receipt generation
- [ ] Multi-currency support
- [ ] PCI tokenization via GHL

---

## 📞 Support

For GHL integration issues:

1. Check this guide's troubleshooting section
2. Review your GHL API token permissions
3. Verify NUVEI credentials are correct
4. Check application logs for detailed errors

**GHL API Documentation:** https://highlevel.stoplight.io/
**NUVEI Documentation:** https://developers.nuvei.com/

---

## 🔄 Version History

- **v1.0.0** - Initial GHL integration
  - Payment creation with contact linking
  - Refund processing
  - Contact management
  - Webhook support

---

**Last Updated:** March 20, 2026
