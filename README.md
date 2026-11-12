# PlayPen

A farm restoration game with a Python and SQLite backend. Grow crops, raise animals, fulfill village orders, and use the proceeds to rebuild the homestead. A browser session identifies your farm, and its crops, inventory, and progress are stored on disk in `instance/playpen.sqlite3`.

## Run locally

Requires Python 3.9 or newer.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -m playpen
```

Open [http://localhost:8000](http://localhost:8000). Drag to move around the valley and pinch or scroll to zoom. Tap an empty bed and drag a seed across the field to plant, swipe across the seedlings to water them, then swipe across ripe crops to harvest. Wheat takes 12 seconds and earns 5 XP. Carrots take 22 seconds and earn 8 XP.

1. Harvest two wheat and deliver them to Nora to reach Level 2 and earn 12 coins. Tap the old barn and use the coins to restore it.
2. Grow more wheat for Pip, then collect an egg. Give Milo an egg and a carrot. At Level 3 the wildflower habitat and Clover the cow appear. Clover eats a carrot and produces milk.
3. Fill more orders and reach Level 4 to replant the orchard for 32 coins. Tap the level display to see all five levels and the donation history.
4. Open Shop and simulate a purchase from one of the fictional partners. Each demo offer can earn XP once. The listed dollar prices are illustrative. PayPal Sandbox checkout is a separate optional test inside the shop.

Level 3 (40 XP) and Level 5 (120 XP) automatically record simulated sponsor donations of $5 and $10. These records are created once per farm and no funds are moved. When a donation is recorded the old well glows and the goal card points to it. Tap the well to drop a coin in and see who gave what to which cause. Each donation is celebrated once and grants no extra XP. Barn inventory, coins, delivered orders, repairs, and demo purchases persist. The Farm journal in the Barn also has a daily bonus.

### Farm ledger

Open **Barn → Open the farm ledger** (or visit `/ledger`) to see every XP reward, PayPal Sandbox order and demo donation your farm has recorded, with totals. The table uses [AG Grid Community](https://www.ag-grid.com/) (v32.3.3, loaded from jsDelivr) for sorting, filtering by type and search. The data comes from the server's reward ledger at `/farm/ledger`.

## Talk to Bramble, the AI companion

Bramble the hedgehog sits in the corner of the farm. Tap Bramble to chat. Replies come from Claude (`claude-opus-5-5`) through the Anthropic API. Each request includes a summary of your farm from the server, such as crops, animals, coins and the current order, so Bramble can suggest the next step. The conversation is stored per farm in SQLite.

To enable it, add `ANTHROPIC_API_KEY=` with your key to `.env` and restart PlayPen. Without a key the game still works and Bramble says it is napping. Requests use server-side refusal fallbacks (`fallbacks: "default"`), and each farm is limited to 40 messages an hour.

### Shopping with Bramble

Open **Shop → Go shopping with Bramble** (or visit `/market`). Willow Lane Market is a fictional store that shows how Bramble would ride along on a real shopping site as a browser extension. Bramble scans the page and tags the demo partner products: three real organic products from 365 by Whole Foods Market (chia seeds, rolled oats and wildflower honey, at Amazon's listed prices on Nov 12, 2026). 365 by Whole Foods Market has not partnered with PlayPen; it is shown as a partner brand for the demo. The scan reads the page's product markup and is not an AI call.

Ask Bramble to buy a partner product and Claude calls a `start_sandbox_checkout` tool. The server creates a PayPal Sandbox order and the chat shows an **Approve in PayPal Sandbox** button. Bramble can't approve or pay. You sign in with a Sandbox test buyer and confirm, just like the Shop checkout. Each partner product earns its XP once, whether you simulate the purchase or buy it in Sandbox.

### Bramble in Chrome

The `extension/` folder is a Chrome extension that lets Bramble follow you around the web. Bramble wanders along the bottom of every tab, hops in from the side when you switch tabs, and can be dragged anywhere. On Amazon, Bramble marks organic products with a 🌿 **Organic** badge and highlights a demo list of healthy brands (365 by Whole Foods Market, KIND, RXBAR, Larabar, Simple Mills and others) labeled **Partner brand (demo)**, then offers a tour that walks to each one. Ask Bramble to "show me organic granola on Amazon" and it opens that Amazon search in your tab (a `browse_amazon` tool) and reports what it found when the page loads. Bramble itself is an animated SVG (`bramble-rig.js`, shared with the game) that blinks, follows your pointer with its eyes, walks, talks, waves, sniffs and naps. These are real brands shown to demonstrate how partner brands would work. They have not partnered with PlayPen. Spotting each brand earns 3 farm XP once.

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, select **Load unpacked**, and choose the `extension` folder.
2. Open your PlayPen farm in the same browser once. The page shares a private farm token with the extension.
3. Search Amazon for something like "healthy snacks" or "granola bars".

Click Bramble to chat. Chat in Chrome uses the same Claude companion, plus a `search_products` tool backed by [Channel3](https://channel3.ai/docs/). Channel3 is strongest for home, kitchen and wellness gear (try "Find a reusable lunch box"). Add `CHANNEL3_API_KEY=` to `.env` to enable it.

### Deploy to Render

`render.yaml` is a Render Blueprint. In Render, choose **New → Blueprint** and select this repository, then fill in the secret keys when prompted. PlayPen uses Render's `RENDER_EXTERNAL_URL` as its public address. The free plan's disk is temporary, so farms reset when the service restarts.

## Try a PayPal Sandbox purchase

1. In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/), find a **Sandbox** REST app. Under [Sandbox Accounts](https://developer.paypal.com/dashboard/accounts), open **⋯ → View/Edit Account** on a **Personal** account. The profile shows its generated email and password. This is the buyer login. The app's Sandbox Business account receives the test payment.
2. Enter the Sandbox app's client ID and secret in `.env`. If the file is missing, copy `.env.example` to `.env` first. Restart PlayPen. The `.env` file is excluded from Git.
3. Open **Barn → Farm journal** to complete the daily task for 15 XP. Select **Wildflower seeds** in the **Shop** and approve the purchase with the sandbox buyer.
4. After PayPal sends you back, select **Confirm sandbox purchase**. A completed USD 3 test payment grants 25 XP and unlocks Wildflower habitat at 40 XP. If capture is still processing, open the order and check again.
5. Return to the order and try confirming again. The purchase can grant XP only once.

The integration uses the [PayPal Orders API](https://developer.paypal.com/api/rest/integration/orders-api) and always calls the Sandbox endpoint. The server sets the product and price, checks the order against the farm, verifies the completed capture and amount, and grants rewards in the same database transaction that records the capture. You can reopen an order after a dropped response.

## Double-check the foundation

```sh
python -m unittest discover -s tests -v
```

These checks use a temporary database and simulated PayPal responses. Run the Sandbox walkthrough above to check real authorization and capture with your developer credentials.

The impact milestones record demo donations in the game. Live sponsor funding and payout execution are separate future integrations. The checkout currently confirms on return or manual recheck. Automatic reconciliation of later refunds will need a verified webhook endpoint.
