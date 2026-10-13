(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const transform = ([x, y]) => `translate(${x}px, ${y}px)`;

  function initDragSurfaces({
    documentRef = typeof document === "undefined" ? null : document,
    windowRef = typeof window === "undefined" ? null : window,
    features = [],
  } = {}) {
    if (!documentRef || !windowRef?.PointerEvent) return null;
    const reducedMotion = windowRef.matchMedia?.("(prefers-reduced-motion: reduce)");
    const listeners = [];
    const controllers = [];
    let destroyed = false;

    function listen(target, type, callback, options) {
      target?.addEventListener(type, callback, options);
      listeners.push(() => target?.removeEventListener(type, callback, options));
    }

    // Feature factories register hooks before any surface receives pointer input.
    const context = {
      documentRef, windowRef, reducedMotion, listen, controllers, transform,
      get destroyed() { return destroyed; },
    };
    const providers = features.map(factory => factory(context));
    const cleanups = [...documentRef.querySelectorAll("[data-drag-reveal]")].map(root => {
      const surface = root.querySelector("[data-drag-surface]");
      if (!surface?.setPointerCapture) return () => {};
      const handle = root.querySelector("[data-drag-handle]");
      const underlay = root.querySelector("[data-drag-surprise]");
      const isTheme = surface.hasAttribute("data-theme-toggle");
      let pointer = null;
      let animation = null;
      let observer;
      let position = [0, 0];
      let bounds;
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

      function render() { surface.style.transform = transform(position); }

      const state = {
        root, surface, handle, underlay, viewportBounds, render, park, reset,
        get position() { return position; },
        set position(value) { position = value; },
        get bounds() { return bounds; },
      };
      // Returning null leaves this surface outside that feature's pointer handling.
      const hooks = providers.map(provider => provider.attach(state)).filter(Boolean);
      if (!hooks.length) return () => {};
      const motion = hooks.find(hook => hook.motion)?.motion;
      const notify = (name, event) => hooks.forEach(hook => hook[name]?.(event));
      const moving = () => Boolean(animation || motion?.isBusy());

      function cancelAnimation() {
        if (animation) {
          animation.onfinish = null;
          animation.cancel();
          animation = null;
        }
      }

      function park() {
        cancelAnimation();
        motion?.cancel();
        position = [0, 0];
        observer?.disconnect();
        for (const property of ["transform", "left", "top", "width", "height"]) surface.style.removeProperty(property);
        root.style.removeProperty("height");
        root.removeAttribute("data-drag-active");
        notify("onPark");
      }

      function finish(immediate = false, released = false) {
        const dragged = pointer?.dragged;
        const id = pointer?.id;
        pointer = null;
        root.removeAttribute("data-dragging");
        if (id !== undefined && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
        if (immediate || reducedMotion?.matches || documentRef.hidden) {
          park();
          return;
        }
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

      function reset() {
        notify("onCancel");
        if (pointer || moving()) {
          suppressClick = true;
          finish(true);
        }
      }

      listen(surface, "pointerdown", event => {
        if (pointer || !event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        if (handle && event.pointerType === "touch" && !handle.contains(event.target)) return;
        notify("beforeStart");
        bounds = root.getBoundingClientRect();
        const current = surface.getBoundingClientRect();
        position = [current.left - bounds.left, current.top - bounds.top];
        suppressClick = moving();
        cancelAnimation();
        motion?.cancel();
        pointer = {
          id: event.pointerId, x: event.clientX, y: event.clientY,
          start: position, dragged: suppressClick,
        };
        notify("onStart", event);
        if (pointer.dragged) {
          render();
          capture();
        }
      });

      function capture() {
        // Delay capture until dragging so a normal click reaches its nested link.
        try { surface.setPointerCapture(pointer.id); } catch { finish(true); return false; }
        pointer.dragged = true;
        suppressClick = true;
        if (handle) {
          root.style.height = `${bounds.height}px`;
          for (const property of ["left", "top", "width", "height"]) surface.style[property] = `${bounds[property]}px`;
          const icon = handle.querySelector("svg").getBoundingClientRect();
          const underlay = root.querySelector(".card-cpu > svg");
          for (const dimension of ["width", "height"]) underlay.style[dimension] = `${icon[dimension] * 2}px`;
          // Live content or hidden-state changes can move the reserved card space.
          observer?.disconnect();
          observer = windowRef.MutationObserver && new windowRef.MutationObserver(reset);
          observer?.observe(documentRef.body, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ["hidden"],
          });
        }
        root.setAttribute("data-drag-active", "");
        root.setAttribute("data-dragging", "");
        return true;
      }

      listen(windowRef, "pointermove", event => {
        if (event.pointerId !== pointer?.id) return;
        const dx = (handle ? clamp(event.clientX, 0, documentRef.documentElement.clientWidth) : event.clientX) - pointer.x;
        const dy = (handle ? clamp(event.clientY, 0, documentRef.documentElement.clientHeight) : event.clientY) - pointer.y;
        if (!pointer.dragged && Math.hypot(dx, dy) < 6) return;
        if (!pointer.dragged && !capture()) return;
        position = constrain([pointer.start[0] + dx, pointer.start[1] + dy]);
        render();
        notify("onMove", event);
        event.preventDefault();
      });

      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        listen(windowRef, type, event => {
          // Touch transfers implicit capture from the title handle to the card.
          if (event.pointerId === pointer?.id && (type !== "lostpointercapture" || event.target === surface)) {
            const released = type === "pointerup";
            notify(released ? "onRelease" : "onCancel", event);
            finish(false, released);
          }
        });
      }
      listen(surface, "dragstart", event => event.preventDefault());
      listen(surface, "click", event => {
        // Keyboard activation remains available, including after a cancelled drag.
        if (suppressClick && event.detail !== 0) {
          event.preventDefault();
          event.stopPropagation();
        }
      }, true);
      listen(documentRef, "keydown", event => {
        if (event.key === "Escape" && (pointer || moving())) {
          event.preventDefault();
          suppressClick = true;
          notify("onCancel");
          finish(Boolean(motion?.isBusy()));
        }
      });
      listen(documentRef, "visibilitychange", () => { if (documentRef.hidden) reset(); });
      for (const type of ["blur", "resize", "scroll"]) listen(windowRef, type, reset);
      if (isTheme) for (const type of ["resize", "scroll"]) listen(windowRef.visualViewport, type, reset);
      listen(reducedMotion, "change", () => { if (reducedMotion.matches && moving()) park(); });
      root.setAttribute("data-drag-ready", "");
      controllers.push({ surface, underlay, isBusy: () => Boolean(pointer || moving()) });

      return () => {
        reset();
        root.removeAttribute("data-drag-ready");
      };
    });

    return {
      destroy() {
        destroyed = true;
        providers.forEach(provider => provider.destroy?.());
        cleanups.forEach(cleanup => cleanup());
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
