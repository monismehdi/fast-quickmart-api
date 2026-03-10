const statusEl = document.getElementById('order-status');
const itemsEl = document.getElementById('order-items');
const issuePanel = document.getElementById('issue-panel');
const issueText = document.getElementById('issue-text');
const replacementList = document.getElementById('replacement-list');
const replaceSelectedBtn = document.getElementById('replace-selected-btn');
const holdTimer = document.getElementById('hold-timer');
const summaryOrderId = document.getElementById('summary-order-id');
const summaryTotal = document.getElementById('summary-total');
const summaryItems = document.getElementById('summary-items');
const paymentSummarySection = document.getElementById('payment-summary');
const paymentModeEl = document.getElementById('order-payment-mode');
const couponValueEl = document.getElementById('order-coupon-value');
const paymentDiscountEl = document.getElementById('order-payment-discount');
const handlingEl = document.getElementById('order-handling');
const deliveryEl = document.getElementById('order-delivery');
const surgeEl = document.getElementById('order-surge');
const finalEl = document.getElementById('order-final');
const deliveryNoteEl = document.getElementById('order-delivery-note');
const surgeNoteEl = document.getElementById('order-surge-note');
const emergencyFeeEl = document.getElementById('order-emergency-fee');
const storeNameEl = document.getElementById('order-store-name');
const storeDistanceEl = document.getElementById('order-store-distance');
const storeNoteEl = document.getElementById('order-store-note');
const countdownEl = document.getElementById('delivery-map-countdown');
const mapMarker = document.getElementById('delivery-marker');
const agentNameEl = document.getElementById('agent-name');
const agentVehicleEl = document.getElementById('agent-vehicle');
const agentCallEl = document.getElementById('agent-call');
const agentChatBtn = document.getElementById('agent-chat');
const instructionsEl = document.getElementById('delivery-instructions-note');
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
let countdownInterval = null;
let routeInterval = null;
let normalizedRoute = [];
let routeIndex = 0;

let ws;
let activeIssue;
let holdInterval = null;
let selectedReplacementId = null;
let finalPlacedNotified = false;

function normalizeRoute(route) {
  if (!route || !route.length) return [];
  const lats = route.map((point) => point.lat ?? 0);
  const lngs = route.map((point) => point.lng ?? 0);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(0.0001, maxLat - minLat);
  const lngSpan = Math.max(0.0001, maxLng - minLng);
  return route.map((point) => ({
    x: 10 + (((point.lng ?? 0) - minLng) / lngSpan) * 75,
    y: 80 - (((point.lat ?? 0) - minLat) / latSpan) * 50,
  }));
}

function updateMarkerPosition(point) {
  if (!mapMarker || !point) return;
  const x = Math.min(95, Math.max(5, point.x));
  const y = Math.min(85, Math.max(15, point.y));
  mapMarker.style.left = `${x}%`;
  mapMarker.style.top = `${y}%`;
}

function startRouteAnimation(route) {
  if (!mapMarker) return;
  clearInterval(routeInterval);
  normalizedRoute = normalizeRoute(route);
  if (!normalizedRoute.length) return;
  routeIndex = 0;
  updateMarkerPosition(normalizedRoute[0]);
  routeInterval = setInterval(() => {
    routeIndex = (routeIndex + 1) % normalizedRoute.length;
    updateMarkerPosition(normalizedRoute[routeIndex]);
  }, 3200);
}

