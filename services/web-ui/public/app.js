const state = { lastTraceId: null };

function setLastTraceId(traceId) {
  if (!traceId) return;
  state.lastTraceId = traceId;
  document.getElementById('last-trace-id').textContent = traceId;
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  setLastTraceId(response.headers.get('x-trace-id'));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Request to ${path} failed`);
    error.data = data;
    throw error;
  }
  return data;
}

function renderRow(cells) {
  const row = document.createElement('tr');
  row.innerHTML = cells.map((cell) => `<td>${cell}</td>`).join('');
  return row;
}

function statusBadge(status) {
  return `<span class="status-${status}">${status}</span>`;
}

async function loadOrders() {
  const { data } = await apiFetch('/api/v1/orders');
  const body = document.querySelector('#orders-table tbody');
  body.innerHTML = '';
  data.forEach((order) => {
    body.appendChild(renderRow([
      order.id,
      order.customerId,
      statusBadge(order.status),
      `$${order.total.toFixed(2)}`,
      order.trackingNumber || '-'
    ]));
  });
}

async function loadInventory() {
  const { data } = await apiFetch('/api/v1/inventory');
  const body = document.querySelector('#inventory-table tbody');
  body.innerHTML = '';
  data.forEach((item) => {
    body.appendChild(renderRow([item.sku, item.name, item.available, item.reserved, item.warehouse]));
  });
}

async function loadShipments() {
  const { data } = await apiFetch('/api/v1/shipments');
  const body = document.querySelector('#shipments-table tbody');
  body.innerHTML = '';
  data.forEach((shipment) => {
    body.appendChild(renderRow([
      shipment.id,
      shipment.orderId,
      statusBadge(shipment.status),
      shipment.trackingNumber
    ]));
  });
}

async function loadNotifications() {
  const { data } = await apiFetch('/api/v1/notifications');
  const body = document.querySelector('#notifications-table tbody');
  body.innerHTML = '';
  data.forEach((notification) => {
    body.appendChild(renderRow([
      notification.id,
      notification.customerId,
      notification.channel,
      notification.template,
      statusBadge(notification.status)
    ]));
  });
}

async function refreshAll() {
  await Promise.allSettled([loadOrders(), loadInventory(), loadShipments(), loadNotifications()]);
}

document.querySelectorAll('[data-refresh]').forEach((button) => {
  button.addEventListener('click', () => {
    const loaders = { orders: loadOrders, inventory: loadInventory, shipments: loadShipments, notifications: loadNotifications };
    loaders[button.dataset.refresh]();
  });
});

document.getElementById('order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const sku = form.get('sku');
  const price = sku === 'SKU-BAG-001' ? 89.99 : 29.99;
  const resultBox = document.getElementById('order-result');
  resultBox.textContent = 'Placing order...';

  try {
    const order = await apiFetch('/api/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        customerId: form.get('customerId'),
        items: [{ sku, quantity: Number(form.get('quantity')), price }],
        shippingAddress: { city: form.get('city'), country: 'US' }
      })
    });
    resultBox.textContent = JSON.stringify(order, null, 2);
    await refreshAll();
  } catch (error) {
    resultBox.textContent = `Order failed: ${error.message}\n${JSON.stringify(error.data, null, 2)}`;
  }
});

refreshAll();
setInterval(refreshAll, 8000);
