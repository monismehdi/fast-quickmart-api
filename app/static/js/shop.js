const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2
});

const state = {
  category: 'all',
  query: '',
  sort: 'relevance',
  inStockOnly: false,
  brand: 'all',
  emergencyMode: false,
};
const LOAD_CHUNK = 10;
let visibleLimit = LOAD_CHUNK;
const PIN_STORAGE_KEY = 'quickmart_pin';
const surgeInfo = window.SURGE_INFO || {};
const surgeThreshold = window.SURGE_WAIVER_THRESHOLD || 499;
const pinInput = document.getElementById('home-pin');
const pinFeedback = document.getElementById('pin-feedback');
const loadMoreBtn = document.getElementById('load-more');
const EMERGENCY_STORAGE_KEY = 'quickmart_emergency_mode';
const emergencyToggle = document.getElementById('emergency-toggle');
const emergencyToggleState = document.getElementById('emergency-toggle-state');
const emergencyBanner = document.getElementById('emergency-banner');
const emergencyBannerCopy = document.getElementById('emergency-banner-copy');
const emergencyBannerNote = document.getElementById('emergency-banner-note');

async function postForm(url, payload) {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => fd.append(k, v));
  const res = await fetch(url, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || err.error || 'Request failed');
  }
  return res.json();
}

async function loadCart() {
  const res = await fetch('/api/cart');
  if (!res.ok) return;
  const data = await res.json();
  const root = document.getElementById('cart-items');
  root.innerHTML = '';
  if (!data.items.length) {
    root.innerHTML = `
      <div class="cart-empty">
        <img src="/static/images/ui/empty-box.svg" alt="Empty cart" />
        <div>Your cart is empty. Add some products to begin.</div>
      </div>
    `;
  }
  data.items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'cart-row';
    row.innerHTML = `
      <div>${item.name}<br><small>${INR.format(item.price)}</small></div>
      <div class="qty">
        <button onclick="updateQty('${item.product_id}', ${item.qty - 1})">-</button>
        <strong>${item.qty}</strong>
        <button onclick="updateQty('${item.product_id}', ${item.qty + 1})">+</button>
      </div>
      <div>${INR.format(item.qty * item.price)}</div>
    `;
    root.appendChild(row);
  });
  document.getElementById('cart-total').textContent = `Total: ${INR.format(data.total)}`;
}

async function addToCart(productId) {
  if (state.emergencyMode) {
    const targetCard = document.querySelector(`[data-product-id="${productId}"]`);
    if (!isEmergencyEligibleCard(targetCard)) {
    const scope = emergencyScopeText() || 'emergency essentials';
      alert(`Emergency mode only covers ${scope}. Disable emergency mode to add this product.`);
      return;
    }
  }
  await postForm('/cart/add', { product_id: productId, qty: 1 });
  await loadCart();
}

async function updateQty(productId, qty) {
  await postForm('/cart/update', { product_id: productId, qty: Math.max(0, qty) });
  await loadCart();
}

function checkout() {
  location.href = '/payment';
}

function filterProducts(category, buttonEl) {
  state.category = category;
  document.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'));
  if (buttonEl) {
    buttonEl.classList.add('active');
  } else {
    const selected = document.querySelector(`.chip[data-filter="${category}"]`);
    if (selected) selected.classList.add('active');
  }
  resetVisibleLimit();
  applyProductView();
}

function compareCards(a, b) {
  const aPrice = Number(a.dataset.price || 0);
  const bPrice = Number(b.dataset.price || 0);
  const aName = (a.dataset.name || '').toLowerCase();
  const bName = (b.dataset.name || '').toLowerCase();
  const aDiscount = Number(a.dataset.discount || 0);
  const bDiscount = Number(b.dataset.discount || 0);

  switch (state.sort) {
    case 'price_low_high':
      return aPrice - bPrice;
    case 'price_high_low':
      return bPrice - aPrice;
    case 'discount_high_low':
      return bDiscount - aDiscount;
    case 'name_a_z':
      return aName.localeCompare(bName);
    default:
      return 0;
  }
}

