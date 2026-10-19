import { config } from '../config';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ content: { 'application/json': { schema } } });
const err = (description: string) => ({ description, ...json(ref('Error')) });
const secured = [{ bearerAuth: [] }, { apiKeyAuth: [] }];
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Production Node API',
    version: config.version,
    description: 'Todo API with JWT + API-key auth, Redis caching, uploads, GraphQL (/graphql) and WebSockets (/ws).',
    license: { name: 'Proprietary' },
  },
  servers: [{ url: '/', description: 'This server' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['user', 'admin'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AuthResponse: { type: 'object', properties: { token: { type: 'string' }, user: ref('User') } },
      Todo: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string', nullable: true },
          completed: { type: 'boolean' },
          userId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      TodoInput: {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string', maxLength: 200 }, description: { type: 'string', maxLength: 1000 }, completed: { type: 'boolean' } },
      },
      TodoPage: {
        type: 'object',
        properties: { items: { type: 'array', items: ref('Todo') }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' }, cached: { type: 'boolean' } },
      },
      ApiKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          keyPrefix: { type: 'string' },
          scopes: { type: 'array', items: { type: 'string', enum: ['read', 'write', 'upload', 'admin', '*'] } },
          isActive: { type: 'boolean' },
          expiresAt: { type: 'string', format: 'date-time', nullable: true },
          lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          key: { type: 'string', description: 'Plaintext key, only returned on creation' },
        },
      },
      Upload: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          filename: { type: 'string' },
          originalName: { type: 'string' },
          mimetype: { type: 'string' },
          size: { type: 'integer' },
          todoId: { type: 'string', format: 'uuid', nullable: true },
          url: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, details: {}, correlationId: { type: 'string' } },
      },
    },
  },
  paths: {
    '/api/health': { get: { tags: ['Health'], summary: 'Full health report', responses: { 200: { description: 'healthy or degraded' }, 503: { description: 'unhealthy' } } } },
    '/api/health/live': { get: { tags: ['Health'], summary: 'Liveness probe', responses: { 200: { description: 'alive' } } } },
    '/api/health/ready': { get: { tags: ['Health'], summary: 'Readiness probe', responses: { 200: { description: 'ready' }, 503: { description: 'not ready' } } } },
    '/metrics': { get: { tags: ['Health'], summary: 'Prometheus metrics', responses: { 200: { description: 'text exposition format' } } } },
    '/api/auth/register': {
      post: {
        tags: ['Auth'], summary: 'Register',
        requestBody: json({ type: 'object', required: ['email', 'password', 'name'], properties: { email: { type: 'string' }, password: { type: 'string', description: '8+ chars, upper, lower, digit, symbol' }, name: { type: 'string' } } }),
        responses: { 201: { description: 'Registered', ...json(ref('AuthResponse')) }, 400: err('Validation failed'), 409: err('Email taken') },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'], summary: 'Log in',
        requestBody: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }),
        responses: { 200: { description: 'Logged in', ...json(ref('AuthResponse')) }, 401: err('Invalid credentials'), 429: err('Too many attempts') },
      },
    },
    '/api/auth/me': {
      get: { tags: ['Auth'], summary: 'Current user', security: secured, responses: { 200: { description: 'User' }, 401: err('Unauthenticated') } },
      patch: { tags: ['Auth'], summary: 'Update profile (JWT only)', security: [{ bearerAuth: [] }], requestBody: json({ type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } }), responses: { 200: { description: 'Updated' } } },
    },
    '/api/todos': {
      get: {
        tags: ['Todos'], summary: 'List todos (cached)', security: secured,
        parameters: [
          { name: 'completed', in: 'query', schema: { type: 'boolean' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['created_at', 'updated_at', 'title'] } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
        ],
        responses: { 200: { description: 'Page (X-Cache: HIT|MISS)', ...json(ref('TodoPage')) } },
      },
      post: { tags: ['Todos'], summary: 'Create todo (scope: write)', security: secured, requestBody: json(ref('TodoInput')), responses: { 201: { description: 'Created', ...json(ref('Todo')) }, 400: err('Validation failed') } },
    },
    '/api/todos/stats': { get: { tags: ['Todos'], summary: 'Totals', security: secured, responses: { 200: { description: 'Stats' } } } },
    '/api/todos/{id}': {
      get: { tags: ['Todos'], summary: 'Get todo', security: secured, parameters: [idParam], responses: { 200: { description: 'Todo', ...json(ref('Todo')) }, 404: err('Not found') } },
      patch: { tags: ['Todos'], summary: 'Update todo', security: secured, parameters: [idParam], requestBody: json(ref('TodoInput')), responses: { 200: { description: 'Updated', ...json(ref('Todo')) } } },
      put: { tags: ['Todos'], summary: 'Update todo', security: secured, parameters: [idParam], requestBody: json(ref('TodoInput')), responses: { 200: { description: 'Updated', ...json(ref('Todo')) } } },
      delete: { tags: ['Todos'], summary: 'Delete todo', security: secured, parameters: [idParam], responses: { 204: { description: 'Deleted' }, 404: err('Not found') } },
    },
    '/api/keys': {
      get: { tags: ['API keys'], summary: 'List my keys (JWT only)', security: [{ bearerAuth: [] }], responses: { 200: { description: 'Keys' } } },
      post: {
        tags: ['API keys'], summary: 'Create key (JWT only)', security: [{ bearerAuth: [] }],
        requestBody: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, scopes: { type: 'array', items: { type: 'string' } }, expiresInDays: { type: 'integer' } } }),
        responses: { 201: { description: 'Created (includes plaintext key once)', ...json(ref('ApiKey')) } },
      },
    },
    '/api/keys/{id}': { delete: { tags: ['API keys'], summary: 'Revoke key', security: [{ bearerAuth: [] }], parameters: [idParam], responses: { 200: { description: 'Revoked' } } } },
    '/api/uploads': {
      get: { tags: ['Uploads'], summary: 'List my uploads', security: secured, parameters: [{ name: 'todoId', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Uploads' } } },
      post: {
        tags: ['Uploads'], summary: 'Upload one file (field "file", optional "todoId")', security: secured,
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, todoId: { type: 'string' } } } } } },
        responses: { 201: { description: 'Uploaded', ...json({ type: 'object', properties: { file: ref('Upload') } }) }, 413: err('Too large'), 415: err('Type not allowed') },
      },
    },
    '/api/uploads/multiple': {
      post: {
        tags: ['Uploads'], summary: 'Upload up to 10 files (field "files")', security: secured,
        requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } } } },
        responses: { 201: { description: 'Uploaded' } },
      },
    },
    '/api/uploads/{filename}': { delete: { tags: ['Uploads'], summary: 'Delete my file', security: secured, parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deleted' } } } },
    '/uploads/{filename}': { get: { tags: ['Uploads'], summary: 'Download my file', security: secured, parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'File' }, 404: err('Not found') } } },
    '/api/ops/status': { get: { tags: ['Ops'], summary: 'Runtime, breakers, limiter, cache and sink status', security: secured, responses: { 200: { description: 'Status' } } } },
    '/api/ops/circuit-breakers/{name}/{action}': { post: { tags: ['Ops'], summary: 'Trip or reset a breaker (admin)', security: secured, parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }, { name: 'action', in: 'path', required: true, schema: { type: 'string', enum: ['trip', 'reset'] } }], responses: { 200: { description: 'Breaker' } } } },
    '/api/ops/cache/flush': { post: { tags: ['Ops'], summary: 'Flush caches (admin)', security: secured, responses: { 200: { description: 'Flushed' } } } },
    '/api/ops/load-shedding': { post: { tags: ['Ops'], summary: 'Simulate overload (admin)', security: secured, requestBody: json({ type: 'object', properties: { durationMs: { type: 'integer' } } }), responses: { 200: { description: 'OK' } } } },
    '/api/ops/traces/{traceId}': { get: { tags: ['Ops'], summary: 'Fetch a trace from Tempo (admin)', security: secured, parameters: [{ name: 'traceId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Trace' }, 501: err('Tempo not configured') } } },
    '/api/ops/logs': { get: { tags: ['Ops'], summary: 'LogQL query against Loki (admin)', security: secured, parameters: [{ name: 'query', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Loki response' } } } },
    '/api/ops/incidents': {
      get: { tags: ['Ops'], summary: 'PagerDuty incidents raised by this instance (admin)', security: secured, responses: { 200: { description: 'Incidents' } } },
      post: { tags: ['Ops'], summary: 'Trigger a PagerDuty incident (admin)', security: secured, requestBody: json({ type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, severity: { type: 'string' }, dedupKey: { type: 'string' } } }), responses: { 201: { description: 'Triggered' } } },
    },
    '/api/ops/alertmanager': { post: { tags: ['Ops'], summary: 'Alertmanager webhook -> PagerDuty (Bearer ALERT_WEBHOOK_TOKEN)', responses: { 200: { description: 'Processed' } } } },
  },
};
