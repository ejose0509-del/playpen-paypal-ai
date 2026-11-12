import sqlite3
import tempfile
import unittest
from pathlib import Path

from playpen import create_app, game
from playpen.content import IMPACT_MILESTONES
from playpen.paypal import PayPalSandbox

LEVEL_3_XP = 40


class WellCeremonyTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.db = str(Path(directory.name) / "farm.sqlite3")
        config = {"TESTING": True, "DATABASE": self.db, "SECRET_KEY": "k", "BASE_URL": "http://localhost:8000"}
        self.client = create_app(config, PayPalSandbox("", "")).test_client()
        self.client.get("/")
        with self.client.session_transaction() as session:
            self.csrf = session["csrf"]
            self.farm_id = session["farm_id"]

    def reach_level_3(self):
        with game.database(self.db) as db:
            game.award(db, self.farm_id, "test", "level-3", "Test XP", LEVEL_3_XP)

    def state(self):
        return game.farm_state(self.db, self.farm_id, game.farm_day())

    def celebrate(self, level):
        return self.client.post(f"/farm/donations/{level}/celebrate", data={"csrf": self.csrf})

    def test_new_donation_waits_at_the_well_uncelebrated(self):
        self.reach_level_3()
        [donation] = self.state()["donations"]
        self.assertEqual(donation["level"], IMPACT_MILESTONES[0]["level"])
        self.assertFalse(donation["celebrated"])

    def test_celebrating_marks_donation_once_and_grants_no_xp(self):
        # Arrange
        self.reach_level_3()
        xp_before = self.state()["xp"]

        # Act
        first = self.celebrate(3)
        second = self.celebrate(3)

        # Assert
        self.assertEqual(first.status_code, 200)
        self.assertTrue(first.json["state"]["donations"][0]["celebrated"])
        self.assertEqual(second.status_code, 409)
        self.assertEqual(self.state()["xp"], xp_before)

    def test_celebrating_a_donation_not_yet_earned_is_refused(self):
        self.assertEqual(self.celebrate(5).status_code, 409)
        self.assertEqual(self.state()["donations"], [])

    def test_celebrate_requires_csrf(self):
        self.reach_level_3()
        self.assertEqual(self.client.post("/farm/donations/3/celebrate").status_code, 403)
        self.assertFalse(self.state()["donations"][0]["celebrated"])


class CelebrationMigrationTests(unittest.TestCase):
    def test_donations_from_before_the_ceremony_count_as_celebrated(self):
        # Arrange: a database with the old donation table and one recorded donation.
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        db_path = str(Path(directory.name) / "old.sqlite3")
        with sqlite3.connect(db_path) as db:
            db.executescript("""
                CREATE TABLE farms (id TEXT PRIMARY KEY);
                CREATE TABLE donation_events (
                    farm_id TEXT NOT NULL REFERENCES farms(id), level INTEGER NOT NULL, cause TEXT NOT NULL,
                    sponsor TEXT NOT NULL, cents INTEGER NOT NULL CHECK (cents > 0), recorded_at INTEGER NOT NULL,
                    mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode = 'demo'), PRIMARY KEY (farm_id, level));
                INSERT INTO farms VALUES ('old-farm');
                INSERT INTO donation_events (farm_id, level, cause, sponsor, cents, recorded_at)
                    VALUES ('old-farm', 3, 'Pollinator habitat', 'Alder & Finch Seeds', 500, 1000);
            """)

        # Act
        game.init_db(db_path)

        # Assert
        with game.database(db_path) as db:
            row = db.execute("SELECT celebrated_at FROM donation_events WHERE farm_id = 'old-farm'").fetchone()
        self.assertEqual(row["celebrated_at"], 1000)


if __name__ == "__main__":
    unittest.main()
