# NUVEI (BaseCommerce) Custom App Configuration

This merchant's gateway account is **BaseCommerce (BaseX)**, a proprietary
3DES-encrypted payment platform — not Nuvei's REST 1.0 checksum-based API,
and not NMI's Direct Post API (both were dead-end guesses before this was
confirmed). Confirmed live 2026-08-29: a real SALE transaction against
production correctly authenticated, encrypted, and was evaluated by the
actual card network (declined with response_code 2006 "No such Issuer" —
the expected, safe outcome for a well-known non-issuable test card number).

Protocol reference: the open-source PHP port at
github.com/greenlystinc/basecommerce-php, which reimplements "the SDK
provided by BaseCommerce" with the same wire protocol (JSON body with
`gateway_username`/`gateway_password`/`payload`, where `payload` is
Triple DES (DES-EDE3, ECB) encrypted JSON, hex-encoded, keyed by
hex-decoding the SDK Key).

## Environment Variables Template

Create a `.env` file in the project root (do not commit this file):

```
# Server Configuration
PORT=3000
NODE_ENV=development

# NUVEI (BaseCommerce) API Configuration
NUVEI_SDK_USERNAME=your_basecommerce_sdk_username
NUVEI_SDK_PASSWORD=your_basecommerce_sdk_password
NUVEI_SDK_KEY=your_basecommerce_sdk_key
NUVEI_ORGANIZATION_ID=
NUVEI_SANDBOX_MODE=true
NUVEI_API_ENDPOINT=
```

## Getting BaseCommerce Credentials

Pull them from the account's "Merchant Information" panel (Organization ID /
SDK Username / SDK Password / SDK Key), or from BaseCommerce/Nuvei support.

## Configuration Details

- **NUVEI_SDK_USERNAME** / **NUVEI_SDK_PASSWORD** / **NUVEI_SDK_KEY**: all three are required together — this is not an either/or auth scheme. `NUVEI_SDK_KEY` is a hex-encoded 24-byte Triple DES key; never send it to a browser/client.
- **NUVEI_ORGANIZATION_ID**: account metadata; not required by the transaction API calls themselves.
- **NUVEI_SANDBOX_MODE**: `true` → `https://gateway.basecommercesandbox.com`, `false` → `https://gateway.basecommerce.com` (production). Leave `NUVEI_API_ENDPOINT` blank to auto-select by this flag.

## Known Gaps

- Transaction lookup by ID (`getPaymentDetails`) is not implemented — no lookup endpoint was found in the reference protocol. Confirm with BaseCommerce/Nuvei support whether one exists.
- `voidPayment`'s request shape is inferred by analogy with refund, not directly observed against the live gateway — verify with a real test transaction before relying on it in production.

## Security Notes

- Never commit the `.env` file
- Keep the SDK key secure and hidden
- Use environment variables for all sensitive data
- Rotate keys regularly
