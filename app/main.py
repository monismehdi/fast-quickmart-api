from datetime import datetime, timezone
from pathlib import Path
import math
import random
from typing import Any

from fastapi import Body, Cookie, FastAPI, Form, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.orders import ConnectionManager, OrderEngine
from app.recommendation import (
    recommend_ml_products,
    recommend_hybrid_products,
    recommend_from_order_patterns,
    recommend_from_similar_orders,
    recommend_products,
)
from app.repository import next_id, read_data, write_data

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="quickmart")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

manager = ConnectionManager()
engine = OrderEngine(manager)

HANDLING_FEE = 25
DELIVERY_FEE_THRESHOLD = 299
DELIVERY_FEE = 40
SURGE_WAIVER_THRESHOLD = 499
SURGE_CHARGES = {
    "560001": 45,
    "110001": 40,
    "400001": 35,
}

EMERGENCY_KEYWORDS = {"diaper", "formula", "baby", "medicine", "medicines", "pad", "care", "milk", "sanitize", "sanitary", "thermometer", "blood", "pressure", "monitor", "first aid", "wipe"}
EMERGENCY_CATEGORIES = {"Kids", "Daily Essentials", "Dairy", "Medical"}
EMERGENCY_TIME_WINDOW = (10, 20)
EMERGENCY_SCOPE = [
    "baby diapers",
    "baby child care",
    "baby formula",
    "medicines",
    "sanitary pads",
    "milk",
    "thermometers",
    "blood pressure monitors",
    "baby wipes",
    "first aid kits",
    "medical equipment",
]
EMERGENCY_FEE_RANGE = (15, 30)
DEFAULT_STORE_KEY = "default"
STORE_NETWORK = {
    DEFAULT_STORE_KEY: [
        {
            "id": "qm_central",
            "name": "Quickmart Central Hub",
            "distance_label": "1.2 km",
            "eta_modifier": 0,
            "emergency_fee": 20,
            "open": True,
            "lat": 12.9716,
            "lng": 77.5946,
            "status_note": "Serving from your neighbourhood hub.",
        },
        {
            "id": "qm_east",
            "name": "Quickmart East Block",
            "distance_label": "4.3 km",
            "eta_modifier": 8,
            "emergency_fee": 18,
            "open": True,
            "lat": 12.9821,
            "lng": 77.6085,
            "status_note": "Shifted to the east block if the central hub is busy.",
        },
    ],
    "560001": [
        {
            "id": "qm_central",
            "name": "Quickmart Central Hub",
            "distance_label": "1.2 km",
            "eta_modifier": 0,
            "emergency_fee": 22,
            "open": False,
            "lat": 12.9716,
            "lng": 77.5946,
            "status_note": "Central hub is re-stocking its emergency essentials.",
        },
        {
            "id": "qm_south",
            "name": "Quickmart South Point",
            "distance_label": "3.9 km",
            "eta_modifier": 10,
            "emergency_fee": 19,
            "open": True,
            "lat": 12.9552,
            "lng": 77.5999,
            "status_note": "Serving now from the south point depot.",
        },
        {
            "id": "qm_outer",
            "name": "Quickmart Outer Ring Depot",
            "distance_label": "6.5 km",
            "eta_modifier": 15,
            "emergency_fee": 16,
            "open": True,
            "lat": 12.9614,
            "lng": 77.6499,
            "status_note": "Fallback from the outer ring because the nearest hubs were paused.",
        },
    ],
    "560002": [
        {
            "id": "qm_central",
            "name": "Quickmart Central Hub",
            "distance_label": "1.5 km",
            "eta_modifier": 0,
            "emergency_fee": 18,
            "open": True,
            "lat": 12.9716,
            "lng": 77.5946,
            "status_note": "Central hub is taking this order.",
        },
        {
            "id": "qm_north",
            "name": "Quickmart North Annex",
            "distance_label": "4.8 km",
            "eta_modifier": 12,
            "emergency_fee": 17,
            "open": True,
            "lat": 13.0048,
            "lng": 77.5973,
            "status_note": "North annex handles overflow and farther pins.",
        },
    ],
}
PIN_COORDINATES = {
    "560001": {"lat": 12.9718, "lng": 77.5945},
    "560002": {"lat": 12.9765, "lng": 77.5991},
    "560003": {"lat": 12.9790, "lng": 77.6050},
}
DEFAULT_CUSTOMER_LOCATION = {"lat": 12.9736, "lng": 77.5991}
DEFAULT_STORE_LOCATION = {"lat": 12.9716, "lng": 77.5946}
TRACKING_SEGMENTS = 5

