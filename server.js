/**
 * PRODUCTION-READY SERVER
 * 
 * CURRICULUM COVERAGE:
 * #2226-2250: Production deployment, process managers (PM2)
 * #2251-2275: Monitoring with Prometheus, Grafana
 * #2276-2310: Security hardening, rate limiting, DDoS protection
 */

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const promClient = require('prom-client');
const winston = require('winston');
require('dotenv').config();

const app = express();

// #2276-2290: Security middleware
app.use(helmet());
app.use(compression());

// #2291-2300: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per IP
    message: 'Too many requests from this IP'
});

app.use('/api/', limiter);

// #2251-2265: Prometheus metrics
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestCounter = new promClient.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
});

const httpRequestDuration = new promClient.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    registers: [register]
});

// Metrics middleware
app.use((req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;

        httpRequestCounter.inc({
            method: req.method,
            route: req.route?.path || req.path,
            status: res.statusCode
        });

        httpRequestDuration.observe({
            method: req.method,
            route: req.route?.path || req.path,
            status: res.statusCode
        }, duration);
    });

    next();
});

// #2266-2275: Winston logging
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

app.use(express.json());

app.get('/', (req, res) => {
    logger.info('Root endpoint accessed');
    res.json({
        message: 'Production-ready API',
        version: '1.0.0',
        environment: process.env.NODE_ENV
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Error handling
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    logger.info(`🚀 Production server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;
