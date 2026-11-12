"""Server-side Channel3 product search, used by Bramble in Chrome to suggest real products."""

import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

API = "https://api.trychannel3.com/v1/search"
MAX_RESULTS = 4
FETCH_RESULTS = 12
# The catalog mixes in lots of pet supplies; leave them out unless the player asked for them.
PET_CATEGORIES = {"animals-pet-supplies", "equestrian", "horse-care"}
PET_WORDS = ("pet", "dog", "cat", "horse", "bird", "puppy", "kitten")


class Channel3Error(Exception):
    pass


def _https(url):
    return url if isinstance(url, str) and urlsplit(url).scheme == "https" else None


def category_slugs(product):
    category = product.get("category")
    if isinstance(category, dict):
        return {c.get("slug") for c in category.get("path") or [] if isinstance(c, dict)} | {category.get("slug")}
    if isinstance(category, list):
        return {c.get("slug") for c in category if isinstance(c, dict)}
    return set()


def simplify(product):
    """The few fields Bramble's product cards show, or None when a product has no usable offer."""
    offers = [o for o in product.get("offers") or [] if _https(o.get("url"))]
    if not product.get("title") or not offers:
        return None
    in_stock = [o for o in offers if o.get("availability") != "OutOfStock"] or offers
    offer = min(in_stock, key=lambda o: (o.get("price") or {}).get("price") or float("inf"))
    price = offer.get("price") or {}
    images = product.get("images") or []
    main = next((i for i in images if i.get("is_main_image")), images[0] if images else {})
    brands = product.get("brands") or []
    return {
        "title": str(product["title"])[:140],
        "brand": brands[0].get("name") if brands else None,
        "price": price.get("price"),
        "currency": price.get("currency") or "USD",
        "store": offer.get("domain"),
        "url": offer["url"],
        "image": _https(main.get("cleaned_url")) or _https(main.get("url")),
    }


class Channel3:
    def __init__(self, api_key, opener=urlopen):
        self.api_key = api_key
        self.opener = opener

    @property
    def configured(self):
        return bool(self.api_key)

    def search(self, query, limit=MAX_RESULTS):
        body = json.dumps({"query": query, "limit": FETCH_RESULTS}).encode()
        request = Request(API, data=body, method="POST", headers={
            "x-api-key": self.api_key, "Content-Type": "application/json", "Accept": "application/json",
        })
        try:
            with self.opener(request, timeout=10) as response:
                data = json.load(response)
        except HTTPError as error:
            raise Channel3Error(f"Channel3 rejected the search ({error.code})") from error
        except (URLError, TimeoutError, ValueError) as error:
            raise Channel3Error("Channel3 did not return a usable response") from error
        products = data.get("products") if isinstance(data, dict) else None
        if not isinstance(products, list):
            raise Channel3Error("Channel3 response had no products")
        wants_pets = any(word in query.lower().split() or f"{word}s" in query.lower().split() for word in PET_WORDS)
        kept = [
            p for p in products
            if isinstance(p, dict) and (wants_pets or not category_slugs(p) & PET_CATEGORIES)
        ]
        return [p for p in (simplify(p) for p in kept) if p][:limit]
