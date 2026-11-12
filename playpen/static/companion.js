// Bramble: the companion on the HUD, with an AI chat panel.

const byId = (id) => document.getElementById(id);
const art = new URL("./art/", import.meta.url).href;

export function createCompanion({ csrf, url, place = "farm" }) {
  const pet = byId("pet");
  const petArt = byId("pet-art");
  const badge = byId("pet-badge");
  const bubble = byId("pet-bubble");
  const chat = byId("chat");
  const log = byId("chat-log");
  const form = byId("chat-form");
  const input = byId("chat-input");
  let loaded = false;
  let waiting = false;
  let moodTimer;
  let bubbleTimer;

  // Bramble is an animated SVG (bramble-rig.js); the painted picture is the fallback.
  const rig = window.BrambleRig ? window.BrambleRig.create() : null;
  if (rig) {
    const style = document.createElement("style");
    style.textContent = window.BrambleRig.css;
    document.head.append(style);
    petArt.append(rig.el);
    pet.classList.add("rigged");
  } else {
    petArt.append(Object.assign(document.createElement("img"), { src: petArt.dataset.fallback || `${art}bramble.png`, alt: "" }));
  }
  const rigState = { talk: "talk", think: "think", hop: "happy", idle: "idle" };
  // Little idle habits so Bramble never looks frozen: a sniff around, or a wave.
  if (rig) setInterval(() => {
    if (pet.dataset.mood || document.hidden || rig.state !== "idle") return;
    const roll = Math.random();
    if (roll < 0.35) rig.set("sniff", 1600);
    else if (roll < 0.55) rig.set("wave", 1300);
  }, 8000);

  function mood(name, ms = 1600) {
    clearTimeout(moodTimer);
    pet.dataset.mood = name;
    if (rig) rig.set(rigState[name] || "idle");
    if (name !== "think") moodTimer = setTimeout(() => {
      delete pet.dataset.mood;
      if (rig) rig.set("idle");
    }, ms);
  }

  function say(text, ms = 6000) {
    clearTimeout(bubbleTimer);
    bubble.textContent = text;
    bubble.hidden = false;
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, ms);
  }

  function add(role, text) {
    const item = document.createElement("li");
    item.dataset.role = role;
    item.textContent = text;
    log.append(item);
    log.scrollTop = log.scrollHeight;
    return item;
  }

  // A Sandbox order Bramble prepared. The player approves it on PayPal; Bramble can't.
  function addCheckout({ product, price, approval_url: approve, status_url: status }) {
    const item = add("checkout", "");
    const title = document.createElement("strong");
    title.textContent = `${product} · ${price}`;
    const note = document.createElement("span");
    note.textContent = "PayPal Sandbox order ready. Test money only.";
    const go = document.createElement("a");
    go.className = "chat-approve";
    go.href = approve;
    go.textContent = "Approve in PayPal Sandbox";
    const later = document.createElement("a");
    later.href = status;
    later.textContent = "Order details";
    item.append(title, note, go, later);
    log.scrollTop = log.scrollHeight;
  }

  async function send(message) {
    if (waiting) return;
    waiting = true;
    form.querySelector("button").disabled = true;
    if (message) add("user", message);
    const status = add("status", "Bramble is thinking…");
    mood("think");
    try {
      const body = new FormData();
      body.set("csrf", csrf);
      body.set("message", message);
      body.set("place", place);
      const response = await fetch(url, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      status.remove();
      if (response.ok && data.reply) {
        add("assistant", data.reply);
        for (const checkout of data.checkouts || []) addCheckout(checkout);
        mood("talk", Math.min(6000, 900 + data.reply.length * 35));
        if (chat.hidden) say(data.reply);
      } else {
        add("error", data.message || "Bramble didn’t hear that. Try again.");
        mood("idle", 0);
      }
    } catch {
      status.remove();
      add("error", "Couldn’t reach the farm. Try again.");
      mood("idle", 0);
    } finally {
      waiting = false;
      form.querySelector("button").disabled = false;
    }
  }

  async function open() {
    chat.hidden = false;
    bubble.hidden = true;
    badge.hidden = true;
    pet.setAttribute("aria-expanded", "true");
    if (!loaded) {
      loaded = true;
      try {
        const data = await fetch(url).then((response) => response.json());
        for (const entry of data.messages) add(entry.role, entry.content);
        if (!data.configured) {
          add("error", "Bramble is napping. Add an Anthropic API key to .env to wake them up.");
        } else if (!data.messages.length) {
          await send("");
        }
      } catch {
        add("error", "Couldn’t reach the farm. Try again.");
      }
    }
    if (matchMedia("(pointer: fine)").matches) input.focus();
  }

  function close() {
    chat.hidden = true;
    pet.setAttribute("aria-expanded", "false");
  }

  pet.addEventListener("click", () => (chat.hidden ? open() : close()));
  byId("chat-close").addEventListener("click", close);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = "";
    send(message);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !chat.hidden) close();
  });

  return {
    // Small physical reactions to what the player does. These are animations, not AI.
    react(kind) {
      if (waiting) return;
      if (kind === "harvest" || kind === "level") mood("hop", 600);
    },
    mood,
    say,
    // Open the chat and send a message as the player, e.g. from an "Ask Bramble" button.
    async ask(message) {
      if (chat.hidden) await open();
      send(message);
    },
  };
}
