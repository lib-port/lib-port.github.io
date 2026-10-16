(() => {
  "use strict";

  const IDLE = 0, FLYING = 1, FINISHING = 2;
  const STRUGGLING = 3, SUCTION = 4, RETURNING = 5, SETTLING = 6, SWALLOWED = 7;
  const LAP_MS = 4000;
  const FINISH_SPEED = 2;
  const HOVER_PAUSE_MS = 62.5;
  const START_PHASE = Math.PI / 2;
  const FULL_TURN = 2 * Math.PI;
  const clamp = value => Math.min(1, Math.max(0, value));
  const smooth = value => value * value * (3 - 2 * value);
  const centre = element => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  };
  const direction = (from, to) => {
    const x = to.x - from.x, y = to.y - from.y;
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  };

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
    let state = root.hasAttribute("data-plane-swallowed") ? SWALLOWED : IDLE;
    let input;
    let pointerType;
    let frame = null;
    let previousTime = null;
    let hover = null;
    let hoverTimer = null;
    let destroyed = false;
    let vortex = null;
    let held = null;
    let motion = null;
    let overlay = null;
    let pose;
    let freePose;
    const now = () => windowRef.performance.now();
    const random = () => (windowRef.Math || Math).random();

    function restingPose() {
      return flightPose(START_PHASE, geometry);
    }

    function homePoint() {
      const origin = centre(root), home = restingPose();
      return { x: origin.x + home.x, y: origin.y + home.y };
    }

    function strugglePose(time) {
      const elapsed = Math.min(2000, Math.max(0, time - motion.startedAt));
      const progress = elapsed / 2000;
      const distance = 96 * progress * (2 - progress);
      const { from, away } = motion;
      const wobble = 8 * Math.sin(16 * Math.PI * progress) * Math.sin(Math.PI * progress);
      const offset = distance + wobble;
      const angle = Math.atan2(away.y, away.x);
      const turn = Math.atan2(Math.sin(angle - from.angle), Math.cos(angle - from.angle));
      return { ...from,
        x: from.x + offset * away.x,
        y: from.y + offset * away.y,
        angle: from.angle + turn * smooth(clamp(elapsed / 120)) };
    }

    function clearOverlay() {
      overlay?.remove();
      overlay = null;
      root.removeAttribute("data-plane-detached");
    }

    function beginSuction(time) {
      const origin = centre(root);
      freePose = { x: origin.x + pose.x, y: origin.y + pose.y, angle: pose.angle };
      overlay = plane.cloneNode(true);
      overlay.removeAttribute("data-title-flight-plane");
      overlay.setAttribute("data-plane-overlay", "");
      overlay.style.removeProperty("z-index");
      documentRef.body.append(overlay);
      root.setAttribute("data-plane-detached", "");
      cancelHover();
      state = SUCTION;
      motion = { startedAt: time, from: freePose };
    }

    function transitPoint(progress, target) {
      const amount = state === SUCTION ? progress ** 3 : smooth(progress);
      const from = motion.from;
      const pull = direction(from, target);
      const wave = state === RETURNING ? motion.amplitude *
        Math.sin(FULL_TURN * motion.waves * amount + motion.phase) * Math.sin(Math.PI * amount) : 0;
      return { x: from.x + (target.x - from.x) * amount - pull.y * wave,
        y: from.y + (target.y - from.y) * amount + pull.x * wave };
    }

    function renderTransit(time) {
      const duration = state === SUCTION ? 1200 : 1000;
      const progress = clamp((time - motion.startedAt) / duration);
      const target = state === SUCTION ? centre(vortex.root) : homePoint();
      const current = transitPoint(progress, target);
      let angle = motion.from.angle;
      if (state === RETURNING) {
        const before = transitPoint(Math.max(0, progress - 0.0001), target);
        const after = transitPoint(Math.min(1, progress + 0.0001), target);
        const tangent = Math.atan2(after.y - before.y, after.x - before.x);
        const turn = Math.atan2(Math.sin(tangent - angle), Math.cos(tangent - angle));
        angle += turn * smooth(clamp((time - motion.startedAt) / 120));
      }
      freePose = { ...current, angle };
      overlay.style.transform = `translate3d(${current.x - 8}px, ${current.y - 8}px, 0) rotate(${freePose.angle}rad)`;
      if (progress < 1 - 1e-10) return;
      const swallowed = state === SUCTION;
      clearOverlay();
      motion = null;
      state = swallowed ? SWALLOWED : IDLE;
      lapElapsed = 0;
      if (swallowed) {
        root.setAttribute("data-plane-swallowed", "");
        vortex = held = null;
      }
      render(time);
    }

    function render(time = now()) {
      root.setAttribute("data-plane-motion", ["idle", "flying", "finishing", "struggling", "suction", "returning", "settling", "swallowed"][state]);
      if (state === SUCTION || state === RETURNING) { renderTransit(time); return; }
      const current = state === STRUGGLING ? strugglePose(time)
        : flightPose(START_PHASE + FULL_TURN * lapElapsed / LAP_MS, geometry);
      if (state === IDLE && vortex) {
        const pull = direction(homePoint(), centre(vortex.root));
        const amount = 12 * smooth(clamp((time - vortex.startedAt - 2000) / 300));
        current.x += amount * pull.x;
        current.y += amount * pull.y;
        if (amount > 0) root.setAttribute("data-plane-motion", "tug");
      }
      if (state === SETTLING) {
        const amount = 1 - smooth(clamp((time - motion.startedAt) / 250));
        current.x += motion.offset.x * amount;
        current.y += motion.offset.y * amount;
        if (!amount) { state = IDLE; motion = null; root.setAttribute("data-plane-motion", "idle"); }
      }
      pose = current;
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

    function waitForPause(event, captured = false) {
      if (destroyed || state !== IDLE || documentRef.hidden || reducedMotion.matches) return;
      cancelHover();
      const pending = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, captured };
      hover = pending;
      hoverTimer = windowRef.setTimeout(() => {
        if (hover !== pending) return;
        if (captured && (!held || held.pointerId !== pending.id || !insideActivation(held))) { cancelHover(); return; }
        hoverTimer = null;
        hover = null;
        start(pending.type);
      }, HOVER_PAUSE_MS);
    }

    function schedule() {
      if (frame === null && state !== SWALLOWED && (state !== IDLE || vortex) && !documentRef.hidden && !reducedMotion.matches) {
        const current = windowRef.requestAnimationFrame(time => {
          if (destroyed || frame !== current) return;
          frame = null;
          tick(time);
        });
        frame = current;
      }
    }

    function tick(time) {
      if (destroyed || documentRef.hidden || reducedMotion.matches) {
        if (documentRef.hidden) { resetGravity(); render(); }
        sync();
        return;
      }
      if (!Number.isFinite(time) || (vortex && (vortex.root.isConnected === false ||
          !Object.values(centre(vortex.root)).every(Number.isFinite)))) {
        resetGravity(); render(); sync(); return;
      }
      const previous = previousTime === null ? time : previousTime;
      previousTime = time;
      if (state === FLYING || state === FINISHING) {
        const deadline = vortex ? vortex.startedAt + 2000 : Infinity;
        advanceLoop(Math.max(0, Math.min(time, deadline) - previous));
        if (state !== IDLE && time >= deadline) {
          render(deadline);
          beginSuction(deadline);
        }
      }
      if (state === IDLE && vortex && time >= vortex.startedAt + 5000) {
        const deadline = vortex.startedAt + 5000;
        render(deadline);
        beginSuction(deadline);
      }
      if (state === STRUGGLING && time >= motion.startedAt + 2000) {
        const deadline = motion.startedAt + 2000;
        render(deadline);
        beginSuction(deadline);
      }
      render(time);
      sync();
    }

    function advanceLoop(elapsed) {
      const speed = state === FINISHING ? FINISH_SPEED : 1;
      const nextElapsed = lapElapsed + elapsed * speed;
      if (state === FINISHING && nextElapsed >= LAP_MS) {
        // End at the resting point even if this frame overshoots the loop.
        lapElapsed = 0;
        state = IDLE;
      } else if (state !== IDLE) {
        lapElapsed = nextElapsed % LAP_MS;
      }
    }

    function sync() {
      if (destroyed) return;
      if (documentRef.hidden || reducedMotion.matches) cancelHover();
      if (reducedMotion.matches) {
        resetGravity();
        if (state !== SWALLOWED) state = IDLE;
        lapElapsed = 0;
        render();
      }
      launch.hidden = reducedMotion.matches || state >= STRUGGLING;
      launch.setAttribute("aria-disabled", String(state !== IDLE));
      if (documentRef.hidden || state === SWALLOWED || (state === IDLE && !vortex)) cancelFrame();
      else schedule();
    }

    function start(inputType) {
      if (vortex && state === IDLE && now() >= vortex.startedAt + 5000) tick(now());
      if (destroyed || state !== IDLE || reducedMotion.matches || documentRef.hidden) return;
      cancelHover();
      input = inputType;
      if (vortex) {
        render();
        const origin = centre(root);
        motion = { startedAt: now(), from: { ...pose },
          away: direction(centre(vortex.root), { x: origin.x + pose.x, y: origin.y + pose.y }) };
        state = STRUGGLING;
      } else state = FLYING;
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

    function resetGravity() {
      if (vortex || (state >= STRUGGLING && state < SWALLOWED)) {
        cancelHover();
        clearOverlay();
        if (state !== SWALLOWED) { state = IDLE; lapElapsed = 0; }
        motion = null;
      }
      vortex = held = null;
    }

    function insideActivation(event) {
      return !launch.hidden && [root, launch].some(element => {
        const bounds = element.getBoundingClientRect();
        return event.clientX >= bounds.left && event.clientX <= bounds.right &&
          event.clientY >= bounds.top && event.clientY <= bounds.bottom;
      });
    }

    function trackHeld(event) {
      if (!held || event.pointerId !== held.pointerId || event.pointerType !== held.pointerType) return;
      const inside = insideActivation(event);
      const moved = held.clientX !== event.clientX || held.clientY !== event.clientY;
      if (inside && (!held.inside || moved)) waitForPause(event, true);
      if (!inside && held.inside) {
        cancelHover();
        if (input === held.pointerType) finish();
      }
      held = { ...held, clientX: event.clientX, clientY: event.clientY, inside };
    }

    function onVortex({ detail }) {
      if (destroyed || state === SWALLOWED || !detail) return;
      const { phase } = detail;
      if (phase === "start") {
        if (documentRef.hidden || reducedMotion.matches || !Number.isFinite(detail.startedAt)) return;
        vortex = detail;
      } else if (!vortex || vortex.root !== detail.root || vortex.startedAt !== detail.startedAt) return;
      else if (phase === "grab") {
        if (detail.pointerType === "mouse" || detail.pointerType === "pen") {
          held = { ...detail, inside: false };
          trackHeld(detail);
        }
      } else if (phase === "release") {
        if (hover?.captured) cancelHover();
        held = null;
      } else if (phase === "cancel") {
        resetGravity();
        render();
      } else if (phase === "home") {
        tick(now());
        const time = now();
        if (state === STRUGGLING) { render(time); beginSuction(time); }
        if (state === SUCTION) {
          render(time);
          state = RETURNING;
          motion = { startedAt: time, from: freePose, amplitude: 8 + 4 * random(),
            waves: 1.5 + random(), phase: FULL_TURN * random() };
        } else if (state === IDLE) {
          const home = restingPose();
          const offset = { x: pose.x - home.x, y: pose.y - home.y };
          if (Math.hypot(offset.x, offset.y) > 0.0001) {
            state = SETTLING;
            motion = { startedAt: time, offset };
          }
        }
        if (hover?.captured) cancelHover();
        vortex = held = null;
        render(time);
      }
      sync();
    }

    measure();
    root.setAttribute("data-flight-ready", "");
    listen(root, "pointerenter", event => {
      if (held?.pointerId === event.pointerId) return;
      if (event.pointerType === "mouse" || event.pointerType === "pen") waitForPause(event);
    });
    listen(root, "pointermove", event => {
      if (held?.pointerId === event.pointerId) return;
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
      if (held?.pointerId === event.pointerId) return;
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
      resetGravity(); render(); sync();
      if (input === "touch") finish();
    }, passive);
    listen(windowRef, "blur", () => { cancelHover(); resetGravity(); render(); sync(); });
    listen(windowRef, "libport:ball-vortex", onVortex);
    listen(windowRef, "pointermove", trackHeld, { capture: true, passive: true });
    listen(reducedMotion, "change", () => { cancelHover(); sync(); });
    listen(documentRef, "visibilitychange", () => { cancelHover(); if (documentRef.hidden) resetGravity(); render(); sync(); });
    listen(documentRef, "keydown", event => {
      if (event.key === "Escape") { resetGravity(); render(); sync(); }
    });
    const observer = windowRef.ResizeObserver ? new windowRef.ResizeObserver(measure) : null;
    if (observer) observer.observe(text);
    listen(windowRef, "resize", () => { cancelHover(); resetGravity(); render(); sync(); if (!observer) measure(); });
    documentRef.fonts?.ready?.then(measure);
    sync();

    return {
      destroy() {
        destroyed = true;
        cancelHover();
        cancelFrame();
        resetGravity();
        observer?.disconnect();
        listeners.forEach(remove => remove());
        launch.hidden = true;
        launch.removeAttribute("aria-disabled");
        root.removeAttribute("data-flight-ready");
        root.removeAttribute("data-plane-motion");
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
