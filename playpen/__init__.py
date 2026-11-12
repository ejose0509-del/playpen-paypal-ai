"""PlayPen web app. Run with python -m playpen."""

import os
import secrets
import sqlite3
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from dotenv import load_dotenv
from flask import Flask, abort, flash, jsonify, redirect, render_template, request, session, url_for

from . import extension, game, homestead
from .channel3 import Channel3, Channel3Error
from .companion import Companion, CompanionUnavailable, browsing_note
from . import companion as companion_store
from .content import (
    ANIMALS, DEMO_BRAND_XP, DEMO_BRANDS, GOODS, IMPACT_MILESTONES, LEVELS, PARTNER_PRODUCTS, REPAIRS, VISITORS,
)
from .paypal import PayPalError, PayPalSandbox, approval_url, completed_capture_id


def instance_secret(directory):
    secret_file = directory / "session.key"
    try:
        with os.fdopen(os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as file:
            file.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    return secret_file.read_text().strip()


def validate_origin(origin):
    parsed = urlsplit(origin)
    if (
        not parsed.hostname or parsed.username is not None or parsed.password is not None
        or parsed.path or parsed.query or parsed.fragment
    ):
        raise ValueError("PLAYPEN_BASE_URL must be an origin, for example http://localhost:8000")
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
        raise ValueError("Use HTTPS for a non-local PlayPen origin")


def create_app(config=None, payments=None, companion=None, products=None):
    project_dir = Path(__file__).resolve().parent.parent
    load_dotenv(project_dir / ".env")
    app = Flask(__name__, instance_path=str(project_dir / "instance"))
    app.config.from_mapping(
        DATABASE=str(Path(app.instance_path) / "playpen.sqlite3"),
        SECRET_KEY=os.environ.get("PLAYPEN_SESSION_KEY"),
        BASE_URL=(
            os.environ.get("PLAYPEN_BASE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "http://localhost:8000"
        ).rstrip("/"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )
    if config:
        app.config.update(config)
    base_url = app.config["BASE_URL"]
    validate_origin(base_url)
    app.config["SESSION_COOKIE_SECURE"] = base_url.startswith("https://")

    db = app.config["DATABASE"]
    Path(db).parent.mkdir(parents=True, exist_ok=True)
    if not app.secret_key:
        app.secret_key = instance_secret(Path(app.instance_path))
    game.init_db(db)
    companion_store.init_db(db)
    extension.init_db(db)
    if products is None:
        products = Channel3(os.environ.get("CHANNEL3_API_KEY", "").strip())
    if companion is None:
        companion = Companion()

    if payments is None:
        payments = PayPalSandbox(
            os.environ.get("PAYPAL_SANDBOX_CLIENT_ID", "").strip(),
            os.environ.get("PAYPAL_SANDBOX_CLIENT_SECRET", "").strip(),
        )

    @app.before_request
    def require_csrf():
        if request.method == "POST" and not request.path.startswith("/extension/api/"):
            expected = session.get("csrf")
            supplied = request.form.get("csrf", "")
            if not expected or not secrets.compare_digest(expected.encode(), supplied.encode()):
                abort(403, "Open PlayPen and try again.")

    @app.after_request
    def disable_caching(response):
        response.headers["Cache-Control"] = "no-store"
        return response

    def owned_checkout(order_id):
        checkout = game.get_checkout(db, session.get("farm_id"), order_id)
        if checkout is None:
            abort(404)
        return checkout

    def playable_state(farm):
        return {
            key: farm[key]
            for key in (
                "xp", "stage", "plots", "inventory", "now", "level", "level_start", "next_level_xp",
                "animals", "visitor_order", "repairs", "donations", "demo_purchases", "has_harvested",
            )
        } | {
            "milestone": bool(farm["milestones"]),
            "milestone_xp": game.MILESTONE_XP,
        }

    def action_result(changed, message):
        farm = game.farm_state(db, session["farm_id"], game.farm_day())
        return jsonify(state=playable_state(farm), message=message), 200 if changed else 409

    @app.get("/")
    def home():
        if "farm_id" not in session:
            farm_id = uuid4().hex
            game.ensure_farm(db, farm_id)
            session["farm_id"] = farm_id
            session["csrf"] = secrets.token_hex(32)
            session.permanent = True
        # A cookie can outlive its farm (a reset database, or Render's temporary disk), so recreate the row.
        game.ensure_farm(db, session["farm_id"])
        day = game.farm_day()
        prompt, choices, _ = game.daily_challenge(day)
        farm = game.farm_state(db, session["farm_id"], day)
        return render_template(
            "home.html",
            farm=farm,
            field=playable_state(farm),
            prompt=prompt,
            choices=choices,
            day=day,
            catalog=game.CATALOG,
            configured=payments.configured,
            milestone_xp=game.MILESTONE_XP,
            goods=GOODS,
            levels=LEVELS,
            impact_milestones=IMPACT_MILESTONES,
            visitors=VISITORS,
            repairs=REPAIRS,
            partner_products=PARTNER_PRODUCTS,
            extension_token=extension.link_token(db, session["farm_id"]),
        )

    @app.post("/farm/plots/<int:number>")
    def update_plot(number):
        tool = request.form.get("tool")
        if not 1 <= number <= game.PLOT_COUNT or tool not in {*game.CROPS, "water", "harvest"}:
            return jsonify(message="Choose a tool and a farm bed."), 400
        return action_result(*game.work_plot(db, session["farm_id"], number, tool))

    @app.post("/farm/animals/<kind>")
    def animal_action(kind):
        action = request.form.get("action")
        if kind not in ANIMALS or action not in {"feed", "collect"}:
            return jsonify(message="Choose a valid animal and action."), 400
        return action_result(*homestead.care_for_animal(db, session["farm_id"], kind, action))

    @app.post("/farm/visitors/deliver")
    def fulfill_visitor():
        sequence = request.form.get("sequence", type=int)
        if sequence is None or sequence < 0:
            return jsonify(message="Open the current village order to deliver it."), 400
        return action_result(*homestead.deliver_request(db, session["farm_id"], sequence))

    @app.post("/farm/repairs/<key>")
    def restore_building(key):
        if key not in REPAIRS:
            return jsonify(message="Choose a valid repair."), 400
        return action_result(*homestead.repair_building(db, session["farm_id"], key))

    @app.post("/farm/donations/<int:level>/celebrate")
    def celebrate_donation(level):
        return action_result(*homestead.celebrate_donation(db, session["farm_id"], level))

    @app.post("/farm/partners/<sku>")
    def partner_demo(sku):
        if sku not in PARTNER_PRODUCTS:
            return jsonify(message="Choose a demo product from the partner market."), 400
        return action_result(*homestead.simulate_purchase(db, session["farm_id"], sku))

    @app.get("/farm/companion")
    def companion_history():
        if "farm_id" not in session:
            abort(403, "Open PlayPen and try again.")
        return jsonify(
            configured=companion.configured,
            messages=companion.history(db, session["farm_id"]),
        )

    def open_checkout(sku):
        """Create a Sandbox order for this farm. Returns the stored order's approval link."""
        checkout_id = uuid4().hex
        order = payments.create_order(checkout_id, sku, base_url)
        target = approval_url(order)
        if not isinstance(order.get("id"), str) or not order["id"]:
            raise PayPalError("Order ID was missing")
        game.save_checkout(db, checkout_id, session["farm_id"], order["id"], target, sku)
        return order["id"], target

    def companion_checkout(sku):
        """Bramble's start_sandbox_checkout tool. Nothing is charged until the player approves."""
        product = game.CATALOG[sku]
        if not payments.configured:
            return {"error": "PayPal Sandbox isn't set up on this farm, so no order was created."}
        try:
            order_id, target = open_checkout(sku)
        except (PayPalError, sqlite3.IntegrityError) as error:
            app.logger.warning("Companion Sandbox order failed (%s)", getattr(error, "status", None))
            return {"error": "PayPal Sandbox couldn't create the order. Nothing was charged."}
        return {
            "status": "Sandbox order created and waiting for the player's approval. Nothing has been charged.",
            "product": product["name"], "price": f"${product['price']}", "xp": product["xp"],
            "order_id": order_id, "approval_url": target,
        }

    @app.get("/ledger")
    def ledger_page():
        if "farm_id" not in session:
            return redirect(url_for("home"))
        return render_template("ledger.html")

    @app.get("/farm/ledger")
    def ledger_data():
        if "farm_id" not in session:
            abort(403, "Open PlayPen and try again.")
        return jsonify(game.ledger(db, session["farm_id"]))

    @app.get("/market")
    def market():
        if "farm_id" not in session:
            return redirect(url_for("home"))
        farm = game.farm_state(db, session["farm_id"], game.farm_day())
        return render_template(
            "market.html", partner_products=PARTNER_PRODUCTS, demo_purchases=farm["demo_purchases"],
            configured=payments.configured,
        )

    @app.post("/farm/companion")
    def companion_chat():
        farm = game.farm_state(db, session["farm_id"], game.farm_day())
        at_market = request.form.get("place") == "market"
        try:
            result = companion.reply(
                db, session["farm_id"], playable_state(farm), request.form.get("message", ""),
                checkout=companion_checkout if at_market else None,
            )
        except CompanionUnavailable as error:
            return jsonify(message=str(error)), 503
        checkouts = [
            {"product": c["product"], "price": c["price"], "approval_url": c["approval_url"],
             "status_url": url_for("checkout_status", order_id=c["order_id"])}
            for c in result["checkouts"]
        ]
        return jsonify(reply=result["reply"], checkouts=checkouts)

    # Bramble in Chrome. The extension sends this farm's private token instead of a session cookie,
    # so these routes skip the form CSRF check: a page can't read or guess the token.
    def extension_farm():
        farm_id = extension.farm_for(db, request.headers.get("X-PlayPen-Token", ""))
        if farm_id is None:
            abort(401, "Open your PlayPen farm in Chrome to bring Bramble along.")
        return farm_id

    def spotted_brands(keys):
        return [DEMO_BRANDS[k] for k in dict.fromkeys(keys or []) if isinstance(k, str) and k in DEMO_BRANDS]

    def product_search(query):
        if not products.configured:
            return {"error": "Product search isn't set up yet (no Channel3 key), so you can't search right now."}
        try:
            return {"products": products.search(query)}
        except Channel3Error as error:
            app.logger.warning("Channel3 search failed: %s", error)
            return {"error": "The product search didn't answer. Try again in a moment."}

    @app.get("/extension/api/hello")
    def extension_hello():
        farm = game.farm_state(db, extension_farm(), game.farm_day())
        return jsonify(
            brands={k: {"name": b["name"], "match": b["match"], "case": b.get("case", False), "why": b["why"]}
                    for k, b in DEMO_BRANDS.items()},
            brand_xp=DEMO_BRAND_XP,
            farm={"level": farm["level"], "xp": farm["xp"], "coins": farm["inventory"]["coins"]},
            search=products.configured, chat=companion.configured,
        )

    @app.post("/extension/api/spot")
    def extension_spot():
        farm_id = extension_farm()
        keys = (request.get_json(silent=True) or {}).get("brands")
        awarded = []
        with game.database(db) as connection:
            for key in dict.fromkeys(k for k in keys or [] if isinstance(k, str) and k in DEMO_BRANDS):
                name = DEMO_BRANDS[key]["name"]
                if game.award(connection, farm_id, "partner-brand", key, f"Spotted {name} (demo partner brand)", DEMO_BRAND_XP):
                    awarded.append(name)
        farm = game.farm_state(db, farm_id, game.farm_day())
        return jsonify(awarded=awarded, xp=len(awarded) * DEMO_BRAND_XP, farm_xp=farm["xp"], level=farm["level"])

    @app.post("/extension/api/chat")
    def extension_chat():
        farm_id = extension_farm()
        body = request.get_json(silent=True) or {}
        page = body.get("page") if isinstance(body.get("page"), dict) else {}
        organic = page.get("organic") if isinstance(page.get("organic"), int) else 0
        note = browsing_note(
            str(page.get("host", "a website"))[:80], str(page.get("title", "")),
            spotted_brands(page.get("brands") if isinstance(page.get("brands"), list) else []),
            max(0, min(organic, 200)),
        )
        farm = game.farm_state(db, farm_id, game.farm_day())
        try:
            result = companion.reply(
                db, farm_id, playable_state(farm), str(body.get("message", "")),
                browsing={"note": note, "search": product_search},
            )
        except CompanionUnavailable as error:
            return jsonify(message=str(error)), 503
        navigate = result["navigate"][0] if result["navigate"] else None
        return jsonify(reply=result["reply"], products=result["products"], navigate=navigate)

    @app.post("/daily")
    def daily():
        day = game.farm_day()
        if request.form.get("day") != day:
            flash("A new farm task is ready. Try today’s task.")
        else:
            outcome = game.complete_daily(db, session["farm_id"], day, request.form.get("answer", type=int))
            flash({
                "incorrect": "Try another answer.",
                "already_completed": "You’ve already earned today’s reward.",
                "earned": f"Daily task complete. Your farm earned {game.DAILY_XP} XP.",
            }[outcome])
        return redirect(url_for("home"), code=303)

    @app.post("/checkout")
    def create_checkout():
        sku = request.form.get("sku")
        if sku not in game.CATALOG:
            abort(400, "Unknown product")
        if not payments.configured:
            flash("Add PayPal Sandbox credentials to enable checkout.")
            return redirect(url_for("home"), code=303)
        try:
            _, target = open_checkout(sku)
        except (PayPalError, sqlite3.IntegrityError) as error:
            app.logger.warning("Sandbox order creation failed (%s)", getattr(error, "status", None))
            flash("PayPal Sandbox couldn’t create the order. Check the credentials and try again.")
            return redirect(url_for("home"), code=303)
        return redirect(target, code=303)

    @app.get("/checkout/return")
    def checkout_return():
        checkout = owned_checkout(request.args.get("token", ""))
        return redirect(url_for("checkout_status", order_id=checkout["paypal_order_id"]), code=303)

    @app.get("/checkout/cancel")
    def checkout_cancel():
        flash("Checkout was canceled. You can start again from your farm.")
        return redirect(url_for("home"), code=303)

    @app.get("/checkout/<order_id>")
    def checkout_status(order_id):
        checkout = owned_checkout(order_id)
        return render_template("checkout.html", checkout=checkout, catalog=game.CATALOG)

    @app.post("/checkout/<order_id>/capture")
    def capture_checkout(order_id):
        checkout = owned_checkout(order_id)
        if checkout["capture_id"]:
            flash("This purchase has already earned its farm reward.")
            return redirect(url_for("home"), code=303)
        try:
            order = payments.confirm_order(checkout)
            capture_id = completed_capture_id(order, checkout)
            if not capture_id:
                flash("Payment is awaiting approval or processing. No XP has been added yet.")
                return redirect(url_for("checkout_status", order_id=order_id), code=303)
            awarded = game.settle_checkout(db, checkout, capture_id)
        except (PayPalError, ValueError, sqlite3.IntegrityError) as error:
            app.logger.warning("Sandbox capture could not be verified (%s)", getattr(error, "status", None))
            flash("The purchase couldn’t be verified yet. Try checking this order again.")
            return redirect(url_for("checkout_status", order_id=order_id), code=303)
        if awarded:
            flash(f"Sandbox purchase verified. Your farm earned {checkout['xp']} XP.")
        else:
            flash("This purchase has already earned its farm reward.")
        return redirect(url_for("home"), code=303)

    return app
