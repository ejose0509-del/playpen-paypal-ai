import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

from playpen import create_app, game
from playpen.paypal import PayPalSandbox


class SandboxResponses:
    """Exercise the real client with simulated responses at the HTTP boundary."""

    def __init__(self, case):
        self.case = case
        self.order = None
        self.captures = 0
        self.capture_amount = "3.00"
        self.capture_status = "COMPLETED"
        self.lose_capture_response = False

    def open(self, request, timeout):
        origin = "https://api-m.sandbox.paypal.com"
        self.case.assertTrue(request.full_url.startswith(origin + "/"))
        path = request.full_url.removeprefix(origin)
        if path == "/v1/oauth2/token":
            self.case.assertTrue(request.get_header("Authorization").startswith("Basic "))
            self.case.assertEqual(request.data, b"grant_type=client_credentials")
            return self.response({"access_token": "test-token"})

        self.case.assertEqual(request.get_header("Authorization"), "Bearer test-token")
        if path == "/v2/checkout/orders" and request.method == "POST":
            payload = json.loads(request.data)
            unit = payload["purchase_units"][0]
            self.case.assertEqual(unit["amount"]["value"], "3.00")
            self.case.assertEqual(unit["items"][0]["sku"], "wildflower-seeds")
            context = payload["payment_source"]["paypal"]["experience_context"]
            self.case.assertEqual(context["landing_page"], "LOGIN")
            self.case.assertEqual(context["return_url"], "http://localhost:8000/checkout/return")
            self.case.assertEqual(request.get_header("Paypal-request-id"), "o-" + unit["custom_id"])
            self.order = {
                "id": "ORDER-1",
                "status": "CREATED",
                "purchase_units": [unit],
                "links": [{
                    "rel": "payer-action",
                    "href": "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
                }],
            }
            return self.response(self.order)

        if request.method == "POST":
            self.case.assertEqual(path, "/v2/checkout/orders/ORDER-1/capture")
            self.case.assertEqual(self.order["status"], "APPROVED")
            unit = self.order["purchase_units"][0]
            self.case.assertEqual(request.get_header("Paypal-request-id"), "c-" + unit["custom_id"])
            self.captures += 1
            self.order["status"] = "COMPLETED"
            unit["payments"] = {"captures": [{
                "id": "CAPTURE-1",
                "status": self.capture_status,
                "amount": {"value": self.capture_amount, "currency_code": "USD"},
            }]}
            if self.lose_capture_response:
                raise URLError("simulated lost response after capture")
        else:
            self.case.assertEqual(path, "/v2/checkout/orders/ORDER-1")
        return self.response(self.order)

    @staticmethod
    def response(data):
        return io.BytesIO(json.dumps(data).encode())


class PlayPenTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "farm.sqlite3")
        self.config = {
            "TESTING": True, "DATABASE": self.db, "SECRET_KEY": "test-session-key",
            "BASE_URL": "http://localhost:8000",
        }
        self.responses = SandboxResponses(self)
        self.payments = PayPalSandbox("test-id", "test-secret")
        self.payments.opener = self.responses
        self.app = create_app(self.config, self.payments)
        self.client = self.app.test_client()
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.csrf = session["csrf"]
            self.farm_id = session["farm_id"]

    def post(self, path, **fields):
        return self.client.post(path, data={"csrf": self.csrf, **fields}, follow_redirects=True)

    def state(self):
        return game.farm_state(self.db, self.farm_id, game.farm_day())

    def complete_daily(self):
        day = game.farm_day()
        return self.post("/daily", day=day, answer=game.daily_challenge(day)[2])

    def create_order(self):
        response = self.client.post(
            "/checkout", data={"csrf": self.csrf, "sku": "wildflower-seeds", "amount": "0.01"},
        )
        self.assertEqual(response.status_code, 303)
        self.assertEqual(response.location, "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1")

    def capture(self):
        return self.post("/checkout/ORDER-1/capture")

    def test_daily_reward_persists_and_can_only_be_claimed_once(self):
        day = game.farm_day()
        wrong_answer = (game.daily_challenge(day)[2] + 1) % 3
        self.post("/daily", day=day, answer=wrong_answer)
        self.assertEqual(self.state()["xp"], 0)
        self.assertIn(b"15 XP", self.complete_daily().data)
        self.complete_daily()
        restarted = create_app(self.config, self.payments).test_client()
        restarted.set_cookie("session", self.client.get_cookie("session").value)
        self.assertIn(b"Watered garden", restarted.get("/").data)
        self.assertEqual(self.state()["xp"], 15)
        self.assertEqual(len(self.state()["rewards"]), 1)

    def test_checkout_advances_farm_and_unlocks_milestone_once(self):
        self.complete_daily()
        self.create_order()
        response = self.client.get("/checkout/return?token=ORDER-1", follow_redirects=True)
        self.assertIn(b"Confirm sandbox purchase", response.data)
        self.capture()
        self.assertEqual(self.state()["xp"], 15)
        self.responses.order["status"] = "APPROVED"
        response = self.capture()
        self.assertIn(b"Wildflower habitat impact milestone unlocked.", response.data)
        self.capture()
        self.assertEqual(self.responses.captures, 1)
        self.assertEqual(self.state()["xp"], 40)
        self.assertEqual(len(self.state()["milestones"]), 1)

    def test_pending_capture_does_not_award_until_completed(self):
        self.create_order()
        self.responses.capture_status = "PENDING"
        self.responses.order["status"] = "APPROVED"
        self.capture()
        self.assertEqual(self.state()["xp"], 0)
        self.responses.order["purchase_units"][0]["payments"]["captures"][0]["status"] = "COMPLETED"
        self.capture()
        self.assertEqual(self.state()["xp"], 25)
        self.assertEqual(self.responses.captures, 1)

    def test_underpaid_capture_does_not_award(self):
        self.create_order()
        self.responses.order["status"] = "APPROVED"
        self.responses.capture_amount = "0.01"
        self.capture()
        self.assertEqual(self.state()["xp"], 0)

    def test_recovers_when_capture_response_is_lost(self):
        self.create_order()
        self.responses.order["status"] = "APPROVED"
        self.responses.lose_capture_response = True
        self.capture()
        self.assertEqual(self.state()["xp"], 25)
        self.assertEqual(self.responses.captures, 1)

    def test_checkout_requires_correct_farm_and_csrf(self):
        self.create_order()
        other = self.app.test_client()
        other.get("/")
        self.assertEqual(other.get("/checkout/ORDER-1").status_code, 404)
        self.assertEqual(other.get("/checkout/return?token=ORDER-1").status_code, 404)
        self.assertEqual(self.client.post("/checkout/ORDER-1/capture").status_code, 403)
        self.assertEqual(self.state()["xp"], 0)

    def test_concurrent_attempts_grant_capture_reward_once(self):
        self.create_order()
        checkout = game.get_checkout(self.db, self.farm_id, "ORDER-1")
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(
                lambda _: game.settle_checkout(self.db, checkout, "CAPTURE-1"),
                range(8),
            ))
        self.assertEqual(sum(results), 1)
        self.assertEqual(self.state()["xp"], 25)

    def test_crops_unlock_the_habitat_without_checkout(self):
        def work(tool):
            return self.client.post("/farm/plots/1", data={"csrf": self.csrf, "tool": tool})

        for harvest_number in range(5):
            planted_at = 1000 + harvest_number * 30
            with patch("playpen.game.time", return_value=planted_at):
                self.assertEqual(work("carrot").status_code, 200)
                self.assertEqual(work("water").status_code, 200)
                self.assertEqual(work("harvest").status_code, 409)
            with patch("playpen.game.time", return_value=planted_at + 23):
                result = work("harvest")
                self.assertEqual(result.status_code, 200)
                self.assertEqual(work("harvest").status_code, 409)

        self.assertTrue(result.json["state"]["milestone"])
        self.assertEqual(result.json["state"]["inventory"]["carrot"], 5)
        self.assertEqual(self.state()["xp"], 40)
        self.assertEqual(len(self.state()["milestones"]), 1)

    def test_orders_fund_repairs_and_animal_goods_fill_the_next_order(self):
        def action(path, **data):
            return self.client.post(path, data={"csrf": self.csrf, **data})

        def grow(crop, bed, started):
            with patch("playpen.game.time", return_value=started):
                self.assertEqual(action(f"/farm/plots/{bed}", tool=crop).status_code, 200)
                self.assertEqual(action(f"/farm/plots/{bed}", tool="water").status_code, 200)
            with patch("playpen.game.time", return_value=started + 25):
                self.assertEqual(action(f"/farm/plots/{bed}", tool="harvest").status_code, 200)

        self.assertEqual(action("/farm/repairs/barn").status_code, 409)
        self.assertEqual(action("/farm/animals/cow", action="feed").status_code, 409)
        grow("wheat", 1, 1000)
        grow("wheat", 2, 1000)
        delivered = action("/farm/visitors/deliver", sequence=0).json["state"]
        self.assertEqual((delivered["level"], delivered["inventory"]["coins"], delivered["inventory"]["wheat"]), (2, 12, 0))
        self.assertEqual(action("/farm/visitors/deliver", sequence=0).status_code, 409)
        repaired = action("/farm/repairs/barn").json["state"]
        self.assertIn("barn", repaired["repairs"])
        self.assertEqual(repaired["inventory"]["coins"], 0)
        self.assertEqual(action("/farm/repairs/barn").status_code, 409)

        grow("wheat", 1, 1040)
        grow("carrot", 2, 1040)
        with patch("playpen.game.time", return_value=1070):
            self.assertEqual(action("/farm/animals/hen", action="feed").status_code, 200)
            self.assertEqual(action("/farm/animals/hen", action="feed").status_code, 409)
            self.assertEqual(action("/farm/animals/hen", action="collect").status_code, 409)
        with patch("playpen.game.time", return_value=1085):
            state = action("/farm/animals/hen", action="collect").json["state"]
            self.assertEqual(action("/farm/animals/hen", action="collect").status_code, 409)
        self.assertEqual(state["inventory"]["egg"], 1)
        self.assertEqual(state["donations"][0]["cents"], 500)
        state = action("/farm/visitors/deliver", sequence=1).json["state"]
        self.assertEqual((state["inventory"]["egg"], state["inventory"]["carrot"], state["inventory"]["coins"]), (0, 0, 16))
        grow("carrot", 1, 1100)
        grow("carrot", 2, 1100)
        state = action("/farm/visitors/deliver", sequence=2).json["state"]
        self.assertEqual((state["level"], state["inventory"]["coins"]), (4, 34))
        self.assertIn("orchard", action("/farm/repairs/orchard").json["state"]["repairs"])
        grow("carrot", 1, 1140)
        grow("wheat", 2, 1140)
        with patch("playpen.game.time", return_value=1170):
            self.assertEqual(action("/farm/animals/cow", action="feed").status_code, 200)
        with patch("playpen.game.time", return_value=1193):
            state = action("/farm/animals/cow", action="collect").json["state"]
        self.assertEqual((state["level"], state["inventory"]["milk"]), (5, 1))
        self.assertEqual([entry["cents"] for entry in state["donations"]], [500, 1000])
        self.assertEqual(action("/farm/visitors/deliver", sequence=3).json["state"]["inventory"]["milk"], 0)

    def test_partner_demo_awards_once_and_records_each_crossed_level(self):
        with game.database(self.db) as connection:
            game.award(connection, self.farm_id, "test", "xp", "Existing farm progress", 114)
        purchase = self.post("/farm/partners/seed-mix")
        state = purchase.json["state"]
        self.assertEqual((state["level"], state["xp"]), (5, 122))
        self.assertEqual([(entry["level"], entry["cents"], entry["mode"]) for entry in state["donations"]],
                         [(3, 500, "demo"), (5, 1000, "demo")])
        self.assertEqual(self.post("/farm/partners/seed-mix").status_code, 409)
        game.init_db(self.db)
        self.assertEqual(len(self.state()["donations"]), 2)
        self.assertEqual(self.state()["xp"], 122)
        self.assertIsNone(self.responses.order)


if __name__ == "__main__":
    unittest.main()
