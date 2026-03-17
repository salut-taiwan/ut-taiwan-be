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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/modules', require('./routes/modules'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/scraper', require('./routes/scraper'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res, next) => {
  next(createError(404));
});

// Error handler
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: err.message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
