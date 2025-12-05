from collections import Counter
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
