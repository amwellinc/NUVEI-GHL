require('dotenv').config();
const { registerProvider } = require('../src/services/ghlProviderConfig');

registerProvider({
  locationId: process.env.GHL_LOCATION_ID,
  paymentsUrl: `${process.env.APP_URL}/ghl-provider/checkout`,
  queryUrl: `${process.env.APP_URL}/ghl-provider/query`,
  imageUrl: `${process.env.APP_URL}/static/nuvei-logo.png`,
  name: 'NUVEI-Payments',
  description: 'AMWELL USA payment processing'
}).then((r) => {
  console.log('Registered:', JSON.stringify(r, null, 2));
  process.exit(0);
}).catch((e) => {
  console.error('Registration failed:', e);
  process.exit(1);
});