COUPONS = {
    "WELCOME50": {
        "description": "Flat ₹50 off on orders above ₹200",
        "type": "fixed",
        "amount": 50,
        "min_total": 200,
    },
    "FRESH15": {
        "description": "15% off up to ₹120 on orders above ₹250",
        "type": "percent",
        "percent": 15,
        "max_amount": 120,
        "min_total": 250,
    },
    "HALFPRICE": {
        "description": "₹150 off on orders ₹450 and up",
        "type": "fixed",
        "amount": 150,
        "min_total": 450,
    },
}

PAYMENT_METHOD_DISCOUNTS = {
    "cod": {
        "label": "Cash on Delivery",
        "description": "Pay in cash when we arrive.",
        "percent": 0,
        "max_amount": 0,
        "min_total": 0,
    },
    "amazon_pay": {
        "label": "Amazon Pay",
        "description": "5% instant discount up to ₹150.",
        "percent": 5,
        "max_amount": 150,
        "min_total": 150,
    },
    "upi": {
        "label": "UPI / Wallets",
        "description": "3% cashback capped at ₹80.",
        "percent": 3,
        "max_amount": 80,
        "min_total": 100,
    },
    "card": {
        "label": "Debit / Credit Card",
        "description": "2% off (max ₹100) on all cards.",
        "percent": 2,
        "max_amount": 100,
        "min_total": 0,
    },
}

CHATBOT_CONTACT = {"email": "support@quickmart.example", "phone": "+91 22 5555 0199"}

CHATBOT_INTENTS = [
    {
        "name": "greeting",
        "keywords": ["hello", "hi", "hey", "good morning", "good afternoon", "good evening"],
        "reply": "Hi there! I'm Quickmart's assistant. I can help you with order status, refunds, cancellations, or any quickmart FAQ.",
        "suggestions": ["Track order", "Refund policy", "Talk to human"],
    },
    {
        "name": "order_status",
        "keywords": ["order status", "track order", "tracking", "where is my order", "order update"],
        "reply": "Check your profile's Orders tab or paste your order ID into /order/<id> to see live updates (Picked, Packed, On the way). We refresh the tracker every few minutes.",
        "suggestions": ["View my orders", "Order ETA", "Talk to human"],
    },
    {
        "name": "order_updates",
        "keywords": ["eta", "delivery time", "arrival", "when will", "update"],
        "reply": "Delivery updates and ETA appear right on the order tracker. If you share your order ID I can point you to the right row, and we push a new status at each milestone.",
        "suggestions": ["Latest ETA", "Delivery fee", "Talk to human"],
    },
    {
        "name": "cancellation",
        "keywords": ["cancel order", "cancellation", "stop order", "change order", "need to cancel"],
        "reply": "Orders are cancellable before packing starts (usually within 10 minutes of placing it). Visit your order page and tap the cancel option, or contact support quickly so we can stop packing. After packing begins, email or call us to explore options.",
        "suggestions": ["Cancel my order", "Replacement policy", "Talk to human"],
        "human": True,
        "contact": CHATBOT_CONTACT,
    },
    {
        "name": "refund",
        "keywords": ["refund", "return", "money back", "reimbursement"],
        "reply": "Refunds are issued once we confirm the cancellation or a missing/damaged item. It typically takes 2–3 business days to land in your original payment channel, though some banks may take a little longer.",
        "suggestions": ["Refund timeline", "Missing item", "Talk to human"],
        "human": True,
        "contact": CHATBOT_CONTACT,
    },
    {
        "name": "faq",
        "keywords": ["hours", "help", "support", "faq", "delivery fee", "payment", "contact", "store hours"],
        "reply": "Quickmart delivers daily from 6:00 to 23:00. Delivery fee is ₹40 for carts below ₹299, and we waive it for higher totals. COD, Amazon Pay, UPI, and cards are accepted; coupons can be stacked where eligible.",
        "suggestions": ["Delivery fee", "Payment options", "Talk to human"],
    },
]

