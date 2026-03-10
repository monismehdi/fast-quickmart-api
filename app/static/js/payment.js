const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const config = window.PAYMENT_CONFIG || {};
const baseTotal = Number(config.base_total) || 0;
const couponInput = document.getElementById('coupon-code');
const hiddenPinInput = document.getElementById('payment-pin');
const PIN_STORAGE_KEY = 'quickmart_pin';
const applyCouponButton = document.getElementById('apply-coupon');
const summary = {
  subtotal: document.getElementById('summary-subtotal'),
  coupon: document.getElementById('summary-coupon'),
  payment: document.getElementById('summary-payment'),
  handling: document.getElementById('summary-handling'),
  delivery: document.getElementById('summary-delivery'),
  surge: document.getElementById('summary-surge'),
  final: document.getElementById('final-amount'),
  deliveryNote: document.getElementById('delivery-note'),
  surgeNote: document.getElementById('surge-note'),
};
const pinHelper = document.getElementById('pin-helper');
const couponMessage = document.getElementById('coupon-message');
const confirmButton = document.getElementById('confirm-payment');
const emergencyInput = document.getElementById('emergency-mode-input');
const storeHint = document.getElementById('store-hint');
const emergencyPreview = document.getElementById('emergency-preview');
const EMERGENCY_STORAGE_KEY = 'quickmart_emergency_mode';
const emergencyInfo = config.emergency_info || {};

const sanitizePin = (val) => (val || '').replace(/\D/g, '').slice(0, 6);
const storedPin = window.localStorage?.getItem(PIN_STORAGE_KEY) || '';
const storedEmergencyMode = window.localStorage?.getItem(EMERGENCY_STORAGE_KEY) === '1';
const state = {
  coupon: '',
  paymentMode: document.querySelector('input[name="payment_mode"]:checked')?.value || 'cod',
  pin: sanitizePin(storedPin),
  emergencyMode: storedEmergencyMode,
};
if (hiddenPinInput) {
  hiddenPinInput.value = state.pin;
}
if (emergencyInput) {
  emergencyInput.value = state.emergencyMode ? '1' : '0';
}

function formatCurrency(value) {
  return formatter.format(value);
}

function syncHiddenPin() {
  if (hiddenPinInput) {
    hiddenPinInput.value = state.pin;
  }
}

function getCouponInfo(code) {
  const normalized = (code || '').trim().toUpperCase();
  const coupon = config.coupons?.[normalized];
  if (!coupon) {
    return { amount: 0, valid: false, normalized };
  }
  const minTotal = coupon.min_total || 0;
  if (baseTotal < minTotal) {
    return { amount: 0, valid: false, normalized, min_total: minTotal };
  }
  let amount;
  if (coupon.type === 'fixed') {
    amount = coupon.amount;
  } else {
    amount = (baseTotal * (coupon.percent || 0)) / 100;
    amount = Math.min(amount, coupon.max_amount ?? amount);
  }
  return { amount: Math.round(amount * 100) / 100, valid: true, normalized, description: coupon.description };
}

function getPaymentMethodInfo(amountAfterCoupon) {
  const methods = config.payment_methods || {};
  const method = methods[state.paymentMode] || methods.cod || { percent: 0, max_amount: 0, description: '' };
  if (amountAfterCoupon < (method.min_total || 0) || (method.percent || 0) <= 0) {
    return { amount: 0, label: method.label || 'Payment', description: method.description || '' };
  }
  let discount = (amountAfterCoupon * method.percent) / 100;
  discount = Math.min(discount, method.max_amount || discount);
  return { amount: Math.round(discount * 100) / 100, label: method.label, description: method.description };
}

function resolveStoreForPin(pin) {
  const networks = config.store_network || {};
  const defaultKey = config.store_network_default || 'default';
  const chosenKey = pin && networks[pin] ? pin : defaultKey;
  const candidates = networks[chosenKey] || networks[defaultKey] || [];
  if (!candidates.length) return null;
  const primary = candidates[0];
  const selected = candidates.find((store) => store.open !== false) || candidates[candidates.length - 1];
  const fallbackNote =
    primary && selected.id !== primary.id
      ? primary.status_note || `${primary.name} is temporarily paused; routing from ${selected.name}.`
      : '';
  return {
    ...selected,
    status_note: fallbackNote || selected.status_note || '',
  };
}

function updateStoreHint(store) {
  if (!storeHint) return;
  if (!store) {
    storeHint.textContent = '';
    return;
  }
  const distance = store.distance_label ? ` (${store.distance_label})` : '';
  const note = store.status_note ? ` ${store.status_note}` : '';
  storeHint.textContent = `Routing from ${store.name}${distance}.${note}`;
}

function updateEmergencyPreview() {
  if (!emergencyPreview) return;
  if (state.emergencyMode === false) {
    emergencyPreview.classList.add('hidden');
    return;
  }
  const windowRange = emergencyInfo.window || [];
  const rangeText = windowRange.length ? `${windowRange[0]}-${windowRange[1]} min` : 'superfast';
  const scopeText = (emergencyInfo.scope || []).join(', ');
  const description =
    emergencyInfo.description ||
    `Emergency mode guarantees ${rangeText} delivery for ${scopeText}.`;
  emergencyPreview.textContent = description;
  emergencyPreview.classList.remove('hidden');
}

