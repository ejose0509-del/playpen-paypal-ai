import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from playpen import create_app, game
from playpen.channel3 import Channel3, Channel3Error, simplify
from playpen.companion import Companion
from playpen.content import DEMO_BRAND_XP
from playpen.paypal import PayPalSandbox
from tests.test_companion import FakeMessages


class FakeProducts:
    """Stands in for the Channel3 client at the app boundary."""

    def __init__(self, configured=True):
        self.configured = configured
        self.queries = []

    def search(self, query):
        self.queries.append(query)
        return [{"title": "Low Sugar Granola", "brand": "Purely Elizabeth", "price": 6.99, "currency": "USD",
                 "store": "example.com", "url": "https://example.com/granola", "image": None}]


def search_call(query):
    return SimpleNamespace(stop_reason="tool_use", content=[
        SimpleNamespace(type="tool_use", id="toolu_s", name="search_products", input={"query": query}),
    ])


class ExtensionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "farm.sqlite3")
        self.messages = FakeMessages()
        self.products = FakeProducts()
        client = SimpleNamespace(beta=SimpleNamespace(messages=self.messages))
        config = {"TESTING": True, "DATABASE": self.db, "SECRET_KEY": "k", "BASE_URL": "http://localhost:8000"}
        self.app = create_app(config, PayPalSandbox("", ""), Companion(client), self.products)
        self.client = self.app.test_client()
        page = self.client.get("/").get_data(as_text=True)
        self.token = re.search(r'name="playpen-extension-token" content="([^"]+)"', page).group(1)
        with self.client.session_transaction() as session:
            self.farm_id = session["farm_id"]
        self.ext = self.app.test_client()  # no session cookie, like the extension
        self.headers = {"X-PlayPen-Token": self.token}

    def test_farm_page_shares_one_stable_token(self):
        page = self.client.get("/").get_data(as_text=True)
        self.assertIn(self.token, page)

    def test_farm_page_recreates_a_farm_missing_from_the_database(self):
        # Arrange: a session cookie for a farm the database no longer has.
        with self.client.session_transaction() as session:
            session["farm_id"] = "gone"

        # Act
        response = self.client.get("/")

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(game.farm_state(self.db, "gone", game.farm_day())["xp"], 0)

    def test_extension_routes_need_the_farm_token(self):
        self.assertEqual(self.ext.get("/extension/api/hello").status_code, 401)
        self.assertEqual(self.ext.get("/extension/api/hello", headers={"X-PlayPen-Token": "guess"}).status_code, 401)
        self.assertEqual(self.ext.post("/extension/api/spot", json={"brands": ["kind"]}).status_code, 401)

    def test_hello_lists_brands_and_this_farm(self):
        data = self.ext.get("/extension/api/hello", headers=self.headers).json
        self.assertIn("kind", data["brands"])
        self.assertTrue(data["brands"]["kind"]["case"])
        self.assertEqual(data["farm"]["level"], 1)
        self.assertTrue(data["search"])

    def test_spotting_a_brand_earns_xp_once(self):
        # Act
        first = self.ext.post("/extension/api/spot", json={"brands": ["kind", "kind", "rxbar", "not-a-brand"]}, headers=self.headers).json
        again = self.ext.post("/extension/api/spot", json={"brands": ["kind"]}, headers=self.headers).json

        # Assert
        self.assertEqual(first["awarded"], ["KIND", "RXBAR"])
        self.assertEqual(first["farm_xp"], 2 * DEMO_BRAND_XP)
        self.assertEqual(again["awarded"], [])
        kinds = [row["kind"] for row in game.ledger(self.db, self.farm_id)["rows"]]
        self.assertEqual(kinds, ["Brand spotted (demo)", "Brand spotted (demo)"])

    def test_chrome_chat_tells_bramble_about_the_page_and_searches_products(self):
        # Arrange
        self.messages.script = [search_call("low sugar granola")]
        self.messages.reply = "Purely Elizabeth has a lower-sugar granola."

        # Act
        response = self.ext.post("/extension/api/chat", headers=self.headers, json={
            "message": "anything healthier?",
            "page": {"host": "www.amazon.com", "title": "Amazon.com : granola", "brands": ["kind", "evil"]},
        })

        # Assert
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["products"][0]["brand"], "Purely Elizabeth")
        self.assertEqual(self.products.queries, ["low sugar granola"])
        first = self.messages.calls[0]
        self.assertEqual([t["name"] for t in first["tools"]], ["search_products", "browse_amazon"])
        note = first["messages"][-1]["content"]
        self.assertIn("www.amazon.com", note)
        self.assertIn("- KIND:", note)
        self.assertIn("have not partnered with PlayPen", note)
        tool_result = json.loads(self.messages.calls[1]["messages"][-1]["content"][0]["content"])
        self.assertNotIn("url", tool_result["products"][0])

    def test_bramble_can_take_the_player_to_an_amazon_search(self):
        # Arrange
        self.messages.script = [SimpleNamespace(stop_reason="tool_use", content=[
            SimpleNamespace(type="tool_use", id="toolu_b", name="browse_amazon", input={"query": "organic granola & oats"}),
        ])]
        self.messages.reply = "Let's go look!"

        # Act
        data = self.ext.post("/extension/api/chat", headers=self.headers, json={
            "message": "show me organic granola on amazon", "page": {"host": "news.example", "organic": 3},
        }).json

        # Assert
        self.assertEqual(data["navigate"], "https://www.amazon.com/s?k=organic+granola+%26+oats")
        self.assertEqual(data["reply"], "Let's go look!")
        self.assertIn("browse_amazon", [t["name"] for t in self.messages.calls[0]["tools"]])
        self.assertIn("3 organic products", self.messages.calls[0]["messages"][-1]["content"])

    def test_chrome_chat_reports_missing_channel3_key_to_bramble(self):
        self.products.configured = False
        self.messages.script = [search_call("granola")]
        self.ext.post("/extension/api/chat", headers=self.headers, json={"message": "find granola", "page": {}})
        result = self.messages.calls[1]["messages"][-1]["content"][0]
        self.assertTrue(result["is_error"])
        self.assertEqual(self.products.queries, [])