CHATBOT_DEFAULT = {
    "name": "fallback",
    "reply": "That one sounds new to me. Would you like me to connect you with a real teammate? Email support@quickmart.example, call +91 22 5555 0199, or tap 'Talk to human' below and we'll take over.",
    "suggestions": ["Connect with human", "View FAQ", "Track order"],
    "human": True,
    "contact": CHATBOT_CONTACT,
}


def build_chatbot_response(message: str) -> dict:
    normalized = message.lower()
    for intent in CHATBOT_INTENTS:
        if any(keyword in normalized for keyword in intent["keywords"]):
            return {
                "reply": intent["reply"],
                "suggestions": intent.get("suggestions", []),
                "human": bool(intent.get("human", False)),
                "contact": intent.get("contact"),
            }
    return {
        "reply": CHATBOT_DEFAULT["reply"],
        "suggestions": CHATBOT_DEFAULT.get("suggestions", []),
        "human": bool(CHATBOT_DEFAULT.get("human", False)),
        "contact": CHATBOT_DEFAULT.get("contact"),
    }


def is_emergency_product(product: dict[str, Any]) -> bool:
    category = product.get("category")
    if category not in EMERGENCY_CATEGORIES:
        return False
    name = (product.get("name") or "").lower()
    key = (product.get("product_key") or "").lower()
    haystack = f"{name} {key}"
    return any(keyword in haystack for keyword in EMERGENCY_KEYWORDS)


def resolve_store_assignment(pin_code: str | None) -> tuple[dict[str, Any], str]:
    pin = (pin_code or "").strip()
    candidates = STORE_NETWORK.get(pin) or STORE_NETWORK.get(DEFAULT_STORE_KEY, [])
    if not candidates:
        candidates = STORE_NETWORK.get(DEFAULT_STORE_KEY, [])
    first = candidates[0] if candidates else None
    selected = next((store for store in candidates if store.get("open", True)), None)
    if not selected and candidates:
        selected = candidates[-1]
    if not selected:
        selected = {
            "id": "qm_regional",
            "name": "Quickmart Regional Hub",
            "distance_label": "approx 5 km",
            "eta_modifier": 5,
            "emergency_fee": 20,
            "status_note": "Routed to the nearest available depot.",
        }
    fallback_note = ""
    if first and selected["id"] != first["id"]:
        fallback_note = first.get("status_note") or f"{first['name']} is temporarily paused; routing from {selected['name']}."
    sanitized = {
        "id": selected["id"],
        "name": selected["name"],
        "distance_label": selected.get("distance_label"),
        "eta_modifier": selected.get("eta_modifier", 0),
        "emergency_fee": selected.get("emergency_fee", 0),
        "status_note": fallback_note or selected.get("status_note", ""),
        "lat": selected.get("lat"),
        "lng": selected.get("lng"),
    }
    return sanitized, fallback_note


def resolve_customer_location(pin_code: str | None) -> dict[str, float]:
    pin = (pin_code or "").strip()
    coords = PIN_COORDINATES.get(pin)
    if coords:
        return {"lat": coords["lat"], "lng": coords["lng"]}
    return {"lat": DEFAULT_CUSTOMER_LOCATION["lat"], "lng": DEFAULT_CUSTOMER_LOCATION["lng"]}


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    if any(v is None for v in (lat1, lon1, lat2, lon2)):
        return 0.0
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)) if a < 1 else r * math.pi, 2)


def build_delivery_path(start: dict[str, float], end: dict[str, float], segments: int = TRACKING_SEGMENTS) -> list[dict[str, float]]:
    if not start or not end:
        return []
    steps = max(2, segments)
    lat_step = (end["lat"] - start["lat"]) / (steps - 1)
    lng_step = (end["lng"] - start["lng"]) / (steps - 1)
    return [
        {"lat": start["lat"] + lat_step * idx, "lng": start["lng"] + lng_step * idx}
        for idx in range(steps)
    ]

def load_users():
    return read_data("users", [])


