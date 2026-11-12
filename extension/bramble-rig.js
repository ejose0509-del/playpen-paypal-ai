// Bramble, animated from a set of hand-painted poses (a flipbook) plus gentle body motion.
// Shared by the game (playpen/static/bramble-rig.js is an exact copy; a test keeps them equal)
// and the Chrome extension. Defines window.BrambleRig = { css, create(options) }.
//
// States: idle, walk, talk, happy, think, sniff, wave, sleep. Bramble also blinks on its own
// and leans a little toward the pointer. Pose images: idle, blink, talk, happy, walk1, walk2,
// think, sleep: one transparent sprite sheet (sheet.png, 4 columns x 2 rows) in the folder `base`.
(function () {
  if (window.BrambleRig) return;
  const POSES = ["idle", "blink", "talk", "happy", "walk1", "walk2", "think", "sleep"];
  // In the game this script is loaded from /static/, and the poses live in /static/art/bramble/.
  const scriptBase = document.currentScript && document.currentScript.src
    ? new URL("./art/bramble/", document.currentScript.src).href
    : "";

  const css = `
    .brp { position: relative; display: block; width: 100%; height: 100%; transform-origin: 50% 100%;
      transition: transform .3s ease-out; }
    .brp .brp-body { position: absolute; inset: 0; transform-origin: 50% 95%; }
    .brp .brp-pose { position: absolute; left: 50%; top: 50%; width: 100%; aspect-ratio: 1; transform: translate(-50%, -50%);
      background-repeat: no-repeat; background-size: 400% 200%; pointer-events: none; }
    .brp .brp-zzz { position: absolute; right: 4%; top: 2%; font: 700 16px/1 Georgia, serif; color: #6b4a2a;
      opacity: 0; pointer-events: none; text-shadow: 0 1px 0 #fff8; }
    .brp[data-state="idle"] .brp-body { animation: brp-breathe 3.2s ease-in-out infinite; }
    .brp[data-state="walk"] .brp-body { animation: brp-step .34s ease-in-out infinite alternate; }
    .brp[data-state="talk"] .brp-body, .brp[data-state="wave"] .brp-body { animation: brp-nod .4s ease-in-out infinite alternate; }
    .brp[data-state="happy"] .brp-body { animation: brp-jump .62s cubic-bezier(.3,1.4,.5,1) infinite; }
    .brp[data-state="think"] .brp-body { animation: brp-ponder 2.4s ease-in-out infinite; }
    .brp[data-state="sniff"] .brp-body { animation: brp-sniff 1.3s ease-in-out infinite; }
    .brp[data-state="sleep"] .brp-body { animation: brp-breathe 5s ease-in-out infinite; }
    .brp[data-state="sleep"] .brp-zzz { animation: brp-zzz 2.6s ease-in-out infinite; }
    @keyframes brp-breathe { 50% { transform: scale(1.02, .985); } }
    @keyframes brp-step { from { transform: translateY(0) rotate(-3deg); } to { transform: translateY(-5%) rotate(3deg); } }
    @keyframes brp-nod { from { transform: rotate(-2deg); } to { transform: rotate(2deg) translateY(1.5%); } }
    @keyframes brp-jump { 0%, 100% { transform: translateY(0) scale(1); } 15% { transform: translateY(0) scale(1.05, .93); }
      50% { transform: translateY(-14%) scale(.97, 1.04); } }
    @keyframes brp-ponder { 50% { transform: rotate(-4deg) translateY(-1%); } }
    @keyframes brp-sniff { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-5deg) translateY(1%); }
      50% { transform: rotate(0) scale(1.02, .98); } 75% { transform: rotate(5deg) translateY(1%); } }
    @keyframes brp-zzz { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(10px, -18px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .brp, .brp * { animation: none !important; transition: none !important; } }
  `;

  // Which pose(s) each state shows. Two poses alternate at the given speed.
  const FRAMES = {
    idle: ["idle"], walk: ["walk1", "walk2", 170], talk: ["talk", "idle", 190], wave: ["talk"],
    happy: ["happy"], think: ["think"], sniff: ["idle"], sleep: ["sleep"],
  };

  function create({ title = "", base = scriptBase } = {}) {
    const wrap = document.createElement("span");
    wrap.style.display = "block";
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    const root = document.createElement("span");
    root.className = "brp";
    root.dataset.state = "idle";
    root.setAttribute("role", "img");
    root.setAttribute("aria-label", title);
    const body = document.createElement("span");
    body.className = "brp-body";
    const sprite = document.createElement("span");
    sprite.className = "brp-pose";
    sprite.style.backgroundImage = `url("${base}sheet.png")`;
    body.append(sprite);
    body.append(Object.assign(document.createElement("span"), { className: "brp-zzz", textContent: "z z" }));
    root.append(body);
    wrap.append(root);

    let shown = null;
    function show(pose) {
      if (shown === pose) return;
      const index = POSES.indexOf(pose);
      sprite.style.backgroundPosition = `${((index % 4) * 100) / 3}% ${Math.floor(index / 4) * 100}%`;
      shown = pose;
    }

    let alive = true;
    let flipTimer = null;
    let stateTimer = null;
    let blinkTimer = null;

    function play(state) {
      clearInterval(flipTimer);
      const [first, second, speed] = FRAMES[state] || FRAMES.idle;
      show(first);
      if (second) {
        let toggle = false;
        flipTimer = setInterval(() => { toggle = !toggle; show(toggle ? second : first); }, speed);
      }
    }

    // Blink now and then while idle (sometimes a quick double blink).
    function blink() {
      if (!alive) return;
      if (root.dataset.state === "idle" || root.dataset.state === "sniff") {
        show("blink");
        setTimeout(() => { if (shown === "blink") show("idle"); }, 140);
        if (Math.random() < 0.2) {
          setTimeout(() => { show("blink"); setTimeout(() => { if (shown === "blink") show("idle"); }, 120); }, 300);
        }
      }
      blinkTimer = setTimeout(blink, 2200 + Math.random() * 3200);
    }
    blinkTimer = setTimeout(blink, 1600);
    play("idle");

    // Lean a few degrees toward the pointer.
    function lookAt(clientX) {
      const box = root.getBoundingClientRect();
      if (!box.width) return;
      const dx = clientX - (box.left + box.width / 2);
      const lean = Math.max(-1, Math.min(1, dx / 500)) * 4;
      root.style.transform = `rotate(${lean.toFixed(2)}deg)`;
    }
    const onMove = (event) => lookAt(event.clientX);
    addEventListener("pointermove", onMove, { passive: true });

    function set(state, ms = 0) {
      clearTimeout(stateTimer);
      const next = FRAMES[state] ? state : "idle";
      root.dataset.state = next;
      play(next);
      if (ms) stateTimer = setTimeout(() => set("idle"), ms);
    }

    return {
      el: wrap,
      get state() { return root.dataset.state; },
      set,
      lookAt,
      destroy() {
        alive = false;
        clearInterval(flipTimer);
        clearTimeout(stateTimer);
        clearTimeout(blinkTimer);
        removeEventListener("pointermove", onMove);
        wrap.remove();
      },
    };
  }

  window.BrambleRig = { css, create };
})();
