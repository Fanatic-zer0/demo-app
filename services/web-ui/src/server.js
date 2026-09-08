const express = require('express');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

// Mirrors the Kong Ingress path-prefix routing (see charts/oms-demo/templates/kong-ingress.yaml)
// so the same UI works unchanged behind Kong in Kubernetes or this gateway locally.
const ROUTES = [
  { prefix: '/api/v1/orders', target: process.env.ORDER_SERVICE_URL || 'http://order-service:8080' },
  { prefix: '/api/v1/inventory', target: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:8080' },
  { prefix: '/api/v1/payments', target: process.env.PAYMENT_SERVICE_URL || 'http://payment-service:8080' },
  { prefix: '/api/v1/shipments', target: process.env.SHIPPING_SERVICE_URL || 'http://shipping-service:8080' },
  { prefix: '/api/v1/notifications', target: process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:8080' }
];

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health/live', (_request, response) => response.json({ status: 'UP', service: 'web-ui' }));
  app.get('/health/ready', (_request, response) => response.json({ status: 'READY', service: 'web-ui' }));

  // Raw proxy: body is forwarded as-is, so this must run before any body-parsing middleware.
  app.use((request, response, next) => {
    const route = ROUTES.find((candidate) => request.path.startsWith(candidate.prefix));
    if (!route) return next();

    const traceId = request.headers['x-trace-id'] || randomUUID();
    const target = new URL(route.target);
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const proxyRequest = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: request.originalUrl,
          method: request.method,
          headers: {
            ...request.headers,
            host: target.hostname,
            'x-trace-id': traceId,
            'content-length': Buffer.byteLength(body)
          }
        },
        (proxyResponse) => {
          response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
          proxyResponse.pipe(response);
        }
      );

      proxyRequest.on('error', (error) => {
        response.status(502).json({ error: 'upstream_unavailable', message: error.message, traceId });
      });

      if (body.length) proxyRequest.write(body);
      proxyRequest.end();
    });
  });

  app.use((request, response) => {
    response.status(404).json({ error: 'not_found', path: request.path });
  });

  return app;
}

module.exports = { createApp };
