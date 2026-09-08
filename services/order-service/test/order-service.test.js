const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

function stubCallService(responses) {
  const calls = [];
  return {
    calls,
    callService: async (baseUrl, path, options = {}) => {
      calls.push({ baseUrl, path, method: options.method || 'GET', body: options.body, traceId: options.traceId });
      const match = responses.find((entry) => entry.path === path && (entry.method || 'GET') === (options.method || 'GET'));
      if (!match) throw new Error(`No stub registered for ${options.method || 'GET'} ${path}`);
      if (match.error) throw match.error;
      return match.result;
    }
  };
}

test('order service orchestrates inventory, payment, shipping, and notification on success', async () => {
  const { callService, calls } = stubCallService([
    { path: '/api/v1/inventory/SKU-BAG-001/reservations', method: 'POST', result: { reservationId: 'res-1' } },
    { path: '/api/v1/payments', method: 'POST', result: { id: 'pay-1' } },
    { path: '/api/v1/payments/pay-1/capture', method: 'POST', result: { id: 'pay-1', status: 'CAPTURED' } },
    { path: '/api/v1/shipments', method: 'POST', result: { id: 'shp-1', trackingNumber: 'DX1' } },
    { path: '/api/v1/notifications', method: 'POST', result: { id: 'ntf-1' } },
    { path: '/api/v1/shipments/shp-1/tracking', method: 'GET', result: { status: 'IN_TRANSIT', trackingNumber: 'DX1', checkpoints: [] } }
  ]);
  const app = createApp({ callService });

  const created = await request(app)
    .post('/api/v1/orders')
    .set('x-trace-id', 'trace-abc')
    .send({ customerId: 'cust-900', items: [{ sku: 'SKU-BAG-001', quantity: 1, price: 89.99 }] })
    .expect(201);

  assert.equal(created.body.status, 'CONFIRMED');
  assert.equal(created.body.paymentId, 'pay-1');
  assert.equal(created.body.shipmentId, 'shp-1');
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.traceId === 'trace-abc'));

  const tracking = await request(app).get(`/api/v1/orders/${created.body.id}/tracking`).expect(200);
  assert.equal(tracking.body.orderId, created.body.id);
});

test('order service releases inventory reservations when payment fails', async () => {
  const paymentError = new Error('card_declined');
  paymentError.statusCode = 402;
  const { callService, calls } = stubCallService([
    { path: '/api/v1/inventory/SKU-BAG-001/reservations', method: 'POST', result: { reservationId: 'res-2' } },
    { path: '/api/v1/payments', method: 'POST', error: paymentError },
    { path: '/api/v1/inventory/SKU-BAG-001/reservations/res-2', method: 'DELETE', result: { released: true } }
  ]);
  const app = createApp({ callService });

  const response = await request(app)
    .post('/api/v1/orders')
    .send({ customerId: 'cust-901', items: [{ sku: 'SKU-BAG-001', quantity: 1, price: 89.99 }] })
    .expect(402);

  assert.equal(response.body.message, 'card_declined');
  const releaseCall = calls.find((call) => call.method === 'DELETE');
  assert.ok(releaseCall, 'expected the reservation to be released on failure');
});