function startCountdown(minutes) {
  if (!countdownEl) return;
  clearInterval(countdownInterval);
  let seconds = Math.max(0, Math.round((minutes || 0) * 60));
  const tick = () => {
    if (seconds <= 0) {
      countdownEl.textContent = 'Arriving shortly';
      clearInterval(countdownInterval);
      return;
    }
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    countdownEl.textContent = `ETA ${mm}m ${ss.toString().padStart(2, '0')}s`;
    seconds -= 1;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function updateInstructionText(text) {
  if (!instructionsEl) return;
  instructionsEl.textContent = text;
}

function setupDeliveryMap(order) {
  const driver = order.driver || {};
  if (agentNameEl) {
    agentNameEl.textContent = driver.name || 'Quickmart agent';
  }
  if (agentVehicleEl) {
    agentVehicleEl.textContent = driver.vehicle || 'Quickmart delivery';
  }
  if (agentCallEl) {
    agentCallEl.href = driver.phone ? `tel:${driver.phone}` : '#';
  }
  startCountdown(order.eta_minutes || 0);
  startRouteAnimation(driver.route || []);
}

if (agentChatBtn) {
  agentChatBtn.addEventListener('click', () => {
    const note = prompt('Send a special instruction to the delivery agent:');
    if (note === null) return;
    const trimmed = note.trim();
    if (trimmed) {
      updateInstructionText(`Instruction sent: “${trimmed}”`);
    } else {
      updateInstructionText('No instruction was sent.');
    }
  });
}

function render(order) {
  statusEl.textContent = `Status: ${order.status}`;
  summaryOrderId.textContent = order.id;
  summaryTotal.textContent = INR.format(order.total || 0);
  itemsEl.innerHTML = '';
  summaryItems.innerHTML = '';

  order.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'item-state';
    row.innerHTML = `
      <div>${item.name} (${item.brand || 'Quickmart'}) x ${item.qty}</div>
      <span class="badge ${item.state}">${item.state.replaceAll('_', ' ')}</span>
    `;
    itemsEl.appendChild(row);

    const li = document.createElement('div');
    li.className = 'item-state';
    li.innerHTML = `
      <div>${item.name} (${item.brand || 'Quickmart'}) x ${item.qty}</div>
      <div>${INR.format(item.unit_price * item.qty)}</div>
    `;
    summaryItems.appendChild(li);
  });

  activeIssue = order.active_issue;
  if (activeIssue) {
    issuePanel.style.display = 'block';
    issueText.textContent = `Item issue: ${activeIssue.reason}. Choose an action in 2 minutes.`;
    renderReplacementTable(activeIssue);
    startHoldTimer(activeIssue.hold_until);
  } else {
    issuePanel.style.display = 'none';
    holdTimer.textContent = '';
    selectedReplacementId = null;
    replaceSelectedBtn.disabled = true;
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }

  if (order.status === 'confirmed' && !finalPlacedNotified) {
    finalPlacedNotified = true;
    const lines = order.items
      .filter((i) => i.state !== 'skipped')
      .map((i) => `- ${i.name} (${i.brand || 'Quickmart'}) x ${i.qty}`)
      .join('\n');
    alert(`Order placed successfully!\nOrder ID: ${order.id}\nItems:\n${lines}`);
  }
  const payment = order.payment_summary;
  if (payment) {
    paymentSummarySection.style.display = 'block';
    paymentModeEl.textContent = payment.payment_label || payment.payment_mode || 'Cash on Delivery';
    couponValueEl.textContent = payment.coupon_discount ? `- ${INR.format(payment.coupon_discount)}` : '-INR 0.00';
    paymentDiscountEl.textContent = payment.payment_discount ? `- ${INR.format(payment.payment_discount)}` : '-INR 0.00';
    handlingEl.textContent = payment.handling_fee ? INR.format(payment.handling_fee) : INR.format(0);
    deliveryEl.textContent = payment.delivery_fee ? INR.format(payment.delivery_fee) : INR.format(0);
    surgeEl.textContent = payment.surge_charge ? INR.format(payment.surge_charge) : INR.format(0);
    if (emergencyFeeEl) {
      emergencyFeeEl.textContent = payment.emergency_fee ? INR.format(payment.emergency_fee) : INR.format(0);
    }
    if (storeNameEl) {
      storeNameEl.textContent = payment.store_name || order.store_assignment?.name || '';
    }
    if (storeDistanceEl) {
      storeDistanceEl.textContent = payment.store_distance ? ` ${payment.store_distance}` : '';
    }
    if (storeNoteEl) {
      storeNoteEl.textContent = payment.store_note || order.store_assignment?.status_note || '';
    }
    finalEl.textContent = INR.format(payment.final_total || order.total);
    deliveryNoteEl.textContent = payment.delivery_note || '';
    surgeNoteEl.textContent = payment.surge_note || '';
  } else if (paymentSummarySection) {
    paymentSummarySection.style.display = 'none';
  }
  setupDeliveryMap(order);
}

function startHoldTimer(iso) {
  if (holdInterval) {
    clearInterval(holdInterval);
  }
  holdInterval = setInterval(() => {
    const diff = Math.max(0, Math.floor((new Date(iso) - new Date()) / 1000));
    const mm = String(Math.floor(diff / 60)).padStart(2, '0');
    const ss = String(diff % 60).padStart(2, '0');
    holdTimer.textContent = `Order on hold: ${mm}:${ss}`;
    if (diff <= 0 || !activeIssue) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }, 1000);
}

function renderReplacementTable(issue) {
  selectedReplacementId = null;
  replaceSelectedBtn.disabled = true;
  if (!issue.suggestions || issue.suggestions.length === 0) {
    replacementList.innerHTML = '<p class="muted">No alternatives available. You can continue with remaining items or cancel.</p>';
    return;
  }

  const modeText = issue.suggestion_mode === 'other_brands'
    ? 'No direct similar match found. Showing other brands for the same product.'
    : 'Showing similar available options.';

  replacementList.innerHTML = `
    <p class="muted">${modeText}</p>
    <table class="history-table replacement-table">
      <thead>
        <tr>
          <th>Select</th>
          <th>Product</th>
          <th>Brand</th>
          <th>Category</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        ${issue.suggestions.map((s) => `
          <tr class="replacement-row" data-id="${s.id}">
            <td><input type="radio" name="replacement_pick" value="${s.id}" /></td>
            <td>${s.name}</td>
            <td>${s.brand || 'Quickmart'}</td>
            <td>${s.category || '-'}</td>
            <td>${INR.format(s.price)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  replacementList.querySelectorAll('.replacement-row').forEach((row) => {
    row.addEventListener('click', () => {
      const id = row.dataset.id;
      selectedReplacementId = id;
      replaceSelectedBtn.disabled = false;
      replacementList.querySelectorAll('.replacement-row').forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      const radio = row.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    });
  });
}

function resolveIssue(action, replacementId = null) {
  ws.send(JSON.stringify({
    type: 'resolve_issue',
    action,
    replacement_id: replacementId,
    item_id: activeIssue?.item_id
  }));
}

document.getElementById('continue-btn').onclick = () => resolveIssue('continue');
document.getElementById('cancel-btn').onclick = () => resolveIssue('cancel');
replaceSelectedBtn.onclick = () => {
  if (!selectedReplacementId) return;
  resolveIssue('replace', selectedReplacementId);
};

async function init() {
  const res = await fetch(`/api/orders/${window.ORDER_ID}`);
  if (!res.ok) return;
  render(await res.json());

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/orders/${window.ORDER_ID}`);
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'order_update') render(data.order);
  };
}

init();
