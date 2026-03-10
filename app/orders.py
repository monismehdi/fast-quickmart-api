import asyncio
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import WebSocket

from app.recommendation import replacement_suggestions

AGENT_ASSIGN_DELAY = 4
STORE_PICKUP_DELAY = 3
OUT_FOR_DELIVERY_DELAY = 3
CONFIRMATION_DELAY = 3


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = {}

    async def connect(self, order_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(order_id, set()).add(websocket)

    def disconnect(self, order_id: str, websocket: WebSocket) -> None:
        if order_id in self._connections:
            self._connections[order_id].discard(websocket)
            if not self._connections[order_id]:
                del self._connections[order_id]

    async def broadcast(self, order_id: str, payload: dict[str, Any]) -> None:
        for ws in list(self._connections.get(order_id, set())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(order_id, ws)


class OrderEngine:
    def __init__(self, manager: ConnectionManager):
        self.manager = manager
        self.active_tasks: dict[str, asyncio.Task[Any]] = {}
        self.decision_queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}

    def start(self, order: dict[str, Any], orders_store: list[dict[str, Any]], products: list[dict[str, Any]], save_orders) -> None:
        if order["id"] in self.active_tasks:
            return
        self.decision_queues[order["id"]] = asyncio.Queue()
        self.active_tasks[order["id"]] = asyncio.create_task(
            self._simulate(order, orders_store, products, save_orders)
        )

    def _build_driver_profile(self, order: dict[str, Any]) -> dict[str, Any]:
        route = order.get("tracking_route") or []
        return {
            "name": "Ravi Kumar",
            "phone": "+919845011223",
            "vehicle": "Quickmart Bike · AQ-7799",
            "route": route,
            "assigned_at": datetime.now(timezone.utc).isoformat(),
        }

    async def push_decision(self, order_id: str, decision: dict[str, Any]) -> None:
        queue = self.decision_queues.get(order_id)
        if queue:
            await queue.put(decision)

    async def _simulate(self, order: dict[str, Any], orders_store: list[dict[str, Any]], products: list[dict[str, Any]], save_orders) -> None:
        try:
            order["status"] = "packing"
            await self._persist_and_notify(order, orders_store, save_orders)
            issue_triggered = False

            for item in order["items"]:
                if order["status"] == "cancelled":
                    break

                product = next((p for p in products if p["id"] == item["product_id"]), None)
                issue_random = random.random()

                if not issue_triggered and issue_random < 0.3:
                    issue_triggered = True
                    reason = random.choice(["missing", "damaged", "out_of_stock"])
                    item["state"] = reason
                    hold_until = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
                    suggestions, suggestion_mode = replacement_suggestions(product, products) if product else ([], "none")
                    order["status"] = "on_hold"
                    order["active_issue"] = {
                        "item_id": item["id"],
                        "reason": reason,
                        "hold_until": hold_until,
                        "suggestion_mode": suggestion_mode,
                        "suggestions": [
                            {
                                "id": s["id"],
                                "name": s["name"],
                                "brand": s.get("brand", "Quickmart"),
                                "category": s.get("category", "General"),
                                "price": s["price"],
                            }
                            for s in suggestions
                        ],
                    }
                    await self._persist_and_notify(order, orders_store, save_orders)

                    try:
                        decision = await asyncio.wait_for(self.decision_queues[order["id"]].get(), timeout=120)
                    except asyncio.TimeoutError:
                        decision = {"action": "continue"}

                    action = decision.get("action")
                    if action == "cancel":
                        order["status"] = "cancelled"
                        order["active_issue"] = None
                        await self._persist_and_notify(order, orders_store, save_orders)
                        return
                    if action == "replace":
                        replacement_id = decision.get("replacement_id")
                        replacement = next((p for p in products if p["id"] == replacement_id and p.get("stock", 0) > 0), None)
                        if replacement:
                            item["product_id"] = replacement["id"]
                            item["name"] = replacement["name"]
                            item["brand"] = replacement.get("brand", item.get("brand", "Quickmart"))
                            item["unit_price"] = replacement["price"]
                            item["state"] = "replaced"
                        else:
                            item["state"] = "skipped"
                    if action == "continue":
                        item["state"] = "skipped"

                    order["active_issue"] = None
                    order["status"] = "packing"
                    await self._persist_and_notify(order, orders_store, save_orders)
                else:
                    item["state"] = "placed"
                    await self._persist_and_notify(order, orders_store, save_orders)

            if order["status"] != "cancelled":
                await asyncio.sleep(AGENT_ASSIGN_DELAY)
                if order["status"] == "cancelled":
                    return
                order["driver"] = self._build_driver_profile(order)
                order["status"] = "driver_assigned"
                await self._persist_and_notify(order, orders_store, save_orders)

                await asyncio.sleep(STORE_PICKUP_DELAY)
                if order["status"] == "cancelled":
                    return
                order["status"] = "driver_at_store"
                await self._persist_and_notify(order, orders_store, save_orders)

                await asyncio.sleep(OUT_FOR_DELIVERY_DELAY)
                if order["status"] == "cancelled":
                    return
                order["status"] = "out_for_delivery"
                await self._persist_and_notify(order, orders_store, save_orders)

                await asyncio.sleep(CONFIRMATION_DELAY)
                if order["status"] == "cancelled":
                    return
                order["status"] = "confirmed"
                await self._persist_and_notify(order, orders_store, save_orders)
        finally:
            self.active_tasks.pop(order["id"], None)
            self.decision_queues.pop(order["id"], None)

    async def _persist_and_notify(self, order: dict[str, Any], orders_store: list[dict[str, Any]], save_orders) -> None:
        order["updated_at"] = datetime.now(timezone.utc).isoformat()
        summary_total = order.get("payment_summary", {}).get("final_total")
        if summary_total is None:
            summary_total = round(sum(i["qty"] * i["unit_price"] for i in order["items"] if i["state"] != "skipped"), 2)
        order["total"] = summary_total

        for idx, existing in enumerate(orders_store):
            if existing["id"] == order["id"]:
                orders_store[idx] = order
                break
        save_orders(orders_store)
        await self.manager.broadcast(order["id"], {"type": "order_update", "order": order})
