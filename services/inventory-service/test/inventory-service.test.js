const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('inventory service reserves stock', async () => {
  const app = createApp();
  const response = await request(app)
    .post('/api/v1/inventory/SKU-BAG-001/reservations')
    .send({ orderId: 'ord-2001', quantity: 2 })
    .expect(201);

  assert.equal(response.body.orderId, 'ord-2001');
  assert.equal(response.body.item.available, 40);
});

test('inventory service releases a reservation and restores the exact quantity', async () => {
  const app = createApp();
  const before = await request(app).get('/api/v1/inventory/SKU-BAG-001').expect(200);

  const reserved = await request(app)
    .post('/api/v1/inventory/SKU-BAG-001/reservations')
    .send({ orderId: 'ord-2002', quantity: 3 })
    .expect(201);
  assert.equal(reserved.body.item.available, before.body.available - 3);

  const released = await request(app)
    .delete(`/api/v1/inventory/SKU-BAG-001/reservations/${reserved.body.reservationId}`)
    .expect(200);

  assert.equal(released.body.item.available, before.body.available);
  assert.equal(released.body.item.reserved, before.body.reserved);
});
