# quickmart

FastAPI demo app for 30-minute delivery ordering, AI-like recommendations, and live order packing tracking with WebSockets.

## Highlights

- **Persona-aware onboarding** – signup captures `age_group`, `lifestyle`, `personality`, and `app_usage`, stores likes, and keeps credentials in `app/data/users.json` so each user arrives with a profile.
- **Personalized shop** – `/shop` now blends a hybrid recommendation layer built from repeat-order cadence, recency, reorder frequency, likes, and similar-user behavior. The top of the page groups learned suggestions into `Daily`, `Weekly`, and `Monthly` blocks with confidence bars and “why this” chips, while still keeping a searchable/sortable catalog, in-stock filtering, floating carts driven by `app/static/js/shop.js`, load-more controls, and a home-page PIN widget that previews surge zones (`app/templates/shop.html`, `app/static/js/shop.js`, `app/static/css/style.css`, `app/recommendation.py`).
- **Cart, checkout, and simulated packing** – REST endpoints under `/cart/*`, `/checkout`, and `/api/orders/*` save state via `app/repository.py` to JSON files; `OrderEngine` in `app/orders.py` simulates packing/issue handling and publishes updates over WebSockets (`/ws/orders/{order_id}`).
- **Actionable order tracking** – `/order/{order_id}` shows live status, ETA, hold timer, issue resolution (continue, replace, cancel), and replacement suggestions fetched when items are missing/damaged.
- **Profile + history** – `/profile` renders stored user details plus paginated order history and auto-refreshing live orders (polling every 4 seconds via `app/static/js/profile.js`).
- **Product details powered by data layers** – `build_product_detail` in `app/main.py` aggregates variants, price/discount heuristics, highlights, and gallery thumbnails so every `/product/{product_id}` page feels rich.
- **Realistic payment desk** – `/payment` introduces multi-tier payment modes (COD, Amazon Pay, UPI, card), coupon prompts, pin-based surge handling, delivery fee waivers above ₹299, and mirrors the breakdown in the order tracker (`app/templates/payment.html`, `app/static/js/payment.js`, `app/templates/order.html`).
- **Instant support assistant** – a small chat widget backed by `/api/chat`, minimal JS/CSS assets, and a tiny intent matcher that answers FAQs about orders, cancellations, refunds, and escalation to a human if the question is outside the quickmart playbook.
- **Emergency fulfillment** – the emergency toggle now anchors inside the right-hand cart so the “Emergency delivery active” state feels full, and it filters to diapers, baby care, formula, milk, OTC medicines, thermometers, blood-pressure monitors, first-aid kits, and other basic medical gear. Emergency orders promise a 10–20 minute window with an extra ₹15–₹30 fee and automatically reroute to the next open Quickmart when the closest hub is paused; the checkout payload surfaces each store’s distance and ETA for transparency.
- **Interactive delivery tracking** – the tracker now narrates packing → driver assigned → driver at store → out for delivery → confirmed, with short deliberate gaps between each handoff. It visualizes the Quickmart store, your home, the delivery route, distance/time left, and ETA, hides the overlay until the agent is assigned, and keeps the rider call control (chat is temporarily disabled) along with fallback store hints, status history, and surge notes.

## Structure

- `app/main.py` orchestrates templated views, cart/order APIs, search suggestion endpoints, and WebSocket routing for order decisions.
- `app/recommendation.py` powers the hybrid recommendation scoring layer, repeat-order cadence detection, collaborative likes rankings, and replacement suggestions used by the shop and order engine.
- `app/orders.py` keeps the `ConnectionManager` and `OrderEngine` that queue decisions, simulate packing delays, handle missing/damaged products, and trigger recommendation-based replacements.
- Static assets in `app/templates` (login, shop, profile, product, order) pair with `app/static/js` logic to render the front-end behaviors described above.

## Future Updates

- [ ] Add a real ML recommender using `scikit-learn` as the next recommendation engine upgrade, starting with a simple user-item similarity or `NearestNeighbors` model trained from `app/data/orders.json`.
- [ ] Compare the current hybrid heuristic recommender against the ML version and keep graceful fallback behavior when order data is sparse.
- [ ] Add light evaluation/debug tooling so recommendation reasons, confidence, and ranking changes are easier to inspect during development.

## Run

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000
