import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx

from playpen import companion as companion_module
from playpen import create_app, game, homestead
from playpen.companion import Companion
from playpen.content import PARTNER_PRODUCTS


class FakeMessages:
    """Records each request at the SDK boundary and returns a scripted reply."""

    def __init__(self):
        self.calls = []
        self.reply = "Your wheat is ready. Swipe across it, then take two bundles to Nora."
        self.stop_reason = "end_turn"
        self.error = None
        self.script = []  # responses to return before falling back to the plain reply

    def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})
        if self.error:
            raise self.error
        if self.script:
            return self.script.pop(0)
        return SimpleNamespace(
            stop_reason=self.stop_reason,
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=self.reply)],
        )


def tool_call(sku, name="start_sandbox_checkout"):
    """A scripted model turn that asks to run the checkout tool."""
    return SimpleNamespace(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(type="text", text="Golden Blossom Honey is $7.00. Starting a Sandbox order."),
            SimpleNamespace(type="tool_use", id="toolu_1", name=name, input={"sku": sku}),
        ],
    )


class FakePayments:
    """Stands in for PayPalSandbox at the app boundary."""

    def __init__(self, configured=True):
        self.configured = configured
        self.orders = []

    def create_order(self, checkout_id, sku, base_url):
        order_id = f"ORDER-{len(self.orders) + 1}"
        self.orders.append(sku)
        return {
            "id": order_id,
            "links": [{"rel": "payer-action", "href": f"https://www.sandbox.paypal.com/checkoutnow?token={order_id}"}],
        }


class CompanionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.messages = FakeMessages()
        self.payments = FakePayments()
        fake_client = SimpleNamespace(beta=SimpleNamespace(messages=self.messages))
        self.db = str(Path(directory.name) / "farm.sqlite3")
        config = {
            "TESTING": True, "DATABASE": self.db,
            "SECRET_KEY": "test-session-key", "BASE_URL": "http://localhost:8000",
        }
        self.app = create_app(config, self.payments, Companion(fake_client))
        self.client = self.app.test_client()
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.csrf = session["csrf"]
            self.farm_id = session["farm_id"]

    def chat(self, message="", place="farm"):
        return self.client.post("/farm/companion", data={"csrf": self.csrf, "message": message, "place": place})

    def test_greeting_uses_live_farm_state_and_is_hidden_from_the_log(self):
        response = self.chat()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["reply"], self.messages.reply)

        call = self.messages.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["fallbacks"], "default")
        self.assertEqual(call["messages"][0]["role"], "user")
        system_note = call["messages"][-1]
        self.assertEqual(system_note["role"], "system")
        brief = json.loads(system_note["content"].split("\n", 1)[1])
        self.assertEqual(brief["level"], 1)
        self.assertEqual(brief["crop_beds"]["empty"], 12)
        self.assertEqual(brief["current_order"]["from"], "Nora")

        history = self.client.get("/farm/companion").json
        self.assertTrue(history["configured"])
        self.assertEqual(history["messages"], [{"role": "assistant", "content": self.messages.reply}])

    def test_conversation_carries_earlier_turns(self):
        self.chat()
        self.chat("What should I plant?")
        self.chat("And after that?")
        sent = [m for m in self.messages.calls[-1]["messages"] if m["role"] != "system"]
        self.assertEqual([m["role"] for m in sent], ["user", "assistant", "user", "assistant", "user"])
        self.assertEqual(sent[2]["content"], "What should I plant?")
        self.assertEqual(sent[-1]["content"], "And after that?")
        visible = self.client.get("/farm/companion").json["messages"]
        self.assertEqual(len(visible), 5)

    def test_chat_without_csrf_is_rejected(self):
        response = self.client.post("/farm/companion", data={"message": "hi"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.messages.calls, [])

    def test_rejects_long_messages_without_calling_the_api(self):
        response = self.chat("x" * 401)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.messages.calls, [])

    def test_refusal_and_api_errors_are_reported_not_recorded(self):
        self.messages.stop_reason = "refusal"
        self.assertEqual(self.chat("hello").status_code, 503)
        self.messages.stop_reason = "end_turn"
        request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        self.messages.error = anthropic.APIConnectionError(request=request)
        response = self.chat("hello again")
        self.assertEqual(response.status_code, 503)
        self.assertIn("reach the AI service", response.json["message"])
        self.assertEqual(self.client.get("/farm/companion").json["messages"], [])

    def test_hourly_limit_blocks_further_messages(self):
        original = companion_module.HOURLY_LIMIT
        companion_module.HOURLY_LIMIT = 2
        self.addCleanup(setattr, companion_module, "HOURLY_LIMIT", original)
        self.assertEqual(self.chat("one").status_code, 200)
        self.assertEqual(self.chat("two").status_code, 200)
        self.assertEqual(self.chat("three").status_code, 503)
        self.assertEqual(len(self.messages.calls), 2)

    def test_farm_chat_offers_no_checkout_tool(self):
        self.chat("Buy me some honey")
        self.assertNotIn("tools", self.messages.calls[0])
        self.assertEqual(self.payments.orders, [])

    def test_market_buy_request_creates_sandbox_order_for_player_to_approve(self):
        # Arrange
        self.messages.script = [tool_call("blossom-honey")]
        self.messages.reply = "Your order is ready. Tap Approve and sign in with your Sandbox buyer."

        # Act
        response = self.chat("I'd like to buy the honey", place="market")

        # Assert: one order, an approve link for the player, nothing captured yet.
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.payments.orders, ["blossom-honey"])
        [checkout] = response.json["checkouts"]
        self.assertEqual(checkout["product"], PARTNER_PRODUCTS["blossom-honey"]["name"])
        self.assertEqual(checkout["approval_url"], "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1")
        self.assertEqual(self.client.get(checkout["status_url"]).status_code, 200)
        self.assertIsNone(game.get_checkout(self.db, self.farm_id, "ORDER-1")["capture_id"])
        # The model sees the outcome but never the approval link.
        tool_turn = self.messages.calls[1]["messages"][-1]["content"][0]
        self.assertEqual(tool_turn["type"], "tool_result")
        self.assertNotIn("sandbox.paypal.com", tool_turn["content"])
        self.assertEqual(game.farm_state(self.db, self.farm_id, game.farm_day())["xp"], 0)

    def test_market_tool_rejects_unknown_product_without_creating_order(self):
        self.messages.script = [tool_call("orchard-starter")]
        response = self.chat("buy the orchard kit", place="market")
        self.assertEqual(response.json["checkouts"], [])
        self.assertEqual(self.payments.orders, [])
        self.assertTrue(self.messages.calls[1]["messages"][-1]["content"][0]["is_error"])

    def test_market_tool_reports_missing_sandbox_setup(self):
        self.payments.configured = False
        self.messages.script = [tool_call("blossom-honey")]
        response = self.chat("buy the honey", place="market")
        self.assertEqual(response.json["checkouts"], [])
        result = self.messages.calls[1]["messages"][-1]["content"][0]
        self.assertIn("isn't set up", result["content"])

    def test_market_page_lists_all_partner_products(self):
        page = self.client.get("/market").get_data(as_text=True)
        for sku in PARTNER_PRODUCTS:
            self.assertIn(f'data-partner="{sku}"', page)

    def test_partner_reward_is_granted_once_across_sandbox_and_demo(self):
        # Arrange: a captured Sandbox order for a partner product.
        game.save_checkout(self.db, "c1", self.farm_id, "ORDER-9", "https://www.sandbox.paypal.com/x", "seed-mix")
        checkout = game.get_checkout(self.db, self.farm_id, "ORDER-9")

        # Act
        first = game.settle_checkout(self.db, checkout, "CAPTURE-9")
        again = game.settle_checkout(self.db, checkout, "CAPTURE-9")
        demo_changed, _ = homestead.simulate_purchase(self.db, self.farm_id, "seed-mix")

        # Assert
        self.assertTrue(first)
        self.assertFalse(again)
        self.assertFalse(demo_changed)
        self.assertEqual(game.farm_state(self.db, self.farm_id, game.farm_day())["xp"], PARTNER_PRODUCTS["seed-mix"]["xp"])

    def test_partner_capture_after_demo_records_payment_without_more_xp(self):
        homestead.simulate_purchase(self.db, self.farm_id, "seed-mix")
        game.save_checkout(self.db, "c2", self.farm_id, "ORDER-8", "https://www.sandbox.paypal.com/y", "seed-mix")
        checkout = game.get_checkout(self.db, self.farm_id, "ORDER-8")
        self.assertFalse(game.settle_checkout(self.db, checkout, "CAPTURE-8"))
        self.assertEqual(game.get_checkout(self.db, self.farm_id, "ORDER-8")["capture_id"], "CAPTURE-8")
        self.assertEqual(game.farm_state(self.db, self.farm_id, game.farm_day())["xp"], PARTNER_PRODUCTS["seed-mix"]["xp"])

    def test_unconfigured_companion_says_so(self):
        companion = Companion()
        companion._tried, companion._client = True, None
        self.assertFalse(companion.configured)
        with self.assertRaises(companion_module.CompanionUnavailable):
            companion.reply(None, "farm", {}, "hi")


if __name__ == "__main__":
    unittest.main()
