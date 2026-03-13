from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any


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
