import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { register } from './metrics';
import { errorHandler } from './middleware/error';
import { loadShedding } from './middleware/load-shedding';
import { ipRateLimiter } from './middleware/rate-limit';
import { requestContext } from './middleware/request-context';
import { apiKeysRouter } from './routes/api-keys';
import { authRouter } from './routes/auth';
import { healthRouter } from './routes/health';
import { opsRouter } from './routes/ops';
import { todosRouter } from './routes/todos';
import { filesRouter, uploadsRouter } from './routes/uploads';
import { openApiSpec } from './swagger/openapi';

/** Builds the Express app. GraphQL and the 404/error handlers are attached by server.ts. */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy === 'true' ? true : config.trustProxy);
  app.set('etag', 'strong');

  app.use(requestContext);
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Swagger UI and the Apollo landing page need inline scripts/styles and their CDN assets.
        'script-src': ["'self'", "'unsafe-inline'", 'https://embeddable-sandbox.cdn.apollographql.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https:'],
        'img-src': ["'self'", 'data:', 'https:'],
        'frame-src': ["'self'", 'https://sandbox.embed.apollographql.com'],
        'connect-src': ["'self'", 'https:', 'wss:', 'ws:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)),
    credentials: true,
    exposedHeaders: ['X-Correlation-ID', 'X-Request-ID', 'X-Trace-ID', 'X-Cache', 'RateLimit', 'RateLimit-Policy', 'Retry-After'],
  }));
  app.use(compression({
    level: config.compression.level,
    threshold: 1024,
    // compression >= 1.8 negotiates brotli when the client accepts it.
    brotli: config.compression.brotli ? { params: { [require('node:zlib').constants.BROTLI_PARAM_QUALITY]: 4 } } : undefined,
    filter: (req, res) => (req.headers.accept === 'text/event-stream' ? false : compression.filter(req, res)),
  } as compression.CompressionOptions));
  app.use(loadShedding);

  app.get('/', (_req, res) => {
    res.json({
      message: 'Production-ready API',
      version: config.version,
      environment: config.env,
      instance: config.instance,
      docs: '/api/docs',
      graphql: '/graphql',
      websocket: '/ws',
      metrics: '/metrics',
    });
  });

  app.get('/metrics', async (_req, res, next) => {
    try {
      res.set('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/health', healthRouter);
  app.use('/api', ipRateLimiter);
  app.use('/api', express.json({ limit: '100kb' }));
  app.use('/api/auth', authRouter);
  app.use('/api/todos', todosRouter);
  app.use('/api/keys', apiKeysRouter);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/ops', opsRouter);
  app.use('/uploads', filesRouter);

  app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Production Node API' }));

  return app;
}

export { errorHandler };