def save_users(users):
    write_data("users", users)


def load_products():
    return read_data("products", [])


def load_carts():
    return read_data("carts", {})


def save_carts(carts):
    write_data("carts", carts)


def load_orders():
    return read_data("orders", [])


def save_orders(orders):
    write_data("orders", orders)


def current_user(user_id: str | None):
    if not user_id:
        return None
    users = load_users()
    return next((u for u in users if u["id"] == user_id), None)


def calculate_coupon_discount(base_total: float, coupon_code: str | None):
    if not coupon_code:
        return 0.0, None
    normalized = coupon_code.strip().upper()
    coupon = COUPONS.get(normalized)
    if not coupon or base_total < coupon.get("min_total", 0):
        return 0.0, None
    if coupon["type"] == "fixed":
        amount = min(coupon["amount"], base_total)
    else:
        amount = base_total * coupon["percent"] / 100
        amount = min(amount, coupon.get("max_amount", amount))
    return round(amount, 2), normalized


def calculate_payment_discount(amount: float, payment_mode: str):
    mode = PAYMENT_METHOD_DISCOUNTS.get(payment_mode, PAYMENT_METHOD_DISCOUNTS["cod"])
    if amount < mode.get("min_total", 0) or mode.get("percent", 0) <= 0:
        return 0.0, mode
    discount = amount * mode["percent"] / 100
    discount = min(discount, mode.get("max_amount", discount))
    return round(discount, 2), mode


def build_payment_summary(
    base_total: float,
    coupon_code: str | None,
    payment_mode: str,
    pin_code: str | None,
    emergency_mode: bool = False,
    emergency_fee: float = 0.0,
    store_assignment: dict[str, Any] | None = None,
):
    coupon_discount, normalized_coupon = calculate_coupon_discount(base_total, coupon_code)
    after_coupon = max(0, base_total - coupon_discount)
    payment_discount, payment_mode_data = calculate_payment_discount(after_coupon, payment_mode)
    after_payment = max(0, after_coupon - payment_discount)

    delivery_fee = 0 if after_payment >= DELIVERY_FEE_THRESHOLD else DELIVERY_FEE
    surge_charge = 0
    surge_note = ""
    pin = (pin_code or "").strip()
    if pin and pin in SURGE_CHARGES and after_payment <= SURGE_WAIVER_THRESHOLD:
        surge_charge = SURGE_CHARGES[pin]
        surge_note = f"High order volume at {pin} attracts a surge."

    handling_fee = HANDLING_FEE
    emergency_addon = round(emergency_fee, 2) if emergency_mode else 0.0
    final_total = round(max(0, after_payment + handling_fee + delivery_fee + surge_charge + emergency_addon), 2)

    delivery_note = (
        "Delivery fee waived for orders above ₹299."
        if delivery_fee == 0
        else f"Delivery fee ₹{DELIVERY_FEE} applies for orders under ₹{DELIVERY_FEE_THRESHOLD}."
    )

    return {
        "base_total": round(base_total, 2),
        "coupon_code": normalized_coupon,
        "coupon_discount": coupon_discount,
        "coupon_label": COUPONS.get(normalized_coupon, {}).get("description") if normalized_coupon else None,
        "payment_mode": payment_mode if payment_mode in PAYMENT_METHOD_DISCOUNTS else "cod",
        "payment_label": payment_mode_data["label"],
        "payment_discount": payment_discount,
        "payment_description": payment_mode_data["description"],
        "handling_fee": handling_fee,
        "delivery_fee": delivery_fee,
        "surge_charge": surge_charge,
        "pin_code": pin,
        "surge_note": surge_note,
        "delivery_note": delivery_note,
        "final_total": final_total,
        "emergency_mode": emergency_mode,
        "emergency_fee": emergency_addon,
        "store_name": store_assignment.get("name") if store_assignment else None,
        "store_distance": store_assignment.get("distance_label") if store_assignment else None,
        "store_note": store_assignment.get("status_note") if store_assignment else None,
    }


