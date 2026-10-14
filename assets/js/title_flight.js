(() => {
  "use strict";

  const IDLE = 0, FLYING = 1, FINISHING = 2;
  const LAP_MS = 8000;
  const FINISH_SPEED = 2;
  const HOVER_PAUSE_MS = 250;
  const START_PHASE = Math.PI / 2;
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
    let hover = null;
    let hoverTimer = null;
    let destroyed = false;

    function render() {
      const current = flightPose(START_PHASE + FULL_TURN * lapElapsed / LAP_MS, geometry);
      plane.style.transform = `translate3d(${current.x - 8}px, ${current.y - 8}px, 0) rotate(${current.angle}rad)`;
      plane.style.zIndex = current.front ? "2" : "0";
    }

    function measure() {
      if (destroyed) return;
      const bounds = text.getBoundingClientRect();
      if (geometry && (bounds.width !== geometry.width || bounds.height !== geometry.height)) cancelHover();
      geometry = { width: bounds.width, height: bounds.height };
      render();
    }

    function cancelFrame() {
      if (frame !== null) windowRef.cancelAnimationFrame(frame);
      frame = null;
      previousTime = null;
    }

    function cancelHover() {
      if (hoverTimer !== null) windowRef.clearTimeout(hoverTimer);
      hoverTimer = null;
      hover = null;
    }

    function waitForPause(event) {
      if (destroyed || state !== IDLE || documentRef.hidden || reducedMotion.matches) return;
      cancelHover();
      const pending = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY };
      hover = pending;
      hoverTimer = windowRef.setTimeout(() => {
        if (hover !== pending) return;
        hoverTimer = null;
        hover = null;
        start(pending.type);
      }, HOVER_PAUSE_MS);
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
      if (documentRef.hidden || reducedMotion.matches) cancelHover();
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

    function start(inputType) {
      if (destroyed || state !== IDLE || reducedMotion.matches || documentRef.hidden) return;
      cancelHover();
      input = inputType;
      state = FLYING;
      sync();
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
    listen(root, "pointerenter", event => {
      if (event.pointerType === "mouse" || event.pointerType === "pen") waitForPause(event);
    });
    listen(root, "pointermove", event => {
      if (hover && event.pointerId === hover.id && event.pointerType === hover.type &&
          (event.clientX !== hover.x || event.clientY !== hover.y)) waitForPause(event);
    });
    listen(root, "pointercancel", event => {
      if (event.pointerId === hover?.id) cancelHover();
    });
    // Keep native touch, Enter/Space and assistive activation on the button.
    listen(launch, "click", event => {
      const inputType = event.detail === 0 ? "keyboard" : event.pointerType || pointerType;
      if (inputType === "touch" || inputType === "keyboard") start(inputType);
    });
    listen(root, "pointerleave", event => {
      if (event.pointerId === hover?.id) cancelHover();
      if (event.pointerType !== "touch" && event.pointerType === input) finish();
    });
    listen(launch, "blur", () => { if (input === "keyboard") finish(); });
    // Observe outside touches and scrolling without consuming either gesture.
    const passive = { capture: true, passive: true };
    listen(documentRef, "pointerdown", event => {
      pointerType = event.pointerType;
      if (pointerType === "touch" && !launch.contains(event.target)) finish();
    }, passive);
    listen(documentRef, "scroll", () => {
      cancelHover();
      if (input === "touch") finish();
    }, passive);
    listen(windowRef, "blur", cancelHover);
    listen(reducedMotion, "change", () => { cancelHover(); sync(); });
    listen(documentRef, "visibilitychange", () => { cancelHover(); sync(); });
    const observer = windowRef.ResizeObserver ? new windowRef.ResizeObserver(measure) : null;
    if (observer) observer.observe(text);
    listen(windowRef, "resize", () => { cancelHover(); if (!observer) measure(); });
    documentRef.fonts?.ready?.then(measure);
    sync();

    return {
      destroy() {
        destroyed = true;
        cancelHover();
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
