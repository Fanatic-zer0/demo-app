const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('payment service authorizes and captures payments', async () => {
  const app = createApp();
  const payment = await request(app)
    .post('/api/v1/payments')
    .send({ orderId: 'ord-2001', amount: 25, paymentMethodToken: 'tok_demo' })
    .expect(201);

  assert.equal(payment.body.status, 'AUTHORIZED');
  await request(app).post(`/api/v1/payments/${payment.body.id}/capture`).expect(200);
});