require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const paymentRoutes = require('./routes/payments');
const healthRoutes = require('./routes/health');
const ghlRoutes = require('./routes/ghl');
const oauthRoutes = require('./routes/oauth');
const ghlProviderRoutes = require('./routes/ghlProvider');
const payRoutes = require('./routes/pay');
const stripeWebhookRoutes = require('./routes/stripeWebhook');
const checkoutLinkRoutes = require('./routes/checkoutLink');
const contactsLookupRoutes = require('./routes/contactsLookup');
const ghlWebhookRoutes = require('./routes/ghlWebhook');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Stripe webhook signature verification needs the exact raw request body,
// so this must be mounted (and matched) before the global JSON body parser
// below — once express.json() has parsed and replaced req.body, the raw
// bytes needed for the signature check are gone.
app.use('/pay/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Enhanced request logging middleware with correlation ID
app.use((req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || `${Date.now()}-${Math.random()}`;
  req.correlationId = correlationId;
  
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${correlationId}] ${req.method} ${req.path}`);
  
  res.on('finish', () => {
    console.log(`[${timestamp}] [${correlationId}] ${req.method} ${req.path} - ${res.statusCode}`);
  });
  
  next();
});

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ghl', ghlRoutes);
app.use('/oauth', oauthRoutes);
app.use('/ghl-provider', ghlProviderRoutes);
app.use('/pay/create-link', checkoutLinkRoutes);
app.use('/pay', payRoutes);
app.use('/contacts/lookup', contactsLookupRoutes);
app.use('/webhooks/ghl', ghlWebhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((err, req, res, next) => {
  const timestamp = new Date().toISOString();
  const correlationId = req.correlationId || 'unknown';
  
  console.error(`[${timestamp}] [${correlationId}] Error:`, err.message);
  
  res.status(err.statusCode || 500).json({
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : undefined,
    correlationId: correlationId
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] GHL NUVEI Custom App listening on port ${PORT}`);
  console.log(`[${new Date().toISOString()}] Environment: ${NODE_ENV}`);
  console.log(`[${new Date().toISOString()}] NUVEI API Endpoint: ${process.env.NUVEI_API_ENDPOINT}`);
});

// Graceful shutdown handler for Railway & Docker
process.on('SIGTERM', () => {
  console.log(`[${new Date().toISOString()}] SIGTERM signal received: closing HTTP server`);
  server.close(() => {
    console.log(`[${new Date().toISOString()}] HTTP server closed`);
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toISOString()}] SIGINT signal received: closing HTTP server`);
  server.close(() => {
    console.log(`[${new Date().toISOString()}] HTTP server closed`);
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, err);
  process.exit(1);
});

module.exports = app;
