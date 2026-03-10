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
const mapStoreNameEl = document.getElementById('map-store-name');
const mapStoreCoordsEl = document.getElementById('map-store-coords');
const mapHomeNameEl = document.getElementById('map-home-name');
const mapHomeCoordsEl = document.getElementById('map-home-coords');
const mapDistanceEl = document.getElementById('map-distance-left');
const mapTimeLeftEl = document.getElementById('map-time-left');
const storePin = document.getElementById('delivery-store-pin');
const homePin = document.getElementById('delivery-home-pin');
const trackingOverlay = document.getElementById('tracking-locked');
const etaEl = document.getElementById('eta');
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
let countdownInterval = null;
let routeInterval = null;
let normalizedRoute = [];
let routeIndex = 0;
let currentBounds = null;
let countdownSeconds = 0;
let latestOrderDistance = 0;
let latestStoreLocation = null;
let latestCustomerLocation = null;
let trackingActive = false;
const TRACKING_READY_STATUSES = new Set(['driver_assigned', 'driver_at_store', 'out_for_delivery', 'confirmed']);
const STATUS_INSTRUCTION_TEXT = {
  packing: 'Your items are being packed at the Quickmart hub.',
  driver_assigned: 'Driver has been assigned and is heading to the store for pickup.',
  driver_at_store: 'Driver is collecting your items from the store.',
  out_for_delivery: 'Driver is on the road with your essentials.',
  confirmed: 'Driver is moments away from your doorstep.',
  on_hold: 'Order paused while we resolve an item issue. Choose an option on the last panel.',
  cancelled: 'Order has been cancelled.',
};
const TRACKING_OVERLAY_MESSAGES = {
  packing: 'Tracking begins once a delivery agent is assigned.',
  created: 'Tracking begins once a delivery agent is assigned.',
  on_hold: 'Tracking will resume after you resolve the held item.',
};

let ws;
let activeIssue;
let holdInterval = null;
let selectedReplacementId = null;
let finalPlacedNotified = false;

function buildBounds(route) {
  const lats = route.map((point) => point?.lat ?? 0);
  const lngs = route.map((point) => point?.lng ?? 0);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    minLat,
    maxLat,
    minLng,
    maxLng,
    latSpan: Math.max(0.0001, maxLat - minLat),
    lngSpan: Math.max(0.0001, maxLng - minLng),
  };
}

function normalizedPoint(point, bounds = currentBounds) {
  if (!point || !bounds) return null;
  const lat = typeof point.lat === 'number' ? point.lat : bounds.minLat;
  const lng = typeof point.lng === 'number' ? point.lng : bounds.minLng;
  const x = 10 + (((lng - bounds.minLng) / bounds.lngSpan) * 75);
  const y = 80 - (((lat - bounds.minLat) / bounds.latSpan) * 50);
  return {
    x: Math.min(95, Math.max(5, x)),
    y: Math.min(85, Math.max(15, y)),
  };
}

function normalizeRoute(route) {
  if (!route || !route.length) return [];
  currentBounds = buildBounds(route);
  return route.map((point) => normalizedPoint(point, currentBounds)).filter(Boolean);
}

function getNormalizedPosition(point) {
  return normalizedPoint(point);
}

function updateMarkerPosition(point) {
  if (!mapMarker || !point) return;
  const x = Math.min(95, Math.max(5, point.x));
  const y = Math.min(85, Math.max(15, point.y));
  mapMarker.style.left = `${x}%`;
  mapMarker.style.top = `${y}%`;
}

function positionPin(pinEl, location) {
  if (!pinEl) return;
  const normalized = getNormalizedPosition(location);
  if (!normalized) {
    pinEl.style.display = 'none';
    return;
  }
  pinEl.style.display = 'flex';
  pinEl.style.left = `${normalized.x}%`;
  pinEl.style.top = `${normalized.y}%`;
}

function isTrackingReady(order) {
  return Boolean(order?.driver && TRACKING_READY_STATUSES.has(order.status));
}

function startRouteAnimation(route) {
  if (!mapMarker) return;
  clearInterval(routeInterval);
  normalizedRoute = normalizeRoute(route);
  if (!normalizedRoute.length) {
    trackingActive = false;
    return;
  }
  routeIndex = 0;
  updateMarkerPosition(normalizedRoute[0]);
  updateMapPins();
  updateMapStats();
  trackingActive = true;
  routeInterval = setInterval(() => {
    routeIndex = (routeIndex + 1) % normalizedRoute.length;
    updateMarkerPosition(normalizedRoute[routeIndex]);
    updateMapStats();
  }, 3200);
}

