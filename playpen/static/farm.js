import { createCamera } from "./camera.js";
import { createCompanion } from "./companion.js";
import { nextQuest, paintAnimals, paintHomestead, pendingDonation } from "./homestead.js";

const game = document.querySelector("#farm-game");
const viewport = document.querySelector("#farm-viewport");
const world = document.querySelector("#farm-world");
const field = [...game.querySelectorAll(".plot")];
const picker = document.querySelector("#seed-picker");
const flyLayer = document.querySelector("#fly-layer");
const arrow = document.querySelector("#guide-arrow");
const byId = (id) => document.getElementById(id);
const art = new URL("./art/", import.meta.url).href;
const calm = matchMedia("(prefers-reduced-motion: reduce)");

const camera = createCamera(viewport, world, { width: 1536, height: 1024, home: { x: 531, y: 600 } });

const companion = createCompanion({ csrf: game.dataset.csrf, url: game.dataset.companionUrl });

let farm = JSON.parse(byId("farm-state").textContent);
let clockOffset = farm.now * 1000 - Date.now();
let feedbackTimer;
let feedbackElement;
let sweep = null;
let suppressClick = false;
let pickerPlot = null;
let questTarget = null;

const queue = [];
const pending = new Set();
let running = false;

function now() {
  return (Date.now() + clockOffset) / 1000;
}

function plotStatus(plot) {
  if (!plot.crop) return { stage: "empty", label: "Empty" };
  if (plot.ready_at == null) return { stage: "dry", label: "Thirsty", sprite: "seedling" };
  const seconds = Math.max(0, Math.ceil(plot.ready_at - now()));
  if (seconds) return { stage: "growing", label: `${seconds}s`, sprite: "seedling" };
  return { stage: "ready", label: "Ready!", sprite: plot.crop };
}

// What a touch on this bed would do right now.
function actionFor(button) {
  const stage = plotStatus(farm.plots[field.indexOf(button)]).stage;
  return { empty: "plant", dry: "water", ready: "harvest" }[stage] || null;
}

function paintPlots() {
  for (const [index, button] of field.entries()) {
    const plot = farm.plots[index];
    const status = plotStatus(plot);
    const crop = button.querySelector(".plot-crop");
    const label = button.querySelector(".plot-label");
    if (button.dataset.stage !== status.stage || button.dataset.crop !== (plot.crop || "")) {
      button.dataset.stage = status.stage;
      button.dataset.crop = plot.crop || "";
      crop.hidden = !status.sprite;
      crop.style.backgroundImage = status.sprite ? `url("${art}${status.sprite}.png")` : "";
      button.querySelector(".plot-plus").hidden = status.stage !== "empty";
      label.hidden = status.stage === "empty" || status.stage === "ready";
    }
    if (label.textContent !== status.label) label.textContent = status.label;
    const description = `Bed ${plot.number}, ${plot.crop ? plot.crop + ", " : ""}${status.stage === "growing" ? "growing" : status.label}`;
    if (button.getAttribute("aria-label") !== description) button.setAttribute("aria-label", description);
  }
}

function paintFarm() {
  byId("farm-xp").textContent = `${farm.xp} XP`;
  byId("farm-progress").max = farm.next_level_xp ? farm.next_level_xp - farm.level_start : 1;
  byId("farm-progress").value = farm.next_level_xp ? farm.xp - farm.level_start : 1;
  byId("farm-stage").textContent = farm.stage;
  byId("hud-coins").textContent = farm.inventory.coins;
  byId("wildflower-habitat").hidden = !farm.milestone;
  byId("milestone-note").textContent = farm.milestone
    ? "Wildflower habitat impact milestone unlocked."
    : `Wildflower habitat unlocks at ${farm.milestone_xp} XP.`;
  for (const [crop, count] of Object.entries(farm.inventory)) {
    byId(`stock-${crop}`).textContent = count;
  }
  const gift = pendingDonation(farm);
  byId("well-marker").dataset.ready = String(Boolean(gift));
  byId("well-label").textContent = gift ? "Gift ready!" : "Old well";
  paintHomestead(farm, now());
}

