(() => {
  "use strict";

  const IDLE = 0, FLYING = 1, FINISHING = 2;
  const LAP_MS = 8000;
  const FINISH_SPEED = 2;
  const START_PHASE = Math.PI / 4;
  const FULL_TURN = 2 * Math.PI;

  function flightPose(phase, { width, height }) {
    const horizontal = width / 2 + 24;
    const vertical = height / 2 + 12;
    return {
      x: horizontal * Math.sin(phase),
      y: vertical * Math.sin(2 * phase),
      angle: Math.atan2(2 * vertical * Math.cos(2 * phase), horizontal * Math.cos(phase)),
      // Change depth at the outer turns, clear of the title's lettering.
      front: Math.cos(phase) >= 0,
    };
  }

  function initTitleFlight({
    documentRef = typeof document === "undefined" ? null : document,
    windowRef = typeof window === "undefined" ? null : window,
  } = {}) {
    const root = documentRef?.querySelector?.("[data-title-flight]");
    const text = root?.querySelector("[data-title-flight-text]");
    const plane = root?.querySelector("[data-title-flight-plane]");
    const launch = root?.querySelector("[data-title-flight-launch]");
    if (!text || !plane || !launch || !windowRef?.requestAnimationFrame || !windowRef.matchMedia) return null;

    const reducedMotion = windowRef.matchMedia("(prefers-reduced-motion: reduce)");
    const listeners = [];
    let geometry;
    let lapElapsed = 0;
    let state = IDLE;
    let input;
    let pointerType;
    let frame = null;
    let previousTime = null;
    let destroyed = false;

    function render() {
      const current = flightPose(START_PHASE + FULL_TURN * lapElapsed / LAP_MS, geometry);
      plane.style.transform = `translate3d(${current.x - 8}px, ${current.y - 8}px, 0) rotate(${current.angle}rad)`;
      plane.style.zIndex = current.front ? "2" : "0";
    }

    function measure() {
      if (destroyed) return;
      const bounds = text.getBoundingClientRect();
      geometry = { width: bounds.width, height: bounds.height };
      render();
    }

    function cancelFrame() {
      if (frame !== null) windowRef.cancelAnimationFrame(frame);
      frame = null;
      previousTime = null;
    }

    function schedule() {
      if (frame === null && state !== IDLE && !documentRef.hidden && !reducedMotion.matches) {
        frame = windowRef.requestAnimationFrame(tick);
      }
    }

    function tick(time) {
      frame = null;
      if (destroyed || documentRef.hidden || reducedMotion.matches) {
        sync();
        return;
      }
      const elapsed = previousTime === null ? 0 : time - previousTime;
      previousTime = time;
      const speed = state === FINISHING ? FINISH_SPEED : 1;
      const nextElapsed = lapElapsed + elapsed * speed;
      if (state === FINISHING && nextElapsed >= LAP_MS) {
        // End at the resting point even if this frame overshoots the loop.
        lapElapsed = 0;
        state = IDLE;
      } else if (state !== IDLE) {
        lapElapsed = nextElapsed % LAP_MS;
      }
      render();
      if (state === IDLE) sync();
      else schedule();
    }

    function sync() {
      if (destroyed) return;
      if (reducedMotion.matches) {
        state = IDLE;
        lapElapsed = 0;
        render();
      }
      launch.hidden = reducedMotion.matches;
      launch.setAttribute("aria-disabled", String(state !== IDLE));
      if (documentRef.hidden || state === IDLE) cancelFrame();
      else schedule();
    }

    function finish() {
      if (state !== FLYING || documentRef.hidden) return;
      state = lapElapsed === 0 ? IDLE : FINISHING;
      sync();
    }

    function listen(target, type, callback, options) {
      target.addEventListener(type, callback, options);
      listeners.push(() => target.removeEventListener(type, callback, options));
    }

    measure();
    root.setAttribute("data-flight-ready", "");
    // Native button clicks include Enter/Space and assistive activation.
    listen(launch, "click", event => {
      if (state !== IDLE || reducedMotion.matches || documentRef.hidden) return;
      input = event.detail === 0 ? "keyboard" : event.pointerType || pointerType || "mouse";
      state = FLYING;
      sync();
    });
    listen(root, "pointerleave", event => {
      if (event.pointerType !== "touch" && event.pointerType === input) finish();
    });
    listen(launch, "blur", () => { if (input === "keyboard") finish(); });
    // Observe outside touches and scrolling without consuming either gesture.
    const passive = { capture: true, passive: true };
    listen(documentRef, "pointerdown", event => {
      pointerType = event.pointerType;
      if (pointerType === "touch" && !launch.contains(event.target)) finish();
    }, passive);
    listen(documentRef, "scroll", () => { if (input === "touch") finish(); }, passive);
    listen(reducedMotion, "change", sync);
    listen(documentRef, "visibilitychange", sync);
    const observer = windowRef.ResizeObserver ? new windowRef.ResizeObserver(measure) : null;
    if (observer) observer.observe(text);
    else listen(windowRef, "resize", measure);
    documentRef.fonts?.ready?.then(measure);
    sync();

    return {
      destroy() {
        destroyed = true;
        cancelFrame();
        observer?.disconnect();
        listeners.forEach(remove => remove());
        launch.hidden = true;
        launch.removeAttribute("aria-disabled");
        root.removeAttribute("data-flight-ready");
        plane.style.removeProperty("transform");
        plane.style.removeProperty("z-index");
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { flightPose, initTitleFlight };
  } else {
    initTitleFlight();
  }
})();
