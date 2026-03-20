# NUVEI Custom App Configuration

## Environment Variables Template

Create a `.env` file in the project root (do not commit this file):

```
# Server Configuration
PORT=3000
NODE_ENV=development

# NUVEI API Configuration
NUVEI_MERCHANT_ID=your_merchant_id_here
NUVEI_SECRET_KEY=your_secret_key_here
NUVEI_API_ENDPOINT=https://secure.safecharge.com/api/v1
NUVEI_SANDBOX_MODE=true
```

## Getting NUVEI Credentials

1. Log in to your NUVEI merchant account
2. Navigate to Settings > API
3. Or contact NUVEI support for your Merchant ID and Secret Key

## Configuration Details

- **NUVEI_MERCHANT_ID**: Your NUVEI merchant/terminal ID
- **NUVEI_SECRET_KEY**: Your NUVEI API secret key for authentication
- **NUVEI_API_ENDPOINT**: NUVEI's REST API endpoint (default provided)
- **NUVEI_SANDBOX_MODE**: Set to 'true' for testing, 'false' for production

## Security Notes

- Never commit the `.env` file
- Keep secret keys secure and hidden
- Use environment variables for all sensitive data
- Rotate keys regularly