def build_product_detail(product: dict, products: list[dict]) -> dict:
    variants = [
        {
            "id": p["id"],
            "name": p["name"],
            "brand": p.get("brand", ""),
            "price": p["price"],
            "image_url": p.get("image_url", "/static/images/products/fallback.svg"),
            "stock": p.get("stock", 0),
        }
        for p in products
        if p.get("product_key") == product.get("product_key")
    ]
    variants.sort(key=lambda p: p["price"])

    product_copy = dict(product)
    product_copy["variants"] = variants
    product_copy.setdefault("mrp", round(float(product_copy["price"]) * 1.22, 2))
    product_copy.setdefault("discount_pct", int(round((product_copy["mrp"] - float(product_copy["price"])) / product_copy["mrp"] * 100)))
    product_copy.setdefault("unit", "1 unit")
    product_copy.setdefault("shelf_life", "12 months")
    product_copy.setdefault("description", f"{product_copy['name']} by {product_copy.get('brand', 'Quickmart')}.")
    product_copy.setdefault("highlights", ["Quality checked", "Value for money", "Daily use"])
    product_copy.setdefault("gallery_images", [product_copy.get("image_url", "/static/images/products/fallback.svg")] * 4)
    product_copy.setdefault("image_credits", [])
    return product_copy


@app.get("/", response_class=HTMLResponse)
async def home(request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if user:
        return RedirectResponse(url="/shop", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request})


@app.post("/signup")
async def signup(email: str = Form(...), phone: str = Form(...), password: str = Form(...), age_group: str = Form(...), lifestyle: str = Form(...), personality: str = Form(...), app_usage: str = Form(...)):
    users = load_users()
    if any(u["email"] == email for u in users):
        return JSONResponse({"error": "Email already exists"}, status_code=400)

    user = {
        "id": next_id("user", users),
        "email": email,
        "phone": phone,
        "password": password,
        "age_group": age_group,
        "lifestyle": lifestyle,
        "personality": personality,
        "app_usage": app_usage,
        "likes": [],
    }
    users.append(user)
    save_users(users)

    response = JSONResponse({"ok": True})
    response.set_cookie("user_id", user["id"], httponly=True)
    return response


@app.post("/login")
async def login(email: str = Form(...), password: str = Form(...)):
    users = load_users()
    user = next((u for u in users if u["email"] == email and u["password"] == password), None)
    if not user:
        return JSONResponse({"error": "Invalid credentials"}, status_code=401)

    response = JSONResponse({"ok": True})
    response.set_cookie("user_id", user["id"], httponly=True)
    return response


@app.post("/logout")
async def logout():
    response = RedirectResponse(url="/", status_code=303)
    response.delete_cookie("user_id")
    return response