class BrambleRigTests(unittest.TestCase):
    def test_game_and_extension_share_the_same_bramble_drawing(self):
        root = Path(__file__).resolve().parent.parent
        game_copy = (root / "playpen" / "static" / "bramble-rig.js").read_text()
        extension_copy = (root / "extension" / "bramble-rig.js").read_text()
        self.assertEqual(game_copy, extension_copy, "Copy extension/bramble-rig.js to playpen/static/")

    def test_extension_loads_the_drawing_before_bramble(self):
        manifest = json.loads((Path(__file__).resolve().parent.parent / "extension" / "manifest.json").read_text())
        scripts = next(c["js"] for c in manifest["content_scripts"] if "bramble.js" in c["js"])
        self.assertEqual(scripts, ["bramble-rig.js", "bramble.js"])


class Channel3ClientTests(unittest.TestCase):
    def test_search_sends_key_and_simplifies_products(self):
        # Arrange
        sent = {}
        body = {"products": [
            {"id": "p1", "title": "Oat Bar", "brands": [{"id": "b", "name": "Larabar"}],
             "images": [{"url": "https://img.example/oat.jpg", "cleaned_url": None, "is_main_image": True}],
             "offers": [
                 {"url": "https://shop.example/oat", "domain": "shop.example", "availability": "InStock",
                  "price": {"price": 4.5, "currency": "USD"}},
                 {"url": "javascript:alert(1)", "domain": "bad", "price": {"price": 1, "currency": "USD"}},
             ]},
            {"id": "p2", "title": "No offers", "offers": []},
        ]}

        def opener(request, timeout):
            sent["key"] = request.get_header("X-api-key")
            sent["body"] = json.loads(request.data)
            return io.BytesIO(json.dumps(body).encode())

        # Act
        products = Channel3("secret", opener).search("oat bar")

        # Assert
        self.assertEqual(sent, {"key": "secret", "body": {"query": "oat bar", "limit": 12}})
        self.assertEqual(products, [{
            "title": "Oat Bar", "brand": "Larabar", "price": 4.5, "currency": "USD", "store": "shop.example",
            "url": "https://shop.example/oat", "image": "https://img.example/oat.jpg",
        }])

    def test_search_leaves_out_pet_supplies_unless_asked(self):
        # Arrange
        pet = {"title": "Granola Dog Treats", "category": {"slug": "dog-treats", "path": [{"slug": "animals-pet-supplies"}]},
               "offers": [{"url": "https://shop.example/dog", "price": {"price": 5, "currency": "USD"}}]}
        bottle = {"title": "Steel Bottle", "category": {"slug": "water-bottles", "path": [{"slug": "home-garden"}]},
                  "offers": [{"url": "https://shop.example/bottle", "price": {"price": 20, "currency": "USD"}}]}
        opener = lambda request, timeout: io.BytesIO(json.dumps({"products": [pet, bottle]}).encode())

        # Act
        people = Channel3("k", opener).search("granola")
        dogs = Channel3("k", opener).search("treats for dogs")

        # Assert
        self.assertEqual([p["title"] for p in people], ["Steel Bottle"])
        self.assertEqual([p["title"] for p in dogs], ["Granola Dog Treats", "Steel Bottle"])

    def test_bad_response_raises(self):
        with self.assertRaises(Channel3Error):
            Channel3("k", lambda request, timeout: io.BytesIO(b"[]")).search("x")

    def test_product_without_https_offer_is_dropped(self):
        self.assertIsNone(simplify({"title": "T", "offers": [{"url": "http://x"}]}))


if __name__ == "__main__":
    unittest.main()
