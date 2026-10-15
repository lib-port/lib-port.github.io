(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const PHYSICS_STEP = 1 / 120;
  const GRAVITY = 9.80665;
  const DIAMETER = 0.067;
  const MAGNET_RADIUS = DIAMETER;
  // Approximately 55% rebound height, matching a standard tennis ball.
  const RESTITUTION = 0.74;
  const FRICTION = 0.12;
  const EPSILON = 1e-10;
  const IMPACT_STRENGTH = 0.5;
  // With constant ball mass, normal momentum is proportional to speed (m/s).
  const IMPACT_REFERENCE_SPEED = 1;
  const IMPACT_RISE = 80;
  const IMPACT_FADE = 800;
  const IMPACT_PROPERTY = "--ball-impact-highlight";
  const VORTEX_ANGLE = "--ball-vortex-angle";
  const GLOW_PROPERTY = "--ball-vortex-glow";
  const GLOW_FADE = 150;
  const homeAttraction = time => 0.25 * GRAVITY * Math.max(0, time);

  // The solver uses metres and seconds; only rendering uses CSS pixels.
  function gravity(position, time) {
    const distance = Math.hypot(...position);
    const pull = homeAttraction(time);
    return [
      distance ? -pull * (position[0] / distance) : 0,
      GRAVITY - (distance ? pull * (position[1] / distance) : 0),
    ];
  }

  function damp(position, velocity, duration, time) {
    const u = Math.max(0, 1 - Math.hypot(...position) / (3 * DIAMETER));
    // Two passes scale braking to the current pull and the ball's physical size.
    const rate = Math.sqrt(homeAttraction(time) / DIAMETER);
    const factor = Math.exp(-rate * u * u * (3 - 2 * u) * duration);
    for (let axis = 0; axis < 2; axis++) velocity[axis] *= factor;
  }

  function captured(ball) {
    const { position, velocity } = ball;
    const distance = Math.hypot(...position);
    if (distance > MAGNET_RADIUS) {
      ball.captureArmed = true;
      return false;
    }
    // Let outward and tangential launches depart until they turn inwards or stop.
    const outward = Math.hypot(...velocity) > 0 &&
      position.reduce((sum, value, axis) => sum + value * velocity[axis], 0) >= 0;
    if (!outward) ball.captureArmed = true;
    return ball.captureArmed;
  }

  function capturedDuring(position, nextPosition) {
    // Sweep each movement segment so fast returns cannot skip the magnetic zone.
    const change = nextPosition.map((value, axis) => value - position[axis]);
    const fraction = clamp(-position.reduce((sum, value, axis) => sum + value * change[axis], 0) /
      (change.reduce((sum, value) => sum + value * value, 0) || 1), 0, 1);
    return Math.hypot(...position.map((value, axis) => value + change[axis] * fraction)) <= MAGNET_RADIUS;
  }

  function collisionTime(position, velocity, acceleration, boundary, direction, duration) {
    const distance = position - boundary;
    const discriminant = velocity * velocity - 2 * acceleration * distance;
    const times = Math.abs(acceleration) < EPSILON
      ? [velocity ? -distance / velocity : Infinity]
      : discriminant < 0 ? [] : [
        (-velocity - Math.sqrt(discriminant)) / acceleration,
        (-velocity + Math.sqrt(discriminant)) / acceleration,
      ];
    return Math.min(Infinity, ...times.filter(time =>
      time >= -EPSILON && time <= duration + EPSILON &&
      direction * (velocity + acceleration * time) > EPSILON
    ).map(time => Math.max(0, time)));
  }

  function advanceBall(ball, time, duration, onImpact) {
    const { position, velocity, limits } = ball;
    if (captured(ball)) return true;
    damp(position, velocity, duration, time);
    let remaining = duration;
    // Velocity-Verlet between impacts, with symmetric drag around each substep.
    for (let impacts = 0; remaining > EPSILON && impacts < 16; impacts++) {
      const acceleration = gravity(position, time);
      const resting = position[1] >= limits[1][1] - EPSILON && Math.abs(velocity[1]) < 0.05 && acceleration[1] >= 0;
      if (resting) {
        velocity[1] = 0;
        const normal = acceleration[1];
        acceleration[1] = 0;
        velocity[0] = Math.sign(velocity[0]) * Math.max(0, Math.abs(velocity[0]) - FRICTION * normal * remaining);
      }
      let elapsed = remaining;
      let hits = [];
      for (let axis = 0; axis < 2; axis++) {
        for (const side of [0, 1]) {
          const time = collisionTime(position[axis], velocity[axis], acceleration[axis], limits[axis][side], side ? 1 : -1, remaining);
          if (time < elapsed - EPSILON) {
            elapsed = time;
            hits = [[axis, side]];
          } else if (Number.isFinite(time) && Math.abs(time - elapsed) <= EPSILON) {
            hits.push([axis, side]);
          }
        }
      }
      const nextPosition = position.map((value, axis) => value + velocity[axis] * elapsed + acceleration[axis] * elapsed * elapsed / 2);
      const nextAcceleration = gravity(nextPosition, time + elapsed);
      if (resting && nextAcceleration[1] >= 0) nextAcceleration[1] = 0;
      const nextVelocity = velocity.map((value, axis) => value + (acceleration[axis] + nextAcceleration[axis]) * elapsed / 2);
      if (ball.captureArmed && capturedDuring(position, nextPosition)) return true;
      for (let axis = 0; axis < 2; axis++) {
        position[axis] = nextPosition[axis];
        velocity[axis] = nextVelocity[axis];
      }
      for (const [axis, side] of hits) {
        position[axis] = limits[axis][side];
        const incoming = velocity[axis];
        velocity[axis] = -incoming * RESTITUTION;
        if (hits.length === 1) {
          const tangent = 1 - axis;
          velocity[tangent] = Math.sign(velocity[tangent]) * Math.max(0,
            Math.abs(velocity[tangent]) - FRICTION * (1 + RESTITUTION) * Math.abs(incoming));
        }
        if (axis === 1 && side === 1 && Math.abs(velocity[1]) < 0.05 && nextAcceleration[1] >= 0) velocity[1] = 0;
        onImpact(time + elapsed, Math.abs(incoming));
      }
      if (captured(ball)) return true;
      remaining -= elapsed;
      time += elapsed;
    }
    for (let axis = 0; axis < 2; axis++) position[axis] = clamp(position[axis], ...limits[axis]);
    damp(position, velocity, duration, time);
    return captured(ball);
  }

  function createLightDarkBall() {
    return context => ({
      attach(state) {
        const { documentRef, windowRef, reducedMotion } = context;
        const { root, surface, park, reset } = state;
        if (!surface.hasAttribute("data-theme-toggle")) return null;
        let flight = null;
        let samples = [];
        let pulses = [];
        let frame = null;
        let vortexStartedAt = null;
        let glowFade = null;

        function announceVortex(phase, event = {}) {
          if (vortexStartedAt === null) return;
          windowRef.dispatchEvent(new windowRef.CustomEvent("libport:ball-vortex", {
            detail: { phase, root, startedAt: vortexStartedAt, pointerId: event.pointerId,
              pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY },
          }));
        }

        function scheduleFrame() {
          if (frame !== null) windowRef.cancelAnimationFrame(frame);
          frame = null;
          if (context.destroyed || (!flight && !pulses.length && vortexStartedAt === null && !glowFade)) return;
          const current = windowRef.requestAnimationFrame(time => {
            if (context.destroyed || frame !== current) return;
            frame = null;
            tick(time);
          });
          frame = current;
        }

        function clearHighlight() {
          pulses = [];
          surface.style.removeProperty(IMPACT_PROPERTY);
          if (!flight) scheduleFrame();
        }

        function clearVortex(fadeGlow = false) {
          const time = windowRef.performance?.now?.();
          if (!fadeGlow) glowFade = null;
          else if (vortexStartedAt !== null) {
            glowFade = Number.isFinite(time) ? { time, opacity: glowOpacity(time) } : null;
          }
          announceVortex(fadeGlow ? "home" : "cancel");
          vortexStartedAt = null;
          root.removeAttribute("data-ball-vortex");
          root.style.removeProperty(VORTEX_ANGLE);
          renderGlow(time);
        }

        function glowOpacity(time) {
          return 0.3 * clamp((time - vortexStartedAt) / 6000, 0, 1);
        }

        function renderGlow(time) {
          const opacity = vortexStartedAt !== null ? glowOpacity(time)
            : glowFade ? glowFade.opacity * clamp(1 - (time - glowFade.time) / GLOW_FADE, 0, 1) : 0;
          if (opacity > EPSILON) {
            root.setAttribute("data-ball-glow", "");
            root.style.setProperty(GLOW_PROPERTY, String(opacity));
          } else {
            glowFade = null;
            root.removeAttribute("data-ball-glow");
            root.style.removeProperty(GLOW_PROPERTY);
          }
        }

        function renderVortex(time) {
          if (vortexStartedAt === null) return;
          const elapsed = Math.max(0, (time - vortexStartedAt) / 1000);
          // Integrate 0.5 turns/s² up to 1.5 turns/s, preserving phase across catches.
          const turns = elapsed <= 3 ? elapsed * elapsed / 4 : 2.25 + 1.5 * (elapsed - 3);
          root.style.setProperty(VORTEX_ANGLE, `${(turns % 1) * 360}deg`);
        }

        // Preserve collision times within a frame, including simultaneous corner hits.
        function recordImpact(time, speed) {
          pulses.push([flight.startedAt + time * 1000, IMPACT_STRENGTH * speed / IMPACT_REFERENCE_SPEED]);
        }

        function tick(time) {
          if (documentRef.hidden || !Number.isFinite(time)) { reset(); return; }
          if (reducedMotion?.matches) { clearVortex(); clearHighlight(); park(); return; }
          if (flight) tickFlight(flight, time);
          renderVortex(time);
          renderGlow(time);
          let strength = 0;
          pulses = pulses.filter(([impact, amount]) => {
            const age = Math.max(0, time - impact);
            strength += amount * clamp(Math.min(age / IMPACT_RISE,
              (IMPACT_RISE + IMPACT_FADE - age) / IMPACT_FADE), 0, 1);
            return age < IMPACT_RISE + IMPACT_FADE;
          });
          if (pulses.length) surface.style.setProperty(IMPACT_PROPERTY, `${100 * Math.min(1, strength)}%`);
          else surface.style.removeProperty(IMPACT_PROPERTY);
          scheduleFrame();
        }

        context.listen(documentRef, "keydown", event => {
          if (event.key === "Escape") { clearVortex(); clearHighlight(); }
        });
        context.listen(reducedMotion, "change", () => {
          if (reducedMotion.matches) { clearVortex(); clearHighlight(); }
        });

        function recordMotion(event) {
          const position = state.position;
          const time = event.timeStamp;
          if (!Number.isFinite(time) || time < samples.at(-1)?.time) {
            samples = [];
            return;
          }
          samples = samples.filter(sample => sample.time >= time - 100 && sample.time < time);
          samples.push({ time, position: [...position] });
        }

        function releaseVelocity() {
          if (samples.length < 2) return [0, 0];
          const first = samples[0];
          const last = samples.at(-1);
          const duration = (last.time - first.time) / 1000;
          const velocity = last.position.map((value, axis) => (value - first.position[axis]) / duration);
          const speed = Math.hypot(...velocity);
          if (!Number.isFinite(speed) || speed < 300) return [0, 0];
          return velocity.map(value => value * Math.min(1, 2500 / speed));
        }

        function cancelFlight() {
          flight = null;
          scheduleFrame();
        }

        function tickFlight(current, time) {
          current.accumulator = Math.min(0.1, current.accumulator + clamp((time - current.previousTime) / 1000, 0, 0.1));
          current.previousTime = Math.max(time, current.previousTime);
          let steps = 0;
          while ((current.remaining || current.accumulator + EPSILON >= PHYSICS_STEP) && steps++ < 4096) {
            const interval = current.remaining || PHYSICS_STEP;
            const elapsed = Math.max(0, (time - current.startedAt) / 1000 - current.accumulator);
            const radius = Math.hypot(...current.position);
            // Resolve impacts and the rapidly changing direction near home.
            const travel = Math.min(DIAMETER / 64, Math.max(1e-6, radius / 8));
            const acceleration = Math.hypot(...gravity(current.position, elapsed));
            const duration = Math.min(interval, travel / (Math.hypot(...current.velocity) + Math.sqrt(acceleration * travel)));
            if (!Number.isFinite(duration) || duration <= EPSILON) { reset(); return; }
            if (advanceBall(current, elapsed, duration, recordImpact)) {
              park();
              return;
            }
            current.accumulator -= duration;
            current.remaining = interval - duration > EPSILON ? interval - duration : 0;
            if (![...current.position, ...current.velocity].every(Number.isFinite)) { reset(); return; }
          }
          state.position = current.position.map(value => value * current.scale);
          state.render();
        }

        function throwBall(velocity) {
          if (!Math.hypot(...velocity) || !windowRef.requestAnimationFrame || !windowRef.cancelAnimationFrame) return false;
          const releaseTime = windowRef.performance?.now?.();
          if (!Number.isFinite(releaseTime)) return false;
          const bounds = state.bounds;
          const position = state.position;
          const viewport = state.viewportBounds();
          const size = surface.getBoundingClientRect();
          const radius = Math.max(size.width, size.height) / 2;
          const scale = 2 * radius / DIAMETER;
          const home = [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
          const limits = [
            [viewport.left + radius - home[0], viewport.left + viewport.width - radius - home[0]],
            [viewport.top + radius - home[1], viewport.top + viewport.height - radius - home[1]],
          ];
          if (!limits.flat().every(Number.isFinite)) { park(); return true; }
          if (!(radius > 0) || limits.some(([min, max]) => min >= max || min > 0 || max < 0)) return false;
          flight = {
            position: position.map((value, axis) => clamp(value, ...limits[axis]) / scale),
            velocity: velocity.map(value => value / scale),
            limits: limits.map(sides => sides.map(value => value / scale)), scale,
            captureArmed: false,
            startedAt: releaseTime, accumulator: 0, remaining: 0, previousTime: releaseTime,
          };
          const fresh = vortexStartedAt === null;
          if (fresh) {
            vortexStartedAt = releaseTime;
            glowFade = null;
          }
          root.setAttribute("data-ball-vortex", "");
          renderVortex(releaseTime);
          renderGlow(releaseTime);
          scheduleFrame();
          if (fresh) announceVortex("start");
          return true;
        }

        return {
          motion: {
            isBusy: () => Boolean(flight),
            cancel: cancelFlight,
            start: () => throwBall(releaseVelocity()),
          },
          onStart(event) { samples = []; recordMotion(event); announceVortex("grab", event); },
          onMove: recordMotion,
          onRelease(event) { recordMotion(event); announceVortex("release", event); },
          onCancel() { samples = []; clearVortex(); clearHighlight(); },
          onPark() { clearVortex(true); scheduleFrame(); },
        };
      },
    });
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createLightDarkBall };
  } else {
    window.LibPortDrag.registerFeature(createLightDarkBall());
  }
})();
