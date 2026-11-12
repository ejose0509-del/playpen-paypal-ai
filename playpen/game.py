"""Farm progression and its persistent reward ledger."""

import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from time import time
from uuid import uuid4

from .content import ANIMALS, GOODS, IMPACT_MILESTONES, LEVELS, PARTNER_PRODUCTS, current_level, visitor_request

CATALOG = {
    "wildflower-seeds": {
        "name": "Wildflower seeds",
        "price": "3.00",
        "xp": 25,
    },
    "orchard-starter": {
        "name": "Orchard starter kit",
        "price": "5.00",
        "xp": 30,
    },
    # Partner products can also be bought with PayPal Sandbox from the market page.
    # Their XP is shared with the simulated purchase, so each earns it only once.
    **{
        sku: {"name": product["name"], "price": product["price"], "xp": product["xp"], "partner": True}
        for sku, product in PARTNER_PRODUCTS.items()
    },
}

MILESTONE_XP = LEVELS[2]["xp"]
DAILY_XP = 15
PLOT_COUNT = 12
CROPS = {
    "wheat": {"name": "Wheat", "seconds": 12, "xp": 5},
    "carrot": {"name": "Carrot", "seconds": 22, "xp": 8},
}
CHALLENGES = (
    ("What should you use to water the seedlings?", ("Rake", "Watering can", "Hammer"), 1),
    ("Which material is ready to add to a compost pile?", ("Vegetable scraps", "Glass", "Plastic"), 0),
    ("What helps native bees find food?", ("Bare soil", "Gravel", "Native flowers"), 2),
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS farms (
    id TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkouts (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL REFERENCES farms(id),
    paypal_order_id TEXT NOT NULL UNIQUE,
    approval_url TEXT NOT NULL,
    sku TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency TEXT NOT NULL,
    xp INTEGER NOT NULL CHECK (xp > 0),
    capture_id TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS rewards (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    source TEXT NOT NULL,
    reference TEXT NOT NULL,
    label TEXT NOT NULL,
    xp INTEGER NOT NULL CHECK (xp > 0),
    earned_at REAL,
    PRIMARY KEY (farm_id, source, reference)
);

CREATE TABLE IF NOT EXISTS milestones (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    name TEXT NOT NULL,
    PRIMARY KEY (farm_id, name)
);

CREATE TABLE IF NOT EXISTS plots (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 12),
    planting_id TEXT NOT NULL UNIQUE,
    crop TEXT NOT NULL CHECK (crop IN ('wheat', 'carrot')),
    ready_at REAL,
    PRIMARY KEY (farm_id, number)
);

CREATE TABLE IF NOT EXISTS stock_moves (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    item TEXT NOT NULL,
    change INTEGER NOT NULL CHECK (change != 0)
);
CREATE INDEX IF NOT EXISTS stock_moves_farm ON stock_moves (farm_id, item);

CREATE TABLE IF NOT EXISTS animal_cycles (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    animal TEXT NOT NULL,
    cycle_id TEXT NOT NULL UNIQUE,
    ready_at REAL NOT NULL,
    PRIMARY KEY (farm_id, animal)
);

CREATE TABLE IF NOT EXISTS delivered_requests (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    sequence INTEGER NOT NULL,
    PRIMARY KEY (farm_id, sequence)
);

CREATE TABLE IF NOT EXISTS completed_repairs (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    repair TEXT NOT NULL,
    PRIMARY KEY (farm_id, repair)
);

CREATE TABLE IF NOT EXISTS donation_events (
    farm_id TEXT NOT NULL REFERENCES farms(id),
    level INTEGER NOT NULL,
    cause TEXT NOT NULL,
    sponsor TEXT NOT NULL,
    cents INTEGER NOT NULL CHECK (cents > 0),
    recorded_at INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'demo' CHECK (mode = 'demo'),
    celebrated_at INTEGER,
    PRIMARY KEY (farm_id, level)
);
"""


@contextmanager
def database(filename):
    connection = sqlite3.connect(filename, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def init_db(filename):
    with database(filename) as db:
        db.executescript(SCHEMA)
        widen_plots(db)
        add_celebrations(db)
        existing = db.execute(
            "SELECT farm_id, SUM(xp) AS xp FROM rewards GROUP BY farm_id HAVING SUM(xp) >= ?",
            (MILESTONE_XP,),
        ).fetchall()
        for row in existing:
            record_impact(db, row["farm_id"], row["xp"])


def add_celebrations(db):
    """Donations recorded before the well ceremony existed count as already celebrated.

    Rewards earned before the ledger page existed keep a blank earned_at time."""
    columns = {row["name"] for row in db.execute("PRAGMA table_info(donation_events)")}
    if "celebrated_at" not in columns:
        db.execute("ALTER TABLE donation_events ADD COLUMN celebrated_at INTEGER")
        db.execute("UPDATE donation_events SET celebrated_at = recorded_at")
    if "earned_at" not in {row["name"] for row in db.execute("PRAGMA table_info(rewards)")}:
        db.execute("ALTER TABLE rewards ADD COLUMN earned_at REAL")


def widen_plots(db):
    """Farms created with six beds keep their crops when the field grows to twelve."""
    table = db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plots'").fetchone()
    if "BETWEEN 1 AND 6" not in table["sql"]:
        return
    db.executescript(
        """
        BEGIN;
        ALTER TABLE plots RENAME TO plots_six;
        CREATE TABLE plots (
            farm_id TEXT NOT NULL REFERENCES farms(id),
            number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 12),
            planting_id TEXT NOT NULL UNIQUE,
            crop TEXT NOT NULL CHECK (crop IN ('wheat', 'carrot')),
            ready_at REAL,
            PRIMARY KEY (farm_id, number)
        );
        INSERT INTO plots SELECT farm_id, number, planting_id, crop, ready_at FROM plots_six;
        DROP TABLE plots_six;
        COMMIT;
        """
    )


def ensure_farm(filename, farm_id):
    with database(filename) as db:
        db.execute("INSERT INTO farms (id) VALUES (?) ON CONFLICT DO NOTHING", (farm_id,))


def farm_day():
    return datetime.now(timezone.utc).date().isoformat()


def daily_challenge(day):
    return CHALLENGES[date.fromisoformat(day).toordinal() % len(CHALLENGES)]


def total_xp(db, farm_id):
    return db.execute(
        "SELECT COALESCE(SUM(xp), 0) FROM rewards WHERE farm_id = ?", (farm_id,)
    ).fetchone()[0]


def award(db, farm_id, source, reference, label, xp):
    cursor = db.execute(
        """
        INSERT INTO rewards (farm_id, source, reference, label, xp, earned_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
        """,
        (farm_id, source, reference, label, xp, time()),
    )
    if cursor.rowcount:
        record_impact(db, farm_id, total_xp(db, farm_id))
    return cursor.rowcount == 1


def record_impact(db, farm_id, xp):
    if xp >= MILESTONE_XP:
        db.execute(
            "INSERT INTO milestones (farm_id, name) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (farm_id, "Wildflower habitat"),
        )
    level = current_level(xp)["number"]
    db.executemany(
        """
        INSERT INTO donation_events (farm_id, level, cause, sponsor, cents, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING
        """,
        [
            (farm_id, entry["level"], entry["cause"], entry["sponsor"], entry["cents"], int(time()))
            for entry in IMPACT_MILESTONES if entry["level"] <= level
        ],
    )


def inventory(db, farm_id):
    stock = dict.fromkeys((*GOODS, "coins"), 0)
    # Crops already earned by existing farms remain in the harvest reward ledger.
    for row in db.execute(
        "SELECT source, COUNT(*) AS quantity FROM rewards WHERE farm_id = ? AND source LIKE 'harvest-%' GROUP BY source",
        (farm_id,),
    ):
        stock[row["source"].removeprefix("harvest-")] = row["quantity"]
    for row in db.execute(
        "SELECT item, SUM(change) AS quantity FROM stock_moves WHERE farm_id = ? GROUP BY item",
        (farm_id,),
    ):
        stock[row["item"]] += row["quantity"]
    return stock


def request_sequence(db, farm_id):
    return db.execute(
        "SELECT COUNT(*) FROM delivered_requests WHERE farm_id = ?", (farm_id,)
    ).fetchone()[0]


def complete_daily(filename, farm_id, day, answer):
    if answer != daily_challenge(day)[2]:
        return "incorrect"
    with database(filename) as db:
        awarded = award(db, farm_id, "daily", day, "Daily farm task", DAILY_XP)
    return "earned" if awarded else "already_completed"


def work_plot(filename, farm_id, number, tool):
    """Apply one tool under a write lock so a crop can be harvested only once."""
    with database(filename) as db:
        db.execute("BEGIN IMMEDIATE")
        plot = db.execute(
            "SELECT * FROM plots WHERE farm_id = ? AND number = ?", (farm_id, number)
        ).fetchone()

        if tool in CROPS:
            if plot:
                return False, "This bed is planted. Choose another bed."
            db.execute(
                "INSERT INTO plots (farm_id, number, planting_id, crop) VALUES (?, ?, ?, ?)",
                (farm_id, number, uuid4().hex, tool),
            )
            return True, f"{CROPS[tool]['name']} planted. Water it to start growing."

        if not plot:
            return False, "This bed is empty. Plant wheat or carrots first."
        crop = CROPS[plot["crop"]]
        if tool == "water":
            if plot["ready_at"] is not None:
                return False, "This crop has already been watered."
            db.execute(
                "UPDATE plots SET ready_at = ? WHERE planting_id = ?",
                (time() + crop["seconds"], plot["planting_id"]),
            )
            return True, f"{crop['name']} watered. Ready in {crop['seconds']} seconds."

        if plot["ready_at"] is None:
            return False, "Water this crop first."
        if plot["ready_at"] > time():
            return False, "This crop is still growing."
        db.execute("DELETE FROM plots WHERE planting_id = ?", (plot["planting_id"],))
        award(
            db, farm_id, f"harvest-{plot['crop']}", plot["planting_id"],
            f"{crop['name']} harvest", crop["xp"],
        )
        return True, f"{crop['name']} harvested. +{crop['xp']} XP"


def field_state(db, farm_id):
    planted = {
        row["number"]: dict(row)
        for row in db.execute("SELECT number, crop, ready_at FROM plots WHERE farm_id = ?", (farm_id,))
    }
    return {
        "plots": [planted.get(number, {"number": number}) for number in range(1, PLOT_COUNT + 1)],
        "inventory": inventory(db, farm_id),
        "now": time(),
    }


def homestead_state(db, farm_id, xp, rewards):
    level = current_level(xp)
    sequence = request_sequence(db, farm_id)
    cycles = {
        row["animal"]: row["ready_at"]
        for row in db.execute("SELECT animal, ready_at FROM animal_cycles WHERE farm_id = ?", (farm_id,))
    }
    return {
        "level": level["number"],
        "level_start": level["xp"],
        "next_level_xp": LEVELS[level["number"]]["xp"] if level["number"] < len(LEVELS) else None,
        "animals": {
            key: {**animal, "unlocked": level["number"] >= animal["level"], "ready_at": cycles.get(key)}
            for key, animal in ANIMALS.items()
        },
        "visitor_order": {"sequence": sequence, **visitor_request(sequence)},
        "repairs": [
            row["repair"]
            for row in db.execute("SELECT repair FROM completed_repairs WHERE farm_id = ?", (farm_id,))
        ],
        "donations": [
            dict(row)
            for row in db.execute(
                """
                SELECT level, cause, sponsor, cents, mode, celebrated_at IS NOT NULL AS celebrated
                FROM donation_events WHERE farm_id = ? ORDER BY level
                """,
                (farm_id,),
            )
        ],
        "demo_purchases": [row["reference"] for row in rewards if row["source"] == "partner-demo"],
        "has_harvested": any(row["source"].startswith("harvest-") for row in rewards),
    }


def farm_state(filename, farm_id, day):
    with database(filename) as db:
        db.execute("BEGIN")
        xp = total_xp(db, farm_id)
        rewards = db.execute(
            "SELECT source, reference, label, xp FROM rewards WHERE farm_id = ? ORDER BY rowid DESC",
            (farm_id,),
        ).fetchall()
        milestones = db.execute(
            "SELECT name FROM milestones WHERE farm_id = ?", (farm_id,)
        ).fetchall()
        orders = db.execute(
            """
            SELECT paypal_order_id, sku FROM checkouts
            WHERE farm_id = ? AND capture_id IS NULL ORDER BY rowid DESC LIMIT 5
            """,
            (farm_id,),
        ).fetchall()
        field = field_state(db, farm_id)
        homestead = homestead_state(db, farm_id, xp, rewards)
    unlocked = [level["name"] for level in LEVELS if xp >= level["xp"]]
    return {
        "xp": xp,
        "stage": unlocked[-1],
        "unlocked": unlocked,
        "daily_complete": any(r["source"] == "daily" and r["reference"] == day for r in rewards),
        "rewards": rewards,
        "milestones": milestones,
        "orders": orders,
        **field,
        **homestead,
    }


def save_checkout(filename, checkout_id, farm_id, order_id, approval_url, sku):
    product = CATALOG[sku]
    with database(filename) as db:
        db.execute(
            """
            INSERT INTO checkouts
                (id, farm_id, paypal_order_id, approval_url, sku, amount, currency, xp)
            VALUES (?, ?, ?, ?, ?, ?, 'USD', ?)
            """,
            (checkout_id, farm_id, order_id, approval_url, sku, product["price"], product["xp"]),
        )


def get_checkout(filename, farm_id, order_id):
    with database(filename) as db:
        row = db.execute(
            "SELECT * FROM checkouts WHERE farm_id = ? AND paypal_order_id = ?",
            (farm_id, order_id),
        ).fetchone()
    return row


def settle_checkout(filename, checkout, capture_id):
    """Record the capture and grant its reward in the same database transaction."""
    with database(filename) as db:
        updated = db.execute(
            "UPDATE checkouts SET capture_id = ? WHERE id = ? AND capture_id IS NULL",
            (capture_id, checkout["id"]),
        )
        if updated.rowcount:
            product = CATALOG[checkout["sku"]]
            if product.get("partner"):
                # Same ledger key as the simulated purchase: one reward per partner product.
                return award(db, checkout["farm_id"], "partner-demo", checkout["sku"], product["name"], checkout["xp"])
            award(db, checkout["farm_id"], "paypal", capture_id, product["name"], checkout["xp"])
        else:
            stored = db.execute(
                "SELECT capture_id FROM checkouts WHERE id = ?", (checkout["id"],)
            ).fetchone()
            if stored is None or stored["capture_id"] != capture_id:
                raise ValueError("Checkout already associated with a different capture")
    return bool(updated.rowcount)


REWARD_KINDS = {
    "animal": "Animal goods", "visitor": "Village order", "repair": "Restoration", "daily": "Daily task",
    "partner-demo": "Partner offer", "paypal": "Sandbox purchase", "partner-brand": "Brand spotted (demo)",
}


def ledger(filename, farm_id):
    """Every XP award, PayPal Sandbox order and demo donation for one farm, for the ledger page."""
    with database(filename) as db:
        db.execute("BEGIN")
        rewards = db.execute(
            "SELECT source, reference, label, xp, earned_at FROM rewards WHERE farm_id = ? ORDER BY rowid",
            (farm_id,),
        ).fetchall()
        checkouts = db.execute(
            "SELECT paypal_order_id, sku, amount, capture_id FROM checkouts WHERE farm_id = ? ORDER BY rowid",
            (farm_id,),
        ).fetchall()
        donations = db.execute(
            """
            SELECT level, cause, sponsor, cents, recorded_at, celebrated_at FROM donation_events
            WHERE farm_id = ? ORDER BY level
            """,
            (farm_id,),
        ).fetchall()
    rows = [
        {
            "when": row["earned_at"], "kind": "Harvest" if row["source"].startswith("harvest-")
            else REWARD_KINDS.get(row["source"], "Bonus"),
            "item": row["label"], "xp": row["xp"], "amount": None, "status": "XP earned",
            "group": "xp",
        }
        for row in rewards
    ]
    rows += [
        {
            "when": None, "kind": "PayPal Sandbox", "item": CATALOG.get(row["sku"], {}).get("name", row["sku"]),
            "xp": None, "amount": float(row["amount"]),
            "status": "Paid (test money)" if row["capture_id"] else "Awaiting approval",
            "group": "money", "reference": row["paypal_order_id"],
        }
        for row in checkouts
    ]
    rows += [
        {
            "when": row["recorded_at"], "kind": "Demo donation", "item": f"{row['sponsor']} for {row['cause'].lower()}",
            "xp": None, "amount": row["cents"] / 100,
            "status": "Celebrated at the well" if row["celebrated_at"] else "Waiting at the well",
            "group": "donation", "reference": f"Level {row['level']}",
        }
        for row in donations
    ]
    summary = {
        "xp": sum(row["xp"] for row in rewards),
        "rewards": len(rewards),
        "donated": sum(row["cents"] for row in donations) / 100,
        "sandbox_paid": sum(float(row["amount"]) for row in checkouts if row["capture_id"]),
    }
    return {"rows": rows, "summary": summary}
