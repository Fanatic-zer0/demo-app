const { createHttpApp, requireFields, asyncRoute } = require('../../_shared/http-app');
const { createStore } = require('../../_shared/store');
const { randomUUID } = require('node:crypto');

const SEED_ITEMS = [
  { sku: 'SKU-BAG-001', name: 'Travel Backpack', available: 42, reserved: 3, warehouse: 'iad-1' },
  { sku: 'SKU-BTL-002', name: 'Insulated Bottle', available: 120, reserved: 8, warehouse: 'iad-2' }
];

function createApp({ createStoreFn = createStore } = {}) {
  // Seed once per store instance; a shared Redis store already populated skips re-seeding.
  const itemsReady = createStoreFn('inventory-items').then(async (store) => {
    for (const item of SEED_ITEMS) {
      if (!(await store.get(item.sku))) await store.set(item.sku, item);
    }
    return store;
  });
  const reservationsReady = createStoreFn('inventory-reservations');

  return createHttpApp({
    serviceName: 'inventory-service',
    registerRoutes(app) {
      app.get('/api/v1/inventory', asyncRoute(async (_request, response) => {
        const items = await itemsReady;
        response.json({ data: await items.list() });
      }));

      app.get('/api/v1/inventory/:sku', asyncRoute(async (request, response) => {
        const items = await itemsReady;
        const item = await items.get(request.params.sku);
        if (!item) return response.status(404).json({ error: 'sku_not_found' });
        response.json(item);
      }));

      app.post('/api/v1/inventory/:sku/reservations', asyncRoute(async (request, response) => {
        requireFields(request.body, ['orderId', 'quantity']);
        const items = await itemsReady;
        const reservations = await reservationsReady;
        const item = await items.get(request.params.sku);
        if (!item) return response.status(404).json({ error: 'sku_not_found' });
        const quantity = Number(request.body.quantity);
        if (quantity <= 0 || item.available < quantity) return response.status(409).json({ error: 'insufficient_inventory' });
        const updated = { ...item, available: item.available - quantity, reserved: item.reserved + quantity };
        await items.set(item.sku, updated);

        const reservationId = `res-${randomUUID()}`;
        await reservations.set(reservationId, { sku: item.sku, orderId: request.body.orderId, quantity });
        response.status(201).json({ reservationId, orderId: request.body.orderId, item: updated });
      }));

      app.delete('/api/v1/inventory/:sku/reservations/:reservationId', asyncRoute(async (request, response) => {
        const items = await itemsReady;
        const reservations = await reservationsReady;
        const reservation = await reservations.get(request.params.reservationId);
        if (!reservation || reservation.sku !== request.params.sku) {
          return response.status(404).json({ error: 'reservation_not_found' });
        }
        const item = await items.get(reservation.sku);
        const updated = {
          ...item,
          available: item.available + reservation.quantity,
          reserved: Math.max(0, item.reserved - reservation.quantity)
        };
        await items.set(item.sku, updated);
        await reservations.delete(request.params.reservationId);
        response.json({ reservationId: request.params.reservationId, released: true, item: updated });
      }));
    }
  });
}

module.exports = { createApp };