// The well ceremony: pan to the well, drop a coin in, then show who gave what.
const WELL = { x: 656, y: 452 };
const { impact } = JSON.parse(byId("homestead-content").textContent);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, calm.matches ? 0 : ms));

async function celebrate(gift) {
  const result = await post(`/farm/donations/${gift.level}/celebrate`, new FormData());
  if (!result.ok) {
    feedback(result.message, false);
    return;
  }
  const scene = byId("well-ceremony");
  camera.lock(true);
  camera.centerOn(WELL.x, WELL.y + 60, { nextScale: Math.max(camera.scale, 1.15) });
  companion.mood("think");
  await pause(600);
  scene.hidden = false;
  scene.classList.remove("play");
  void scene.offsetWidth; // restart the CSS animations
  scene.classList.add("play");
  await pause(1700);
  companion.react("level");
  companion.say("The whole valley felt that one!", 4000);

  const given = farm.donations.reduce((sum, entry) => sum + entry.cents, 0);
  const possible = impact.reduce((sum, entry) => sum + entry.cents, 0);
  const next = impact.find((entry) => !farm.donations.some((done) => done.level === entry.level));
  byId("donation-level").textContent = `Level ${gift.level} milestone`;
  byId("donation-amount").textContent = `$${(gift.cents / 100).toFixed(2)}`;
  byId("donation-sponsor").textContent = gift.sponsor;
  byId("donation-cause").textContent = gift.cause.toLowerCase();
  byId("donation-total").textContent = next
    ? `$${(given / 100).toFixed(2)} of $${(possible / 100).toFixed(2)} given so far. Next: ${next.cause.toLowerCase()} at Level ${next.level}.`
    : `All $${(possible / 100).toFixed(2)} in demo donations given. Thank you for restoring the valley.`;
  game.querySelector("dialog[open]")?.close();
  byId("donation-card").showModal();
  camera.lock(false);
}

byId("well-marker").addEventListener("click", () => {
  closePicker();
  const gift = pendingDonation(farm);
  if (!gift) {
    game.querySelector("dialog[open]")?.close();
    byId("level-road").showModal();
    return;
  }
  queue.push(() => celebrate(gift).catch((error) => feedback(error.message, false)));
  drain();
});
byId("donation-card").addEventListener("close", () => {
  byId("well-ceremony").classList.remove("play");
  byId("well-ceremony").hidden = true;
});

function firstPlot(...stages) {
  for (const stage of stages) {
    const match = field.find((button) => button.dataset.stage === stage && !pending.has(button));
    if (match) return match;
  }
  return null;
}

function paintQuest() {
  let quest;
  if (farm.has_harvested) {
    quest = nextQuest(farm);
  } else {
    quest = { title: "First harvest", progress: 0, count: "0 / 1", target: "field" };
    if (firstPlot("ready")) quest.instruction = "Swipe across the ripe crops to harvest.";
    else if (firstPlot("dry")) quest.instruction = "Swipe across the seedlings to water them.";
    else if (firstPlot("growing")) quest.instruction = "Your crops are growing. Plant more while you wait.";
    else quest.instruction = "Tap an empty bed, then drag a seed across the field.";
  }
  const name = byId("quest-name");
  const hint = byId("quest-instruction");
  if (name.textContent !== quest.title) name.textContent = quest.title;
  if (hint.textContent !== quest.instruction) hint.textContent = quest.instruction;
  byId("quest-count").textContent = quest.count;
  byId("quest-fill").style.width = `${quest.progress}%`;

  const target = quest.target === "field" ? firstPlot("ready", "dry", "empty") : quest.target ? byId(quest.target) : null;
  const visible = target && !target.hidden ? target : null;
  if (visible !== questTarget) {
    questTarget = visible;
    arrow.hidden = !visible;
    if (visible) {
      const box = visible.getBoundingClientRect();
      const origin = world.getBoundingClientRect();
      arrow.style.left = `${(box.left + box.width / 2 - origin.left) / camera.scale}px`;
      arrow.style.top = `${(box.top - origin.top) / camera.scale}px`;
    }
  }
}

