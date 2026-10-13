(() => {
  "use strict";

  const games = new WeakMap();

  function createDragReveal({ random = Math.random } = {}) {
    return ({ documentRef, windowRef, reducedMotion, listen, controllers, transform }) => {
      // Retain the SVG sources and choice across controller reinitialisation.
      const templates = documentRef.querySelector("[data-drag-icons]");
      let game = games.get(documentRef);
      if (!game && templates) {
        const candidates = [...documentRef.querySelectorAll("[data-drag-surprise]")];
        const available = candidates.filter(candidate => !candidate.closest("[hidden]"));
        if (available.length) {
          game = {
            candidates,
            cpus: new Map(candidates.map(candidate => [candidate, candidate.children[0].cloneNode(true)])),
            icons: [...templates.content.children],
            selected: available[Math.floor(random() * available.length)],
          };
          game.selected.replaceChildren(game.icons[random() < 0.1 ? 1 : 0].cloneNode(true));
          games.set(documentRef, game);
        }
      }
      if (game && templates) {
        templates.remove();
      }

      const shakes = new Map();
      let pendingShuffle = null;
      let destroyed = false;

      function availableCandidates() {
        return game.candidates.filter(candidate => !candidate.closest("[hidden]"));
      }

      function stopShake(surface) {
        const animation = shakes.get(surface);
        if (!animation) return;
        animation.onfinish = null;
        animation.cancel();
        shakes.delete(surface);
      }

      function stopShakes() {
        for (const surface of shakes.keys()) stopShake(surface);
      }

      function stopEffects() {
        pendingShuffle = null;
        stopShakes();
      }

      function shake(surface, index) {
        if (reducedMotion?.matches || documentRef.hidden || !surface.animate) return;
        const neutral = { transform: transform([0, 0]) };
        const direction = index % 2 ? -1 : 1;
        const frames = Array.from({ length: 4 }, (_, step) => ({
          transform: transform([
            direction * (step % 2 ? -1 : 1) * (1.5 + random() * 4.5),
            0,
          ]),
        }));
        const animation = surface.animate([neutral, ...frames, neutral], {
          duration: 640 + random() * 240, easing: "ease-in-out",
        });
        shakes.set(surface, animation);
        animation.onfinish = () => stopShake(surface);
      }

      function discover(underlay, surface) {
        if (!game || underlay !== game.selected) return false;
        const icon = underlay.children[0].getBoundingClientRect();
        const cover = surface.getBoundingClientRect();
        return icon.width > 0 && icon.height > 0 && (
          cover.right <= icon.left || cover.left >= icon.right ||
          cover.bottom <= icon.top || cover.top >= icon.bottom
        );
      }

      function shuffleAfterLanding() {
        if (destroyed || !game || !pendingShuffle || documentRef.hidden || controllers.some(controller => controller.isBusy())) return;
        const previous = pendingShuffle;
        // Consume the completed find before changing SVGs or starting feedback.
        pendingShuffle = null;
        if (previous !== game.selected || previous.closest("[hidden]")) return;
        const available = availableCandidates();
        const alternatives = available.filter(candidate => candidate !== previous);
        if (!alternatives.length) return;
        stopShakes();
        previous.replaceChildren(game.cpus.get(previous).cloneNode(true));
        game.selected = alternatives[Math.floor(random() * alternatives.length)];
        game.selected.replaceChildren(game.icons[random() < 0.1 ? 1 : 0].cloneNode(true));
        controllers.filter(controller => available.includes(controller.underlay))
          .forEach((controller, index) => shake(controller.surface, index));
      }

      if (game) {
        listen(documentRef, "visibilitychange", () => { if (documentRef.hidden) stopEffects(); });
        for (const type of ["blur", "resize", "scroll"]) listen(windowRef, type, stopEffects);
        listen(reducedMotion, "change", () => { if (reducedMotion.matches) stopShakes(); });
        listen(documentRef, "keydown", event => { if (event.key === "Escape") pendingShuffle = null; });
      }

      return {
        attach({ surface, underlay }) {
          let found = false;
          let released = false;
          return {
            beforeStart() {
              if (pendingShuffle === underlay) {
                found = true;
                pendingShuffle = null;
              }
              released = false;
              stopShake(surface);
            },
            onMove() { found ||= discover(underlay, surface); },
            onRelease() { released = true; },
            onCancel() {
              found = false;
              released = false;
              if (pendingShuffle === underlay) pendingShuffle = null;
            },
            onPark() {
              const completedFind = found && released && underlay === game?.selected;
              found = false;
              released = false;
              if (completedFind) pendingShuffle = underlay;
              shuffleAfterLanding();
            },
          };
        },
        destroy() {
          destroyed = true;
          stopEffects();
        },
      };
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    const { initDragSurfaces } = require("./drag_surface.js");
    const initDragReveal = ({ random, features = [], ...options } = {}) =>
      initDragSurfaces({ ...options, features: [createDragReveal({ random }), ...features] });
    module.exports = { createDragReveal, initDragReveal };
  } else {
    window.LibPortDrag.registerFeature(createDragReveal());
  }
})();
