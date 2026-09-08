const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

test('notification service queues messages', async () => {
  const app = createApp();
  const response = await request(app)
    .post('/api/v1/notifications')
    .send({ customerId: 'cust-900', channel: 'sms', template: 'shipment-created' })
    .expect(202);

  assert.equal(response.body.status, 'QUEUED');
});