"""Server-side PayPal Orders client. All requests go to the sandbox."""

import base64
import json
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .game import CATALOG

API = "https://api-m.sandbox.paypal.com"


class PayPalError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def approval_url(order):
    for link in order.get("links", []):
        if link.get("rel") not in {"approve", "payer-action"}:
            continue
        href = link.get("href", "")
        parts = urlsplit(href)
        if (
            parts.scheme == "https"
            and parts.netloc in {"www.sandbox.paypal.com", "sandbox.paypal.com"}
        ):
            return href
    raise PayPalError("No PayPal Sandbox approval URL was returned")


class PayPalSandbox:
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.opener = build_opener(NoRedirects)

    @property
    def configured(self):
        return bool(self.client_id and self.client_secret)

    def _request(self, method, path, headers, body=None):
        request = Request(API + path, data=body, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                data = json.load(response)
        except HTTPError as error:
            raise PayPalError("PayPal rejected the request", error.code) from error
        except (URLError, TimeoutError, ValueError) as error:
            raise PayPalError("PayPal did not return a usable response") from error
        if not isinstance(data, dict):
            raise PayPalError("PayPal response was not an object")
        return data

    def _token(self):
        if not self.configured:
            raise PayPalError("Sandbox credentials are missing")
        credentials = f"{self.client_id}:{self.client_secret}".encode()
        basic = base64.b64encode(credentials).decode("ascii")
        response = self._request(
            "POST",
            "/v1/oauth2/token",
            {
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            b"grant_type=client_credentials",
        )
        token = response.get("access_token")
        if not isinstance(token, str) or not token:
            raise PayPalError("PayPal did not return an access token")
        return token

    def _orders_request(self, token, method, suffix="", payload=None, request_id=None):
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        body = None
        if payload is not None:
            headers.update({"Content-Type": "application/json", "Prefer": "return=representation"})
            body = json.dumps(payload).encode()
        if request_id:
            headers["PayPal-Request-Id"] = request_id
        return self._request(method, "/v2/checkout/orders" + suffix, headers, body)

    def create_order(self, checkout_id, sku, base_url):
        product = CATALOG[sku]
        price = {"currency_code": "USD", "value": product["price"]}
        return self._orders_request(
            self._token(),
            "POST",
            payload={
                "intent": "CAPTURE",
                "purchase_units": [{
                    "custom_id": checkout_id,
                    "amount": {**price, "breakdown": {"item_total": price}},
                    "items": [{
                        "name": product["name"],
                        "sku": sku,
                        "quantity": "1",
                        "unit_amount": price,
                    }],
                }],
                "payment_source": {
                    "paypal": {
                        "experience_context": {
                            "landing_page": "LOGIN",
                            "return_url": base_url + "/checkout/return",
                            "cancel_url": base_url + "/checkout/cancel",
                            "user_action": "PAY_NOW",
                            "shipping_preference": "NO_SHIPPING",
                        },
                    },
                },
            },
            request_id="o-" + checkout_id,
        )

    def confirm_order(self, checkout):
        token = self._token()
        path = "/" + quote(checkout["paypal_order_id"], safe="")
        order = self._orders_request(token, "GET", path)
        if order.get("status") == "APPROVED":
            verify_order(order, checkout)
            try:
                order = self._orders_request(
                    token, "POST", path + "/capture",
                    payload={}, request_id="c-" + checkout["id"],
                )
            except PayPalError as capture_error:
                # The first response can be lost after PayPal has processed a capture.
                order = self._orders_request(token, "GET", path)
                if order.get("status") != "COMPLETED":
                    raise capture_error
        return order


def verify_order(order, checkout):
    units = order.get("purchase_units", [])
    if (
        order.get("id") != checkout["paypal_order_id"]
        or len(units) != 1
        or units[0].get("custom_id") != checkout["id"]
    ):
        raise PayPalError("Order did not match the stored checkout")
    unit = units[0]
    verify_amount(unit.get("amount", {}), checkout, "Order")
    return unit


def verify_amount(amount, checkout, label):
    try:
        value = Decimal(amount.get("value", "NaN"))
    except (InvalidOperation, TypeError) as error:
        raise PayPalError(f"{label} amount was invalid") from error
    if value != Decimal(checkout["amount"]) or amount.get("currency_code") != checkout["currency"]:
        raise PayPalError(f"{label} amount or currency did not match the checkout")


def completed_capture_id(order, checkout):
    if order.get("status") != "COMPLETED":
        return None
    unit = verify_order(order, checkout)
    captures = unit.get("payments", {}).get("captures", [])
    if len(captures) != 1:
        raise PayPalError("Expected one capture for this order")
    capture = captures[0]
    if capture.get("status") != "COMPLETED":
        return None
    verify_amount(capture.get("amount", {}), checkout, "Capture")
    capture_id = capture.get("id")
    if not isinstance(capture_id, str) or not capture_id:
        raise PayPalError("Capture ID was missing")
    return capture_id
