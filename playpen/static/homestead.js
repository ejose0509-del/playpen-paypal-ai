const byId = (id) => document.getElementById(id);
const { visitors, goods, repairs } = JSON.parse(byId("homestead-content").textContent);
const art = new URL("./art/", import.meta.url);
const animalKinds = ["hen", "cow"];

function text(element, value) {
  value = String(value);
  if (element.textContent !== value) element.textContent = value;
}

function sprite(image, filename) {
  const src = new URL(filename, art).href;
  if (image.src !== src) image.src = src;
}

function paintVisitor(farm) {
  const order = farm.visitor_order;
  const visitor = visitors[order.visitor];
  const actor = byId("world-visitor");
  const panel = byId("visitor-panel");
  sprite(actor.querySelector("img"), `${order.visitor}.png`);
  sprite(panel.querySelector("img"), `${order.visitor}.png`);
  text(actor.querySelector("strong"), visitor.name);
  actor.setAttribute("aria-label", `Talk to ${visitor.name}`);
  text(byId("visitor-name"), visitor.name);
  text(byId("visitor-role"), visitor.role);
  text(byId("visitor-line"), order.line);
  text(byId("visitor-order-title"), order.title);
  text(byId("visitor-reward"), `+${order.coins} coins · +${order.xp} XP`);
  byId("visitor-sequence").value = order.sequence;
  const requirements = Object.entries(order.goods);
  const list = byId("visitor-goods");
  list.replaceChildren(...requirements.map(([item, quantity]) => {
    const entry = document.createElement("li");
    const count = document.createElement("strong");
    count.textContent = `${farm.inventory[item]} / ${quantity}`;
    entry.dataset.ready = String(farm.inventory[item] >= quantity);
    entry.append(`${goods[item]} `, count);
    return entry;
  }));
  const canDeliver = requirements.every(([item, quantity]) => farm.inventory[item] >= quantity);
  const deliver = byId("visitor-deliver");
  deliver.disabled = !canDeliver;
  text(deliver, canDeliver ? "Deliver goods" : "Gather requested goods");
  actor.dataset.ready = String(canDeliver);
}

export function paintAnimals(farm, now) {
  for (const kind of animalKinds) {
    const animal = farm.animals[kind];
    const actor = byId(`world-${kind}`);
    actor.hidden = !animal.unlocked;
    if (!animal.unlocked) continue;
    const seconds = animal.ready_at == null ? null : Math.max(0, Math.ceil(animal.ready_at - now));
    const button = byId(`animal-action-${kind}`);
    const description = byId(`animal-description-${kind}`);
    const status = actor.querySelector("[data-animal-map-status]");
    button.form.elements.action.value = seconds == null ? "feed" : "collect";
    if (seconds == null) {
      const stock = farm.inventory[animal.feed];
      text(description, `Feed ${animal.name} 1 ${animal.feed} to make ${animal.output}. In the barn: ${stock}.`);
      text(button, `Feed ${animal.name}`);
      text(status, "Hungry");
      button.disabled = stock < 1;
    } else if (seconds > 0) {
      text(description, `${animal.name} is making ${animal.output}.`);
      text(button, `Ready in ${seconds}s`);
      text(status, `${seconds}s`);
      button.disabled = true;
    } else {
      text(description, `${animal.name} has ${animal.output} ready for the barn.`);
      text(button, `Collect ${animal.product === "egg" ? "egg" : "milk"}`);
      text(status, "Ready!");
      button.disabled = false;
    }
    actor.dataset.ready = String(seconds === 0);
  }
}

function paintRepairs(farm) {
  const barnRestored = farm.repairs.includes("barn");
  byId("farm-world").dataset.barn = barnRestored ? "restored" : "old";
  text(byId("barn-marker").querySelector("span"), barnRestored ? "Barn restored" : "Old barn");
  byId("barn-marker").dataset.ready = String(!barnRestored && farm.level >= repairs.barn.level && farm.inventory.coins >= repairs.barn.coins);
  byId("world-orchard").hidden = !farm.repairs.includes("orchard");
  text(byId("repair-coins"), farm.inventory.coins);
  for (const row of document.querySelectorAll("[data-repair]")) {
    const key = row.dataset.repair;
    const repair = repairs[key];
    const complete = farm.repairs.includes(key);
    const button = row.querySelector("[data-repair-button]");
    text(row.querySelector("[data-repair-detail]"), complete ? repair.complete : repair.detail);
    text(row.querySelector("[data-repair-status]"), complete ? "Repair complete" : `Level ${repair.level} · ${repair.coins} coins · +${repair.xp} XP`);
    if (complete) text(button, "Restored");
    else if (farm.level < repair.level) text(button, `Unlocks at Level ${repair.level}`);
    else if (farm.inventory.coins < repair.coins) text(button, `Need ${repair.coins - farm.inventory.coins} more coins`);
    else text(button, `Restore for ${repair.coins} coins`);
    button.disabled = complete || farm.level < repair.level || farm.inventory.coins < repair.coins;
  }
}

