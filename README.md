# GoHighLevel Custom App - NUVEI Payment Gateway

A Node.js/Express backend custom app for integrating NUVEI payment processing with GoHighLevel.

## Features

- ✅ NUVEI Payment Processing (Server-to-Server API)
- ✅ Payment Creation with Credit Card
- ✅ Payment Details Retrieval
- ✅ Refund Processing
- ✅ Transaction Void (Cancel)
- ✅ Health Check Endpoint
- ✅ Secure Authentication

## Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- NUVEI merchant account with API credentials (Merchant ID and Secret Key)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd ghl-nuvei-custom-app
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file in the project root:
```bash
cp .env.example .env
```

4. Update the `.env` file with your NUVEI credentials:
```
NUVEI_MERCHANT_ID=your_merchant_id
NUVEI_SECRET_KEY=your_secret_key
NUVEI_API_ENDPOINT=https://secure.safecharge.com/api/v1
NUVEI_SANDBOX_MODE=true
PORT=3000
NODE_ENV=development
```

## Development

Start the development server with auto-reload:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## API Endpoints

### Health Check
```
GET /api/health
```
Returns server health status and uptime.

### Create Payment
```
POST /api/payments/create
Content-Type: application/json

{
  "amount": 100.00,
  "currency": "USD",
  "clientUniqueId": "unique-client-id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "ccNumber": "4111111111111111",
  "ccExpMonth": "12",
  "ccExpYear": "25",
  "ccCvv": "123",
  "description": "Order #123"
}
```

**Required fields**: amount, firstName, lastName, email, ccNumber, ccExpMonth, ccExpYear, ccCvv

**Response**:
```json
{
  "success": true,
  "data": {
    "transactionId": "...",
    "status": "...",
    ...
  }
}
```

### Get Payment Details
```
GET /api/payments/:transactionId
```

Retrieve details of a previously created payment.

### Refund Payment
```
POST /api/payments/refund
Content-Type: application/json

{
  "transactionId": "transaction-id",
  "clientUniqueId": "client-id",
  "amount": 100.00,
  "currency": "USD",
  "description": "Refund for order #123"
}
```

### Void Payment
```
POST /api/payments/void
Content-Type: application/json

{
  "transactionId": "transaction-id",
  "clientUniqueId": "client-id"
}
```

## Project Structure

```
src/
├── server.js                 # Main Express server
├── routes/
│   ├── payments.js          # Payment endpoints
│   └── health.js            # Health check endpoint
├── services/
│   └── nuveiClient.js       # NUVEI API client
└── config/
    └── nuvei.config.js      # NUVEI configuration
```

## Error Handling

All endpoints return error responses in the following format:
```json
{
  "success": false,
  "error": "Error message",
  "details": {...}
}
```

## Security Considerations

- Always use HTTPS in production
- Keep NUVEI credentials in environment variables
- Never commit `.env` file
- Validate all input parameters
- Use appropriate CORS settings if accessed from frontend
- Implement rate limiting for production

## Testing with cURL

Create a payment:
```bash
curl -X POST http://localhost:3000/api/payments/create \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "currency": "USD",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "ccNumber": "4111111111111111",
    "ccExpMonth": "12",
    "ccExpYear": "25",
    "ccCvv": "123"
  }'
```

Health check:
```bash
curl http://localhost:3000/api/health
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| PORT | No | 3000 | Server port |
| NODE_ENV | No | development | Environment mode |
| NUVEI_MERCHANT_ID | Yes | - | NUVEI Merchant ID |
| NUVEI_SECRET_KEY | Yes | - | NUVEI Secret Key |
| NUVEI_API_ENDPOINT | No | https://secure.safecharge.com/api/v1 | NUVEI API endpoint |
| NUVEI_SANDBOX_MODE | No | true | Sandbox mode toggle |

## Deployment

For production deployment:

1. Set `NODE_ENV=production`
2. Set `NUVEI_SANDBOX_MODE=false`
3. Update `NUVEI_API_ENDPOINT` to production endpoint
4. Use a process manager like PM2 or Docker
5. Configure HTTPS/SSL
6. Set up proper logging and monitoring

## Support

For issues with NUVEI API integration, refer to [NUVEI Documentation](https://docs.nuvei.com/)

## License

MIT
