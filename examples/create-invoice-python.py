"""
LibrePay Node — create invoice (Python 3.9+, `pip install requests`).

Fill the two env vars, call create_invoice(), send the buyer to checkoutUrl.
The API key stays server-side.
"""

import os

import requests

NODE_URL = os.environ.get("LIBREPAY_NODE_URL", "https://pay.example.com")
API_KEY = os.environ.get("LIBREPAY_API_KEY", "")  # lp_live_… — server-side ONLY


def create_invoice(total: float, currency: str, order_id: str, description: str = ""):
    """Returns the 201 payload: {'invoice': {...}, 'checkoutUrl': 'https://…'}"""
    res = requests.post(
        f"{NODE_URL}/api/v1/invoices",
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {API_KEY}",
        },
        json={
            "amountFiat": total,
            "currency": currency,
            "orderId": order_id,
            "description": description[:140],
            "metadata": {"source": "my-shop"},
        },
        timeout=15,
    )
    if res.status_code != 201:
        raise RuntimeError(f"librepay invoice failed (HTTP {res.status_code}): {res.text[:300]}")
    return res.json()


if __name__ == "__main__":
    data = create_invoice(27.50, "USD", "demo-1042", "Order #1042 — two coffees")
    print("invoice id :", data["invoice"]["id"])
    print("checkout   :", data["checkoutUrl"])
    # In a web framework: redirect(data["checkoutUrl"])
    # Persist data["invoice"]["id"] on the order — the webhook references it.
