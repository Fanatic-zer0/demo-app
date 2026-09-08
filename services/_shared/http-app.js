const express = require('express');
const morgan = require('morgan');
const { randomUUID } = require('node:crypto');

function createHttpApp({ serviceName, version = 'v1', registerRoutes }) {
  const app = express();
  const startedAt = new Date();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Reuse an inbound trace id (propagated by Kong/upstream callers) or mint a new one.
  app.use((request, response, next) => {
    request.traceId = request.headers['x-trace-id'] || request.headers['x-correlation-id'] || randomUUID();
    response.setHeader('x-trace-id', request.traceId);

    const originalJson = response.json.bind(response);
    response.json = (body) => {
      if (body && typeof body === 'object' && !Array.isArray(body) && body.traceId === undefined) {
        body.traceId = request.traceId;
      }
      return originalJson(body);
    };
    next();
  });

  morgan.token('trace-id', (request) => request.traceId);
  app.use(morgan(':trace-id :method :url :status :res[content-length] - :response-time ms'));

  app.get('/health/live', (_request, response) => {
    response.json({ status: 'UP', service: serviceName, version });
  });

  app.get('/health/ready', (_request, response) => {
    response.json({ status: 'READY', service: serviceName, dependencies: [] });
  });

  app.get('/metrics', (_request, response) => {
    response.type('text/plain').send([
      `demo_service_info{service="${serviceName}",version="${version}"} 1`,
      `demo_service_uptime_seconds{service="${serviceName}"} ${Math.floor((Date.now() - startedAt.getTime()) / 1000)}`
    ].join('\n'));
  });

  registerRoutes(app);

  app.use((request, response) => {
    response.status(404).json({
      error: 'not_found',
      service: serviceName,
      path: request.path
    });
  });

  app.use((error, request, response, _next) => {
    response.status(error.statusCode || 500).json({
      error: error.code || 'internal_error',
      message: error.message || 'Unexpected service failure',
      service: serviceName,
      traceId: request.traceId,
      upstream: error.upstream
    });
  });

  return app;
}

function listen(app, serviceName, defaultPort) {
  const port = Number(process.env.PORT || defaultPort);
  const server = app.listen(port, () => {
    console.log(`${serviceName} listening on ${port}`);
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length > 0) {
    const error = new Error(`Missing required field(s): ${missing.join(', ')}`);
    error.statusCode = 400;
    error.code = 'validation_failed';
    throw error;
  }
}

// Express 4 does not forward rejected promises to error middleware automatically.
function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

module.exports = { createHttpApp, listen, requireFields, asyncRoute };