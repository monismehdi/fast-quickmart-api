# quickmart

FastAPI demo app for 30-minute delivery ordering, AI-like recommendations, and live order packing tracking with WebSockets.

## Highlights

- **Persona-aware onboarding** – signup captures `age_group`, `lifestyle`, `personality`, and `app_usage`, stores likes, and keeps credentials in `app/data/users.json` so each user arrives with a profile.
- **Personalized shop** – `/shop` surfaces recommendations from `recommend_products` and `recommend_from_similar_orders`, a searchable/sortable catalog, in-stock filtering, floating carts driven by `app/static/js/shop.js`, and now only unpacks 10 products at first load while providing load-more controls plus a home-page PIN widget that previews surge zones (`app/templates/shop.html`, `app/static/js/shop.js`, `app/static/css/style.css`).
- **Cart, checkout, and simulated packing** – REST endpoints under `/cart/*`, `/checkout`, and `/api/orders/*` save state via `app/repository.py` to JSON files; `OrderEngine` in `app/orders.py` simulates packing/issue handling and publishes updates over WebSockets (`/ws/orders/{order_id}`).
- **Actionable order tracking** – `/order/{order_id}` shows live status, ETA, hold timer, issue resolution (continue, replace, cancel), and replacement suggestions fetched when items are missing/damaged.
- **Profile + history** – `/profile` renders stored user details plus paginated order history and auto-refreshing live orders (polling every 4 seconds via `app/static/js/profile.js`).
- **Product details powered by data layers** – `build_product_detail` in `app/main.py` aggregates variants, price/discount heuristics, highlights, and gallery thumbnails so every `/product/{product_id}` page feels rich.
- **Realistic payment desk** – `/payment` introduces multi-tier payment modes (COD, Amazon Pay, UPI, card), coupon prompts, pin-based surge handling, delivery fee waivers above ₹299, and mirrors the breakdown in the order tracker (`app/templates/payment.html`, `app/static/js/payment.js`, `app/templates/order.html`).
- **Instant support assistant** – a small chat widget backed by `/api/chat`, minimal JS/CSS assets, and a tiny intent matcher that answers FAQs about orders, cancellations, refunds, and escalation to a human if the question is outside the quickmart playbook.

## Structure

- `app/main.py` orchestrates templated views, cart/order APIs, search suggestion endpoints, and WebSocket routing for order decisions.
- `app/recommendation.py` powers similarity scoring, collaborative likes rankings, and replacement suggestions used by the shop and order engine.
- `app/orders.py` keeps the `ConnectionManager` and `OrderEngine` that queue decisions, simulate packing delays, handle missing/damaged products, and trigger recommendation-based replacements.
- Static assets in `app/templates` (login, shop, profile, product, order) pair with `app/static/js` logic to render the front-end behaviors described above.

## Run

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000
