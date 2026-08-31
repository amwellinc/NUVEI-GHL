// Generates a signed, tamper-proof payment link — the amount/currency/
// description are fixed by the signature; editing the resulting URL
// invalidates it. Embed the output as a "Pay Now" button/link in a GHL
// funnel or website page via a Custom Code block, or send it directly.
//
// Usage:
//   node scripts/create-payment-link.js --amount 99.99 --description "Consultation" \
//     [--currency USD] [--success-url https://amwellinc.com/thanks] \
//     [--failure-url https://amwellinc.com/payment-failed] \
//     [--contact-id <ghl-contact-id>] [--ttl-hours 24]
// --contact-id ties this payment to a GHL contact: on success, a note is
// added, the nuvei_transaction_id custom field is set, and a
// "payment-completed" tag is added (workflows can trigger off that tag).
// Omit it for a generic link not tied to any one contact.
require('dotenv').config();
const { createSignedLink } = require('../src/lib/paymentLinks');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    args[key] = argv[i + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.amount) {
  console.error('Usage: node scripts/create-payment-link.js --amount 99.99 [--description "..."] [--currency USD] [--success-url URL] [--failure-url URL] [--ttl-hours 24]');
  process.exit(1);
}

try {
  const baseUrl = `${process.env.APP_URL || 'https://am333-nuvei-production.up.railway.app'}/pay`;
  const url = createSignedLink(baseUrl, {
    amount: args.amount,
    currency: args.currency,
    description: args.description,
    successUrl: args['success-url'],
    failureUrl: args['failure-url'],
    contactId: args['contact-id'],
    ttlSeconds: args['ttl-hours'] ? Number(args['ttl-hours']) * 60 * 60 : undefined
  });
  console.log(url);
} catch (error) {
  console.error('Failed to create payment link:', error.message);
  process.exit(1);
}