function applyProductView() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.product-card'));
  cards.sort(compareCards);
  const matching = [];
  cards.forEach((card) => {
    const eligibleForEmergency = !state.emergencyMode || isEmergencyEligibleCard(card);
    if (!eligibleForEmergency) {
      card.style.display = 'none';
      return;
    }
    const categoryOk = state.category === 'all' || card.dataset.category === state.category;
    const queryTarget = `${card.dataset.name || ''} ${card.dataset.brand || ''} ${card.dataset.category || ''}`.toLowerCase();
    const queryOk = !state.query || queryTarget.includes(state.query);
    const stockOk = !state.inStockOnly || Number(card.dataset.stock || 0) > 0;
    const brandOk = state.brand === 'all' || (card.dataset.brand || '') === state.brand;
    if (categoryOk && queryOk && stockOk && brandOk) {
      matching.push(card);
    } else {
      card.style.display = 'none';
    }
  });

  matching.forEach((card, index) => {
    card.style.display = index < visibleLimit ? '' : 'none';
  });

  matching.forEach((card) => grid.appendChild(card));
  updateLoadMore(matching.length);
  refreshEmergencyCardStyles();
}

function updateLoadMore(totalMatches) {
  if (!loadMoreBtn) return;
  if (totalMatches <= visibleLimit) {
    loadMoreBtn.disabled = true;
    loadMoreBtn.classList.add('hidden');
    loadMoreBtn.textContent = 'All products are visible';
    return;
  }
  loadMoreBtn.disabled = false;
  loadMoreBtn.classList.remove('hidden');
  loadMoreBtn.textContent = `Load more products (${Math.min(visibleLimit + LOAD_CHUNK, totalMatches)}/${totalMatches})`;
}

function resetVisibleLimit() {
  visibleLimit = LOAD_CHUNK;
}

function sanitizePin(value) {
  return (value || '').replace(/\\D/g, '').slice(0, 6);
}

function updatePinFeedback(pin) {
  if (!pin || !pinFeedback) {
    if (pinFeedback) pinFeedback.textContent = 'Set a PIN code to preview surge pricing.';
    return;
  }
  const surge = surgeInfo[pin] || 0;
  if (surge > 0) {
    pinFeedback.textContent = `High demand at ${pin} adds ₹${surge} surge.`;
    return;
  }
  pinFeedback.textContent = `Delivery looks smooth at ${pin}. Surge waived for totals above ₹${surgeThreshold}.`;
}

function storePin(value) {
  const normalized = sanitizePin(value);
  if (normalized && window.localStorage) {
    localStorage.setItem(PIN_STORAGE_KEY, normalized);
  } else if (window.localStorage) {
    localStorage.removeItem(PIN_STORAGE_KEY);
  }
  updatePinFeedback(normalized);
  if (pinInput) {
    pinInput.value = normalized;
  }
}

function getEmergencyInfo() {
  return window.EMERGENCY_INFO || {};
}

function emergencyScopeText() {
  const info = getEmergencyInfo();
  return (info.scope || []).join(', ');
}

function updateEmergencyBannerState() {
  if (!emergencyBanner || !emergencyBannerCopy) return;
  if (!state.emergencyMode) {
    emergencyBanner.classList.add('hidden');
    return;
  }
  const info = getEmergencyInfo();
  const windowRange = info.window || [10, 20];
  const scope = emergencyScopeText() || 'emergency essentials';
  emergencyBanner.classList.remove('hidden');
  emergencyBannerCopy.textContent =
    info.description || `Superfast ${windowRange[0]}-${windowRange[1]} minute delivery for ${scope}.`;
  if (emergencyBannerNote) {
    emergencyBannerNote.textContent = `Only ${scope} are available while emergency mode is on.`;
  }
}

function updateEmergencyButtonState() {
  if (!emergencyToggle) return;
  const span = emergencyToggleState;
  const active = state.emergencyMode;
  emergencyToggle.setAttribute('aria-pressed', active ? 'true' : 'false');
  emergencyToggle.classList.toggle('emergency-pill-active', active);
  if (span) {
    span.textContent = active ? 'On' : 'Off';
  }
}

function persistEmergencyMode(value) {
  if (!window.localStorage) return;
  if (value) {
    localStorage.setItem(EMERGENCY_STORAGE_KEY, '1');
  } else {
    localStorage.removeItem(EMERGENCY_STORAGE_KEY);
  }
}

function loadStoredEmergencyMode() {
  if (!window.localStorage) return;
  const stored = localStorage.getItem(EMERGENCY_STORAGE_KEY);
  state.emergencyMode = stored === '1';
  updateEmergencyButtonState();
  updateEmergencyBannerState();
}

function isEmergencyEligibleCard(card) {
  return (card?.dataset?.emergency || '').toLowerCase() === 'true';
}

