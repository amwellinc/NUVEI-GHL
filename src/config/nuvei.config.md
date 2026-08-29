# NUVEI Custom App Configuration

## Environment Variables Template

Create a `.env` file in the project root (do not commit this file):

```
# Server Configuration
PORT=3000
NODE_ENV=development

# NUVEI API Configuration (REST 1.0 — checksum-based auth)
NUVEI_MERCHANT_ID=your_merchant_id_here
NUVEI_MERCHANT_SITE_ID=your_merchant_site_id_here
NUVEI_SECRET_KEY=your_secret_key_here
NUVEI_API_ENDPOINT=
NUVEI_SANDBOX_MODE=true
```

## Getting NUVEI Credentials

1. Log in to your NUVEI merchant account (Control Panel)
2. Navigate to Settings > API, or contact your Nuvei account manager
3. You need all three: Merchant ID, Merchant Site ID, and Secret Key

## Configuration Details

- **NUVEI_MERCHANT_ID**: Your NUVEI merchant ID
- **NUVEI_MERCHANT_SITE_ID**: Your NUVEI site ID (identifies the specific website/app under the merchant account) — required on every request, there is no fallback
- **NUVEI_SECRET_KEY**: Your NUVEI merchant secret key, used to sign the SHA-256 checksum on every request. Never send it to a browser/client.
- **NUVEI_API_ENDPOINT**: Optional override. Leave blank to auto-select based on `NUVEI_SANDBOX_MODE`:
  - sandbox: `https://ppp-test.nuvei.com/ppp/api/v1`
  - production: `https://secure.safecharge.com/ppp/api/v1`
- **NUVEI_SANDBOX_MODE**: `true` for testing, `false` for production

## Security Notes

- Never commit the `.env` file
- Keep secret keys secure and hidden
- Use environment variables for all sensitive data
- Rotate keys regularly
