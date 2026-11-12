"""Farm actions that exchange inventory or advance restoration."""

from time import time
from uuid import uuid4

from . import game
from .content import ANIMALS, GOODS, PARTNER_PRODUCTS, REPAIRS, VISITORS, current_level, visitor_request


def spend(db, farm_id, required):
    available = game.inventory(db, farm_id)
    if any(available[item] < quantity for item, quantity in required.items()):
        return False
    db.executemany(
        "INSERT INTO stock_moves (farm_id, item, change) VALUES (?, ?, ?)",
        [(farm_id, item, -quantity) for item, quantity in required.items()],
    )
    return True


def receive(db, farm_id, item, quantity):
    db.execute(
        "INSERT INTO stock_moves (farm_id, item, change) VALUES (?, ?, ?)",
        (farm_id, item, quantity),
    )


def care_for_animal(filename, farm_id, kind, action):
    animal = ANIMALS[kind]
    with game.database(filename) as db:
        db.execute("BEGIN IMMEDIATE")
        if current_level(game.total_xp(db, farm_id))["number"] < animal["level"]:
            return False, f"{animal['name']} arrives at Level {animal['level']}."
        cycle = db.execute(
            "SELECT cycle_id, ready_at FROM animal_cycles WHERE farm_id = ? AND animal = ?",
            (farm_id, kind),
        ).fetchone()
        if action == "feed":
            if cycle:
                return False, f"{animal['name']} has already been fed. Collect the goods first."
            if not spend(db, farm_id, {animal["feed"]: 1}):
                return False, f"Harvest {GOODS[animal['feed']].lower()} before feeding {animal['name']}."
            db.execute(
                "INSERT INTO animal_cycles (farm_id, animal, cycle_id, ready_at) VALUES (?, ?, ?, ?)",
                (farm_id, kind, uuid4().hex, game.time() + animal["seconds"]),
            )
            return True, f"{animal['name']} was fed. Check back in {animal['seconds']} seconds."
        if not cycle or cycle["ready_at"] > game.time():
            return False, f"{animal['name']} has nothing ready to collect yet."
        db.execute("DELETE FROM animal_cycles WHERE cycle_id = ?", (cycle["cycle_id"],))
        receive(db, farm_id, animal["product"], 1)
        game.award(db, farm_id, "animal", cycle["cycle_id"], f"{animal['name']}’s goods", animal["xp"])
        return True, f"Collected {animal['output']}. +{animal['xp']} XP"


def deliver_request(filename, farm_id, expected_sequence):
    with game.database(filename) as db:
        db.execute("BEGIN IMMEDIATE")
        sequence = game.request_sequence(db, farm_id)
        if sequence != expected_sequence:
            return False, "That order has already changed. Check the current request."
        order = visitor_request(sequence)
        if not spend(db, farm_id, order["goods"]):
            return False, "Gather the missing goods, then return to the visitor."
        db.execute("INSERT INTO delivered_requests (farm_id, sequence) VALUES (?, ?)", (farm_id, sequence))
        receive(db, farm_id, "coins", order["coins"])
        game.award(db, farm_id, "visitor", str(sequence), order["title"], order["xp"])
        name = VISITORS[order["visitor"]]["name"]
        return True, f"Delivered to {name}. +{order['coins']} coins and +{order['xp']} XP"


def repair_building(filename, farm_id, key):
    repair = REPAIRS[key]
    with game.database(filename) as db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute(
            "SELECT 1 FROM completed_repairs WHERE farm_id = ? AND repair = ?", (farm_id, key)
        ).fetchone():
            return False, "This repair is already complete."
        if current_level(game.total_xp(db, farm_id))["number"] < repair["level"]:
            return False, f"This repair unlocks at Level {repair['level']}."
        if not spend(db, farm_id, {"coins": repair["coins"]}):
            return False, "Fill a village order to earn more repair coins."
        db.execute("INSERT INTO completed_repairs (farm_id, repair) VALUES (?, ?)", (farm_id, key))
        game.award(db, farm_id, "repair", key, f"{repair['name']} restored", repair["xp"])
        return True, f"{repair['name']} restored. +{repair['xp']} XP"


def simulate_purchase(filename, farm_id, sku):
    product = PARTNER_PRODUCTS[sku]
    with game.database(filename) as db:
        if not game.award(db, farm_id, "partner-demo", sku, product["name"], product["xp"]):
            return False, "This demo purchase has already earned its reward."
    return True, f"Demo purchase recorded. +{product['xp']} XP"


def celebrate_donation(filename, farm_id, level):
    """Mark a recorded demo donation as celebrated at the well. Grants nothing, so repeats are harmless."""
    with game.database(filename) as db:
        updated = db.execute(
            "UPDATE donation_events SET celebrated_at = ? WHERE farm_id = ? AND level = ? AND celebrated_at IS NULL",
            (int(time()), farm_id, level),
        )
    if not updated.rowcount:
        return False, "There’s no new donation waiting at the well."
    return True, "The valley celebrates your milestone."
