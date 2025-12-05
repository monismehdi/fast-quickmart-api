const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const LIVE_STATUSES = new Set(['created', 'packing', 'on_hold']);

function renderOrders(orders) {
  const tbody = document.querySelector('#orders-table tbody');
  const activeRoot = document.getElementById('active-orders');
  tbody.innerHTML = '';
  activeRoot.innerHTML = '';

  for (const order of orders) {
    const tr = document.createElement('tr');
    tr.dataset.orderId = order.id;
    tr.innerHTML = `
      <td>${order.id}</td>
      <td>${order.created_at}</td>
      <td>${order.items.length}</td>
      <td>${INR.format(order.total || 0)}</td>
      <td><span class="status-inline ${order.status}">${order.status}</span></td>
      <td><a href="/order/${order.id}" class="ghost-link">Track</a></td>
    `;
    tbody.appendChild(tr);

    if (LIVE_STATUSES.has(order.status)) {
      const live = document.createElement('div');
      live.className = 'item-state';
      live.innerHTML = `
        <div><strong>${order.id}</strong><br><span class="muted">${order.items.length} items | ETA ${order.eta_minutes || 30} min</span></div>
        <span class="status-inline ${order.status}">${order.status.replaceAll('_', ' ')}</span>
      `;
      activeRoot.appendChild(live);
    }
  }

  if (!activeRoot.innerHTML) {
    activeRoot.innerHTML = '<p class="muted">No active orders right now.</p>';
  }
}

async function refreshOrders() {
  const res = await fetch('/api/my-orders');
  if (!res.ok) return;
  const data = await res.json();
  renderOrders(data.orders || []);
}

refreshOrders();
setInterval(refreshOrders, 4000);