export function paintHomestead(farm, now) {
  text(byId("farm-level"), `Level ${farm.level}`);
  paintVisitor(farm);
  paintAnimals(farm, now);
  paintRepairs(farm);
  for (const row of document.querySelectorAll("[data-farm-level]")) {
    const number = Number(row.dataset.farmLevel);
    if (number === farm.level) row.setAttribute("aria-current", "step");
    else row.removeAttribute("aria-current");
    row.dataset.unlocked = String(number <= farm.level);
  }
  for (const row of document.querySelectorAll("[data-impact-level]")) {
    const recorded = farm.donations.some((entry) => entry.level === Number(row.dataset.impactLevel));
    row.dataset.recorded = String(recorded);
    text(row.querySelector("[data-impact-status]"), recorded ? "Demo recorded" : "Upcoming");
  }
  for (const button of document.querySelectorAll("[data-demo-sku]")) {
    button.disabled = farm.demo_purchases.includes(button.dataset.demoSku);
    text(button, button.disabled ? "Demo recorded" : "Simulate purchase");
  }
}

// The first recorded demo donation the player hasn't celebrated at the well yet.
export function pendingDonation(farm) {
  return farm.donations.find((entry) => !entry.celebrated) || null;
}

export function nextQuest(farm) {
  const gift = pendingDonation(farm);
  if (gift) {
    return {
      title: "A gift for the valley",
      instruction: `${gift.sponsor} is giving $${(gift.cents / 100).toFixed(2)}. Tap the old well to celebrate.`,
      target: "well-marker",
      progress: 100,
      count: "Ready",
    };
  }
  const order = farm.visitor_order;
  if (order.sequence === 0) {
    const gathered = Math.min(farm.inventory.wheat, order.goods.wheat);
    return {
      title: "Nora’s first order",
      instruction: gathered === order.goods.wheat ? "Tap Nora to deliver your wheat." : "Harvest two wheat for Nora and earn repair coins.",
      target: gathered === order.goods.wheat ? "world-visitor" : "field",
      progress: gathered / order.goods.wheat * 100,
      count: `${gathered} / ${order.goods.wheat} wheat`,
    };
  }
  if (!farm.repairs.includes("barn")) {
    const coins = Math.min(farm.inventory.coins, repairs.barn.coins);
    return {
      title: "Fix up the barn",
      instruction: coins === repairs.barn.coins ? "Tap the old barn to begin repairs." : "Fill village orders to earn timber money.",
      target: coins === repairs.barn.coins ? "barn-marker" : "world-visitor",
      progress: coins / repairs.barn.coins * 100,
      count: `${coins} / ${repairs.barn.coins} coins`,
    };
  }
  if (order.sequence === 1) {
    const egg = farm.inventory.egg > 0;
    return {
      title: "Milo’s breakfast loaf",
      instruction: egg ? "Deliver an egg and a carrot to Milo." : "Feed Pip wheat and collect an egg for Milo.",
      target: egg ? (farm.inventory.carrot > 0 ? "world-visitor" : "field") : "world-hen",
      progress: (Number(egg) + Number(farm.inventory.carrot > 0)) * 50,
      count: `${Number(egg) + Number(farm.inventory.carrot > 0)} / 2 goods`,
    };
  }
  if (!farm.repairs.includes("orchard")) {
    const canRestore = farm.level >= repairs.orchard.level && farm.inventory.coins >= repairs.orchard.coins;
    return {
      title: "Bring back the orchard",
      instruction: canRestore ? "Tap the barn to replant the orchard." : "Reach Level 4 and earn 32 coins from orders.",
      target: canRestore ? "barn-marker" : "world-visitor",
      progress: Math.min(farm.inventory.coins / repairs.orchard.coins, 1) * 100,
      count: `${Math.min(farm.inventory.coins, repairs.orchard.coins)} / ${repairs.orchard.coins} coins`,
    };
  }
  return {
    title: farm.next_level_xp ? "Grow the homestead" : "A thriving homestead",
    instruction: farm.next_level_xp ? "Keep filling orders to reach the next farm level." : "Open Farm levels to see both donations.",
    progress: farm.next_level_xp ? Math.min(farm.xp / farm.next_level_xp, 1) * 100 : 100,
    count: farm.next_level_xp ? `${farm.xp} / ${farm.next_level_xp} XP` : "Level 5 reached",
  };
}