function feedback(message, success) {
  const status = game.querySelector("dialog[open] [data-feedback]") || byId("game-feedback");
  if (feedbackElement && feedbackElement !== status) {
    feedbackElement.textContent = "";
    if (feedbackElement.hasAttribute("data-feedback")) feedbackElement.hidden = true;
  }
  feedbackElement = status;
  status.textContent = message;
  status.dataset.success = String(success);
  status.hidden = false;
  clearTimeout(feedbackTimer);
  if (!status.hasAttribute("data-feedback")) {
    feedbackTimer = setTimeout(() => { status.textContent = ""; }, 4000);
  }
}

// One request at a time, in the order the player touched things.
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) await queue.shift()();
  running = false;
}

async function post(url, body) {
  const before = { xp: farm.xp, level: farm.level, donations: new Set(farm.donations.map((entry) => entry.level)) };
  body.set("csrf", game.dataset.csrf);
  const response = await fetch(url, { method: "POST", body });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("The farm session has expired. Reload to continue.");
  }
  const data = await response.json();
  if (data.state) {
    farm = data.state;
    clockOffset = farm.now * 1000 - Date.now();
    paintPlots();
    paintFarm();
    paintQuest();
  }
  let news = "";
  if (response.ok && farm.level > before.level) news += ` Level ${farm.level} reached!`;
  if (response.ok) {
    for (const entry of farm.donations.filter((item) => !before.donations.has(item.level))) {
      news += ` A $${(entry.cents / 100).toFixed(2)} demo donation is waiting at the well.`;
    }
  }
  return { ok: response.ok, message: data.message, news, gained: farm.xp - before.xp };
}

function burst(button, words) {
  const element = button.querySelector(".plot-burst");
  element.textContent = words;
  for (const animation of element.getAnimations()) animation.cancel();
  if (calm.matches) return;
  element.animate(
    [{ opacity: 0, transform: "translate(-50%, 6px) scale(.86)" },
      { opacity: 1, transform: "translate(-50%, -8px) scale(1)", offset: .22 },
      { opacity: 0, transform: "translate(-50%, -30px)" }],
    { duration: 950, easing: "ease-out" },
  );
}

function flyToBarn(button, crop) {
  if (calm.matches) return;
  const from = button.getBoundingClientRect();
  const to = byId("barn-button").getBoundingClientRect();
  const frame = flyLayer.getBoundingClientRect();
  const sprite = document.createElement("img");
  sprite.src = `${art}${crop}.png`;
  sprite.className = "fly";
  flyLayer.append(sprite);
  const start = { x: from.left + from.width / 2 - frame.left, y: from.top + from.height / 3 - frame.top };
  const end = { x: to.left + to.width / 2 - frame.left, y: to.top + to.height / 2 - frame.top };
  const lift = Math.min(start.y, end.y) - 70;
  sprite.animate(
    [{ transform: `translate(${start.x}px, ${start.y}px) translate(-50%, -50%) scale(1)`, opacity: 1 },
      { transform: `translate(${(start.x + end.x) / 2}px, ${lift}px) translate(-50%, -50%) scale(1.15)`, opacity: 1, offset: .5 },
      { transform: `translate(${end.x}px, ${end.y}px) translate(-50%, -50%) scale(.45)`, opacity: .2 }],
    { duration: 720, easing: "cubic-bezier(.3, 0, .4, 1)" },
  ).finished.then(() => {
    sprite.remove();
    byId("barn-button").animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "ease-out" },
    );
  });
}

