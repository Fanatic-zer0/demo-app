const { createHttpApp, requireFields, asyncRoute } = require('../../_shared/http-app');
const { createStore } = require('../../_shared/store');
const { randomUUID } = require('node:crypto');

function createApp({ createStoreFn = createStore } = {}) {
  const shipmentsReady = createStoreFn('shipments').then(async (store) => {
    if (!(await store.get('shp-4001'))) {
      await store.set('shp-4001', {
        id: 'shp-4001',
        orderId: 'ord-1001',
        status: 'IN_TRANSIT',
        carrier: 'demo-express',
        trackingNumber: 'DX1001001',
        checkpoints: [
          { code: 'label_created', at: '2026-08-30T10:00:00.000Z' },
          { code: 'picked_up', at: '2026-08-30T15:00:00.000Z' },
          { code: 'in_transit', at: '2026-08-31T02:00:00.000Z' }
        ]
      });
    }
    return store;
  });

  return createHttpApp({
    serviceName: 'shipping-service',
    registerRoutes(app) {
      app.get('/api/v1/shipments', asyncRoute(async (_request, response) => {
        const shipments = await shipmentsReady;
        response.json({ data: await shipments.list() });
      }));

      app.post('/api/v1/shipments', asyncRoute(async (request, response) => {
        requireFields(request.body, ['orderId', 'address']);
        const shipments = await shipmentsReady;
        const shipment = {
          id: `shp-${randomUUID()}`,
          orderId: request.body.orderId,
          status: 'LABEL_CREATED',
          carrier: request.body.carrier || 'demo-express',
          trackingNumber: `DX${Date.now()}`,
          address: request.body.address,
          checkpoints: [{ code: 'label_created', at: new Date().toISOString() }]
        };
        await shipments.set(shipment.id, shipment);
        response.status(201).json(shipment);
      }));

      app.get('/api/v1/shipments/:id', asyncRoute(async (request, response) => {
        const shipments = await shipmentsReady;
        const shipment = await shipments.get(request.params.id);
        if (!shipment) return response.status(404).json({ error: 'shipment_not_found' });
        response.json(shipment);
      }));

      app.get('/api/v1/shipments/orders/:orderId', asyncRoute(async (request, response) => {
        const shipments = await shipmentsReady;
        const all = await shipments.list();
        const data = all.filter((shipment) => shipment.orderId === request.params.orderId);
        response.json({ data, count: data.length });
      }));

      app.get('/api/v1/shipments/:id/tracking', asyncRoute(async (request, response) => {
        const shipments = await shipmentsReady;
        const shipment = await shipments.get(request.params.id);
        if (!shipment) return response.status(404).json({ error: 'shipment_not_found' });
        response.json({
          shipmentId: shipment.id,
          status: shipment.status,
          carrier: shipment.carrier,
          trackingNumber: shipment.trackingNumber,
          checkpoints: shipment.checkpoints
        });
      }));
    }
  });
}

module.exports = { createApp };
