const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('shipping service creates a shipment', async () => {
  const app = createApp();
  const response = await request(app)
    .post('/api/v1/shipments')
    .send({ orderId: 'ord-2001', address: { city: 'Seattle', country: 'US' } })
    .expect(201);

  assert.equal(response.body.status, 'LABEL_CREATED');
});