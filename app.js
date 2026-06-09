require('dotenv').config();
const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');

const app = express();

// Trust the first proxy (Railway, Vercel, etc.) so rate-limit can read the real client IP
app.set('trust proxy', 1);

// Security
app.use(helmet());
const allowedOrigins = new Set(
  [env.FRONTEND_URL]
    .filter(Boolean)
    .flatMap(u => {
      // Accept both www and non-www variants of the configured URL
      try {
        const url = new URL(u);
        const variants = [url.origin];
        if (url.hostname.startsWith('www.')) {
          variants.push(`${url.protocol}//${url.hostname.slice(4)}${url.port ? ':' + url.port : ''}`);
        } else {
          variants.push(`${url.protocol}//www.${url.hostname}${url.port ? ':' + url.port : ''}`);
        }
        return variants;
      } catch {
        return [u];
      }
    })
);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    // In development, allow any localhost port
    if (env.NODE_ENV === 'development' && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    // In production, only allow the configured frontend URL (www + non-www)
    if (allowedOrigins.has(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true,
}));

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Storage proxy — mounted BEFORE the rate limiter so catalog/product image
// loads (30+ per page) don't burn the 200-req/15min budget meant for data
// routes. The upstream URL is anchored to SUPABASE_URL — no SSRF risk.
app.use('/api/storage', require('./routes/storage'));

// SSE — long-lived connections; must be before rate limiter so keep-alive
// connections don't consume the per-IP request budget on every ping.
app.use('/api/sse', require('./routes/sse'));

// Rate limiting (applied only to data routes below)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes (limiter applied per route group to exclude /api/storage)
app.use('/api', limiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/scraper', require('./routes/scraper'));
app.use('/api/users', require('./routes/users'));
app.use('/api/salut', require('./routes/salut'));
app.use('/api/sks-payment', require('./routes/sksPayment'));
app.use('/api/panduan', require('./routes/panduan'));
app.use('/api/config', require('./routes/config'));
app.use('/api/products', require('./routes/products'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res, next) => {
  next(createError(404));
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({
    error: err.message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