@app.get("/shop", response_class=HTMLResponse)
async def shop(request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        return RedirectResponse(url="/", status_code=303)

    products = load_products()
    for product in products:
        product["emergency_ok"] = is_emergency_product(product)
    categories = sorted({p["category"] for p in products})
    carts = load_carts()
    cart = carts.get(user["id"], [])
    all_users = load_users()
    all_orders = load_orders()
    ml_recommendations = recommend_ml_products(user, all_users, all_orders, products, limit=12)
    learned_recommendations = ml_recommendations or recommend_hybrid_products(user, all_users, all_orders, products, limit=12)
    recommendation_engine = "scikit-learn nearest neighbors" if ml_recommendations else "hybrid fallback"
    grouped_recommendations = {
        "Soon to Reorder": [
            product for product in learned_recommendations
            if product.get("recommendation_pattern") in {"daily", "weekly"}
        ],
        "Monthly": [product for product in learned_recommendations if product.get("recommendation_pattern") == "monthly"],
    }
    fallback_recommendations = recommend_products(user, all_users, products, limit=12)
    seen_recommendation_ids = {product["id"] for product in learned_recommendations}
    recommendations = list(learned_recommendations)
    for product in fallback_recommendations:
        if product["id"] in seen_recommendation_ids:
            continue
        recommendations.append(product)
        seen_recommendation_ids.add(product["id"])
        if len(recommendations) >= 6:
            break
    peer_recommendations = recommend_from_similar_orders(user, all_users, all_orders, products)
    product_by_id = {p["id"]: p for p in products}

    enriched_cart = []
    for item in cart:
        product = product_by_id.get(item["product_id"])
        if product:
            enriched_cart.append(
                {
                    "product_id": product["id"],
                    "name": product["name"],
                    "qty": item["qty"],
                    "price": product["price"],
                    "subtotal": round(product["price"] * item["qty"], 2),
                }
            )

    return templates.TemplateResponse(
        "shop.html",
        {
            "request": request,
            "user": user,
            "products": products,
            "categories": categories,
            "cart": enriched_cart,
            "recommendations": recommendations,
            "grouped_recommendations": grouped_recommendations,
            "learned_recommendation_count": len(learned_recommendations),
            "recommendation_engine": recommendation_engine,
            "peer_recommendations": peer_recommendations,
            "surge_info": SURGE_CHARGES,
            "surge_waiver_threshold": SURGE_WAIVER_THRESHOLD,
            "emergency_info": {
                "scope": EMERGENCY_SCOPE,
                "window": EMERGENCY_TIME_WINDOW,
                "fee_range": EMERGENCY_FEE_RANGE,
            },
        },
    )


@app.get("/payment", response_class=HTMLResponse)
async def payment_page(request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        return RedirectResponse(url="/", status_code=303)

    carts = load_carts()
    cart = carts.get(user["id"], [])
    if not cart:
        return RedirectResponse(url="/shop", status_code=303)

    products = load_products()
    product_by_id = {p["id"]: p for p in products}
    items = []
    total = 0.0
    for entry in cart:
        product = product_by_id.get(entry["product_id"])
        if not product:
            continue
        subtotal = round(product["price"] * entry["qty"], 2)
        total += subtotal
        items.append(
            {
                "id": product["id"],
                "name": product["name"],
                "brand": product.get("brand", "Quickmart"),
                "qty": entry["qty"],
                "price": product["price"],
                "subtotal": subtotal,
                "image_url": product.get("image_url", "/static/images/products/fallback.svg"),
            }
        )
    total = round(total, 2)

    payment_methods = []
    for key, method in PAYMENT_METHOD_DISCOUNTS.items():
        discount_text = (
            f"{method['percent']}% off up to ₹{method['max_amount']}"
            if method.get("percent", 0)
            else "No extra discount"
        )
        payment_methods.append(
            {
                "id": key,
                "label": method["label"],
                "description": method["description"],
                "discount_text": discount_text,
            }
        )

    cart_payload = {"items": items, "base_total": total}
    payment_payload = {
        "base_total": total,
        "handling_fee": HANDLING_FEE,
        "delivery_fee": DELIVERY_FEE,
        "delivery_fee_threshold": DELIVERY_FEE_THRESHOLD,
        "surge_waiver_threshold": SURGE_WAIVER_THRESHOLD,
        "surge_charges": SURGE_CHARGES,
        "heavy_pincodes": list(SURGE_CHARGES.keys()),
        "payment_methods": PAYMENT_METHOD_DISCOUNTS,
        "coupons": COUPONS,
        "store_network": STORE_NETWORK,
        "store_network_default": DEFAULT_STORE_KEY,
        "emergency_info": {
            "scope": EMERGENCY_SCOPE,
            "window": list(EMERGENCY_TIME_WINDOW),
            "fee_range": EMERGENCY_FEE_RANGE,
            "description": "Emergency mode delivers within 10-20 minutes for diapers, formula, medicines, pads, medical equipment, and baby essentials.",
        },
    }

    return templates.TemplateResponse(
        "payment.html",
        {
            "request": request,
            "user": user,
            "cart_items": items,
            "base_total": total,
            "payment_methods": payment_methods,
            "coupons": [{"code": code, "description": info["description"], "min_total": info["min_total"]} for code, info in COUPONS.items()],
            "cart_payload": jsonable_encoder(cart_payload),
            "payment_payload": jsonable_encoder(payment_payload),
        },
    )


@app.get("/product/{product_id}", response_class=HTMLResponse)
async def product_page(product_id: str, request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        return RedirectResponse(url="/", status_code=303)

    products = load_products()
    product = next((p for p in products if p["id"] == product_id), None)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    detail_product = build_product_detail(product, products)
    return templates.TemplateResponse(
        "product.html",
        {
            "request": request,
            "user": user,
            "product": detail_product,
        },
    )


@app.get("/api/products/suggestions")
async def product_suggestions(
    q: str = Query(default="", min_length=0, max_length=80),
    limit: int = Query(default=6, ge=1, le=10),
    user_id: str | None = Cookie(default=None),
):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    query = q.strip().lower()
    if not query:
        return {"suggestions": []}

    products = load_products()
    scored = []
    for p in products:
        haystack = f"{p.get('name', '')} {p.get('brand', '')} {p.get('category', '')}".lower()
        if query not in haystack:
            continue
        score = 0
        if p.get("name", "").lower().startswith(query):
            score += 3
        if p.get("brand", "").lower().startswith(query):
            score += 2
        score += haystack.count(query)
        scored.append((score, p))

    scored.sort(key=lambda item: (-item[0], item[1].get("price", 0), item[1].get("name", "")))
    suggestions = [
        {
            "id": p["id"],
            "name": p["name"],
            "brand": p.get("brand", ""),
            "category": p.get("category", ""),
            "price": p.get("price", 0),
            "image_url": p.get("image_url", "/static/images/products/fallback.svg"),
        }
        for _, p in scored[:limit]
    ]
    return {"suggestions": suggestions}


@app.get("/profile", response_class=HTMLResponse)
async def profile_page(request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        return RedirectResponse(url="/", status_code=303)

    orders = load_orders()
    user_orders = [o for o in orders if o["user_id"] == user["id"]]
    user_orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return templates.TemplateResponse("profile.html", {"request": request, "user": user, "orders": user_orders})


@app.get("/api/my-orders")
async def my_orders(user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    orders = load_orders()
    user_orders = [o for o in orders if o["user_id"] == user["id"]]
    user_orders.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"orders": user_orders}


@app.get("/api/cart")
async def get_cart(user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    products = load_products()
    product_by_id = {p["id"]: p for p in products}
    carts = load_carts()
    cart = carts.get(user["id"], [])
    result = []
    for item in cart:
        p = product_by_id.get(item["product_id"])
        if p:
            result.append({"product_id": p["id"], "name": p["name"], "qty": item["qty"], "price": p["price"]})
    return {"items": result, "total": round(sum(i["qty"] * i["price"] for i in result), 2)}


@app.post("/cart/add")
async def cart_add(product_id: str = Form(...), qty: int = Form(1), user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    carts = load_carts()
    cart = carts.setdefault(user["id"], [])

    existing = next((i for i in cart if i["product_id"] == product_id), None)
    if existing:
        existing["qty"] += qty
    else:
        cart.append({"product_id": product_id, "qty": qty})

    if product_id not in user["likes"]:
        users = load_users()
        for idx, each in enumerate(users):
            if each["id"] == user["id"]:
                users[idx]["likes"].append(product_id)
                break
        save_users(users)

    save_carts(carts)
    return {"ok": True}


@app.post("/cart/update")
async def cart_update(product_id: str = Form(...), qty: int = Form(...), user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    carts = load_carts()
    cart = carts.setdefault(user["id"], [])
    cart[:] = [i for i in cart if i["product_id"] != product_id]
    if qty > 0:
        cart.append({"product_id": product_id, "qty": qty})
    save_carts(carts)
    return {"ok": True}


@app.post("/checkout")
async def checkout(
    payment_mode: str = Form("cod"),
    pin_code: str | None = Form(None),
    coupon_code: str | None = Form(None),
    emergency_mode: str | None = Form(None),
    user_id: str | None = Cookie(default=None),
):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    carts = load_carts()
    cart = carts.get(user["id"], [])
    if not cart:
        raise HTTPException(status_code=400, detail="Cart is empty")

    products = load_products()
    product_by_id = {p["id"]: p for p in products}
    emergency_active = str(emergency_mode or "").lower() in {"1", "true", "on", "yes"}
    if emergency_active:
        allowed_emergency_ids = {p["id"] for p in products if is_emergency_product(p)}
        invalid_names = []
        for entry in cart:
            if entry["product_id"] not in allowed_emergency_ids:
                product = product_by_id.get(entry["product_id"])
                if product:
                    invalid_names.append(product["name"])
                else:
                    invalid_names.append(entry["product_id"])
        if invalid_names:
            unique_invalid = sorted(set(invalid_names))
            raise HTTPException(
                status_code=400,
                detail=f"Emergency mode only supports {', '.join(EMERGENCY_SCOPE)}. Remove {', '.join(unique_invalid)} or disable emergency mode.",
            )

    orders = load_orders()
    order = {
        "id": next_id("order", orders),
        "user_id": user["id"],
        "status": "created",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "eta_minutes": 30,
        "active_issue": None,
        "items": [],
    }
    base_total = 0.0
    for idx, item in enumerate(cart, start=1):
        p = product_by_id.get(item["product_id"])
        if not p:
            continue
        subtotal = p["price"] * item["qty"]
        base_total += subtotal
        order["items"].append(
            {
                "id": f"item_{idx}",
                "product_id": p["id"],
                "name": p["name"],
                "brand": p.get("brand", "Quickmart"),
                "qty": item["qty"],
                "unit_price": p["price"],
                "state": "pending",
            }
        )

    if not order["items"]:
        raise HTTPException(status_code=400, detail="No valid items")

    store_assignment, fallback_note = resolve_store_assignment(pin_code)
    store_assignment = dict(store_assignment)
    eta_modifier = store_assignment.get("eta_modifier", 0)
    if emergency_active:
        eta = EMERGENCY_TIME_WINDOW[0] + eta_modifier
        eta = min(max(eta, EMERGENCY_TIME_WINDOW[0]), EMERGENCY_TIME_WINDOW[1])
    else:
        eta = 30 + eta_modifier
    order["eta_minutes"] = eta
    order["store_assignment"] = store_assignment
    order["emergency_mode"] = emergency_active
    if fallback_note:
        order["store_assignment"]["status_note"] = fallback_note
    emergency_fee = store_assignment.get("emergency_fee", 0) if emergency_active else 0

    store_location = {
        "lat": store_assignment.get("lat") if store_assignment.get("lat") is not None else DEFAULT_STORE_LOCATION["lat"],
        "lng": store_assignment.get("lng") if store_assignment.get("lng") is not None else DEFAULT_STORE_LOCATION["lng"],
    }
    customer_location = resolve_customer_location(pin_code)
    order["store_location"] = store_location
    order["customer_location"] = customer_location
    order["distance_km"] = haversine(store_location["lat"], store_location["lng"], customer_location["lat"], customer_location["lng"])
    order["tracking_route"] = build_delivery_path(store_location, customer_location)
    order["driver"] = None
    payment_summary = build_payment_summary(
        base_total,
        coupon_code,
        payment_mode,
        pin_code,
        emergency_mode=emergency_active,
        emergency_fee=emergency_fee,
        store_assignment=store_assignment,
    )
    order["payment_summary"] = payment_summary
    order["total"] = payment_summary["final_total"]
    orders.append(order)
    save_orders(orders)

    carts[user["id"]] = []
    save_carts(carts)

    engine.start(order, orders, products, save_orders)

    return {"ok": True, "order_id": order["id"], "order": order}


@app.get("/order/{order_id}", response_class=HTMLResponse)
async def order_page(order_id: str, request: Request, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        return RedirectResponse(url="/", status_code=303)
    return templates.TemplateResponse("order.html", {"request": request, "order_id": order_id, "user": user})


@app.get("/api/orders/{order_id}")
async def order_data(order_id: str, user_id: str | None = Cookie(default=None)):
    user = current_user(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")

    orders = load_orders()
    order = next((o for o in orders if o["id"] == order_id and o["user_id"] == user["id"]), None)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@app.post("/api/chat")
async def quickmart_chat(payload: dict = Body(...)):
    message = (payload.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    response = build_chatbot_response(message)
    return JSONResponse(
        {
            "reply": response["reply"],
            "suggestions": response.get("suggestions", []),
            "human": bool(response.get("human", False)),
            "contact": response.get("contact"),
        }
    )


@app.websocket("/ws/orders/{order_id}")
async def order_ws(websocket: WebSocket, order_id: str):
    await manager.connect(order_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "resolve_issue":
                await engine.push_decision(order_id, data)
    except WebSocketDisconnect:
        manager.disconnect(order_id, websocket)
