// Bramble for PlayPen: the hedgehog that follows the player from tab to tab.
// It wanders along the bottom of every page, hops in when you switch tabs, points out organic
// products and demo partner brands on Amazon, can take the player to an Amazon search, and chats
// through the player's own PlayPen server (via background.js). Bramble is drawn by bramble-rig.js.
(async function () {
  if (window.top !== window || document.getElementById("playpen-bramble-host")) return;
  if (document.querySelector('meta[name="playpen-extension-token"]')) return; // the farm has its own Bramble
  const { link } = await chrome.storage.local.get("link");
  if (link && location.origin === link.origin) return;

  const SIZE = { w: 88, h: 92 };
  const art = { idle: chrome.runtime.getURL("bramble.png"), talk: chrome.runtime.getURL("bramble-talk.png") };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const call = (path, method = "GET", body) => chrome.runtime.sendMessage({ type: "api", path, method, body });
  const isAmazon = /(^|\.)amazon\.[a-z.]+$/.test(location.hostname);

  // ---- page styles: font and the highlight on spotted products (outside the shadow root) ----
  const pageStyle = document.createElement("style");
  pageStyle.textContent = `
    @font-face { font-family: "PlayPen Bree"; src: url("${chrome.runtime.getURL("BreeSerif-Regular.ttf")}"); }
    .playpen-spot { position: relative !important; outline: 3px solid #6f9a3a !important; outline-offset: 3px; border-radius: 12px; }
    .playpen-spot.playpen-focus { animation: playpen-glow 1.1s ease-in-out 3; }
    .playpen-badge { position: absolute; z-index: 20; top: 8px; right: 8px; display: flex; align-items: center; gap: 5px;
      padding: 5px 10px 5px 6px; border-radius: 999px; background: #486126; color: #fff8e6;
      font: 600 12px/1.15 system-ui, sans-serif; flex-wrap: wrap; row-gap: 2px; max-width: calc(100% - 16px); box-shadow: 0 3px 10px #0004; pointer-events: none;
      animation: playpen-pop .5s cubic-bezier(.3,1.6,.5,1) both; }
    .playpen-badge.playpen-inline { position: static; display: inline-flex; margin: 0 0 8px; max-width: 100%; }
    .playpen-badge b { font: 15px/1 "PlayPen Bree", Georgia, serif; font-weight: 400; }
    .playpen-badge i { font-style: normal; opacity: .85; font-size: 11px; white-space: nowrap; }
    .playpen-badge em { font-style: normal; }
    .playpen-badge.playpen-organic { background: #2f7d4a; }
    .playpen-spot.playpen-organic-spot { outline: 3px dashed #7fbf5a !important; }
    @keyframes playpen-pop { from { transform: scale(.3); opacity: 0; } }
    @keyframes playpen-glow { 50% { outline-color: #f2b632; box-shadow: 0 0 0 8px #f2b63255; } }
  `;
  document.head.append(pageStyle);

  // ---- Bramble's own UI, isolated from the page in a shadow root ----
  const host = document.createElement("div");
  host.id = "playpen-bramble-host";
  Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: 2147483646 });
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .pet { position: fixed; left: 0; top: 0; width: ${SIZE.w}px; height: ${SIZE.h}px; padding: 0; border: 0; background: none;
        cursor: grab; pointer-events: auto; transition: transform 1.4s cubic-bezier(.45,.05,.4,1); will-change: transform; touch-action: none; }
      .pet:focus-visible { outline: 3px solid #f2b632; border-radius: 50%; }
      .pet .body { width: 100%; height: 100%; transform-origin: 50% 100%; }
      .pet .rig { display: block; width: 100%; height: 100%; filter: drop-shadow(0 6px 6px #0004); user-select: none; }
      .pet.left .body { transform: scaleX(-1); }
      ${window.BrambleRig.css}

      .bubble { position: fixed; width: 270px; padding: 12px 14px; border-radius: 16px; pointer-events: auto;
        background: #fff6e3; color: #412419; border: 2px solid #c79a5a; box-shadow: 0 10px 28px #0004;
        font: 15px/1.4 system-ui, sans-serif; opacity: 0; transform: translateY(6px) scale(.97); transition: opacity .2s, transform .2s; }
      .bubble.show { opacity: 1; transform: none; }
      .bubble h3 { margin: 0 0 2px; font: 20px/1.15 "PlayPen Bree", Georgia, serif; color: #486126; }
      .bubble .tag { display: inline-block; margin-bottom: 6px; padding: 2px 8px; border-radius: 999px; background: #e7f0d2; color: #3f5520; font-size: 12px; font-weight: 700; }
      .bubble .xp { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; background: #ffe39a; font-weight: 700; font-size: 13px; }
      .bubble .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
      button.act { min-height: 34px; padding: 4px 12px; border-radius: 999px; border: 1px solid #a87539; background: #fffaf0;
        color: #412419; font: 700 14px system-ui, sans-serif; cursor: pointer; }
      button.act.main { background: #486126; border-color: #486126; color: #fff8e6; }
      button.act:hover { filter: brightness(1.05); }

      .panel { position: fixed; right: 16px; bottom: 120px; width: min(360px, calc(100vw - 32px)); height: min(500px, calc(100vh - 150px));
        display: none; flex-direction: column; pointer-events: auto; border-radius: 18px; overflow: hidden;
        background: #fffaf0; border: 2px solid #c79a5a; box-shadow: 0 18px 48px #0005; font: 15px/1.4 system-ui, sans-serif; color: #412419; }
      .panel.open { display: flex; animation: rise .25s ease-out; }
      @keyframes rise { from { transform: translateY(14px); opacity: 0; } }
      .panel header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #486126; color: #fff8e6; }
      .panel header img { width: 34px; height: 38px; object-fit: contain; }
      .panel header strong { font: 20px/1 "PlayPen Bree", Georgia, serif; font-weight: 400; display: block; }
      .panel header small { opacity: .85; font-size: 12px; }
      .panel header button { margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 50%; background: #ffffff22; color: inherit; font-size: 18px; cursor: pointer; }
      .log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
      .msg { max-width: 86%; padding: 8px 12px; border-radius: 14px; white-space: pre-wrap; }
      .msg.bot { align-self: flex-start; background: #f3e4c3; border-bottom-left-radius: 4px; }
      .msg.me { align-self: flex-end; background: #486126; color: #fff8e6; border-bottom-right-radius: 4px; }
      .msg.note { align-self: center; background: none; color: #8a6a4a; font-size: 13px; text-align: center; }
      .typing span { display: inline-block; width: 7px; height: 7px; margin: 0 2px; border-radius: 50%; background: #8a6a4a; animation: dot 1s infinite; }
      .typing span:nth-child(2) { animation-delay: .15s; } .typing span:nth-child(3) { animation-delay: .3s; }
      @keyframes dot { 50% { transform: translateY(-4px); opacity: .4; } }
      .cards { display: grid; gap: 6px; align-self: stretch; }
      .card { display: grid; grid-template-columns: 56px 1fr; gap: 10px; align-items: center; padding: 8px; border-radius: 12px;
        background: #fff; border: 1px solid #e1c99b; color: inherit; text-decoration: none; }
      .card:hover { border-color: #486126; }
      .card img, .card .ph { width: 56px; height: 56px; object-fit: contain; border-radius: 8px; background: #f6efe0; }
      .card b { display: block; font-size: 13px; line-height: 1.25; max-height: 2.5em; overflow: hidden; }
      .card small { color: #73371e; font-size: 12px; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 12px 8px; }
      .chips button { border: 1px solid #a87539; background: #fff; border-radius: 999px; padding: 4px 10px; font: 600 13px system-ui; color: #412419; cursor: pointer; }
      form { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid #e1c99b; }
      input { flex: 1; min-width: 0; min-height: 40px; padding: 6px 12px; border: 1px solid #a87539; border-radius: 999px; font: 15px system-ui; background: #fff; color: #412419; }
      form button { min-height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: #486126; color: #fff8e6; font: 700 15px system-ui; cursor: pointer; }
      .fine { padding: 0 12px 8px; color: #8a6a4a; font-size: 11px; text-align: center; }
      @media (prefers-reduced-motion: reduce) { .pet, .pet * { animation: none !important; transition-duration: .01s !important; } }
    </style>
    <div class="bubble" role="status" aria-live="polite"></div>
    <section class="panel" aria-label="Chat with Bramble">
      <header>
        <img alt="" src="${art.idle}">
        <div><strong>Bramble</strong><small class="farm">Your PlayPen companion</small></div>
        <button type="button" class="close" aria-label="Close chat">×</button>
      </header>
      <div class="log"></div>
      <div class="chips">
        <button type="button">Show me organic snacks on Amazon</button>
        <button type="button">What did you spot here?</button>
        <button type="button">Find a reusable lunch box</button>
      </div>
      <form><input name="message" maxlength="400" autocomplete="off" placeholder="Ask Bramble…"><button>Send</button></form>
      <div class="fine">Demo partner brands are real brands shown as a demo. They aren’t affiliated with PlayPen.</div>
    </section>
    <button class="pet idle" type="button" aria-label="Bramble the hedgehog. Click to chat, drag to move.">
      <div class="body"><span class="rig"></span></div>
    </button>
  `;
  document.documentElement.append(host);

  const pet = root.querySelector(".pet");
  const rig = window.BrambleRig.create({ title: "Bramble", base: chrome.runtime.getURL("poses/") });
  pet.querySelector(".rig").append(rig.el);
  const bubble = root.querySelector(".bubble");
  const panel = root.querySelector(".panel");
  const log = root.querySelector(".log");
  const form = root.querySelector("form");
  const input = form.elements.message;

  // ---- movement ----
  let pos = { x: innerWidth - SIZE.w - 24, y: innerHeight - SIZE.h - 16 };
  let busy = false; // touring or dragging: no wandering
  let hovered = false; // stand still while the pointer is on Bramble, so it's easy to click
  let moving = null;

  function place(x, y) {
    pos = { x: clamp(x, 4, innerWidth - SIZE.w - 4), y: clamp(y, 4, innerHeight - SIZE.h - 4) };
    pet.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }

  function moveTo(x, y, speed = 260) {
    const from = { ...pos };
    const target = { x: clamp(x, 4, innerWidth - SIZE.w - 4), y: clamp(y, 4, innerHeight - SIZE.h - 4) };
    const distance = Math.hypot(target.x - from.x, target.y - from.y);
    if (distance < 4) return Promise.resolve();
    hideBubble();
    pet.classList.toggle("left", target.x < from.x);
    rig.set("walk");
    pet.style.transitionDuration = `${clamp(distance / speed, 0.45, 2.6)}s`;
    place(target.x, target.y);
    const done = new Promise((resolve) => {
      const finish = () => { pet.removeEventListener("transitionend", finish); clearTimeout(timer); resolve(); };
      const timer = setTimeout(finish, 2800);
      pet.addEventListener("transitionend", finish);
    });
    moving = done.then(() => {
      if (rig.state === "walk") rig.set("idle");
      chrome.storage.local.set({ bramble: { fx: pos.x / innerWidth, fy: pos.y / innerHeight } });
    });
    return moving;
  }

  function homeSpot() {
    return { x: innerWidth - SIZE.w - 24, y: innerHeight - SIZE.h - 16 };
  }

  // Wander along the bottom of the page every so often, like a pet pottering about.
  setInterval(() => {
    if (busy || hovered || panel.classList.contains("open") || bubble.classList.contains("show") || document.hidden) return;
    const roam = Math.random();
    const x = roam < 0.2 ? pos.x + (Math.random() - 0.5) * 120 : 20 + Math.random() * (innerWidth - SIZE.w - 40);
    const y = innerHeight - SIZE.h - 10 - Math.random() * 40;
    if (rig.state !== "idle") return;
    if (roam > 0.85) rig.set("sniff", 1800);
    else if (roam > 0.75) rig.set("wave", 1400);
    else moveTo(x, y, 140);
  }, 9000);

  // Doze off when the player hasn't moved the pointer for a while; wake on the next move.
  let lastActive = Date.now();
  addEventListener("pointermove", () => {
    lastActive = Date.now();
    if (rig.state === "sleep") rig.set("happy", 700);
  }, { passive: true });
  setInterval(() => {
    if (rig.state === "idle" && !busy && !panel.classList.contains("open") && Date.now() - lastActive > 45000) rig.set("sleep");
  }, 5000);

  addEventListener("resize", () => place(pos.x, pos.y));

  // Arrive: hop in from the side of the screen to where Bramble was standing in the last tab.
  const greetings = ["I followed you over here!", "Hop, hop. New tab!", "Wait for me!", "Ooh, where are we now?"];
  let lastArrival = 0;
  async function arrive(talk = true) {
    const { bramble } = await chrome.storage.local.get("bramble");
    const spot = bramble ? { x: bramble.fx * innerWidth, y: bramble.fy * innerHeight } : homeSpot();
    const fromLeft = spot.x < innerWidth / 2;
    pet.style.transitionDuration = "0s";
    place(fromLeft ? -SIZE.w : innerWidth, spot.y);
    pet.getBoundingClientRect();
    await moveTo(spot.x, spot.y, 420);
    rig.set("wave", 1300);
    if (talk && Date.now() - lastArrival > 15000) {
      say({ text: greetings[Math.floor(Math.random() * greetings.length)] }, 2600);
    }
    lastArrival = Date.now();
  }

  // ---- speech bubble ----
  let bubbleTimer = null;
  function hideBubble() {
    bubble.classList.remove("show");
    clearTimeout(bubbleTimer);
  }

  function say({ title, tag, text, xp, actions = [] }, hideAfter = 0) {
    clearTimeout(bubbleTimer);
    bubble.replaceChildren();
    if (title) bubble.append(Object.assign(document.createElement("h3"), { textContent: title }));
    if (tag) bubble.append(Object.assign(document.createElement("span"), { className: "tag", textContent: tag }));
    if (text) bubble.append(Object.assign(document.createElement("div"), { textContent: text }));
    if (xp) bubble.append(Object.assign(document.createElement("span"), { className: "xp", textContent: xp }));
    if (actions.length) {
      const row = Object.assign(document.createElement("div"), { className: "row" });
      for (const [label, run, main] of actions) {
        const button = Object.assign(document.createElement("button"), { type: "button", className: `act${main ? " main" : ""}`, textContent: label });
        button.addEventListener("click", run);
        row.append(button);
      }
      bubble.append(row);
    }
    rig.set("talk", 1500);
    bubble.classList.add("show");
    const width = 270;
    const left = clamp(pos.x + SIZE.w / 2 - width / 2, 8, innerWidth - width - 8);
    bubble.style.left = `${left}px`;
    const height = bubble.offsetHeight;
    const above = pos.y - height - 10;
    bubble.style.top = `${above > 8 ? above : Math.min(pos.y + SIZE.h + 10, innerHeight - height - 8)}px`;
    if (hideAfter) bubbleTimer = setTimeout(hideBubble, hideAfter);
  }

  // ---- drag, or click to chat ----
  pet.addEventListener("pointerenter", () => { hovered = true; });
  pet.addEventListener("pointerleave", () => { hovered = false; });
  let drag = null;
  pet.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, y: event.clientY, ox: pos.x, oy: pos.y, moved: false };
    pet.setPointerCapture(event.pointerId);
  });
  pet.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; busy = true; hideBubble(); pet.style.transitionDuration = "0s"; pet.style.cursor = "grabbing"; }
    place(drag.ox + dx, drag.oy + dy);
  });
  pet.addEventListener("pointerup", () => {
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    pet.style.cursor = "";
    if (wasDrag) {
      busy = false;
      chrome.storage.local.set({ bramble: { fx: pos.x / innerWidth, fy: pos.y / innerHeight } });
      rig.set("happy", 800);
    } else {
      togglePanel();
    }
  });

  // ---- chat ----
  let farm = null;
  function addMessage(kind, text) {
    const node = Object.assign(document.createElement("div"), { className: `msg ${kind}`, textContent: text });
    log.append(node);
    log.scrollTop = log.scrollHeight;
    return node;
  }

  function addProducts(products) {
    const list = Object.assign(document.createElement("div"), { className: "cards" });
    for (const product of products) {
      const card = Object.assign(document.createElement("a"), { className: "card", href: product.url, target: "_blank", rel: "noopener noreferrer" });
      const picture = product.image
        ? Object.assign(document.createElement("img"), { src: product.image, alt: "", loading: "lazy", referrerPolicy: "no-referrer" })
        : Object.assign(document.createElement("div"), { className: "ph" });
      if (product.image) picture.addEventListener("error", () => picture.replaceWith(Object.assign(document.createElement("div"), { className: "ph" })));
      const text = document.createElement("div");
      text.append(Object.assign(document.createElement("b"), { textContent: product.title }));
      const price = product.price != null ? `${product.currency === "USD" ? "$" : `${product.currency} `}${Number(product.price).toFixed(2)}` : "";
      text.append(Object.assign(document.createElement("small"), { textContent: [product.brand, price, product.store].filter(Boolean).join(" · ") }));
      card.append(picture, text);
      list.append(card);
    }
    log.append(list);
    log.append(Object.assign(document.createElement("div"), { className: "msg note", textContent: "Product search by Channel3" }));
    log.scrollTop = log.scrollHeight;
  }

  function togglePanel(force) {
    const open = force ?? !panel.classList.contains("open");
    panel.classList.toggle("open", open);
    if (!open) return;
    hideBubble();
    moveTo(innerWidth - SIZE.w - 24, innerHeight - SIZE.h - 16, 500);
    if (!log.childElementCount) {
      const organic = spots.filter((s) => s.organic).length;
      addMessage("bot", spots.length
        ? `I marked ${[brandList() && `${brandList()} (demo partner brands)`, organic && `${organic} organic products`].filter(Boolean).join(" and ")} on this page. Ask me about them, or send me to find something else.`
        : "I’m riding along with you. Ask me to find organic food on Amazon and I’ll take you there.");
    }
    setTimeout(() => input.focus(), 50);
  }
  root.querySelector(".close").addEventListener("click", () => togglePanel(false));

  async function send(message) {
    if (!message) return;
    if (!link) {
      addMessage("note", "Open your PlayPen farm in this browser first, then I can talk here.");
      return;
    }
    addMessage("me", message);
    input.value = "";
    const typing = addMessage("bot typing", "");
    typing.innerHTML = "<span></span><span></span><span></span>";
    form.querySelector("button").disabled = true;
    rig.set("think");
    const result = await call("/extension/api/chat", "POST", {
      message,
      page: {
        host: location.hostname, title: document.title,
        brands: [...new Set(spots.filter((s) => s.key).map((s) => s.key))],
        organic: spots.filter((s) => s.organic).length,
      },
    });
    rig.set("idle");
    typing.remove();
    form.querySelector("button").disabled = false;
    if (!result || !result.ok) {
      addMessage("note", (result && result.data && result.data.message) || "Bramble didn’t hear that. Try again.");
      return;
    }
    addMessage("bot", result.data.reply);
    if (result.data.products && result.data.products.length) addProducts(result.data.products);
    rig.set("talk", Math.min(5000, 800 + result.data.reply.length * 30));
    if (result.data.navigate) goShopping(result.data.navigate);
  }

  // Bramble takes the player to an Amazon search, then reports what it found when the page loads.
  async function goShopping(url) {
    let target;
    try { target = new URL(url); } catch { return; }
    if (target.origin !== "https://www.amazon.com" || target.pathname !== "/s" || !target.searchParams.get("k")) return;
    await chrome.storage.local.set({ mission: { query: target.searchParams.get("k"), at: Date.now() } });
    addMessage("note", `Bramble is heading to Amazon: “${target.searchParams.get("k")}”`);
    await sleep(1400);
    busy = true;
    rig.set("happy", 600);
    await sleep(600);
    togglePanel(false);
    await moveTo(innerWidth - SIZE.w - 4, pos.y, 600);
    location.href = target.href;
  }
  form.addEventListener("submit", (event) => { event.preventDefault(); send(input.value.trim()); });
  for (const chip of root.querySelectorAll(".chips button")) chip.addEventListener("click", () => send(chip.textContent));
  // Keep the chat's first chip relevant: on Amazon, Bramble already marks organic food here.
  if (isAmazon) root.querySelector(".chips button").textContent = "Which of these is organic?";

  // ---- spotting demo partner brands on Amazon ----
  let brands = {};
  let brandXp = 0; // eslint-disable-line no-unused-vars
  const spots = []; // { key, brand, organic, title, node }; key and brand are null for organic-only products
  const seen = new WeakSet();
  let patterns = [];

  function compile() {
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    patterns = Object.entries(brands).map(([key, brand]) => ({
      key, brand,
      regex: new RegExp(`(^|[^A-Za-z0-9])(${brand.match.map(escape).join("|")})(?![A-Za-z0-9])`, brand.case ? "" : "i"),
    }));
  }

  // Search results are cards; a product page highlights its title block.
  function productNodes() {
    const cards = [...document.querySelectorAll('[data-component-type="s-search-result"]')];
    const detail = document.getElementById("productTitle");
    if (detail) cards.push(document.getElementById("titleSection") || detail.parentElement);
    return cards.filter(Boolean);
  }

  function titleText(node) {
    const title = node.querySelector("#productTitle") || node.querySelector('[data-cy="title-recipe"]') || node.querySelector("h2") || node;
    const byline = document.getElementById("productTitle") && node.contains(document.getElementById("productTitle"))
      ? document.getElementById("bylineInfo") : null;
    return `${title.innerText || ""} ${byline ? byline.innerText : ""}`.slice(0, 500);
  }

  // Amazon shows an "Organic" attribute line on many certified-organic products.
  function isOrganic(node, text) {
    if (/\borganic\b/i.test(text)) return true;
    return [...node.querySelectorAll("span")].some((span) => span.childElementCount === 0 && span.textContent.trim() === "Organic");
  }

  function badge(node, brand, organic) {
    const tag = document.createElement("div");
    const inline = Boolean(node.querySelector("#productTitle"));
    tag.className = `playpen-badge${inline ? " playpen-inline" : ""}${brand ? "" : " playpen-organic"}`;
    if (brand) {
      tag.innerHTML = `<span>🦔</span><b></b><i>Partner brand (demo)</i>${organic ? `<em title="Organic">🌿</em>` : ""}`;
      tag.querySelector("b").textContent = brand.name;
    } else {
      tag.innerHTML = `<span>🌿</span><b>Organic</b>`;
    }
    node.classList.add("playpen-spot");
    if (!brand) node.classList.add("playpen-organic-spot");
    if (inline) node.prepend(tag);
    else node.append(tag);
  }

  function scan() {
    const found = [];
    for (const node of productNodes()) {
      if (seen.has(node)) continue;
      seen.add(node);
      const text = titleText(node);
      const hit = patterns.find((p) => p.regex.test(text));
      const organic = isOrganic(node, text);
      if (!hit && !organic) continue;
      badge(node, hit && hit.brand, organic);
      const title = text.replace(/^\s*Sponsored\s*/i, "").replace(/\s+/g, " ").trim();
      const spot = { key: hit ? hit.key : null, brand: hit ? hit.brand : null, organic, title, node };
      spots.push(spot);
      found.push(spot);
    }
    return found;
  }

  function brandList(limit = 3) {
    const names = [...new Set(spots.filter((s) => s.brand).map((s) => s.brand.name))];
    const shown = names.slice(0, limit).join(", ");
    return names.length > limit ? `${shown} and ${names.length - limit} more` : shown;
  }

  async function reward(found) {
    const keys = [...new Set(found.filter((s) => s.key).map((s) => s.key))];
    if (!keys.length) return null;
    const result = await call("/extension/api/spot", "POST", { brands: keys });
    if (!result || !result.ok) return null;
    farm = { ...farm, xp: result.data.farm_xp, level: result.data.level };
    updateFarmLabel();
    return result.data;
  }

  async function announce(found, mission) {
    if (!found.length) return;
    await moving;
    const earned = await reward(found);
    const brandCount = new Set(spots.filter((s) => s.key).map((s) => s.key)).size;
    const organicCount = spots.filter((s) => s.organic).length;
    const parts = [
      organicCount && `${organicCount} organic product${organicCount === 1 ? "" : "s"}`,
      brandCount && `${brandCount} demo partner brand${brandCount === 1 ? "" : "s"} (${brandList(2)})`,
    ].filter(Boolean);
    rig.set("happy", 900);
    await sleep(500);
    say({
      title: mission ? `Here we are: “${mission.query}”` : organicCount ? "Ooh, organic finds!" : brandCount === 1 ? "I spotted a brand!" : `I spotted ${brandCount} brands!`,
      tag: brandCount ? "Organic · Partner brands (demo)" : "Organic picks",
      text: `I marked ${parts.join(" and ")}. Want a quick tour?`,
      xp: earned && earned.xp ? `+${earned.xp} farm XP` : "",
      actions: [["Show me", tour, true], ["Chat", () => togglePanel(true)], ["Later", hideBubble]],
    });
  }

  // Walk to each spotted brand, one product per brand, and explain it.
  async function tour() {
    busy = true;
    hideBubble();
    // Partner brands first (one product each), then organic picks, six stops at most.
    const stops = [];
    const used = new Set();
    for (const spot of spots) {
      if (!spot.key || used.has(spot.key) || !spot.node.isConnected) continue;
      used.add(spot.key);
      stops.push(spot);
    }
    for (const spot of spots) {
      if (stops.length >= 6) break;
      if (!spot.key && spot.node.isConnected) stops.push(spot);
    }
    stops.length = Math.min(stops.length, 6);
    let index = 0;
    const finish = () => {
      busy = false;
      hideBubble();
      const home = homeSpot();
      moveTo(home.x, home.y, 380);
    };
    const visit = async () => {
      if (index >= stops.length) {
        finish();
        return;
      }
      const stop = stops[index];
      stop.node.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(650);
      const rect = stop.node.getBoundingClientRect();
      const right = rect.right + 8 + SIZE.w < innerWidth;
      const x = right ? rect.right + 8 : rect.left - SIZE.w - 8;
      await moveTo(clamp(x, 4, innerWidth - SIZE.w - 4), rect.top + Math.min(rect.height / 2, 140) - SIZE.h / 2, 520);
      stop.node.classList.remove("playpen-focus");
      void stop.node.offsetWidth;
      stop.node.classList.add("playpen-focus");
      index += 1;
      rig.set("sniff", 900);
      await sleep(500);
      const short = stop.title.length > 90 ? `${stop.title.slice(0, 88)}…` : stop.title;
      say({
        title: stop.brand ? stop.brand.name : "Organic pick",
        tag: `${stop.brand ? `Partner brand (demo)${stop.organic ? " · Organic" : ""}` : "🌿 Organic"} · ${index} of ${stops.length}`,
        text: stop.brand ? stop.brand.why : short,
        actions: index < stops.length
          ? [["Next ›", visit, true], ["Done", finish]]
          : [["Ask Bramble", () => { finish(); togglePanel(true); }, true], ["Done", finish]],
      });
    };
    visit();
  }

  function updateFarmLabel() {
    const label = root.querySelector(".farm");
    if (farm) label.textContent = `Farm level ${farm.level} · ${farm.xp} XP`;
  }

  // ---- start ----
  place(pos.x, pos.y);
  await arrive(false);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) arrive(true); });

  if (!link) {
    say({
      title: "Hi, I’m Bramble!",
      text: "Open your PlayPen farm once in this browser and I’ll follow you from tab to tab.",
      actions: [["Open my farm", () => chrome.runtime.sendMessage({ type: "open-farm" }), true], ["Later", hideBubble]],
    });
    return;
  }

  const hello = await call("/extension/api/hello");
  if (!hello || !hello.ok) {
    say({ text: (hello && hello.data && hello.data.message) || "I can’t reach your farm. Is PlayPen running?" }, 6000);
    return;
  }
  brands = hello.data.brands;
  brandXp = hello.data.brand_xp;
  farm = hello.data.farm;
  updateFarmLabel();
  compile();

  if (!isAmazon) {
    say({ text: greetings[Math.floor(Math.random() * greetings.length)] }, 2600);
    return;
  }
  // Did Bramble bring the player here? Then this search is Bramble's errand.
  const { mission } = await chrome.storage.local.get("mission");
  const here = new URLSearchParams(location.search).get("k");
  const errand = mission && Date.now() - mission.at < 120000 && here === mission.query ? mission : null;
  if (mission) chrome.storage.local.remove("mission");
  rig.set("sniff", 1600);
  await sleep(1200);
  const first = scan();
  if (first.length) {
    announce(first, errand);
  } else {
    say({ text: errand ? `Hmm, nothing organic for “${errand.query}”. Try another search?` : "Sniffing around… ask me to find organic food and I’ll take you there!" }, 5000);
  }

  // Amazon loads more results as you scroll and re-renders on new searches.
  let pending = null;
  new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const found = scan();
      if (found.length && !busy && !panel.classList.contains("open")) announce(found);
      else if (found.length) reward(found);
    }, 1200);
  }).observe(document.body, { childList: true, subtree: true });
})();
