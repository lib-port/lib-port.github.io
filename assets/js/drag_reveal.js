(() => {
  "use strict";

  const games = new WeakMap();

  function createDragReveal({ random = Math.random } = {}) {
    return ({ documentRef, windowRef, reducedMotion, listen, controllers, transform }) => {
      // Retain the SVG sources, choice and progress across controller reinitialisation.
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
            finds: 0,
            complete: false,
            revealed: false,
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
      const trophy = documentRef.querySelector("[data-drag-trophy]");
      const trophyIcon = trophy?.querySelector(".octicon");
      const trophyProgress = trophy?.querySelector("[data-drag-trophy-progress]");
      let trophyAnimation = null;

      function trophyTier(finds = game?.finds || 0) {
        return finds >= 15 ? "gold" : finds >= 10 ? "silver" : finds >= 5 ? "bronze" : null;
      }

      function renderTrophy(tier = trophyTier()) {
        if (!trophy) return;
        if (tier) {
          trophy.setAttribute("data-trophy-tier", tier);
          trophy.setAttribute("aria-label", `${tier[0].toUpperCase() + tier.slice(1)} discovery trophy`);
          trophy.removeAttribute("aria-hidden");
        } else {
          trophy.removeAttribute("data-trophy-tier");
          trophy.removeAttribute("aria-label");
          trophy.setAttribute("aria-hidden", "true");
        }
      }

      function renderProgress() {
        if (!trophyProgress) return;
        const finds = Math.min(game?.finds || 0, 20);
        const progress = finds === 20 ? 5 : finds % 5;
        const target = finds < 5 ? "bronze trophy" : finds < 10 ? "silver trophy" : finds < 15 ? "gold trophy" : "game completion";
        const description = `${finds} completed; ${progress} of 5 towards ${target}; ${5 - progress} remaining`;
        trophyProgress.style.setProperty("--trophy-progress", String(progress / 5));
        trophyProgress.setAttribute("aria-valuenow", String(progress));
        trophyProgress.setAttribute("aria-label", `Progress towards ${target}`);
        trophyProgress.setAttribute("aria-valuetext", description);
        trophy.setAttribute("title", description);
      }

      function stopTrophy() {
        if (!trophyAnimation) return;
        const animation = trophyAnimation;
        trophyAnimation = null;
        animation.onfinish = animation.oncancel = null;
        animation.cancel();
      }

      function settleTrophy() {
        stopTrophy();
        renderTrophy();
      }

      function awardTrophy() {
        if (!trophy) return;
        stopTrophy();
        const fade = game.finds === 5;
        const target = fade ? trophy : trophyIcon;
        if (reducedMotion?.matches || documentRef.hidden || !target?.animate) { renderTrophy(); return; }
        renderTrophy(fade ? "bronze" : trophyTier(game.finds - 1));
        const animation = target.animate(fade ? [{ opacity: 0 }, { opacity: 1 }] : [
          { transform: "perspective(8rem) rotateY(0deg)" },
          { transform: "perspective(8rem) rotateY(360deg)" },
        ], { duration: fade ? 300 : 600, easing: fade ? "ease-out" : "ease-in-out" });
        trophyAnimation = animation;
        animation.onfinish = animation.oncancel = () => {
          if (trophyAnimation === animation) settleTrophy();
        };
      }

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
        settleTrophy();
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
        animation.onfinish = () => {
          if (shakes.get(surface) !== animation) return;
          stopShake(surface);
          finishShuffle();
        };
      }

      function discover(state) {
        if (!game || game.complete || state.underlay !== game.selected) return false;
        const icon = state.underlayRect;
        const cover = state.surfaceRect;
        const found = icon && cover && icon.width > 0 && icon.height > 0 && (
          cover.right <= icon.left || cover.left >= icon.right ||
          cover.bottom <= icon.top || cover.top >= icon.bottom
        );
        if (found && !game.revealed) {
          game.revealed = true;
          game.finds++;
          renderProgress();
          if (game.finds === 20) {
            game.complete = true;
            settleTrophy();
            windowRef.location.assign("https://www.khanacademy.org/");
          } else if (game.finds === 5 || game.finds === 10 || game.finds === 15) awardTrophy();
        }
        return found;
      }

      function finishShuffle() {
        if (destroyed || !game || game.complete || !pendingShuffle?.shaking || shakes.size || documentRef.hidden || controllers.some(controller => controller.isBusy())) return;
        const previous = pendingShuffle.underlay;
        // Consume the completed feedback before changing SVGs.
        pendingShuffle = null;
        if (previous !== game.selected || previous.closest("[hidden]")) return;
        const alternatives = availableCandidates().filter(candidate => candidate !== previous);
        if (!alternatives.length) return;
        previous.replaceChildren(game.cpus.get(previous).cloneNode(true));
        game.selected = alternatives[Math.floor(random() * alternatives.length)];
        game.selected.replaceChildren(game.icons[random() < 0.1 ? 1 : 0].cloneNode(true));
        game.revealed = false;
      }

      function shuffleAfterLanding() {
        if (destroyed || !game || game.complete || !pendingShuffle || documentRef.hidden || controllers.some(controller => controller.isBusy())) return;
        if (pendingShuffle.shaking) { finishShuffle(); return; }
        const previous = pendingShuffle.underlay;
        const available = availableCandidates();
        if (previous !== game.selected || !available.includes(previous) || !available.some(candidate => candidate !== previous)) {
          stopEffects();
          return;
        }
        pendingShuffle.shaking = true;
        controllers.filter(controller => available.includes(controller.underlay))
          .forEach((controller, index) => shake(controller.surface, index));
        finishShuffle();
      }

      if (game) {
        renderTrophy();
        renderProgress();
        listen(documentRef, "visibilitychange", () => { if (documentRef.hidden) stopEffects(); });
        for (const type of ["blur", "resize"]) listen(windowRef, type, stopEffects);
        listen(windowRef, "scroll", settleTrophy);
        listen(reducedMotion, "change", () => {
          if (reducedMotion.matches) {
            settleTrophy();
            stopShakes();
            shuffleAfterLanding();
          }
        });
        listen(documentRef, "keydown", event => { if (event.key === "Escape") stopEffects(); });
      }

      return {
        attach(state) {
          const { surface, underlay } = state;
          let found = false;
          let released = false;
          return {
            beforeStart() {
              if (pendingShuffle?.underlay === underlay && !pendingShuffle.shaking) {
                found = true;
                pendingShuffle = null;
              }
              released = false;
              stopShake(surface);
            },
            onMove() { if (!pendingShuffle?.shaking) found ||= discover(state); },
            onRelease() { released = true; },
            onCancel(event) {
              if (event?.type === "scroll") {
                // Scrolling parks the item immediately and completes an earned find's return.
                released = found;
                return;
              }
              found = false;
              released = false;
              if (pendingShuffle?.underlay === underlay) stopEffects();
            },
            onPark() {
              const completedFind = found && released && !game?.complete && underlay === game?.selected;
              found = false;
              released = false;
              if (completedFind && !pendingShuffle) pendingShuffle = { underlay, shaking: false };
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