function updatePinMessage(pin, surgeCharge) {
  if (!pin) {
    pinHelper.textContent = 'PIN is set on the shop page; set one there to see surge pricing.';
    summary.surgeNote.textContent = '';
    return;
  }
  const heavyPins = config.heavy_pincodes || [];
  const isHeavy = heavyPins.includes(pin);
  if (isHeavy && surgeCharge > 0) {
    pinHelper.textContent = `High demand at ${pin} applies a surge of ${formatCurrency(surgeCharge)}.`;
    summary.surgeNote.textContent = `Surge active for ${pin}.`;
  } else if (isHeavy) {
    pinHelper.textContent = `Orders at ${pin} usually attract a surge, but it's waived for totals above ₹${config.surge_waiver_threshold}.`;
    summary.surgeNote.textContent = 'Surge waived due to high value order.';
  } else {
    pinHelper.textContent = 'Delivery available in this area.';
    summary.surgeNote.textContent = '';
  }
}

function renderSummary() {
  const couponData = getCouponInfo(state.coupon);
  const afterCoupon = Math.max(0, baseTotal - couponData.amount);
  const paymentData = getPaymentMethodInfo(afterCoupon);
  const afterPayment = Math.max(0, afterCoupon - paymentData.amount);

  const handlingFee = config.handling_fee || 0;
  const deliveryFee = afterPayment >= (config.delivery_fee_threshold || 0) ? 0 : (config.delivery_fee || 0);
  const surgeRate = (config.surge_charges || {})[state.pin] || 0;
  const surgeCharge =
    state.pin && surgeRate && afterPayment <= (config.surge_waiver_threshold ?? Infinity)
      ? surgeRate
      : 0;
  const storeAssignment = resolveStoreForPin(state.pin);
  const emergencyFee = state.emergencyMode && storeAssignment ? Number(storeAssignment.emergency_fee || 0) : 0;
  const finalAmount = Math.max(0, afterPayment + handlingFee + deliveryFee + surgeCharge + emergencyFee);

  summary.subtotal.textContent = formatCurrency(baseTotal);
  summary.coupon.textContent = couponData.amount ? `- ${formatCurrency(couponData.amount)}` : '-INR 0.00';
  summary.payment.textContent = paymentData.amount ? `- ${formatCurrency(paymentData.amount)}` : '-INR 0.00';
  summary.handling.textContent = formatCurrency(handlingFee);
  summary.delivery.textContent = formatCurrency(deliveryFee);
  summary.surge.textContent = formatCurrency(surgeCharge);
  summary.emergency.textContent = formatCurrency(emergencyFee);
  summary.final.textContent = formatCurrency(finalAmount);
  summary.deliveryNote.textContent =
    deliveryFee === 0
      ? 'Delivery fee waived for totals above ₹299.'
      : `Delivery fee ₹${config.delivery_fee} applies below ₹${config.delivery_fee_threshold}.`;

  confirmButton.textContent = `Confirm payment • ${formatCurrency(finalAmount)}`;
  syncHiddenPin();
  if (emergencyInput) emergencyInput.value = state.emergencyMode ? '1' : '0';

  if (couponData.valid) {
    couponMessage.textContent = `Coupon ${couponData.normalized} applied (${couponData.description}).`;
  } else if (couponData.normalized) {
    couponMessage.textContent = couponData.min_total
      ? `Add ₹${Math.max(0, couponData.min_total - baseTotal)} more to use ${couponData.normalized}.`
      : `Coupon ${couponData.normalized} is not valid.`;
  } else {
    couponMessage.textContent = '';
  }

  updatePinMessage(state.pin, surgeCharge);
  updateStoreHint(storeAssignment);
  updateEmergencyPreview();
}

document.querySelectorAll('input[name="payment_mode"]').forEach((el) => {
  el.addEventListener('change', (event) => {
    state.paymentMode = event.target.value;
    renderSummary();
  });
});

if (couponInput) {
  couponInput.addEventListener('input', (event) => {
    state.coupon = event.target.value;
  });
}

if (applyCouponButton) {
  applyCouponButton.addEventListener('click', () => {
    state.coupon = couponInput?.value || '';
    renderSummary();
  });
}

const paymentForm = document.getElementById('payment-form');
if (paymentForm) {
  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    syncHiddenPin();
    if (confirmButton) confirmButton.disabled = true;
    try {
      const response = await fetch('/checkout', { method: 'POST', body: new FormData(paymentForm) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(payload.detail || 'Unable to place the order right now.');
        return;
      }
      window.location.href = `/order/${payload.order_id}`;
    } catch (err) {
      alert(err.message || 'Checkout failed');
    } finally {
      if (confirmButton) confirmButton.disabled = false;
    }
  });
}

renderSummary();
