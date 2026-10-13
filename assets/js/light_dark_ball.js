(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const PHYSICS_STEP = 1 / 120;
  const RETURN_DELAY = 3;
  const GRAVITY = 9.80665;
  const DIAMETER = 0.067;
  // Approximately 55% rebound height, matching a standard tennis ball.
  const RESTITUTION = 0.74;
  const FRICTION = 0.12;
  const EPSILON = 1e-10;

  // The solver uses metres and seconds; only rendering uses CSS pixels.
  function gravity(position, time) {
    const distance = Math.hypot(...position);
    const pull = GRAVITY * Math.max(0, time - RETURN_DELAY);
    return [
      distance ? -pull * (position[0] / distance) : 0,
      GRAVITY - (distance ? pull * (position[1] / distance) : 0),
    ];
  }

  function damp(position, velocity, duration) {
    const u = Math.max(0, 1 - Math.hypot(...position) / (3 * DIAMETER));
    const factor = Math.exp(-12 * u * u * (3 - 2 * u) * duration);
    for (let axis = 0; axis < 2; axis++) velocity[axis] *= factor;
  }

  const settled = (position, velocity) => Math.hypot(...position) <= 0.001 && Math.hypot(...velocity) <= 0.02;

  function settledDuring(position, velocity, acceleration, nextVelocity, duration) {
    // Check the slowest point inside the substep so a turning point can settle.
    const change = nextVelocity.map((value, axis) => value - velocity[axis]);
    const fraction = clamp(-velocity.reduce((sum, value, axis) => sum + value * change[axis], 0) /
      (change.reduce((sum, value) => sum + value * value, 0) || 1), 0, 1);
    const time = duration * fraction;
    return settled(
      position.map((value, axis) => value + velocity[axis] * time + acceleration[axis] * time * time / 2),
      velocity.map((value, axis) => value + change[axis] * fraction),
    );
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

  function advanceBall({ position, velocity, limits }, time, duration) {
    const returning = time >= RETURN_DELAY;
    if (returning && settled(position, velocity)) return true;
    if (returning) damp(position, velocity, duration);
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
      if (returning && settledDuring(position, velocity, acceleration, nextVelocity, elapsed)) return true;
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
      }
      remaining -= elapsed;
      time += elapsed;
    }
    for (let axis = 0; axis < 2; axis++) position[axis] = clamp(position[axis], ...limits[axis]);
    if (returning) damp(position, velocity, duration);
    return returning && settled(position, velocity);
  }

  function createLightDarkBall() {
    return context => ({
      attach(state) {
        const { documentRef, windowRef, reducedMotion } = context;
        const { surface, park, reset } = state;
        if (!surface.hasAttribute("data-theme-toggle")) return null;
        let flight = null;
        let samples = [];

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
          if (flight && flight.frame !== null) windowRef.cancelAnimationFrame(flight.frame);
          flight = null;
        }

        function tickFlight(current, time) {
          if (context.destroyed || flight !== current) return;
          current.frame = null;
          if (documentRef.hidden || !Number.isFinite(time)) { reset(); return; }
          if (reducedMotion?.matches) { park(); return; }
          current.accumulator = Math.min(0.1, current.accumulator + clamp((time - current.previousTime) / 1000, 0, 0.1));
          current.previousTime = Math.max(time, current.previousTime);
          let steps = 0;
          while ((current.remaining || current.accumulator + EPSILON >= PHYSICS_STEP) && steps++ < 4096) {
            const interval = current.remaining || PHYSICS_STEP;
            let elapsed = Math.max(0, (time - current.startedAt) / 1000 - current.accumulator);
            if (Math.abs(elapsed - RETURN_DELAY) < EPSILON) elapsed = RETURN_DELAY;
            const radius = Math.hypot(...current.position);
            // Resolve impacts and the rapidly changing direction near home.
            const travel = elapsed >= RETURN_DELAY ? Math.min(DIAMETER / 64, Math.max(1e-6, radius / 8)) : DIAMETER / 64;
            const acceleration = Math.hypot(...gravity(current.position, elapsed));
            let duration = Math.min(interval, travel / (Math.hypot(...current.velocity) + Math.sqrt(acceleration * travel)));
            if (elapsed < RETURN_DELAY) duration = Math.min(duration, RETURN_DELAY - elapsed);
            if (!Number.isFinite(duration) || duration <= EPSILON) { reset(); return; }
            if (advanceBall(current, elapsed, duration)) {
              park();
              return;
            }
            current.accumulator -= duration;
            current.remaining = interval - duration > EPSILON ? interval - duration : 0;
            if (![...current.position, ...current.velocity].every(Number.isFinite)) { reset(); return; }
          }
          state.position = current.position.map(value => value * current.scale);
          state.render();
          current.frame = windowRef.requestAnimationFrame(time => tickFlight(current, time));
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
            startedAt: releaseTime, accumulator: 0, remaining: 0, previousTime: releaseTime, frame: null,
          };
          const current = flight;
          current.frame = windowRef.requestAnimationFrame(time => tickFlight(current, time));
          return true;
        }

        return {
          motion: {
            isBusy: () => Boolean(flight),
            cancel: cancelFlight,
            start: () => throwBall(releaseVelocity()),
          },
          onStart(event) { samples = []; recordMotion(event); },
          onMove: recordMotion,
          onRelease: recordMotion,
          onCancel() { samples = []; },
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
