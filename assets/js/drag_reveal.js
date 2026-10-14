(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const transform = ([x, y]) => `translate(${x}px, ${y}px)`;

  function initDragReveal({
    documentRef = typeof document === "undefined" ? null : document,
    windowRef = typeof window === "undefined" ? null : window,
    random = Math.random,
  } = {}) {
    if (!documentRef || !windowRef?.PointerEvent) return null;

    // Consuming the inert template keeps the choice fixed for this document.
    const templates = documentRef.querySelector("[data-drag-icons]");
    const candidates = documentRef.querySelectorAll("[data-drag-surprise]");
    if (templates && candidates.length) {
      candidates[Math.floor(random() * candidates.length)].replaceChildren(
        templates.content.children[random() < 0.1 ? 1 : 0].cloneNode(true)
      );
      templates.remove();
    }

    const reducedMotion = windowRef.matchMedia?.("(prefers-reduced-motion: reduce)");
    const listeners = [];
    const cleanups = [...documentRef.querySelectorAll("[data-drag-reveal]")].map(root => {
      const surface = root.querySelector("[data-drag-surface]");
      if (!surface?.setPointerCapture) return () => {};
      const handle = root.querySelector("[data-drag-handle]");
      let pointer = null;
      let animation = null;
      let observer;
      let position = [0, 0];
      let bounds;
      let suppressClick = false;

      function constrain([x, y]) {
        // Cards may exceed the viewport; keep only the grabbed point inside it.
        if (handle) return [x, y];
        return [
          clamp(x, -bounds.left, documentRef.documentElement.clientWidth - bounds.right),
          clamp(y, -bounds.top, documentRef.documentElement.clientHeight - bounds.bottom),
        ];
      }

      function cancelAnimation() {
        if (animation) {
          animation.onfinish = null;
          animation.cancel();
          animation = null;
        }
      }

      function park() {
        cancelAnimation();
        position = [0, 0];
        observer?.disconnect();
        for (const property of ["transform", "left", "top", "width", "height"]) surface.style.removeProperty(property);
        root.style.removeProperty("height");
        root.removeAttribute("data-drag-active");
      }

      function finish(immediate = false) {
        const id = pointer?.id;
        pointer = null;
        root.removeAttribute("data-dragging");
        if (id !== undefined && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
        if (immediate || reducedMotion?.matches || documentRef.hidden || !surface.animate || !Math.hypot(...position)) {
          park();
          return;
        }
        if (animation) return;
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
        if (pointer || animation) {
          suppressClick = true;
          finish(true);
        }
      }

      function listen(target, type, callback, options) {
        target?.addEventListener(type, callback, options);
        listeners.push(() => target?.removeEventListener(type, callback, options));
      }

      listen(surface, "pointerdown", event => {
        if (pointer || !event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        if (handle && event.pointerType === "touch" && !handle.contains(event.target)) return;
        bounds = root.getBoundingClientRect();
        const current = surface.getBoundingClientRect();
        position = [current.left - bounds.left, current.top - bounds.top];
        suppressClick = Boolean(animation);
        cancelAnimation();
        pointer = {
          id: event.pointerId, x: event.clientX, y: event.clientY,
          start: position, dragged: suppressClick,
        };
        if (pointer.dragged) {
          surface.style.transform = transform(position);
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
        surface.style.transform = transform(position);
        event.preventDefault();
      });

      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        listen(windowRef, type, event => {
          // Touch transfers implicit capture from the title handle to the card.
          if (event.pointerId === pointer?.id && (type !== "lostpointercapture" || event.target === surface)) finish();
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
        if (event.key === "Escape" && (pointer || animation)) {
          event.preventDefault();
          suppressClick = true;
          finish();
        }
      });
      listen(documentRef, "visibilitychange", () => { if (documentRef.hidden) reset(); });
      for (const type of ["blur", "resize", "scroll"]) listen(windowRef, type, reset);
      listen(reducedMotion, "change", () => { if (reducedMotion.matches && animation) park(); });
      root.setAttribute("data-drag-ready", "");

      return () => {
        reset();
        root.removeAttribute("data-drag-ready");
      };
    });

    return {
      destroy() {
        cleanups.forEach(cleanup => cleanup());
        listeners.forEach(remove => remove());
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initDragReveal };
  } else {
    initDragReveal();
  }
})();