function startCountdown(minutes) {
  if (!countdownEl) return;
  clearInterval(countdownInterval);
  let seconds = Math.max(0, Math.round((minutes || 0) * 60));
  const tick = () => {
    if (seconds <= 0) {
      countdownEl.textContent = 'Arriving shortly';
      countdownSeconds = 0;
      updateMapStats();
      clearInterval(countdownInterval);
      return;
    }
    const mm = Math.floor(seconds / 60);
    const ss = seconds % 60;
    countdownEl.textContent = `ETA ${mm}m ${ss.toString().padStart(2, '0')}s`;
    countdownSeconds = seconds;
    updateMapStats();
    seconds -= 1;
  };
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function updateMapPins() {
  if (latestStoreLocation) {
    positionPin(storePin, latestStoreLocation);
  }
  if (latestCustomerLocation) {
    positionPin(homePin, latestCustomerLocation);
  }
}

function formatDistance(distance) {
  if (!distance && distance !== 0) return '—';
  return `${distance.toFixed(2)} km`;
}

function formatCoords(point) {
  if (!point) return '—';
  return `Lat ${point.lat.toFixed(4)}, Lng ${point.lng.toFixed(4)}`;
}

function formatETA(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm}m ${ss.toString().padStart(2, '0')}s`;
}

function updateMapStats() {
  if (mapDistanceEl) {
    const total = latestOrderDistance || 0;
    if (normalizedRoute.length) {
      const progress = normalizedRoute.length > 1 ? routeIndex / (normalizedRoute.length - 1) : 0;
      const remaining = Math.max(0, 1 - progress);
      mapDistanceEl.textContent = `Distance left ${formatDistance(total * remaining)}`;
    } else {
      mapDistanceEl.textContent = `Distance approx ${formatDistance(total)}`;
    }
  }
  if (mapTimeLeftEl) {
    mapTimeLeftEl.textContent = countdownSeconds > 0 ? `Time left ${formatETA(countdownSeconds)}` : 'Time left —';
  }
}

function resetTrackingAnimation() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (routeInterval) {
    clearInterval(routeInterval);
    routeInterval = null;
  }
  trackingActive = false;
  normalizedRoute = [];
  routeIndex = 0;
  countdownSeconds = 0;
  if (mapMarker) {
    mapMarker.style.left = '';
    mapMarker.style.top = '';
  }
  if (storePin) {
    storePin.style.display = 'none';
  }
  if (homePin) {
    homePin.style.display = 'none';
  }
  updateMapStats();
}
function updateTrackingOverlay(order) {
  if (!trackingOverlay) return;
  const ready = isTrackingReady(order);
  if (ready) {
    trackingOverlay.classList.add('hidden');
    return;
  }
  const message = TRACKING_OVERLAY_MESSAGES[order?.status] || 'Tracking begins once your delivery agent is assigned.';
  trackingOverlay.textContent = message;
  trackingOverlay.classList.remove('hidden');
}

function updateInstructionText(text) {
  if (!instructionsEl) return;
  instructionsEl.textContent = text;
}

function setupDeliveryMap(order) {
  const driver = order.driver;
  if (agentNameEl) {
    agentNameEl.textContent = driver?.name || 'Quickmart agent';
  }
  if (agentVehicleEl) {
    agentVehicleEl.textContent = driver?.vehicle || 'Quickmart delivery';
  }
  if (agentCallEl) {
    agentCallEl.href = driver?.phone ? `tel:${driver.phone}` : '#';
  }
  latestOrderDistance = order.distance_km || latestOrderDistance;
  latestStoreLocation = order.store_location || latestStoreLocation;
  latestCustomerLocation = order.customer_location || latestCustomerLocation;
  if (mapStoreNameEl) {
    mapStoreNameEl.textContent = order.store_assignment?.name || 'Quickmart hub';
  }
  if (mapStoreCoordsEl) {
    mapStoreCoordsEl.textContent = formatCoords(latestStoreLocation);
  }
  if (mapHomeNameEl) {
    mapHomeNameEl.textContent = 'Your location';
  }
  if (mapHomeCoordsEl) {
    mapHomeCoordsEl.textContent = formatCoords(latestCustomerLocation);
  }
  if (etaEl) {
    etaEl.textContent = order.eta_minutes ? `ETA: ${order.eta_minutes} minutes` : 'ETA: 30 minutes';
  }
  const instructionText =
    STATUS_INSTRUCTION_TEXT[order.status] || 'Your order is being prepared. We will update the tracker shortly.';
  updateInstructionText(instructionText);
  updateTrackingOverlay(order);
  const ready = isTrackingReady(order);
  if (!ready) {
    resetTrackingAnimation();
    return;
  }
  startCountdown(order.eta_minutes || 0);
  startRouteAnimation(order.tracking_route || driver.route || []);
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
