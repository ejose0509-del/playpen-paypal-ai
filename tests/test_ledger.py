import sqlite3
import tempfile
import unittest
from pathlib import Path

from playpen import create_app, game, homestead
from playpen.paypal import PayPalSandbox


class LedgerTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "farm.sqlite3")
        config = {"TESTING": True, "DATABASE": self.db, "SECRET_KEY": "k", "BASE_URL": "http://localhost:8000"}
        self.client = create_app(config, PayPalSandbox("", "")).test_client()
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.farm_id = session["farm_id"]

    def test_new_farm_ledger_is_empty(self):
        data = self.client.get("/farm/ledger").json
        self.assertEqual(data["rows"], [])
        self.assertEqual(data["summary"], {"xp": 0, "rewards": 0, "donated": 0, "sandbox_paid": 0})

    def test_ledger_lists_rewards_orders_and_donations_with_totals(self):
        # Arrange: 40 XP (Level 3 donation), a partner offer, one paid and one open Sandbox order.
        with game.database(self.db) as db:
            game.award(db, self.farm_id, "harvest-wheat", "p1", "Wheat harvest", 32)
        homestead.simulate_purchase(self.db, self.farm_id, "seed-mix")
        game.save_checkout(self.db, "c1", self.farm_id, "ORDER-1", "https://www.sandbox.paypal.com/a", "wildflower-seeds")
        game.save_checkout(self.db, "c2", self.farm_id, "ORDER-2", "https://www.sandbox.paypal.com/b", "orchard-starter")
        game.settle_checkout(self.db, game.get_checkout(self.db, self.farm_id, "ORDER-1"), "CAPTURE-1")

        # Act
        data = self.client.get("/farm/ledger").json

        # Assert
        kinds = [row["kind"] for row in data["rows"]]
        self.assertEqual(kinds, ["Harvest", "Partner offer", "Sandbox purchase", "PayPal Sandbox", "PayPal Sandbox", "Demo donation"])
        statuses = {row.get("reference"): row["status"] for row in data["rows"] if row["group"] != "xp"}
        self.assertEqual(statuses["ORDER-1"], "Paid (test money)")
        self.assertEqual(statuses["ORDER-2"], "Awaiting approval")
        self.assertEqual(statuses["Level 3"], "Waiting at the well")
        self.assertTrue(all(row["when"] for row in data["rows"] if row["group"] == "xp"))
        self.assertEqual(data["summary"]["xp"], 32 + 8 + 25)
        self.assertEqual(data["summary"]["donated"], 5.0)
        self.assertEqual(data["summary"]["sandbox_paid"], 3.0)

    def test_ledger_only_shows_this_farms_records(self):
        game.ensure_farm(self.db, "someone-else")
        with game.database(self.db) as db:
            game.award(db, "someone-else", "daily", "d1", "Daily farm task", 15)
        self.assertEqual(self.client.get("/farm/ledger").json["rows"], [])

    def test_ledger_requires_a_farm_session(self):
        fresh = create_app(
            {"TESTING": True, "DATABASE": self.db, "SECRET_KEY": "k", "BASE_URL": "http://localhost:8000"},
            PayPalSandbox("", ""),
        ).test_client()
        self.assertEqual(fresh.get("/farm/ledger").status_code, 403)
        self.assertEqual(fresh.get("/ledger").status_code, 302)

    def test_rewards_from_before_the_ledger_keep_a_blank_time(self):
        # Arrange: an old rewards table without earned_at.
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "old.sqlite3")
        with sqlite3.connect(db_path) as db:
            db.executescript("""
                CREATE TABLE farms (id TEXT PRIMARY KEY);
                CREATE TABLE rewards (farm_id TEXT NOT NULL REFERENCES farms(id), source TEXT NOT NULL,
                    reference TEXT NOT NULL, label TEXT NOT NULL, xp INTEGER NOT NULL CHECK (xp > 0),
                    PRIMARY KEY (farm_id, source, reference));
                INSERT INTO farms VALUES ('old');
                INSERT INTO rewards VALUES ('old', 'daily', 'd0', 'Daily farm task', 15);
            """)

        # Act
        game.init_db(db_path)
        [row] = game.ledger(db_path, "old")["rows"]

        # Assert
        self.assertIsNone(row["when"])
        self.assertEqual(row["xp"], 15)


if __name__ == "__main__":
    unittest.main()
