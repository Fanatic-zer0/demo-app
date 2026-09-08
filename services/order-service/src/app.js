const { createHttpApp, requireFields, asyncRoute } = require('../../_shared/http-app');
const { callService: defaultCallService } = require('../../_shared/service-client');
const { createStore } = require('../../_shared/store');
const { randomUUID } = require('node:crypto');

const SEED_ORDER = {
  id: 'ord-1001',
  customerId: 'cust-501',
  status: 'CONFIRMED',
  total: 149.97,
  currency: 'USD',
  items: [
    { sku: 'SKU-BAG-001', quantity: 1, price: 89.99 },
    { sku: 'SKU-BTL-002', quantity: 2, price: 29.99 }
  ],
  paymentId: 'pay-3001',
  shipmentId: 'shp-4001',
  trackingId: 'shp-4001'
};

function createApp({ callService = defaultCallService, createStoreFn = createStore } = {}) {
  const inventoryUrl = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:8080';
  const paymentUrl = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:8080';
  const shippingUrl = process.env.SHIPPING_SERVICE_URL || 'http://shipping-service:8080';
  const notificationUrl = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:8080';

  const ordersReady = createStoreFn('orders').then(async (store) => {
    if (!(await store.get(SEED_ORDER.id))) await store.set(SEED_ORDER.id, SEED_ORDER);
    return store;
  });

  return createHttpApp({
    serviceName: 'order-service',
    registerRoutes(app) {
      app.get('/api/v1/orders', asyncRoute(async (request, response) => {
        const orders = await ordersReady;
        const status = request.query.status;
        const all = await orders.list();
        const data = all.filter((order) => !status || order.status === status);
        response.json({ data, count: data.length });
      }));

      // Orchestrates the order saga across inventory, payment, shipping, and notification services.
      app.post('/api/v1/orders', asyncRoute(async (request, response) => {
        requireFields(request.body, ['customerId', 'items']);
        const traceId = request.traceId;
        const orderId = `ord-${randomUUID()}`;
        const reservations = [];

        try {
          for (const item of request.body.items) {
            const reservation = await callService(inventoryUrl, `/api/v1/inventory/${item.sku}/reservations`, {
              method: 'POST',
              traceId,
              body: { orderId, quantity: item.quantity }
            });
            reservations.push({ sku: item.sku, reservationId: reservation.reservationId });
          }

          const total = request.body.items.reduce(
            (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
            0
          );

          const payment = await callService(paymentUrl, '/api/v1/payments', {
            method: 'POST',
            traceId,
            body: {
              orderId,
              amount: Number(total.toFixed(2)),
              currency: request.body.currency || 'USD',
              paymentMethodToken: request.body.paymentMethodToken || 'tok_demo'
            }
          });

          await callService(paymentUrl, `/api/v1/payments/${payment.id}/capture`, { method: 'POST', traceId });

          const shipment = await callService(shippingUrl, '/api/v1/shipments', {
            method: 'POST',
            traceId,
            body: {
              orderId,
              carrier: request.body.carrier,
              address: request.body.shippingAddress || { city: 'Unknown', country: 'US' }
            }
          });

          // Notification failures should not roll back a paid, shipped order.
          try {
            await callService(notificationUrl, '/api/v1/notifications', {
              method: 'POST',
              traceId,
              body: {
                customerId: request.body.customerId,
                channel: 'email',
                template: 'order-confirmed',
                payload: { orderId, trackingNumber: shipment.trackingNumber }
              }
            });
          } catch (notifyError) {
            console.warn(`[${traceId}] notification failed for ${orderId}: ${notifyError.message}`);
          }

          const order = {
            id: orderId,
            customerId: request.body.customerId,
            status: 'CONFIRMED',
            total: Number(total.toFixed(2)),
            currency: request.body.currency || 'USD',
            items: request.body.items,
            paymentId: payment.id,
            shipmentId: shipment.id,
            trackingId: shipment.id,
            trackingNumber: shipment.trackingNumber
          };
          const orders = await ordersReady;
          await orders.set(orderId, order);
          response.status(201).json(order);
        } catch (error) {
          // Compensate: release any inventory already reserved before the failure occurred.
          await Promise.allSettled(
            reservations.map((reservation) =>
              callService(inventoryUrl, `/api/v1/inventory/${reservation.sku}/reservations/${reservation.reservationId}`, {
                method: 'DELETE',
                traceId
              })
            )
          );
          error.statusCode = error.statusCode || 502;
          error.code = error.code || 'order_orchestration_failed';
          throw error;
        }
      }));

      app.get('/api/v1/orders/:id', asyncRoute(async (request, response) => {
        const orders = await ordersReady;
        const order = await orders.get(request.params.id);
        if (!order) return response.status(404).json({ error: 'order_not_found' });
        response.json(order);
      }));

      app.patch('/api/v1/orders/:id', asyncRoute(async (request, response) => {
        const orders = await ordersReady;
        const order = await orders.get(request.params.id);
        if (!order) return response.status(404).json({ error: 'order_not_found' });
        const updated = { ...order, ...request.body, id: order.id };
        await orders.set(order.id, updated);
        response.json(updated);
      }));

      app.post('/api/v1/orders/:id/cancel', asyncRoute(async (request, response) => {
        const orders = await ordersReady;
        const order = await orders.get(request.params.id);
        if (!order) return response.status(404).json({ error: 'order_not_found' });
        const cancelled = { ...order, status: 'CANCELLED', cancelReason: request.body.reason || 'customer_request' };
        await orders.set(order.id, cancelled);
        response.json(cancelled);
      }));

      // Fetches live tracking from shipping-service rather than returning a static snapshot.
      app.get('/api/v1/orders/:id/tracking', asyncRoute(async (request, response) => {
        const orders = await ordersReady;
        const order = await orders.get(request.params.id);
        if (!order) return response.status(404).json({ error: 'order_not_found' });
        if (!order.shipmentId) {
          return response.json({ orderId: order.id, status: order.status, trackingNumber: null, checkpoints: [] });
        }
        const tracking = await callService(shippingUrl, `/api/v1/shipments/${order.shipmentId}/tracking`, {
          traceId: request.traceId
        });
        response.json({ orderId: order.id, ...tracking });
      }));
    }
  });
}

module.exports = { createApp };
