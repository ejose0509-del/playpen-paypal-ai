// Bramble, drawn and animated in SVG instead of a flat picture.
// Shared by the game (playpen/static/bramble-rig.js is an exact copy; a test keeps them equal)
// and the Chrome extension. Defines window.BrambleRig = { css, create(options) }.
//
// States: idle, walk, talk, happy, think, sniff, wave, sleep. Bramble also blinks on its own,
// twitches an ear now and then, and looks toward the pointer.
(function () {
  if (window.BrambleRig) return;
  const NS = "http://www.w3.org/2000/svg";
  let serial = 0;

  // The spiky coat: a ring of alternating long and short points around the head and body.
  function spines(cx, cy, outer, inner, count, from, to) {
    const points = [];
    for (let i = 0; i <= count * 2; i += 1) {
      const angle = from + ((to - from) * i) / (count * 2);
      const radius = i % 2 ? inner : outer + Math.sin(i * 2.3) * 2;
      points.push(`${(cx + Math.cos(angle) * radius).toFixed(1)},${(cy + Math.sin(angle) * radius).toFixed(1)}`);
    }
    return points.join(" ");
  }

  const css = `
    .br { display: block; width: 100%; height: 100%; overflow: visible; }
    .br g { transform-box: fill-box; }
    .br .br-all { transform-origin: 50% 100%; animation: br-breathe 3.2s ease-in-out infinite; }
    .br .br-coat { transform-origin: 50% 80%; animation: br-coat 4.5s ease-in-out infinite; }
    .br .br-head { transform-origin: 50% 90%; transition: transform .35s ease; }
    .br .br-look { transition: transform .18s ease-out; }
    .br .br-lid { transform-origin: 50% 0; transform: scaleY(0); transition: transform .07s ease-in; }
    .br.blink .br-lid { transform: scaleY(1); }
    .br .br-happy-eyes, .br .br-mouth-open, .br .br-zzz { opacity: 0; }
    .br .br-ear { transform-origin: 50% 100%; }
    .br.twitch .br-ear-r { animation: br-twitch .45s ease-in-out; }
    .br .br-arm { transform-origin: 50% 15%; transition: transform .3s ease; }
    .br .br-foot { transform-origin: 50% 50%; }
    .br .br-nose { transform-origin: 50% 50%; }

    .br[data-state="walk"] .br-all { animation: br-step .34s ease-in-out infinite alternate; }
    .br[data-state="walk"] .br-foot-l { animation: br-foot .34s ease-in-out infinite alternate; }
    .br[data-state="walk"] .br-foot-r { animation: br-foot .34s ease-in-out infinite alternate-reverse; }
    .br[data-state="walk"] .br-arm-l { animation: br-swing .34s ease-in-out infinite alternate; }
    .br[data-state="walk"] .br-arm-r { animation: br-swing .34s ease-in-out infinite alternate-reverse; }

    .br[data-state="talk"] .br-mouth-open { animation: br-chatter .22s steps(1) infinite; }
    .br[data-state="talk"] .br-mouth { animation: br-chatter-off .22s steps(1) infinite; }
    .br[data-state="talk"] .br-head { animation: br-nod .44s ease-in-out infinite alternate; }

    .br[data-state="happy"] .br-all { animation: br-jump .6s cubic-bezier(.3,1.4,.5,1) infinite; }
    .br[data-state="happy"] .br-eyes { opacity: 0; }
    .br[data-state="happy"] .br-happy-eyes, .br[data-state="happy"] .br-mouth-open { opacity: 1; }
    .br[data-state="happy"] .br-mouth { opacity: 0; }
    .br[data-state="happy"] .br-arm-l { transform: rotate(130deg); }
    .br[data-state="happy"] .br-arm-r { transform: rotate(-130deg); }
    .br[data-state="happy"] .br-coat { animation: br-puff .6s ease-in-out infinite; }

    .br[data-state="think"] .br-head { transform: rotate(-8deg); }
    .br[data-state="think"] .br-arm-l { transform: rotate(40deg); }
    .br[data-state="think"] .br-look { transform: translate(1.5px, -2.5px) !important; }

    .br[data-state="sniff"] .br-nose { animation: br-sniff .18s ease-in-out infinite alternate; }
    .br[data-state="sniff"] .br-head { animation: br-scan 1.6s ease-in-out infinite; }

    .br[data-state="wave"] .br-arm-r { animation: br-wave .3s ease-in-out infinite alternate; }

    .br[data-state="sleep"] .br-lid { transform: scaleY(1); }
    .br[data-state="sleep"] .br-head { transform: rotate(6deg) translateY(2px); }
    .br[data-state="sleep"] .br-zzz { opacity: 1; animation: br-zzz 2.4s ease-in-out infinite; }
    .br[data-state="sleep"] .br-all { animation-duration: 5s; }

    @keyframes br-breathe { 50% { transform: scale(1.015, .985); } }
    @keyframes br-coat { 50% { transform: rotate(1.2deg) scale(1.01); } }
    @keyframes br-twitch { 40% { transform: rotate(18deg); } }
    @keyframes br-step { from { transform: translateY(0) rotate(-2deg); } to { transform: translateY(-4px) rotate(2deg); } }
    @keyframes br-foot { from { transform: translateY(0) rotate(0); } to { transform: translateY(-5px) rotate(-14deg); } }
    @keyframes br-swing { from { transform: rotate(-22deg); } to { transform: rotate(22deg); } }
    @keyframes br-chatter { 0% { opacity: 1; } 50% { opacity: 0; } }
    @keyframes br-chatter-off { 0% { opacity: 0; } 50% { opacity: 1; } }
    @keyframes br-nod { from { transform: rotate(-2deg); } to { transform: rotate(2deg) translateY(1px); } }
    @keyframes br-jump { 0%, 100% { transform: translateY(0) scale(1); } 15% { transform: translateY(0) scale(1.06, .92); } 50% { transform: translateY(-14px) scale(.96, 1.05); } }
    @keyframes br-puff { 50% { transform: scale(1.06); } }
    @keyframes br-sniff { from { transform: scale(1); } to { transform: scale(1.25, 1.1) translateY(-.5px); } }
    @keyframes br-scan { 0%, 100% { transform: rotate(0); } 30% { transform: rotate(-7deg); } 70% { transform: rotate(7deg); } }
    @keyframes br-wave { from { transform: rotate(-95deg); } to { transform: rotate(-128deg); } }
    @keyframes br-zzz { 0% { transform: translate(0, 0); opacity: 0; } 30% { opacity: 1; } 100% { transform: translate(8px, -14px); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .br *, .br { animation: none !important; transition: none !important; } }
  `;

  function create({ title = "" } = {}) {
    const id = `br${(serial += 1)}`;
    const wrap = document.createElement("span");
    wrap.style.display = "block";
    wrap.style.width = "100%";
    wrap.style.height = "100%";
    wrap.innerHTML = `
<svg class="br" data-state="idle" viewBox="0 0 120 124" xmlns="${NS}" role="img" aria-label="${title}">
  <defs>
    <radialGradient id="${id}-coat" cx="50%" cy="38%" r="65%">
      <stop offset="0" stop-color="#b98450"/><stop offset=".55" stop-color="#8a5631"/><stop offset="1" stop-color="#5a3520"/>
    </radialGradient>
    <radialGradient id="${id}-face" cx="45%" cy="40%" r="70%">
      <stop offset="0" stop-color="#fff1d6"/><stop offset="1" stop-color="#ecd0a4"/>
    </radialGradient>
    <linearGradient id="${id}-bag" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7f9e45"/><stop offset="1" stop-color="#55702c"/>
    </linearGradient>
  </defs>
  <ellipse cx="60" cy="118" rx="34" ry="4.5" fill="#2d1d0b" opacity=".22"/>
  <g class="br-all">
    <g class="br-coat">
      <polygon points="${spines(60, 66, 54, 42, 17, Math.PI * 0.82, Math.PI * 2.18)}" fill="url(#${id}-coat)" stroke="#4a2a17" stroke-width="1.2" stroke-linejoin="round"/>
      <polygon points="${spines(60, 64, 45, 36, 14, Math.PI * 0.9, Math.PI * 2.1)}" fill="#a26e3f" opacity=".75"/>
      <g stroke="#e3b98a" stroke-width="1.1" stroke-linecap="round" opacity=".55">
        <path d="M26 44l-6-5M34 30l-4-7M48 20l-2-8M64 18l1-8M80 24l4-7M92 36l6-5M98 52l7-2"/>
      </g>
    </g>
    <g class="br-foot br-foot-l"><ellipse cx="45" cy="112" rx="10" ry="5.5" fill="#8f5f3d"/><ellipse cx="42" cy="111" rx="3" ry="1.6" fill="#b88761"/></g>
    <g class="br-foot br-foot-r"><ellipse cx="75" cy="112" rx="10" ry="5.5" fill="#8f5f3d"/><ellipse cx="78" cy="111" rx="3" ry="1.6" fill="#b88761"/></g>
    <ellipse cx="60" cy="90" rx="29" ry="24" fill="url(#${id}-face)"/>
    <path d="M81 52 L44 104" stroke="#55702c" stroke-width="4.5" stroke-linecap="round"/>
    <g class="br-arm br-arm-l"><ellipse cx="35" cy="89" rx="6" ry="10" fill="#d3a46e" stroke="#9c6d43" stroke-width="1" transform="rotate(18 35 89)"/></g>
    <g class="br-bag">
      <rect x="64" y="90" width="23" height="18" rx="4" fill="url(#${id}-bag)" stroke="#3f5420" stroke-width="1"/>
      <path d="M64 95c0-4 2-6 6-6h11c4 0 6 2 6 6v3H64z" fill="#4d6627"/>
      <circle cx="75.5" cy="98" r="2" fill="#efc65b"/>
    </g>
    <g class="br-arm br-arm-r"><ellipse cx="85" cy="89" rx="6" ry="10" fill="#d3a46e" stroke="#9c6d43" stroke-width="1" transform="rotate(-18 85 89)"/></g>
    <g class="br-head">
      <g class="br-ear br-ear-l"><ellipse cx="38" cy="38" rx="7" ry="7.5" fill="#e3bd8d"/><ellipse cx="38" cy="39" rx="3.6" ry="4" fill="#d79c86"/></g>
      <g class="br-ear br-ear-r"><ellipse cx="82" cy="38" rx="7" ry="7.5" fill="#e3bd8d"/><ellipse cx="82" cy="39" rx="3.6" ry="4" fill="#d79c86"/></g>
      <ellipse cx="60" cy="57" rx="28" ry="24" fill="url(#${id}-face)"/>
      <path d="M36 46c6-10 15-14 24-14s18 4 24 14c-6-4-14-6-24-6s-18 2-24 6z" fill="#9a6538" opacity=".85"/>
      <ellipse cx="42" cy="66" rx="5.5" ry="3.4" fill="#f09a93" opacity=".55"/>
      <ellipse cx="78" cy="66" rx="5.5" ry="3.4" fill="#f09a93" opacity=".55"/>
      <g class="br-eyes">
        <g class="br-look">
          <ellipse cx="49" cy="56" rx="6" ry="7" fill="#2a1a12"/>
          <ellipse cx="71" cy="56" rx="6" ry="7" fill="#2a1a12"/>
          <circle cx="47" cy="53" r="2.3" fill="#fff"/><circle cx="69" cy="53" r="2.3" fill="#fff"/>
          <circle cx="51" cy="59" r="1" fill="#fff" opacity=".8"/><circle cx="73" cy="59" r="1" fill="#fff" opacity=".8"/>
        </g>
        <g class="br-lid"><ellipse cx="49" cy="55.5" rx="7" ry="8" fill="#efd5ab"/><path d="M43 58q6 4.5 12 0" fill="none" stroke="#2a1a12" stroke-width="2" stroke-linecap="round"/></g>
        <g class="br-lid"><ellipse cx="71" cy="55.5" rx="7" ry="8" fill="#efd5ab"/><path d="M65 58q6 4.5 12 0" fill="none" stroke="#2a1a12" stroke-width="2" stroke-linecap="round"/></g>
      </g>
      <g class="br-happy-eyes" fill="none" stroke="#2a1a12" stroke-width="2.4" stroke-linecap="round">
        <path d="M43 58q6-7 12 0"/><path d="M65 58q6-7 12 0"/>
      </g>
      <g class="br-nose"><ellipse cx="60" cy="65" rx="4.4" ry="3.3" fill="#3a2318"/><ellipse cx="58.8" cy="64" rx="1.3" ry=".8" fill="#fff" opacity=".6"/></g>
      <path class="br-mouth" d="M55 70q2.5 3 5 0q2.5 3 5 0" fill="none" stroke="#6b3a26" stroke-width="1.5" stroke-linecap="round"/>
      <g class="br-mouth-open"><ellipse cx="60" cy="72" rx="3.8" ry="3.2" fill="#7a2f2a"/><ellipse cx="60" cy="73.6" rx="2.2" ry="1.3" fill="#e8807a"/></g>
      <g class="br-zzz" fill="#6b4a2a" font-family="Georgia, serif" font-weight="700"><text x="86" y="30" font-size="10">z</text><text x="93" y="22" font-size="7">z</text></g>
    </g>
  </g>
</svg>`;
    const svg = wrap.firstElementChild;
    const look = svg.querySelector(".br-look");
    let blinkTimer;
    let twitchTimer;
    let alive = true;

    function blink() {
      if (!alive) return;
      svg.classList.add("blink");
      setTimeout(() => svg.classList.remove("blink"), 130);
      if (Math.random() < 0.2) setTimeout(() => { svg.classList.add("blink"); setTimeout(() => svg.classList.remove("blink"), 120); }, 260);
      blinkTimer = setTimeout(blink, 2200 + Math.random() * 3200);
    }
    function twitch() {
      if (!alive) return;
      svg.classList.remove("twitch");
      void svg.getBoundingClientRect();
      svg.classList.add("twitch");
      twitchTimer = setTimeout(twitch, 5000 + Math.random() * 7000);
    }
    blinkTimer = setTimeout(blink, 1500);
    twitchTimer = setTimeout(twitch, 4000);

    // Eyes follow the pointer, a couple of SVG units at most.
    function lookAt(clientX, clientY) {
      const box = svg.getBoundingClientRect();
      if (!box.width) return;
      const dx = clientX - (box.left + box.width / 2);
      const dy = clientY - (box.top + box.height * 0.45);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / 300);
      look.style.transform = `translate(${((dx / distance) * 2.6 * reach).toFixed(2)}px, ${((dy / distance) * 2.2 * reach).toFixed(2)}px)`;
    }
    const onMove = (event) => lookAt(event.clientX, event.clientY);
    addEventListener("pointermove", onMove, { passive: true });

    let stateTimer;
    return {
      el: wrap,
      get state() { return svg.dataset.state; },
      // Switch to a state; with ms, go back to idle afterwards.
      set(state, ms = 0) {
        clearTimeout(stateTimer);
        svg.dataset.state = state;
        if (ms) stateTimer = setTimeout(() => { svg.dataset.state = "idle"; }, ms);
      },
      lookAt,
      destroy() {
        alive = false;
        clearTimeout(blinkTimer);
        clearTimeout(twitchTimer);
        clearTimeout(stateTimer);
        removeEventListener("pointermove", onMove);
        wrap.remove();
      },
    };
  }

  window.BrambleRig = { css, create };
})();