// Little particle effects on a bed. They live in world space, so they pan and zoom with the farm.
function fxLayer(button) {
  let layer = button.querySelector(".plot-fx");
  if (!layer) {
    layer = document.createElement("span");
    layer.className = "plot-fx";
    layer.setAttribute("aria-hidden", "true");
    button.append(layer);
  }
  return layer;
}

function particle(layer, className, keyframes, options) {
  const node = document.createElement(className === "fx-can" || className === "fx-pop" ? "img" : "i");
  node.className = className;
  layer.append(node);
  node.animate(keyframes, { fill: "forwards", ...options }).finished.then(() => node.remove());
  return node;
}

const spread = (index, count, from, to) => from + (to - from) * (index / Math.max(1, count - 1));

function waterFx(button) {
  button.classList.add("wet");
  clearTimeout(button.wetTimer);
  button.wetTimer = setTimeout(() => button.classList.remove("wet"), 2600);
  if (calm.matches) return;
  const layer = fxLayer(button);
  const width = button.offsetWidth;
  const can = particle(layer, "fx-can", [
    { transform: "translate(-6px, 4px) rotate(0deg)", opacity: 0 },
    { transform: "translate(0, 0) rotate(-38deg)", opacity: 1, offset: 0.2 },
    { transform: "translate(6px, -2px) rotate(-42deg)", opacity: 1, offset: 0.8 },
    { transform: "translate(10px, 4px) rotate(0deg)", opacity: 0 },
  ], { duration: 1400, easing: "ease-in-out" });
  can.src = `${art}water.png`;
  can.style.left = `${width * 0.05}px`;
  for (let i = 0; i < 9; i += 1) {
    const x = spread(i, 9, width * 0.3, width * 0.85);
    const drop = particle(layer, "fx-drop", [
      { transform: `translate(${width * 0.3}px, 26px) scale(.6)`, opacity: 0 },
      { transform: `translate(${(x + width * 0.3) / 2}px, 18px) scale(1)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${x}px, ${54 + (i % 3) * 6}px) scale(.8, 1.2)`, opacity: 0.2 },
    ], { duration: 560, delay: 180 + i * 70, easing: "cubic-bezier(.4,0,.9,.6)" });
    drop.style.opacity = "0";
  }
  for (let i = 0; i < 2; i += 1) {
    const ring = particle(layer, "fx-ring", [
      { transform: `translate(${width * 0.55 - 20}px, 62px) scale(.3)`, opacity: 0.9 },
      { transform: `translate(${width * 0.55 - 20}px, 62px) scale(1.6)`, opacity: 0 },
    ], { duration: 700, delay: 600 + i * 220, easing: "ease-out" });
    ring.style.opacity = "0";
  }
}

function plantFx(button) {
  if (calm.matches) return;
  const layer = fxLayer(button);
  const width = button.offsetWidth;
  for (let i = 0; i < 7; i += 1) {
    const angle = spread(i, 7, -2.6, -0.5);
    const dirt = particle(layer, "fx-dirt", [
      { transform: `translate(${width / 2}px, 60px) scale(1)`, opacity: 1 },
      { transform: `translate(${width / 2 + Math.cos(angle) * 30}px, ${60 + Math.sin(angle) * 24}px) scale(.8)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${width / 2 + Math.cos(angle) * 40}px, 66px) scale(.4)`, opacity: 0 },
    ], { duration: 520, easing: "cubic-bezier(.2,.7,.4,1)" });
    dirt.style.opacity = "0";
  }
  const crop = button.querySelector(".plot-crop");
  crop.animate([{ transform: "scale(.2) translateY(40%)" }, { transform: "scale(.7) translateY(16%)" }, { transform: "scale(.62) translateY(20%)" }],
    { duration: 480, easing: "cubic-bezier(.3,1.6,.5,1)" });
}

