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
const { requireApiKey } = require('./lib/security');
const ghlWebhookRoutes = require('./routes/ghlWebhook');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Railway (and any platform fronting this app with a reverse proxy) terminates
// TLS and forwards the real client address via X-Forwarded-For. Without this,
// Express's req.ip resolves to the proxy's own socket address for every
// request, which silently breaks every per-IP control in this app: the
// chargeRateLimiter/pageRateLimiter/createLinkRateLimiter (src/lib/security.js)
// would all bucket on one shared "IP" — letting one abusive client exhaust the
// limit for every real customer, and defeating the anti-card-testing-oracle
// purpose of the charge rate limiter entirely. `1` means "trust exactly one
// hop" (this platform's own edge proxy), so Express reads the real client IP
// from the end of the X-Forwarded-For chain and ignores any additional
// entries a client might try to prepend to spoof it.
app.set('trust proxy', 1);

// Baseline security headers applied to every response, including error/JSON
// paths that don't otherwise set any headers of their own. Deliberately does
// NOT set X-Frame-Options here: routes/ghlProvider.js's checkout page must be
// embeddable in a GHL iframe and expresses its embedding policy entirely via
// a scoped Content-Security-Policy frame-ancestors directive (see its own
// tests) — a blanket X-Frame-Options: DENY here would break that.
app.use((req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Stripe webhook signature verification needs the exact raw request body,
// so this must be mounted (and matched) before the global JSON body parser
// below — once express.json() has parsed and replaced req.body, the raw
// bytes needed for the signature check are gone.
app.use('/pay/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookRoutes);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serves the payment provider's logo, registered at /static/nuvei-logo.png
// with GHL — see scripts/register-ghl-provider.js's imageUrl.
app.use('/static', express.static('public/static'));

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
app.use('/api/payments', requireApiKey, paymentRoutes);
app.use('/api/ghl', requireApiKey, ghlRoutes);
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

// Only start listening (and wire process-level signal handlers) when this
// file is actually run as the entrypoint (`node src/server.js` / `npm start`)
// — not when it's `require()`d, e.g. by tests that want the configured `app`
// without also binding a real port or installing SIGTERM/SIGINT handlers
// that would fight with the test runner's own process lifecycle.
if (require.main === module) {
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
}

module.exports = app;
