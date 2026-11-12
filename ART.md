# PlayPen artwork

The farm map, crop sprites and soil bed were generated for PlayPen using Codex’s built-in image generation tool. The playable UI renders its own text, buttons and game state.

## Game concept

```text
Full 16:10 desktop game UI concept screenshot for PLAYPEN, an original cozy farming sim. Art direction: hand-painted miniature isometric countryside with saturated moss and olive greenery, a faded vermilion barn, teal stream, sunlight, chunky charming 3D illustrated props, refined indie game finish. Entire viewport is farm landscape from edge to edge; no website nav, no hero text, no dashboard. Layout precisely: upper left small warm cream brand and XP plaque 'PlayPen / 0 XP' with short XP meter. Upper right cream little 'Barn' and 'Shop' game buttons. Center open field contains six actual playable square dirt beds aligned in a neat 3 by 2 arrangement, with little seedlings and golden wheat; keep composition coherent. Barn and a farmhouse in the upper middle and left, forest and creek to the right. Bottom left cream floating task card with heading 'First harvest', body 'Plant, water, and harvest your first crop.' and tiny progress '0 / 1'. Bottom center a compact ivory wooden tray with 4 buttons 'Wheat', 'Carrot', 'Water', 'Harvest'; each has one strong pictogram. One clear active gold tool tile. Generous space for scenery. No other copy. Only a concept, product UI text and controls later implemented natively. Strong contrast and credible game HUD. Show entire game screen at high fidelity, landscape 16:10.
```

## Farm map (`playpen/static/art/meadow.jpg`)

```text
Game environment asset, landscape 16:10 ratio, for an original cozy farming simulation. Full bleed bird's-eye three-quarter view of a storybook farm, in warm clear afternoon sunlight. Rich painterly 3D miniature game style with crisp chunky geometry, textured grass and deeply colored mossy green conifers, a prominent weathered vermilion barn near (x 39%, y 29%), small ivory farmhouse with slate teal roof near (x 63%, y 26%), gentle shaded blue-green creek winding down the far right edge, wooden fences and paths tracing the edges, a vegetable cart, wildflowers and rocks around the margins. CRITICAL: reserve a clean, wide rectangle of simple short grass in the foreground center, across x 32 to 70 percent, y 45 to 84 percent, a largely flat green area on which the game will dynamically place six crop beds. No painted crop beds, buildings, paths, shadows or shrubs in this central clearing. Trees cluster mostly far left, top, and right corners, grass/dirt foreground continues to every edge. No horizon or sky, camera looks down at map, grass fills bottom, detailed inviting game world. No graphics or interface, no text, no UI, no characters. Avoid harsh contrast in clearing. Aspect 16:10 landscape.
```

## Crop and tool sprites (`playpen/static/art/*.png`)

```text
Transparent background sprite atlas, 2 by 2 perfectly equal spacious grid, four isolated small crop icons for an original cozy farm game, three-quarter bird’s-eye viewpoint, dimensional hand-painted gouache storybook game art, warm sunlight from upper left. Each quarter contains its own centered sprite with clear ample margins, all at equal visual scale, no parts crossing cell boundaries: top left small lush green seedling cluster with three sets of soft leaves, top right ripe golden wheat sheaf still standing with several stems and blades, bottom left ripe carrots growing with green leaves and hints of orange shoulders, bottom right small galvanized teal watering can. Just these objects, NO dirt base, ground, containers, lettering, grid lines, shadows under object or scenery. Preserve genuinely transparent background and clean alpha around each sprite. Square atlas.
```

## Soil bed (`playpen/static/art/soil.png`)

```text
Transparent sprite for a cozy farming game, a single broad rectangular tillable garden bed of dark rich brown soil, viewed from a three-quarter overhead game camera so front edge appears slightly wider than back and depth is foreshortened, hand-painted gouache miniature 3D game art, textured soil with a few parallel subtle furrows and small rounded soil clumps around the edge, warm light from upper left, no wooden border, no rocks outside, no plants or tools, no text, no UI. A compact soft contact shadow immediately under the bed, no other ground or backdrop. Center this single wide 1.6:1 bed in a landscape canvas with generous transparent margin all around. Preserve transparent alpha.
```

## Wildflower habitat (`playpen/static/art/habitat.png`)

```text
Transparent isolated environment prop sprite for a cozy original farming game. A small restored wildflower and pollinator garden with a single warm ochre wooden beehive at center left, surrounded by vivid blue lupines, cream daisies, lavender and gold blossoms, a few small smooth mossy stones. Low broad composition, slight three-quarter overhead perspective with upper-left sunlight, dimensional hand-painted gouache storybook miniature game art. Garden has a compact footprint with some greenery at its base and irregular organic edges. No dirt rectangle, no base tile, no lettering, no UI, no sky or backdrop, transparent canvas with clean alpha. Props concentrated in center, landscape 4:3.
```

## Damaged barn map (`old-meadow.jpg`)

```text
Edit this exact existing PlayPen game map, 16:10 aspect. Preserve the crop, camera, layout, framing, color, warm daylight, farmhouse, creek, all trees, field, path and every position. Change ONLY the large red barn at center-left and the area immediately adjoining its entrance. Before restoration the old barn has washed-out peeling brick-red paint, patches of exposed grey weathered planks, three broken roof shingles and a few patched boards. One door sags and has a visibly broken lower plank, one window has a boarded corner, some ivy at the foundation, a small fallen plank in front of the doors. It should still read as the same safe cozy farm, with recognizable barn silhouette, muted and weathered compared with original, not ruined or scary. Keep the rest of the scene practically pixel-identical, especially the grass foreground for crop placement. No UI, no text, no additional structures, no people or animals.
```

