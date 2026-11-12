"""Catalog and progression values shared by the farm and its game UI."""

LEVELS = (
    {"number": 1, "xp": 0, "name": "Neglected homestead", "unlock": "Crop beds, Pip the hen, and village orders"},
    {"number": 2, "xp": 15, "name": "Watered garden", "unlock": "Repair the old barn"},
    {"number": 3, "xp": 40, "name": "Wildflower meadow", "unlock": "Wildflower habitat, Clover the cow, and the first demo donation"},
    {"number": 4, "xp": 75, "name": "Orchard grounds", "unlock": "Replant the old orchard"},
    {"number": 5, "xp": 120, "name": "Thriving homestead", "unlock": "Second demo donation"},
)

IMPACT_MILESTONES = (
    {"level": 3, "cents": 500, "cause": "Pollinator habitat", "sponsor": "Alder & Finch Seeds"},
    {"level": 5, "cents": 1000, "cause": "Community orchard planting", "sponsor": "Sunpost Apiary"},
)

GOODS = {
    "wheat": "Wheat",
    "carrot": "Carrots",
    "egg": "Eggs",
    "milk": "Milk",
}

ANIMALS = {
    "hen": {
        "name": "Pip", "kind": "Hen", "level": 1, "feed": "wheat", "product": "egg",
        "output": "an egg", "seconds": 14, "xp": 6,
    },
    "cow": {
        "name": "Clover", "kind": "Cow", "level": 3, "feed": "carrot", "product": "milk",
        "output": "a bottle of milk", "seconds": 22, "xp": 9,
    },
}

VISITORS = {
    "nora": {"name": "Nora", "role": "Farm caretaker"},
    "milo": {"name": "Milo", "role": "Village baker"},
}

REQUESTS = (
    {"visitor": "nora", "title": "First delivery", "goods": {"wheat": 2}, "coins": 12, "xp": 8,
     "line": "Your first wheat will stock the village pantry. I can bring timber money for that old barn."},
    {"visitor": "milo", "title": "Morning bake", "goods": {"carrot": 1, "egg": 1}, "coins": 16, "xp": 12,
     "line": "A carrot and one of Pip’s eggs would make a fine breakfast loaf."},
    {"visitor": "nora", "title": "Market basket", "goods": {"carrot": 2}, "coins": 18, "xp": 13,
     "line": "Could you spare two carrots for the village market? The good ones go fast."},
    {"visitor": "milo", "title": "Milk and grain", "goods": {"milk": 1, "wheat": 1}, "coins": 24, "xp": 16,
     "line": "I’m trying a softer loaf. Can you bring milk from Clover and a handful of wheat?"},
)

REPAIRS = {
    "barn": {
        "name": "Old barn", "level": 2, "coins": 12, "xp": 8,
        "detail": "Replace the damaged shingles, mend the doors, and paint the siding.",
        "complete": "The barn doors swing freely again, and the new shingles are keeping it dry.",
    },
    "orchard": {
        "name": "Old orchard", "level": 4, "coins": 32, "xp": 12,
        "detail": "Clear the old orchard patch and plant young apple trees.",
        "complete": "Two apple trees have taken root along the creek.",
    },
}

# Real organic products from 365 by Whole Foods Market, used for the demo only. The brand has
# not partnered with PlayPen; every place these appear says "partner brand (demo)". Prices are
# Amazon's listed prices on 2026-11-12, and checkout uses PayPal Sandbox test money. ``image`` links to
# the product photo on Amazon's image server (not copied into this repo); ``art`` is the offline fallback.
DEMO_PARTNER_BRAND = "365 by Whole Foods Market"
PARTNER_PRODUCTS = {
    "seed-mix": {
        "name": "Organic Black Chia Seeds, 15 oz", "brand": DEMO_PARTNER_BRAND, "store": "Amazon",
        "price": "9.49", "xp": 8, "art": "product-seeds.png", "asin": "B074HJF6KM",
        "image": "https://m.media-amazon.com/images/I/71b0BRG7F8L._AC_SL500_.jpg",
        "detail": "Organic chia seeds. Counts toward the pollinator habitat campaign in the demo.",
    },
    "rolled-oats": {
        "name": "Organic Old Fashioned Rolled Oats, 18 oz", "brand": DEMO_PARTNER_BRAND, "store": "Amazon",
        "price": "4.29", "xp": 10, "art": "product-oats.png", "asin": "B07NSS4R6R",
        "image": "https://m.media-amazon.com/images/I/8135cG2nleL._AC_SL500_.jpg",
        "detail": "Organic whole-grain rolled oats. A pantry staple with a restoration XP reward.",
    },
    "blossom-honey": {
        "name": "Organic Light Amber Wildflower Honey, 12 oz", "brand": DEMO_PARTNER_BRAND, "store": "Amazon",
        "price": "5.49", "xp": 12, "art": "product-honey.png", "asin": "B074H5BV6W",
        "image": "https://m.media-amazon.com/images/I/61gSX35jtwL._AC_SL500_.jpg",
        "detail": "Organic wildflower honey. Counts toward the community orchard campaign in the demo.",
    },
}


def current_level(xp):
    return next(level for level in reversed(LEVELS) if xp >= level["xp"])


def visitor_request(sequence):
    index = sequence if sequence < 2 else 2 + (sequence - 2) % 2
    return REQUESTS[index]


# Real brands Bramble points out while the player shops in Chrome. They are a demo of how
# partner brands would work and have NOT partnered with PlayPen: every label says so.
# ``match`` lists how the brand appears in product titles; ``case`` keeps short names exact.
DEMO_BRAND_XP = 3
DEMO_BRANDS = {
    "365-whole-foods": {"name": "365 by Whole Foods Market", "match": ["365 by Whole Foods Market", "365 Whole Foods", "Whole Foods Market"],
                        "why": "Whole Foods Market's own brand, with a big organic range."},
    "kind": {"name": "KIND", "match": ["KIND"], "case": True, "why": "Nut bars where you can see the nuts and grains."},
    "rxbar": {"name": "RXBAR", "match": ["RXBAR"], "why": "Protein bars with the ingredient list printed on the front."},
    "larabar": {"name": "Larabar", "match": ["Larabar"], "why": "Fruit-and-nut bars made from a handful of ingredients."},
    "simple-mills": {"name": "Simple Mills", "match": ["Simple Mills"], "why": "Crackers and baking mixes made with almond flour."},
    "siete": {"name": "Siete", "match": ["Siete"], "why": "Grain-free tortilla chips and tortillas."},
    "bobs-red-mill": {"name": "Bob's Red Mill", "match": ["Bob's Red Mill", "Bob’s Red Mill", "Bobs Red Mill"], "why": "Whole grains, oats and flours."},
    "purely-elizabeth": {"name": "Purely Elizabeth", "match": ["Purely Elizabeth"], "why": "Granola and oats made with ancient grains."},
    "banza": {"name": "Banza", "match": ["Banza"], "why": "Pasta made from chickpeas."},
    "madegood": {"name": "MadeGood", "match": ["MadeGood", "Made Good"], "why": "Allergy-friendly granola bars and minis."},
    "lesserevil": {"name": "LesserEvil", "match": ["LesserEvil", "Lesser Evil"], "why": "Popcorn and puffed snacks."},
    "annies": {"name": "Annie's", "match": ["Annie's", "Annie’s"], "why": "Organic mac and cheese, crackers and snacks."},
    "once-upon-a-farm": {"name": "Once Upon a Farm", "match": ["Once Upon a Farm"], "why": "Cold-pressed fruit and veggie pouches."},
}