function harvestFx(button, crop) {
  if (calm.matches) return;
  const layer = fxLayer(button);
  const width = button.offsetWidth;
  const pop = particle(layer, "fx-pop", [
    { transform: `translate(${width / 2 - 28}px, 30px) scale(.8) rotate(0)`, opacity: 1 },
    { transform: `translate(${width / 2 - 28}px, -18px) scale(1.25) rotate(-12deg)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${width / 2 - 28}px, -10px) scale(.6) rotate(10deg)`, opacity: 0 },
  ], { duration: 520, easing: "cubic-bezier(.2,.8,.3,1)" });
  pop.src = `${art}${crop}.png`;
  for (let i = 0; i < 10; i += 1) {
    const angle = (Math.PI * 2 * i) / 10;
    const kind = i % 2 ? "fx-leaf" : "fx-spark";
    const bit = particle(layer, kind, [
      { transform: `translate(${width / 2}px, 40px) rotate(0) scale(1)`, opacity: 1 },
      { transform: `translate(${width / 2 + Math.cos(angle) * 46}px, ${40 + Math.sin(angle) * 34 - 10}px) rotate(${i * 50}deg) scale(1.1)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${width / 2 + Math.cos(angle) * 56}px, ${52 + Math.sin(angle) * 34}px) rotate(${i * 80}deg) scale(.5)`, opacity: 0 },
    ], { duration: 720, easing: "cubic-bezier(.2,.7,.4,1)" });
    bit.style.opacity = "0";
  }
  button.animate([{ transform: "scale(1)" }, { transform: "scale(1.06, .92)" }, { transform: "scale(1)" }], { duration: 300, easing: "ease-out" });
}

function workPlot(button, tool) {
  if (pending.has(button)) return;
  pending.add(button);
  button.dataset.pending = "true";
  queue.push(async () => {
    const crop = button.dataset.crop;
    const data = new FormData();
    data.set("tool", tool);
    try {
      const result = await post(button.dataset.actionUrl, data);
      if (result.ok) {
        if (tool === "harvest") {
          companion.react("harvest");
          burst(button, `+${result.gained} XP`);
          harvestFx(button, crop);
          setTimeout(() => flyToBarn(button, crop), calm.matches ? 0 : 260);
        } else if (tool === "water") {
          waterFx(button);
          burst(button, "Watered");
        } else {
          plantFx(button);
          burst(button, "Planted");
        }
        if (result.news) feedback(result.news.trim(), true);
      } else {
        feedback(result.message, false);
      }
    } catch (error) {
      feedback(error.message || "Couldn’t reach the farm. Try again.", false);
    } finally {
      pending.delete(button);
      delete button.dataset.pending;
    }
  });
  drain();
}

function submitForm(form) {
  queue.push(async () => {
    form.setAttribute("aria-busy", "true");
    try {
      const result = await post(form.getAttribute("action"), new FormData(form));
      feedback(result.message + result.news, result.ok);
    } catch (error) {
      feedback(error.message || "Couldn’t reach the farm. Try again.", false);
    } finally {
      form.removeAttribute("aria-busy");
    }
  });
  drain();
}

function closePicker() {
  picker.hidden = true;
  pickerPlot = null;
}

function openPicker(button) {
  const box = button.getBoundingClientRect();
  const frame = game.getBoundingClientRect();
  pickerPlot = button;
  picker.hidden = false;
  picker.style.left = `${Math.min(frame.width - 90, Math.max(90, box.left + box.width / 2 - frame.left))}px`;
  picker.style.top = `${Math.max(96, box.top - frame.top)}px`;
}

function plotAt(x, y) {
  return document.elementFromPoint(x, y)?.closest?.(".plot") || null;
}

function startSweep(event, tool) {
  sweep = { tool, pointerId: event.pointerId, touched: 0, x: event.clientX, y: event.clientY };
  camera.lock(true);
  game.dataset.sweeping = tool;
}

