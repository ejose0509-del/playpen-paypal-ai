// Drag, fling, pinch and wheel camera over a fixed-size world element.

const DRAG_START = 7;
const FRICTION = 0.0045;

export function createCamera(viewport, world, { width, height, home }) {
  const pointers = new Map();
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let scale = 1;
  let x = 0;
  let y = 0;
  let minScale = 1;
  let maxScale = 2;
  let dragging = false;
  let locked = false;
  let pinch = null;
  let velocity = { x: 0, y: 0 };
  let lastMove = 0;
  let frame = 0;

  function limits() {
    const box = viewport.getBoundingClientRect();
    minScale = Math.max(box.width / width, box.height / height);
    maxScale = Math.max(minScale * 1.2, 2.2);
    return box;
  }

  function apply() {
    const box = limits();
    scale = Math.min(maxScale, Math.max(minScale, scale));
    x = Math.min(0, Math.max(box.width - width * scale, x));
    y = Math.min(0, Math.max(box.height - height * scale, y));
    world.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    viewport.style.setProperty("--zoom", scale.toFixed(3));
  }

  function zoomAt(clientX, clientY, nextScale) {
    const box = limits();
    nextScale = Math.min(maxScale, Math.max(minScale, nextScale));
    const px = clientX - box.left;
    const py = clientY - box.top;
    x = px - (px - x) * (nextScale / scale);
    y = py - (py - y) * (nextScale / scale);
    scale = nextScale;
    apply();
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  function fling() {
    let previous = performance.now();
    const step = (time) => {
      const elapsed = Math.min(40, time - previous);
      previous = time;
      const decay = Math.exp(-FRICTION * elapsed);
      velocity.x *= decay;
      velocity.y *= decay;
      x += velocity.x * elapsed;
      y += velocity.y * elapsed;
      apply();
      frame = Math.hypot(velocity.x, velocity.y) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  }

  function centerOn(worldX, worldY, { nextScale = scale, animate = true } = {}) {
    stop();
    const box = limits();
    nextScale = Math.min(maxScale, Math.max(minScale, nextScale));
    const target = { x: box.width / 2 - worldX * nextScale, y: box.height / 2 - worldY * nextScale, scale: nextScale };
    if (!animate || reduceMotion.matches) {
      ({ x, y, scale } = target);
      apply();
      return;
    }
    const from = { x, y, scale };
    const started = performance.now();
    const step = (time) => {
      const t = Math.min(1, (time - started) / 520);
      const eased = 1 - (1 - t) ** 3;
      scale = from.scale + (target.scale - from.scale) * eased;
      x = from.x + (target.x - from.x) * eased;
      y = from.y + (target.y - from.y) * eased;
      apply();
      frame = t < 1 ? requestAnimationFrame(step) : 0;
    };
    frame = requestAnimationFrame(step);
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  }

  viewport.addEventListener("pointerdown", (event) => {
    if (locked || (event.pointerType === "mouse" && event.button !== 0)) return;
    stop();
    velocity = { x: 0, y: 0 };
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
    if (pointers.size === 2) {
      pinch = { ...pinchState(), scale };
      dragging = true;
    }
  });

  window.addEventListener("pointermove", (event) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer || locked) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (pointers.size === 2 && pinch) {
      const current = pinchState();
      x += current.x - pinch.x;
      y += current.y - pinch.y;
      pinch.x = current.x;
      pinch.y = current.y;
      zoomAt(current.x, current.y, pinch.scale * (current.distance / pinch.distance));
      return;
    }
    if (!dragging) {
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < DRAG_START) return;
      dragging = true;
      viewport.dataset.dragging = "true";
    }
    const time = performance.now();
    const elapsed = Math.max(1, time - lastMove);
    lastMove = time;
    velocity = { x: velocity.x * 0.4 + (dx / elapsed) * 0.6, y: velocity.y * 0.4 + (dy / elapsed) * 0.6 };
    x += dx;
    y += dy;
    apply();
  });

  function release(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size === 1) pinch = null;
    if (pointers.size) return;
    pinch = null;
    if (dragging) {
      // Let the click that follows this drag be swallowed before clearing the flag.
      setTimeout(() => { dragging = false; delete viewport.dataset.dragging; }, 0);
      if (performance.now() - lastMove < 80 && !reduceMotion.matches) fling();
    }
  }
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  viewport.addEventListener("click", (event) => {
    if (dragging) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    stop();
    const notched = event.deltaX === 0 && (event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50);
    if (event.ctrlKey || event.metaKey) {
      zoomAt(event.clientX, event.clientY, scale * Math.exp(-event.deltaY * 0.01));
    } else if (notched) {
      zoomAt(event.clientX, event.clientY, scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
    } else {
      x -= event.deltaX;
      y -= event.deltaY;
      apply();
    }
  }, { passive: false });

  window.addEventListener("resize", apply);

  const first = limits();
  // Phones start fully zoomed out so the whole field fits across the screen.
  scale = minScale * (first.width < 700 ? 1 : 1.3);
  centerOn(home.x, home.y, { nextScale: scale, animate: false });

  return {
    centerOn,
    zoomBy(factor) {
      const box = viewport.getBoundingClientRect();
      zoomAt(box.left + box.width / 2, box.top + box.height / 2, scale * factor);
    },
    lock(value) {
      locked = value;
      if (value) {
        pointers.clear();
        pinch = null;
        dragging = false;
        delete viewport.dataset.dragging;
        stop();
      }
    },
    get dragging() { return dragging; },
    get scale() { return scale; },
  };
}
