const { createHttpApp, requireFields, asyncRoute } = require('../../_shared/http-app');
const { createStore } = require('../../_shared/store');
const { randomUUID } = require('node:crypto');

function createApp({ createStoreFn = createStore } = {}) {
  const notificationsReady = createStoreFn('notifications').then(async (store) => {
    if (!(await store.get('ntf-5001'))) {
      await store.set('ntf-5001', {
        id: 'ntf-5001',
        customerId: 'cust-501',
        channel: 'email',
        template: 'order-confirmed',
        status: 'SENT'
      });
    }
    return store;
  });

  return createHttpApp({
    serviceName: 'notification-service',
    registerRoutes(app) {
      app.get('/api/v1/notifications', asyncRoute(async (_request, response) => {
        const notifications = await notificationsReady;
        response.json({ data: await notifications.list() });
      }));

      app.post('/api/v1/notifications', asyncRoute(async (request, response) => {
        requireFields(request.body, ['customerId', 'channel', 'template']);
        const notifications = await notificationsReady;
        const notification = {
          id: `ntf-${randomUUID()}`,
          customerId: request.body.customerId,
          channel: request.body.channel,
          template: request.body.template,
          status: 'QUEUED',
          payload: request.body.payload || {}
        };
        await notifications.set(notification.id, notification);
        response.status(202).json(notification);
      }));

      app.get('/api/v1/notifications/:id', asyncRoute(async (request, response) => {
        const notifications = await notificationsReady;
        const notification = await notifications.get(request.params.id);
        if (!notification) return response.status(404).json({ error: 'notification_not_found' });
        response.json(notification);
      }));

      app.get('/api/v1/notifications/customers/:customerId', asyncRoute(async (request, response) => {
        const notifications = await notificationsReady;
        const all = await notifications.list();
        const data = all.filter((notification) => notification.customerId === request.params.customerId);
        response.json({ data, count: data.length });
      }));

      app.post('/api/v1/notifications/:id/retry', asyncRoute(async (request, response) => {
        const notifications = await notificationsReady;
        const notification = await notifications.get(request.params.id);
        if (!notification) return response.status(404).json({ error: 'notification_not_found' });
        const retried = { ...notification, status: 'QUEUED', retryReason: request.body.reason || 'manual_retry' };
        await notifications.set(notification.id, retried);
        response.json(retried);
      }));
    }
  });
}

module.exports = { createApp };