## Animals, villagers, orchard and timber

```text
Transparent production sprite atlas for the cozy farm game PlayPen. Landscape 3:2 canvas. EXACT 3 columns and 2 rows of identical size, each object centered within its cell with wide fully transparent margins on all sides. Row 1: [white speckled hen with rusty red comb, standing in profile facing right], [Jersey dairy cow, caramel and cream with small brass bell, standing three-quarter facing left], [Nora, kind middle-aged farm caretaker wearing olive green overalls and mustard scarf with brown gardening boots, full-body miniature game figurine, standing three-quarter]. Row 2: [Milo, friendly young village baker with rolled-up ivory sleeves and terra-cotta apron carrying a basket, full-body miniature game figurine, standing three-quarter], [small orchard cluster of two apple trees with red apples, short grass only at the base], [a golden stack of cut wood and planks with a small hammer]. Consistent richly painted gouache textures, dimensional hand-painted storybook 3D props with warm top-left daylight, slightly overhead three-quarter view. No glow, diffuse halo, checkerboard, grid lines, labels, backdrop, landscape, connected elements, or surface shadows beyond the objects. Genuine full transparent alpha outside each object. Six isolated sprites, no additional objects.
```

## Fictional market products (`product-*.png`)

```text
Transparent game inventory sprite atlas, exact 3 equal columns by 1 row, wide landscape 3:1 composition, ample clear margins around each independently centered item. Three plausible fictional retail products for a cozy farm game demo. Left: kraft yellow seed envelope with simple dark green sprout illustration and small hand-drawn floral motif, no words. Middle: cream folded-top paper oats pouch with muted blue horizontal bands and small oat stalk illustration, no words. Right: short dark amber glass honey jar with cream circular label and burnt-orange lid, no words. Dimensional hand-painted storybook gouache art, visibly different silhouettes, coherent lighting from top left. No props, scenery, surface backdrop, halo, grid lines, text, letters or watermark. Use true clean transparent alpha outside the three products.
```


## Valley world map (`playpen/static/art/valley.jpg`)

Generated with ChatGPT image generation on November 9, 2026, for the pannable farm. 1536 × 1024.

```text
Game environment map for an original cozy farm restoration game. Wide landscape 3:2, the largest size available. Bird's-eye three-quarter view of an entire small farm valley, warm late-afternoon sunlight from the upper left, hand-painted gouache storybook miniature style with chunky 3D props and rich moss and olive greens. This is a large world map the player pans across, so keep every building and prop small relative to the canvas, with generous open grass between zones. Zones: upper left, a weathered faded vermilion barn with peeling paint, a few missing shingles and a sagging door, with a packed-dirt yard in front. Upper centre, a small ivory farmhouse with a slate teal roof and a mailbox by its path. Centre, a round clearing of short grass with an old dry stone well in the middle, ringed by a worn footpath. Lower centre and lower left, a broad flat field of plain short grass, completely empty. Right of centre, an empty fenced paddock with a trough. Upper right, a gentle hill with a few bare neglected fruit trees. Far right edge, a teal creek with a small wooden footbridge. Bottom right, a dirt road leaving through a wooden gate, with an empty market stall beside it. Soft dirt footpaths connect every zone. Conifers and wildflowers gather along the outer edges only. Grass continues to every edge of the canvas. No sky, no horizon, no people, no animals, no crop beds, no text, no lettering, no interface elements, no borders.
```

## Valley with the restored barn (`playpen/static/art/valley-restored.jpg`)

An edit of the valley map in the same ChatGPT conversation. The game fades this image in over the first when the barn is repaired.

```text
Edit this exact image. Keep the camera, layout, framing, colours, lighting and every other object pixel-identical. Change ONLY the red barn in the upper left: it has now been lovingly restored. Fresh bright vermilion paint with crisp cream trim, a complete tidy shingle roof with no holes, both doors straight and repaired, clean windows, the lean-to roof mended, and a couple of flower pots by the door. Same barn shape, size and position. Do not add people, animals, text or any new structures. Same 3:2 size.
```

## Bramble the companion (`playpen/static/art/bramble.png`, `bramble-talk.png`)

Generated with ChatGPT image generation on November 10, 2026, as one transparent two-pose atlas, then split and trimmed.

```text
Generate an image with a fully transparent background (PNG with alpha). Transparent game sprite atlas for an original cozy farm restoration game. Landscape 2:1 canvas split into EXACTLY 2 equal columns, one character per cell, each centered with wide transparent margins and nothing crossing the middle. The character is Bramble, a small round friendly hedgehog companion with soft chestnut-brown spines, a cream face and belly, big warm dark eyes, rosy cheeks, and a tiny moss-green satchel with a single leaf badge worn across its body. Left cell: Bramble sitting happily, facing three-quarter right, small paws together. Right cell: Bramble standing up excitedly on hind legs, one paw raised and pointing up and to the right, mouth open as if talking. Dimensional hand-painted gouache storybook miniature game art, warm light from the upper left, matching a painterly farm map. No ground, no shadow plate, no grid lines, no border, no text, no lettering, no background scenery. Clean transparent alpha around both sprites.
```

## Bramble pose sheet (`playpen/static/art/bramble/sheet.png`)

Generated with ChatGPT image generation from the original `bramble.png`, as one transparent 4x2 sprite sheet: idle, blink, talking, happy jump, walking (two steps), thinking and sleeping. The game and the Chrome extension show one cell at a time.
