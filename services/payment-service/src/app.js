const { createHttpApp, requireFields, asyncRoute } = require('../../_shared/http-app');
const { createStore } = require('../../_shared/store');
const { randomUUID } = require('node:crypto');

function createApp({ createStoreFn = createStore } = {}) {
  const paymentsReady = createStoreFn('payments').then(async (store) => {
    if (!(await store.get('pay-3001'))) {
      await store.set('pay-3001', {
        id: 'pay-3001',
        orderId: 'ord-1001',
        status: 'CAPTURED',
        amount: 149.97,
        currency: 'USD',
        provider: 'stripe-demo'
      });
    }
    return store;
  });

  return createHttpApp({
    serviceName: 'payment-service',
    registerRoutes(app) {
      app.get('/api/v1/payments', asyncRoute(async (request, response) => {
        const payments = await paymentsReady;
        const all = await payments.list();
        const data = all.filter((payment) => !request.query.orderId || payment.orderId === request.query.orderId);
        response.json({ data, count: data.length });
      }));

      app.post('/api/v1/payments', asyncRoute(async (request, response) => {
        requireFields(request.body, ['orderId', 'amount', 'paymentMethodToken']);
        const payments = await paymentsReady;
        const payment = {
          id: `pay-${randomUUID()}`,
          orderId: request.body.orderId,
          status: 'AUTHORIZED',
          amount: Number(request.body.amount),
          currency: request.body.currency || 'USD',
          provider: 'stripe-demo'
        };
        await payments.set(payment.id, payment);
        response.status(201).json(payment);
      }));

      app.get('/api/v1/payments/:id', asyncRoute(async (request, response) => {
        const payments = await paymentsReady;
        const payment = await payments.get(request.params.id);
        if (!payment) return response.status(404).json({ error: 'payment_not_found' });
        response.json(payment);
      }));

      app.post('/api/v1/payments/:id/capture', asyncRoute(async (request, response) => {
        const payments = await paymentsReady;
        const payment = await payments.get(request.params.id);
        if (!payment) return response.status(404).json({ error: 'payment_not_found' });
        const captured = { ...payment, status: 'CAPTURED', captureReference: `cap-${randomUUID()}` };
        await payments.set(payment.id, captured);
        response.json(captured);
      }));

      app.post('/api/v1/payments/:id/refunds', asyncRoute(async (request, response) => {
        const payments = await paymentsReady;
        const payment = await payments.get(request.params.id);
        if (!payment) return response.status(404).json({ error: 'payment_not_found' });
        response.status(201).json({
          refundId: `ref-${randomUUID()}`,
          paymentId: payment.id,
          amount: request.body.amount || payment.amount,
          status: 'REQUESTED'
        });
      }));
    }
  });
}

module.exports = { createApp };
