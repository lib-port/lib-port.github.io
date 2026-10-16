(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const transform = ([x, y]) => `translate(${x}px, ${y}px)`;
  const rect = (left, top, width, height) => Object.freeze({ left, top, width, height, right: left + width, bottom: top + height });

  function initDragSurfaces({
    documentRef = typeof document === "undefined" ? null : document,
    windowRef = typeof window === "undefined" ? null : window,
    features = [],
  } = {}) {
    if (!documentRef || !windowRef?.PointerEvent) return null;
    const reducedMotion = windowRef.matchMedia?.("(prefers-reduced-motion: reduce)");
    const listeners = [];
    const controllers = [];
    const owners = new Map();
    const dirty = new Set();
    const watchedCards = new Set();
    let frame = null;
    let observer = null;
    let destroyed = false;

    function listen(target, type, callback, options) {
      target?.addEventListener(type, callback, options);
      listeners.push(() => target?.removeEventListener(type, callback, options));
    }

    function discardPaint(controller) {
      dirty.delete(controller);
      if (!dirty.size && frame) {
        const previous = frame;
        frame = null;
        windowRef.cancelAnimationFrame(previous.id);
      }
    }

    function queuePaint(controller) {
      if (reducedMotion?.matches || !windowRef.requestAnimationFrame || !windowRef.cancelAnimationFrame) {
        controller.render();
        return;
      }
      dirty.add(controller);
      if (frame) return;
      const scheduled = { id: null };
      frame = scheduled;
      scheduled.id = windowRef.requestAnimationFrame(() => {
        if (frame !== scheduled || destroyed) return;
        frame = null;
        const pending = [...dirty];
        dirty.clear();
        pending.forEach(item => item.render());
      });
    }

    function unwatch(controller) {
      watchedCards.delete(controller);
      if (!watchedCards.size) {
        observer?.disconnect();
        observer = null;
      }
    }

    function watch(controller) {
      watchedCards.add(controller);
      if (observer || !windowRef.MutationObserver) return;
      const current = new windowRef.MutationObserver(() => {
        if (observer !== current || destroyed) return;
        [...watchedCards].forEach(item => item.reset());
      });
      observer = current;
      current.observe(documentRef.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ["hidden"],
      });
    }

    // Providers register their global hooks first, preserving cancellation order.
    const context = {
      documentRef, windowRef, reducedMotion, listen, controllers, transform,
      get destroyed() { return destroyed; },
    };
    const providers = features.map(factory => factory(context));
    for (const root of documentRef.querySelectorAll("[data-drag-reveal]")) {
      const surface = root.querySelector("[data-drag-surface]");
      if (!surface?.setPointerCapture) continue;
      const handle = root.querySelector("[data-drag-handle]");
      const underlay = root.querySelector("[data-drag-surprise]");
      const isTheme = surface.hasAttribute("data-theme-toggle");
      let pointer = null;
      let animation = null;
      let position = [0, 0];
      let bounds;
      let size;
      let handleSize;
      let underlayRect;
      let suppressClick = false;

      function viewportBounds() {
        const viewport = isTheme && windowRef.visualViewport;
        return {
          left: viewport?.offsetLeft || 0,
          top: viewport?.offsetTop || 0,
          width: viewport?.width || documentRef.documentElement.clientWidth,
          height: viewport?.height || documentRef.documentElement.clientHeight,
        };
      }

      function constrain([x, y]) {
        // Cards may exceed the viewport; keep only the grabbed point inside it.
        if (handle) return [x, y];
        const viewport = viewportBounds();
        return [
          clamp(x, viewport.left - bounds.left, viewport.left + viewport.width - bounds.right),
          clamp(y, viewport.top - bounds.top, viewport.top + viewport.height - bounds.bottom),
        ];
      }

      // Physics already runs in a frame callback and needs an immediate render.
      function render() {
        discardPaint(controller);
        surface.style.transform = transform(position);
      }

      const state = {
        root, surface, handle, underlay, viewportBounds, render, park, reset,
        get position() { return position; },
        set position(value) { position = value; },
        get bounds() { return bounds; },
        get surfaceRect() { return size && rect(bounds.left + position[0], bounds.top + position[1], size.width, size.height); },
        get underlayRect() { return underlayRect; },
      };
      const hooks = providers.map(provider => provider.attach(state)).filter(Boolean);
      if (!hooks.length) continue;
      const motion = hooks.find(hook => hook.motion)?.motion;
      const notify = (name, event) => hooks.forEach(hook => hook[name]?.(event));
      const moving = () => Boolean(animation || motion?.isBusy());
      const controller = {
        root, surface, underlay, render, reset, isTheme,
        isBusy: () => Boolean(pointer || moving()),
        move, end,
        escape(event) {
          if (!pointer && !moving()) return;
          event.preventDefault();
          suppressClick = true;
          notify("onCancel");
          finish(Boolean(motion?.isBusy()));
        },
        reduce() { if (moving()) park(); else if (dirty.has(controller)) render(); },
      };
      controllers.push(controller);

      function cancelAnimation() {
        if (animation) {
          animation.onfinish = null;
          animation.cancel();
          animation = null;
        }
      }

      function park() {
        discardPaint(controller);
        cancelAnimation();
        motion?.cancel();
        position = [0, 0];
        bounds = size = underlayRect = handleSize = undefined;
        unwatch(controller);
        for (const property of ["transform", "left", "top", "width", "height"]) surface.style.removeProperty(property);
        root.style.removeProperty("height");
        root.removeAttribute("data-drag-active");
        notify("onPark");
      }

      function finish(immediate = false, released = false) {
        if (immediate) discardPaint(controller);
        else if (dirty.has(controller)) render();
        const dragged = pointer?.dragged;
        const id = pointer?.id;
        pointer = null;
        owners.delete(id);
        root.removeAttribute("data-dragging");
        if (id !== undefined && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
        if (immediate || reducedMotion?.matches || documentRef.hidden) { park(); return; }
        if (moving()) return;
        if (released && dragged && motion?.start()) return;
        if (!surface.animate || !Math.hypot(...position)) { park(); return; }
        const bounce = Math.min(0.08, 8 / Math.hypot(...position));
        animation = surface.animate([
          { transform: transform(position), offset: 0 },
          { transform: transform(constrain(position.map(value => -value * bounce))), offset: 0.7 },
          { transform: transform(constrain(position.map(value => value * bounce / 3))), offset: 0.85 },
          { transform: transform([0, 0]), offset: 1 },
        ], { duration: 400, easing: "ease-out", fill: "forwards" });
        animation.onfinish = park;
      }

      function reset(event) {
        notify("onCancel", event);
        if (pointer || moving()) { suppressClick = true; finish(true); }
      }

      listen(surface, "pointerdown", event => {
        if (pointer || owners.has(event.pointerId) || !event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        if (handle && event.pointerType === "touch" && !handle.contains(event.target)) return;
        notify("beforeStart");
        // Read geometry once per pickup, including the visible position on regrab.
        bounds = root.getBoundingClientRect();
        size = surface.getBoundingClientRect();
        underlayRect = underlay?.children[0]?.getBoundingClientRect();
        handleSize = handle?.querySelector("svg").getBoundingClientRect();
        position = [size.left - bounds.left, size.top - bounds.top];
        suppressClick = moving();
        cancelAnimation();
        motion?.cancel();
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position, dragged: suppressClick };
        owners.set(pointer.id, controller);
        notify("onStart", event);
        if (pointer.dragged) { render(); capture(); }
      });

      function capture() {
        // Delay capture until dragging so a normal click reaches its nested link.
        try { surface.setPointerCapture(pointer.id); } catch { finish(true); return false; }
        pointer.dragged = true;
        suppressClick = true;
        if (handle) {
          const width = handleSize.width * 2;
          const height = handleSize.height * 2;
          underlayRect = rect(bounds.left + (bounds.width - width) / 2, bounds.top + (bounds.height - height) / 2, width, height);
          root.style.height = `${bounds.height}px`;
          for (const property of ["left", "top", "width", "height"]) surface.style[property] = `${bounds[property]}px`;
          const svg = root.querySelector(".card-cpu > svg");
          svg.style.width = `${width}px`;
          svg.style.height = `${height}px`;
          // One observer covers every reserved card until all have returned home.
          watch(controller);
        }
        root.setAttribute("data-drag-active", "");
        root.setAttribute("data-dragging", "");
        return true;
      }

      function move(event) {
        if (!pointer) return;
        const dx = (handle ? clamp(event.clientX, 0, documentRef.documentElement.clientWidth) : event.clientX) - pointer.x;
        const dy = (handle ? clamp(event.clientY, 0, documentRef.documentElement.clientHeight) : event.clientY) - pointer.y;
        if (!pointer.dragged && Math.hypot(dx, dy) < 6) return;
        if (!pointer.dragged && !capture()) return;
        position = constrain([pointer.start[0] + dx, pointer.start[1] + dy]);
        queuePaint(controller);
        // Keep all input samples for velocity and reveal thresholds.
        notify("onMove", event);
        event.preventDefault();
      }

      function end(event) {
        // Touch transfers implicit capture from the title handle to the card.
        if (event.type === "lostpointercapture" && event.target !== surface) return;
        const released = event.type === "pointerup";
        notify(released ? "onRelease" : "onCancel", event);
        finish(false, released);
      }

      listen(surface, "dragstart", event => event.preventDefault());
      listen(surface, "click", event => {
        if (suppressClick && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
      root.setAttribute("data-drag-ready", "");
    }

    listen(windowRef, "pointermove", event => owners.get(event.pointerId)?.move(event));
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      listen(windowRef, type, event => owners.get(event.pointerId)?.end(event));
    }
    listen(documentRef, "keydown", event => {
      if (event.key === "Escape") controllers.forEach(item => item.escape(event));
    });
    listen(documentRef, "visibilitychange", () => {
      if (documentRef.hidden) controllers.forEach(item => item.reset());
    });
    for (const type of ["blur", "resize", "scroll"]) {
      listen(windowRef, type, event => controllers.forEach(item => item.reset(event)));
      if (type !== "blur") listen(windowRef.visualViewport, type, event => controllers.forEach(item => { if (item.isTheme) item.reset(event); }));
    }
    listen(reducedMotion, "change", () => {
      if (reducedMotion.matches) controllers.forEach(item => item.reduce());
    });

    return {
      destroy() {
        destroyed = true;
        providers.forEach(provider => provider.destroy?.());
        controllers.forEach(item => {
          item.reset();
          discardPaint(item);
          item.root.removeAttribute("data-drag-ready");
        });
        observer?.disconnect();
        observer = null;
        watchedCards.clear();
        owners.clear();
        listeners.forEach(remove => remove());
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initDragSurfaces };
  } else {
    const features = [];
    let controller;
    window.LibPortDrag = {
      registerFeature(factory) { features.push(factory); },
      init() {
        controller?.destroy();
        controller = initDragSurfaces({ features });
        return controller;
      },
    };
    // Deferred feature scripts finish registering before DOMContentLoaded.
    if (document.readyState === "complete") queueMicrotask(() => window.LibPortDrag.init());
    else document.addEventListener("DOMContentLoaded", () => window.LibPortDrag.init(), { once: true });
  }
})();
