from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

try:
    import numpy as np
    from sklearn.neighbors import NearestNeighbors
except ImportError:  # pragma: no cover - graceful fallback when sklearn is unavailable
    np = None
    NearestNeighbors = None


def _similar_users(user: dict[str, Any], all_users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    similar_users = []
    for candidate in all_users:
        if candidate["id"] == user["id"]:
            continue
        score = 0
        if candidate.get("age_group") == user.get("age_group"):
            score += 1
        if candidate.get("lifestyle") == user.get("lifestyle"):
            score += 1
        if candidate.get("personality") == user.get("personality"):
            score += 1
        if candidate.get("app_usage") == user.get("app_usage"):
            score += 1
        if score >= 2:
            similar_users.append(candidate)
    return similar_users


def recommend_products(user: dict[str, Any], all_users: list[dict[str, Any]], products: list[dict[str, Any]], limit: int = 6) -> list[dict[str, Any]]:
    liked = set(user.get("likes", []))
    similar_users = _similar_users(user, all_users)

    similar_likes = Counter()
    for s_user in similar_users:
        similar_likes.update(s_user.get("likes", []))

    ranked = []
    for product in products:
        pid = product["id"]
        score = 0
        if pid in liked:
            score += 5
        score += similar_likes.get(pid, 0)
        if product.get("stock", 0) <= 0:
            continue
        ranked.append((score, product))

    ranked.sort(key=lambda x: (-x[0], x[1]["name"]))
    return [item[1] for item in ranked[:limit]]


def recommend_from_similar_orders(
    user: dict[str, Any],
    all_users: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    products: list[dict[str, Any]],
    limit: int = 6,
) -> list[dict[str, Any]]:
    similar_users = _similar_users(user, all_users)
    similar_ids = {u["id"] for u in similar_users}
    if not similar_ids:
        return []

    ordered_counts: Counter[str] = Counter()
    for order in orders:
        if order.get("user_id") not in similar_ids:
            continue
        for item in order.get("items", []):
            if item.get("state") == "skipped":
                continue
            ordered_counts[item["product_id"]] += int(item.get("qty", 1))

    product_by_id = {p["id"]: p for p in products if p.get("stock", 0) > 0}
    ranked = []
    for product_id, count in ordered_counts.items():
        if product_id in product_by_id:
            ranked.append((count, product_by_id[product_id]))
    ranked.sort(key=lambda x: (-x[0], x[1]["name"]))
    return [item[1] for item in ranked[:limit]]


def _parse_order_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _pattern_bucket(days: list[int]) -> tuple[str, int] | None:
    if not days:
        return None

    avg_gap = sum(days) / len(days)
    recent_gaps = days[-2:] if len(days) >= 2 else days
    if recent_gaps and max(recent_gaps) <= 2 and avg_gap <= 4:
        return "Daily", 1
    if avg_gap <= 10 and len(days) >= 2:
        return "Weekly", 7
    if avg_gap <= 45:
        return "Monthly", 30
    return None


def recommend_from_order_patterns(
    user: dict[str, Any],
    orders: list[dict[str, Any]],
    products: list[dict[str, Any]],
    limit: int = 6,
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    product_by_id = {p["id"]: p for p in products if p.get("stock", 0) > 0}
    item_dates: dict[str, list[datetime]] = defaultdict(list)
    item_qty: Counter[str] = Counter()

    for order in orders:
        if order.get("user_id") != user["id"]:
            continue
        if order.get("status") == "cancelled":
            continue

        created_at = _parse_order_timestamp(order.get("created_at"))
        if not created_at:
            continue

        for item in order.get("items", []):
            if item.get("state") in {"skipped", "damaged", "missing", "out_of_stock"}:
                continue
            product_id = item.get("product_id")
            if product_id not in product_by_id:
                continue
            item_dates[product_id].append(created_at)
            item_qty[product_id] += int(item.get("qty", 1))

    ranked: list[tuple[float, dict[str, Any]]] = []
    for product_id, timestamps in item_dates.items():
        unique_dates = sorted({ts.date() for ts in timestamps})
        if len(unique_dates) < 2:
            continue

        gaps = [
            max((current - previous).days, 1)
            for previous, current in zip(unique_dates, unique_dates[1:])
        ]
        pattern = _pattern_bucket(gaps)
        if not pattern:
            continue

        label, target_gap = pattern
        days_since_last = max((now.date() - unique_dates[-1]).days, 0)
        timing_fit = 1 - min(abs(days_since_last - target_gap) / max(target_gap, 1), 1)
        frequency_score = len(unique_dates) * 2 + item_qty[product_id] * 0.35
        score = round(frequency_score + (timing_fit * 4), 3)

        product = dict(product_by_id[product_id])
        product["recommendation_badge"] = f"{label} pick"
        product["recommendation_reason"] = (
            f"You usually reorder this {label.lower()} and it looks close to your next cycle."
        )
        product["recommendation_pattern"] = label.lower()
        product["recommendation_score"] = score
        ranked.append((score, product))

    ranked.sort(key=lambda entry: (-entry[0], entry[1]["name"]))
    return [product for _, product in ranked[:limit]]


def recommend_hybrid_products(
    user: dict[str, Any],
    all_users: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    products: list[dict[str, Any]],
    limit: int = 12,
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    liked = set(user.get("likes", []))
    similar_users = _similar_users(user, all_users)
    similar_user_ids = {candidate["id"] for candidate in similar_users}
    product_by_id = {product["id"]: product for product in products if product.get("stock", 0) > 0}
    pattern_products = {
        product["id"]: product for product in recommend_from_order_patterns(user, orders, products, limit=max(limit, 12))
    }

    personal_counts: Counter[str] = Counter()
    recent_counts: Counter[str] = Counter()
    similar_likes: Counter[str] = Counter()
    similar_orders: Counter[str] = Counter()

    for candidate in similar_users:
        similar_likes.update(candidate.get("likes", []))

    for order in orders:
        created_at = _parse_order_timestamp(order.get("created_at"))
        if not created_at:
            continue

        if order.get("user_id") == user["id"] and order.get("status") != "cancelled":
            age_days = max((now - created_at).days, 0)
            recency_weight = 3 if age_days <= 7 else 2 if age_days <= 21 else 1
            for item in order.get("items", []):
                if item.get("state") in {"skipped", "damaged", "missing", "out_of_stock"}:
                    continue
                product_id = item.get("product_id")
                if product_id not in product_by_id:
                    continue
                qty = int(item.get("qty", 1))
                personal_counts[product_id] += qty
                recent_counts[product_id] += qty * recency_weight

        if order.get("user_id") in similar_user_ids:
            for item in order.get("items", []):
                if item.get("state") == "skipped":
                    continue
                product_id = item.get("product_id")
                if product_id in product_by_id:
                    similar_orders[product_id] += int(item.get("qty", 1))

    ranked: list[tuple[float, dict[str, Any]]] = []
    for product in product_by_id.values():
        product_id = product["id"]
        score = 0.0
        reasons: list[str] = []

        if product_id in pattern_products:
            pattern_product = pattern_products[product_id]
            score += float(pattern_product.get("recommendation_score", 0)) + 12
            reasons.append(pattern_product.get("recommendation_badge", "Repeat pick"))
        if personal_counts.get(product_id):
            score += min(personal_counts[product_id] * 2.4, 14)
            reasons.append("You reorder this")
        if recent_counts.get(product_id):
            score += min(recent_counts[product_id] * 1.3, 12)
            reasons.append("Recently bought")
        if product_id in liked:
            score += 6
            reasons.append("In your likes")
        if similar_likes.get(product_id):
            score += min(similar_likes[product_id] * 1.4, 7)
            reasons.append("People like you save this")
        if similar_orders.get(product_id):
            score += min(similar_orders[product_id] * 0.9, 8)
            reasons.append("People like you order this")

        if score <= 0:
            continue

        enriched = dict(product)
        if product_id in pattern_products:
            enriched.update({
                "recommendation_badge": pattern_products[product_id].get("recommendation_badge"),
                "recommendation_pattern": pattern_products[product_id].get("recommendation_pattern"),
                "recommendation_reason": pattern_products[product_id].get("recommendation_reason"),
            })
        else:
            enriched["recommendation_badge"] = "Smart pick"
            primary_reason = reasons[0].lower() if reasons else "your shopping style"
            enriched["recommendation_reason"] = f"Suggested from {primary_reason} and nearby shopping habits."

        unique_reasons = list(dict.fromkeys(reasons))
        confidence = max(32, min(int(score * 4), 98))
        enriched["recommendation_reasons"] = unique_reasons[:3]
        enriched["recommendation_score"] = round(score, 3)
        enriched["recommendation_confidence"] = confidence
        ranked.append((score, enriched))

    ranked.sort(key=lambda entry: (-entry[0], entry[1]["name"]))
    return [product for _, product in ranked[:limit]]


def recommend_ml_products(
    user: dict[str, Any],
    all_users: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    products: list[dict[str, Any]],
    limit: int = 12,
    neighbors: int = 4,
) -> list[dict[str, Any]]:
    if np is None or NearestNeighbors is None:
        return []

    product_by_id = {product["id"]: product for product in products if product.get("stock", 0) > 0}
    if len(product_by_id) < 2:
        return []

    user_ids = [candidate["id"] for candidate in all_users]
    product_ids = sorted(product_by_id.keys())
    user_index = {user_id: idx for idx, user_id in enumerate(user_ids)}
    product_index = {product_id: idx for idx, product_id in enumerate(product_ids)}
    matrix = np.zeros((len(user_ids), len(product_ids)), dtype=float)
    purchase_history: dict[str, Counter[str]] = defaultdict(Counter)

    for order in orders:
        order_user_id = order.get("user_id")
        row = user_index.get(order_user_id)
        if row is None or order.get("status") == "cancelled":
            continue
        for item in order.get("items", []):
            if item.get("state") in {"skipped", "damaged", "missing", "out_of_stock"}:
                continue
            product_id = item.get("product_id")
            column = product_index.get(product_id)
            if column is None:
                continue
            qty = float(int(item.get("qty", 1)))
            matrix[row, column] += qty
            purchase_history[order_user_id][product_id] += int(qty)

    active_rows = [idx for idx, values in enumerate(matrix) if float(values.sum()) > 0]
    if len(active_rows) < 2:
        return []

    target_row = user_index.get(user["id"])
    if target_row is None or float(matrix[target_row].sum()) <= 0:
        return []

    active_matrix = matrix[active_rows]
    active_user_ids = [user_ids[idx] for idx in active_rows]
    active_lookup = {user_id: idx for idx, user_id in enumerate(active_user_ids)}
    target_active_row = active_lookup.get(user["id"])
    if target_active_row is None:
        return []

    n_neighbors = min(max(neighbors, 2), len(active_user_ids))
    model = NearestNeighbors(metric="cosine", algorithm="brute", n_neighbors=n_neighbors)
    model.fit(active_matrix)
    distances, indices = model.kneighbors(active_matrix[target_active_row].reshape(1, -1))

    neighbor_contrib = np.zeros(len(product_ids), dtype=float)
    reasons_by_product: dict[str, list[str]] = defaultdict(list)
    for distance, active_idx in zip(distances[0], indices[0]):
        neighbor_id = active_user_ids[int(active_idx)]
        if neighbor_id == user["id"]:
            continue
        weight = max(1.0 - float(distance), 0.0)
        if weight <= 0:
            continue
        neighbor_vector = active_matrix[int(active_idx)]
        neighbor_contrib += neighbor_vector * weight
        top_neighbor_products = np.argsort(neighbor_vector)[::-1][:3]
        for product_idx in top_neighbor_products:
            value = neighbor_vector[int(product_idx)]
            if value <= 0:
                continue
            product_id = product_ids[int(product_idx)]
            reasons_by_product[product_id].append("ML similar shoppers")

    if float(neighbor_contrib.sum()) <= 0:
        return []

    own_vector = active_matrix[target_active_row]
    pattern_products = {
        product["id"]: product for product in recommend_from_order_patterns(user, orders, products, limit=max(limit, 12))
    }
    similar_order_products = {
        product["id"] for product in recommend_from_similar_orders(user, all_users, orders, products, limit=max(limit, 12))
    }
    liked = set(user.get("likes", []))

    ranked: list[tuple[float, dict[str, Any]]] = []
    for idx, product_id in enumerate(product_ids):
        base_score = float(neighbor_contrib[idx])
        if base_score <= 0:
            continue

        score = base_score
        reasons = list(dict.fromkeys(reasons_by_product.get(product_id, [])))
        if float(own_vector[idx]) > 0:
            score += min(float(own_vector[idx]) * 0.8, 4.5)
            reasons.append("You buy this too")
        if product_id in pattern_products:
            score += 6.0
            reasons.append(pattern_products[product_id].get("recommendation_badge", "Repeat pick"))
        if product_id in liked:
            score += 2.0
            reasons.append("In your likes")
        if product_id in similar_order_products:
            score += 2.5
            reasons.append("Strong neighbor match")

        product = dict(product_by_id[product_id])
        if product_id in pattern_products:
            product.update({
                "recommendation_badge": pattern_products[product_id].get("recommendation_badge"),
                "recommendation_pattern": pattern_products[product_id].get("recommendation_pattern"),
                "recommendation_reason": pattern_products[product_id].get("recommendation_reason"),
            })
        else:
            product["recommendation_badge"] = "ML pick"
            product["recommendation_pattern"] = "weekly"
            product["recommendation_reason"] = "Suggested by a scikit-learn nearest-neighbors model trained on similar shopping baskets."

        unique_reasons = list(dict.fromkeys(reasons))
        confidence = max(35, min(int(score * 12), 98))
        product["recommendation_reasons"] = unique_reasons[:3] or ["ML similar shoppers"]
        product["recommendation_confidence"] = confidence
        product["recommendation_score"] = round(score, 3)
        product["recommendation_model"] = "scikit-nearest-neighbors"
        ranked.append((score, product))

    ranked.sort(key=lambda entry: (-entry[0], entry[1]["name"]))
    return [product for _, product in ranked[:limit]]


def replacement_suggestions(
    missing_product: dict[str, Any],
    products: list[dict[str, Any]],
    limit: int = 5,
) -> tuple[list[dict[str, Any]], str]:
    category = missing_product.get("category")
    same_category = [
        p for p in products
        if p["id"] != missing_product["id"] and p.get("category") == category and p.get("stock", 0) > 0
    ]
    same_category.sort(key=lambda p: (abs(p["price"] - missing_product["price"]), p["name"]))
    if same_category:
        return same_category[:limit], "similar_items"

    # If no similar suggestions exist, offer same product from other brands.
    product_key = missing_product.get("product_key")
    missing_brand = missing_product.get("brand")
    other_brand = [
        p for p in products
        if p["id"] != missing_product["id"]
        and p.get("product_key") == product_key
        and p.get("brand") != missing_brand
        and p.get("stock", 0) > 0
    ]
    other_brand.sort(key=lambda p: (abs(p["price"] - missing_product["price"]), p["name"]))
    if other_brand:
        return other_brand[:limit], "other_brands"

    return [], "none"