for (const button of field) {
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const tool = actionFor(button);
    if (tool !== "water" && tool !== "harvest") return;
    closePicker();
    startSweep(event, tool);
    sweep.touched += 1;
    suppressClick = true;
    workPlot(button, tool);
  });
  button.addEventListener("click", () => {
    if (suppressClick) return;
    const tool = actionFor(button);
    if (tool === "plant") {
      if (pickerPlot === button) closePicker();
      else openPicker(button);
    } else if (tool) {
      workPlot(button, tool);
    } else {
      feedback(`Ready in ${button.querySelector(".plot-label").textContent}.`, true);
    }
  });
}

for (const seed of picker.querySelectorAll("[data-seed]")) {
  seed.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    startSweep(event, seed.dataset.seed);
    sweep.anchor = pickerPlot;
  });
  // Keyboard and assistive activation, which sends no pointer events.
  seed.addEventListener("click", (event) => {
    if (event.detail === 0 && pickerPlot) {
      workPlot(pickerPlot, seed.dataset.seed);
      closePicker();
    }
  });
}

window.addEventListener("pointermove", (event) => {
  if (!sweep || event.pointerId !== sweep.pointerId) return;
  const wanted = sweep.tool === "water" || sweep.tool === "harvest" ? sweep.tool : "plant";
  // A fast swipe reports few positions, so walk the line between them.
  const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - sweep.x, event.clientY - sweep.y) / 14));
  for (let step = 1; step <= steps; step += 1) {
    const button = plotAt(
      sweep.x + (event.clientX - sweep.x) * step / steps,
      sweep.y + (event.clientY - sweep.y) * step / steps,
    );
    if (!button || pending.has(button) || actionFor(button) !== wanted) continue;
    sweep.touched += 1;
    workPlot(button, sweep.tool);
  }
  sweep.x = event.clientX;
  sweep.y = event.clientY;
});

function endSweep(event) {
  if (!sweep || event.pointerId !== sweep.pointerId) return;
  if (sweep.anchor) {
    if (!sweep.touched && actionFor(sweep.anchor) === "plant") workPlot(sweep.anchor, sweep.tool);
    closePicker();
  }
  sweep = null;
  delete game.dataset.sweeping;
  camera.lock(false);
  setTimeout(() => { suppressClick = false; }, 0);
}
window.addEventListener("pointerup", endSweep);
window.addEventListener("pointercancel", endSweep);

viewport.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".plot")) closePicker();
});

for (const form of game.querySelectorAll("form[data-farm-action]")) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitForm(form);
  });
}
for (const button of game.querySelectorAll("[data-dialog]")) {
  button.addEventListener("click", () => {
    closePicker();
    game.querySelector("dialog[open]")?.close();
    byId(button.dataset.dialog).showModal();
  });
}
for (const panel of game.querySelectorAll("dialog")) {
  panel.addEventListener("close", () => {
    const status = panel.querySelector("[data-feedback]");
    if (status) {
      status.hidden = true;
      status.textContent = "";
    }
  });
}
for (const button of game.querySelectorAll("[data-zoom]")) {
  button.addEventListener("click", () => camera.zoomBy(Number(button.dataset.zoom)));
}
byId("quest").addEventListener("click", () => {
  if (!questTarget) return;
  const box = questTarget.getBoundingClientRect();
  const origin = world.getBoundingClientRect();
  camera.centerOn(
    (box.left + box.width / 2 - origin.left) / camera.scale,
    (box.top + box.height / 2 - origin.top) / camera.scale,
  );
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePicker();
});

// Tap a critter and it hops. They are decoration only.
for (const critter of game.querySelectorAll(".critter")) {
  critter.addEventListener("click", () => {
    critter.classList.remove("boing");
    void critter.offsetWidth;
    critter.classList.add("boing");
    setTimeout(() => critter.classList.remove("boing"), 650);
  });
}

paintPlots();
paintFarm();
paintQuest();
setInterval(() => {
  if (!document.hidden) {
    paintPlots();
    paintAnimals(farm, now());
    paintQuest();
  }
}, 250);
