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
const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });

let ws;
let activeIssue;
let holdInterval = null;
let selectedReplacementId = null;
let finalPlacedNotified = false;

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
    finalEl.textContent = INR.format(payment.final_total || order.total);
    deliveryNoteEl.textContent = payment.delivery_note || '';
    surgeNoteEl.textContent = payment.surge_note || '';
  } else if (paymentSummarySection) {
    paymentSummarySection.style.display = 'none';
  }
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