function toggleEmergencyMode() {
  state.emergencyMode = !state.emergencyMode;
  persistEmergencyMode(state.emergencyMode);
  updateEmergencyButtonState();
  updateEmergencyBannerState();
  resetVisibleLimit();
  applyProductView();
}

function refreshEmergencyCardStyles() {
  const cards = Array.from(document.querySelectorAll('.product-card'));
  cards.forEach((card) => {
    const restricted = state.emergencyMode && !isEmergencyEligibleCard(card);
    card.classList.toggle('emergency-restricted', restricted);
  });
}

function loadStoredPin() {
  if (!window.localStorage) return;
  const saved = localStorage.getItem(PIN_STORAGE_KEY) || '';
  if (pinInput) {
    pinInput.value = saved;
  }
  updatePinFeedback(saved);
}

function buildBrandFilter() {
  const select = document.getElementById('brand-select');
  if (!select) return;
  const cards = Array.from(document.querySelectorAll('.product-card'));
  const brandMap = new Map();
  cards.forEach((card) => {
    const code = (card.dataset.brand || '').trim();
    if (!code) return;
    if (!brandMap.has(code)) {
      brandMap.set(code, card.dataset.brandName || code);
    }
  });

  const options = ['<option value="all">All brands</option>'];
  Array.from(brandMap.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .forEach(([code, label]) => {
      options.push(`<option value="${code}">${label}</option>`);
    });
  select.innerHTML = options.join('');
  select.value = state.brand;
}

let suggestionTimer = null;

async function fetchSuggestions(query) {
  const box = document.getElementById('search-suggestions');
  if (!box) return;
  if (!query) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  const res = await fetch(`/api/products/suggestions?q=${encodeURIComponent(query)}&limit=6`);
  if (!res.ok) {
    box.hidden = true;
    return;
  }
  const data = await res.json();
  if (!data.suggestions || !data.suggestions.length) {
    box.innerHTML = '<div class=\"suggestion-item muted\">No matches found</div>';
    box.hidden = false;
    return;
  }
  box.innerHTML = data.suggestions.map((item) => `
    <a class=\"suggestion-item\" href=\"/product/${item.id}\">
      <img src=\"${item.image_url}\" alt=\"${item.name}\" />
      <div>
        <strong>${item.name}</strong>
        <small>${item.brand} | ${item.category} | ${INR.format(item.price)}</small>
      </div>
    </a>
  `).join('');
  box.hidden = false;
}

function handleImageError(imgEl) {
  const media = imgEl.closest('.product-media');
  if (media) media.classList.add('no-img');
  imgEl.style.display = 'none';
}

function handleImageLoad(imgEl) {
  const media = imgEl.closest('.product-media');
  if (media) media.classList.remove('no-img');
  imgEl.style.display = 'block';
}

document.getElementById('checkout-btn').addEventListener('click', checkout);
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const inStockToggle = document.getElementById('in-stock-only');
const brandSelect = document.getElementById('brand-select');

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    resetVisibleLimit();
    applyProductView();
    clearTimeout(suggestionTimer);
    suggestionTimer = setTimeout(() => fetchSuggestions(state.query), 180);
  });
  searchInput.addEventListener('focus', () => fetchSuggestions(state.query));
}

if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    resetVisibleLimit();
    applyProductView();
  });
}

if (inStockToggle) {
  inStockToggle.addEventListener('change', (e) => {
    state.inStockOnly = e.target.checked;
    resetVisibleLimit();
    applyProductView();
  });
}

if (brandSelect) {
  brandSelect.addEventListener('change', (e) => {
    state.brand = e.target.value;
    resetVisibleLimit();
    applyProductView();
  });
}

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', () => {
    visibleLimit += LOAD_CHUNK;
    applyProductView();
  });
}

if (emergencyToggle) {
  emergencyToggle.addEventListener('click', toggleEmergencyMode);
}

if (pinInput) {
  pinInput.addEventListener('input', (e) => {
    storePin(e.target.value);
  });
}

document.addEventListener('click', (e) => {
  const box = document.getElementById('search-suggestions');
  if (!box) return;
  const wrap = document.querySelector('.search-wrap');
  if (wrap && !wrap.contains(e.target)) {
    box.hidden = true;
  }
});

loadStoredPin();
loadStoredEmergencyMode();
applyProductView();
buildBrandFilter();
loadCart();
window.filterProducts = filterProducts;
window.handleImageError = handleImageError;
window.handleImageLoad = handleImageLoad;
