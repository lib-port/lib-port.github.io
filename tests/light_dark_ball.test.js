"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { clientAssetPath } = require("./client_assets");
const {
  Events, fixture, themeFixture, flick, advance, close, assertParked, finishShakes,
  gameEnabled, ballEnabled, homepage, assetPath,
} = require("./helpers/drag_fixture");
const ballTest = (name, callback) => test(name, {
  skip: !ballEnabled && "The built homepage disables the light/dark ball.",
}, callback);
const ballGameTest = (name, callback) => ballTest(name, t => {
  if (!gameEnabled) { t.skip("The built homepage disables the find the bug game."); return; }
  callback(t);
});
const randomPrefix = (...values) => () => values.length ? values.shift() : 0.5;
const screenGravity = diameter => 9.80665 * diameter / 0.067;

function measureImpact(f, axis, direction, boundary) {
  const step = 1 / 120;
  let previous = f.position();
  let previousVelocity;
  let incoming;
  for (let frame = 0; frame < 120 && f.frames.size; frame++) {
    f.tick(step * 1000);
    const position = f.position();
    const velocity = position.map((value, index) => (value - previous[index]) / step);
    if (incoming && direction * incoming[axis] > 0 && direction * velocity[axis] < 0) {
      assert.ok(Math.abs(position[axis] - boundary) < 30, "the throw reverses at the viewport edge");
      f.tick(step * 1000);
      const outgoing = f.position().map((value, index) => (value - position[index]) / step);
      // The last interval can straddle an impact while still moving outwards.
      return { incoming: previousVelocity, outgoing };
    }
    previous = position;
    previousVelocity = incoming;
    incoming = velocity;
  }
  assert.fail("the throw reaches the viewport edge and rebounds");
}

function probePull(seconds, dx = -4000, diameter = 44) {
  const f = themeFixture({ left: 6000, top: 844 - diameter, width: diameter, height: diameter });
  f.documentRef.documentElement.clientWidth = 12000;
  flick(f, { dx, dy: 0 });
  f.tick(seconds * 1000);
  const step = 1000 / 120;
  const x0 = f.position()[0];
  f.tick(step);
  const x1 = f.position()[0];
  f.tick(step);
  const x2 = f.position()[0];
  assert.ok(x2 < -3 * diameter, "the probe remains outside the braking area");
  close(f.position()[1], 0, 0.001);
  const acceleration = (x2 - 2 * x1 + x0) / (step / 1000) ** 2;
  // Floor friction opposes the measured direction of motion.
  const friction = x2 < x1 ? 0.12 : -0.12;
  f.controller.destroy();
  return acceleration / screenGravity(diameter) - friction;
}

function throwTowardsHome(f, { dx, dy = 0, speed = 2500 }) {
  const x = f.bounds.left + f.bounds.width / 2;
  const y = f.bounds.top + f.bounds.height / 2;
  const distance = Math.hypot(dx, dy);
  f.pointer("pointerdown", x, y);
  f.wait(120);
  f.pointer("pointermove", x + dx + speed * dx / distance * 0.04, y + dy + speed * dy / distance * 0.04);
  f.wait(40);
  f.pointer("pointermove", x + dx, y + dy);
  f.pointer("pointerup", x + dx, y + dy);
  f.tick(0);
}

for (const seconds of [0, 0.1, 1, 2, 3, 4, 20]) {
  ballTest(`home attraction grows continuously to ${0.25 * seconds}G at ${seconds} real seconds`, () => {
    close(probePull(seconds), 0.25 * (seconds + 1 / 120), 0.03);
  });
}

ballTest("home attraction has the same G strength at different distances and button diameters", () => {
  for (const diameter of [44, 88]) {
    close(probePull(4, -500, diameter), probePull(4, -4000, diameter), 0.03);
  }
});

ballTest("a ball bouncing just below home snaps back before attraction exceeds downward gravity", () => {
  const f = themeFixture();
  flick(f, { dx: 0, dy: 8, duration: 8 });
  assert.equal(f.frames.size, 1);
  f.tick(1000 / 120);
  assertParked(f);
  advance(f, 880);
  assert.equal(f.frames.size, 0);
  assert.equal(f.animations.length, 0, "the magnet snaps without a settling animation");
  f.controller.destroy();
});

ballTest("a ball returning along the floor snaps home without waiting four seconds", () => {
  const f = themeFixture();
  flick(f, { dx: -80, dy: 16 });
  let previous;
  let frames = 0;
  while (f.root.hasAttribute("data-drag-active") && frames < 120) {
    previous = f.position();
    f.tick(1000 / 120);
    frames++;
  }
  assertParked(f);
  close(previous[1], 16, 0.001);
  assert.ok(previous[0] < -44 / 2, "capture happens before the ball reaches the space directly below home");
  assert.ok(frames / 120 < 1, "the floor return completes while attraction is still below 0.25G");
  advance(f, 880);
  assert.equal(f.frames.size, 0, "the remaining highlight finishes after magnetic capture");
  f.controller.destroy();
});

for (const [speed, escapes] of [[320, false], [1000, true]]) {
  ballTest(`a ${speed}px/s tangential floor launch can depart before magnetic capture`, () => {
    const f = themeFixture({ left: 170 });
    f.pointer("pointerdown", 192, 806);
    f.wait(120);
    f.pointer("pointermove", 192 - speed * 0.04, 822);
    f.wait(40);
    f.pointer("pointermove", 192, 822);
    f.pointer("pointerup", 192, 822);
    f.tick(1000 / 120);
    assert.ok(f.position()[0] > 0, "a tangential release can start moving outwards");
    assert.equal(f.frames.size, 1);
    let maximumDistance = Math.hypot(...f.position());
    for (let frame = 1; frame < 120 && f.root.hasAttribute("data-drag-active"); frame++) {
      f.tick(1000 / 120);
      maximumDistance = Math.max(maximumDistance, Math.hypot(...f.position()));
    }
    assert.equal(maximumDistance > 44, escapes, "slow launches can turn back within the zone and fast launches can escape");
    assertParked(f);
    advance(f, 880);
    assert.equal(f.frames.size, 0, "the remaining highlight finishes after magnetic capture");
    f.controller.destroy();
  });
}

ballTest("one metre follows the rendered 6.7 cm ball diameter", () => {
  for (const diameter of [44, 88]) {
    const f = themeFixture({ left: 1000, top: 1000, width: diameter, height: diameter });
    Object.assign(f.documentRef.documentElement, { clientWidth: 4000, clientHeight: 4000 });
    flick(f, { dx: 0, dy: -4 * diameter, duration: 160 });
    f.tick(100);
    close(f.position()[0], 0);
    // Above home, both fields pull down: a(t) = (1 + 0.25t)G.
    const expected = -4 * 0.067 - 25 * 0.067 * 0.1 + 9.80665 * (0.1 ** 2 / 2 + 0.25 * 0.1 ** 3 / 6);
    close(f.position()[1] / (diameter / 0.067), expected);
    f.controller.destroy();
  }
});

ballTest("a fast return snaps home even when a rendered frame would cross the whole magnetic zone", () => {
  const f = themeFixture({ left: 500, top: 300 });
  f.documentRef.documentElement.clientWidth = 1200;
  throwTowardsHome(f, { dx: -88 });
  assert.equal(f.frames.size, 1);
  f.tick(100);
  assertParked(f);
  advance(f, 150);
  assert.equal(f.frames.size, 0);
  assert.equal(f.animations.length, 0);
  f.controller.destroy();
});

ballTest("magnetic capture uses centre distance rather than a square around home", () => {
  const f = themeFixture({ left: 500, top: 300 });
  f.documentRef.documentElement.clientWidth = 1200;
  throwTowardsHome(f, { dx: -0.8 * 44, dy: 0.8 * 44, speed: 300 });
  f.tick(1000 / 120);
  const position = f.position();
  assert.ok(position.every(value => Math.abs(value) < 44));
  assert.ok(Math.hypot(...position) > 44, "the diagonal return remains outside the circular zone");
  assert.equal(f.frames.size, 1);
  advance(f, 100);
  assertParked(f);
  advance(f, 150);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

for (const diameter of [44, 88]) {
  for (const delay of [0, 12000, 40000]) {
    ballTest(`the magnet captures a returning ${diameter}px ball after a ${delay}ms frame delay`, () => {
      const f = themeFixture({ left: 50 * diameter, top: 20 * diameter, width: diameter, height: diameter });
      Object.assign(f.documentRef.documentElement, { clientWidth: 100 * diameter, clientHeight: 21 * diameter });
      flick(f, { dx: -2 * diameter, dy: 0, firstFrameDelay: delay });
      for (let frame = 0; frame < 600 && f.root.hasAttribute("data-drag-active"); frame++) {
        assert.ok(f.position()[0] < -diameter, "an armed return parks on entry into the one-diameter zone");
        f.tick(1000 / 120);
        close(f.position()[1], 0);
      }
      assertParked(f);
      advance(f, 150);
      assert.equal(f.frames.size, 0);
      assert.equal(f.animations.length, 0);
      f.controller.destroy();
    });
  }

  for (const distance of [0.75 * diameter, diameter]) {
    ballTest(`a returning ${diameter}px ball snaps at distance ${distance}px including the boundary`, () => {
      const f = themeFixture({ left: 500, top: 300, width: diameter, height: diameter });
      f.documentRef.documentElement.clientWidth = 1200;
      throwTowardsHome(f, { dx: -distance });
      f.tick(1000 / 120);
      assertParked(f);
      advance(f, 150);
      assert.equal(f.frames.size, 0);
      f.controller.destroy();
    });
  }

  ballTest(`a returning ${diameter}px ball stays in flight outside its magnetic radius`, () => {
    const f = themeFixture({ left: 500, top: 300, width: diameter, height: diameter });
    f.documentRef.documentElement.clientWidth = 1200;
    throwTowardsHome(f, { dx: -diameter - 40 });
    f.tick(1000 / 120);
    assert.ok(Math.hypot(...f.position()) > diameter);
    assert.equal(f.frames.size, 1);
    advance(f, 100);
    assertParked(f);
    advance(f, 150);
    assert.equal(f.frames.size, 0);
    f.controller.destroy();
  });

  ballTest(`an outward ${diameter}px ball can leave the magnetic zone after a close release`, () => {
    const f = themeFixture({ left: 5 * diameter, top: 5 * diameter, width: diameter, height: diameter });
    Object.assign(f.documentRef.documentElement, { clientWidth: 20 * diameter, clientHeight: 20 * diameter });
    flick(f, { dx: -diameter / 2, dy: 0, duration: 20 });
    f.tick(1000 / 120);
    assert.ok(f.position()[0] < -diameter / 2);
    assert.ok(Math.hypot(...f.position()) < diameter);
    assert.equal(f.frames.size, 1, "the outward launch remains free inside the zone");
    advance(f, 100);
    assert.ok(Math.hypot(...f.position()) > diameter, "the launch can escape the zone");
    assert.equal(f.frames.size, 1);
    f.controller.destroy();
  });
}

ballTest("the magnet does not capture a ball held and dragged inside its zone", () => {
  const f = themeFixture();
  f.pointer("pointerdown", 352, 806);
  f.pointer("pointermove", 332, 796);
  advance(f, 10000);
  assert.deepEqual(f.position(), [-20, -10]);
  assert.equal(f.root.hasAttribute("data-dragging"), true);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("a moving ball exactly at home has a finite gravity direction", () => {
  const f = themeFixture({ left: 170, top: 800 });
  f.pointer("pointerdown", 192, 822);
  f.wait(120);
  f.pointer("pointermove", 152, 822);
  f.wait(40);
  f.pointer("pointermove", 192, 822);
  f.pointer("pointerup", 192, 822);
  close(f.position()[0], 0);
  f.tick(1000 / 120);
  assert.ok(f.position().every(Number.isFinite));
  assert.ok(f.position()[0] > 0, "non-zero release momentum moves the ball away from home");
  assert.equal(f.frames.size, 1);
  advance(f, 3000);
  assertParked(f);
  f.controller.destroy();
});

for (const [width, height, left, top, dx, dy, duration] of [
  [80, 95, 18, 35, -15, -15, 20],
  [1400, 900, 600, 350, 100, -250, 80],
  [4000, 2000, 1500, 1000, -200, 200, 80],
  [390, 844, 0, 0, 100, 100, 80],
  [390, 844, 346, 800, -80, -80, 80],
]) {
  ballTest(`throws stay bounded and settle in a ${width} by ${height} viewport from ${left}, ${top}`, () => {
    const f = themeFixture({ left, top });
    Object.assign(f.documentRef.documentElement, { clientWidth: width, clientHeight: height });
    flick(f, { dx, dy, duration });
    for (let frame = 0; frame < 7200 && f.frames.size; frame++) {
      f.tick(1000 / 120);
      const [x, y] = f.position();
      assert.ok(Number.isFinite(x) && x >= -left - 1e-6 && x <= width - 44 - left + 1e-6);
      assert.ok(Number.isFinite(y) && y >= -top - 1e-6 && y <= height - 44 - top + 1e-6);
    }
    assertParked(f);
    assert.equal(f.frames.size, 0);
    assert.equal(f.animations.length, 0, "magnetic capture parks without a spring animation");
    f.controller.destroy();
  });
}

for (const delay of [60000, 1000000, 100000000]) {
  ballTest(`a ${delay} ms frame pause keeps the growing field bounded and eventually settles`, () => {
    const f = themeFixture();
    flick(f, { firstFrameDelay: delay });
    for (let frame = 0; frame < 360 && f.frames.size; frame++) {
      const [x, y] = f.position();
      assert.ok(Number.isFinite(x) && x >= -330 - 1e-6 && x <= 16 + 1e-6);
      assert.ok(Number.isFinite(y) && y >= -784 - 1e-6 && y <= 16 + 1e-6);
      f.tick(1000 / 120);
    }
    assertParked(f);
    assert.equal(f.frames.size, 0);
    f.controller.destroy();
  });
}

ballTest("invalid frame clocks reset motion without leaving callbacks", () => {
  const f = themeFixture();
  flick(f);
  f.tick(NaN);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

for (const geometry of [{ width: 0, height: 0 }, { left: -50 }, { width: 400 }]) {
  ballTest(`invalid or unreachable home geometry ${JSON.stringify(geometry)} keeps the ordinary return`, () => {
    const f = themeFixture(geometry);
    flick(f);
    assert.equal(f.frames.size, 0);
    assert.equal(f.animations.length, 1);
    f.complete();
    assertParked(f);
    f.controller.destroy();
  });
}

ballTest("non-finite viewport geometry parks safely on release", () => {
  const f = themeFixture();
  f.pointer("pointerdown", 352, 806);
  f.wait(40);
  f.pointer("pointermove", 272, 726);
  f.documentRef.documentElement.clientWidth = NaN;
  f.pointer("pointerup", 272, 726);
  assert.equal(f.frames.size, 0);
  assert.equal(f.animations.length, 0);
  assertParked(f);
  f.controller.destroy();
});

if (homepage !== null) {
  test("built ball and shared assets agree with the feature markup", () => {
    assert.equal(fs.existsSync(assetPath("light_dark_ball.js")), ballEnabled);
    assert.equal(fs.existsSync(assetPath("drag_surface.js")), ballEnabled || gameEnabled);
    assert.equal(/<script\b[^>]*\bsrc="[^"]*\/assets\/js\/drag_surface\.js"/.test(homepage), ballEnabled || gameEnabled);
  });
}

for (const pointerType of ["mouse", "pen", "touch"]) {
  ballTest(`${pointerType} theme throws follow release velocity and gravity without switching the theme`, () => {
    const f = themeFixture();
    const { initThemeToggle } = require(clientAssetPath(path.join(__dirname, "..", "assets", "js", "theme_toggle.js")));
    const icons = { light: new Events(), dark: new Events() };
    f.link.querySelector = selector => selector.includes('"light"') ? icons.light : icons.dark;
    f.documentRef.documentElement.dataset = {};
    f.documentRef.querySelector = () => f.link;
    const mediaQuery = Object.assign(new Events(), { matches: false });
    const theme = initThemeToggle({ ...f, storage: null, mediaQuery });
    flick(f, { pointerType });
    assert.equal(f.frames.size, 1);
    assert.equal(f.animations.length, 0);
    assert.equal(f.captures.size, 0);
    assert.equal(f.root.hasAttribute("data-drag-active"), true);
    assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, true);
    assert.equal(theme.getTheme(), "light");
    f.tick(100);
    assert.ok(f.position()[0] < -80 && f.position()[0] > -180, "home attraction bends the outward throw immediately");
    assert.ok(f.position()[1] < -80 && f.position()[1] > -180 + screenGravity(44) * 0.1 ** 2 / 2);
    assert.equal(f.link.emit("click", { detail: 0 }).defaultPrevented, false);
    assert.equal(theme.getTheme(), "dark");
    assert.equal(f.frames.size, 1, "keyboard activation leaves the throw running");
    advance(f, 5000);
    assertParked(f);
    assert.equal(f.frames.size, 0);
    f.pointer("pointerdown"); f.pointer("pointerup");
    assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
    assert.equal(theme.getTheme(), "light");
    theme.destroy();
    f.controller.destroy();
  });
}

ballTest("theme throw speed is capped while keeping its direction", () => {
  const f = themeFixture();
  flick(f, { dx: -150, dy: -150, duration: 1 });
  const step = 1 / 120;
  f.tick(step * 1000);
  const distance = 2500 / Math.SQRT2 * step;
  // The ramp contributes less than 0.001px in the first physics step.
  close(f.position()[0], -150 - distance, 0.001);
  close(f.position()[1], -150 - distance + screenGravity(44) * step ** 2 / 2, 0.001);
  f.controller.destroy();
});

for (const [name, options, gesture] of [
  ["gentle", {}, { dx: -20, dy: -20, duration: 120 }],
  ["paused", {}, { pause: 150 }],
  ["invalid timestamp", {}, { release: { timeStamp: NaN } }],
  ["backwards timestamp", {}, { release: { timeStamp: -1 } }],
  ["missing frame support", { frameAnimation: false }, {}],
]) {
  ballTest(`${name} theme releases keep the ordinary spring return`, () => {
    const f = themeFixture(options);
    flick(f, gesture);
    assert.equal(f.frames.size, 0);
    assert.equal(f.animations.length, 1);
    assert.equal(f.animations[0].options.duration, 400);
    f.complete();
    assertParked(f);
    f.controller.destroy();
  });
}

ballGameTest("small theme movements stay clicks and fast releases on other surfaces stay spring returns", () => {
  const f = themeFixture();
  flick(f, { dx: 2, dy: 2, duration: 1 });
  assertParked(f);
  assert.equal(f.frames.size, 0);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
  const other = fixture({ width: 44, left: 330, top: 784 });
  flick(other);
  assert.equal(other.frames.size, 0);
  assert.equal(other.animations[0].options.duration, 400);
  f.controller.destroy(); other.controller.destroy();
});

for (const dx of [200, -200]) {
  ballTest(`theme throws reflect off the ${dx > 0 ? "right" : "left"} wall with tennis-ball restitution`, () => {
    const f = themeFixture({ left: 350, top: 1500 });
    Object.assign(f.documentRef.documentElement, { clientWidth: 1000, clientHeight: 3000 });
    flick(f, { dx, dy: 0, duration: 100 });
    const { incoming, outgoing } = measureImpact(f, 0, Math.sign(dx), dx > 0 ? 606 : -350);
    // Frame-averaged speeds include the changing acceleration around impact.
    close(-outgoing[0] / incoming[0], 0.74, 0.03);
    f.controller.destroy();
  });
}

ballTest("an upwards theme throw bounces off the ceiling and accelerates downwards", () => {
  const f = themeFixture({ left: 170, top: 300 });
  flick(f, { dx: 0, dy: -200, duration: 80 });
  const { incoming, outgoing } = measureImpact(f, 1, -1, -300);
  close(-outgoing[1] / incoming[1], 0.74, 0.06);
  const before = f.position()[1];
  f.tick(1000 / 120);
  assert.ok((f.position()[1] - before) * 120 > outgoing[1], "both fields accelerate the rebound downwards");
  f.controller.destroy();
});

ballTest("floor impacts lose speed with tennis-ball restitution", () => {
  const f = themeFixture({ left: 170, top: 100 });
  flick(f, { dx: 0, dy: 200, duration: 80 });
  const { incoming, outgoing } = measureImpact(f, 1, 1, 700);
  close(-outgoing[1] / incoming[1], 0.74, 0.06);
  f.controller.destroy();
});

ballTest("floor contact friction reduces tangential throwing speed", () => {
  const f = themeFixture({ left: 500, top: 100 });
  f.documentRef.documentElement.clientWidth = 4000;
  flick(f, { dx: 200, dy: 200, duration: 100 });
  const { incoming, outgoing } = measureImpact(f, 1, 1, 700);
  assert.ok(outgoing[0] < incoming[0], "contact removes tangential momentum");
  close((incoming[0] - outgoing[0]) / (1.74 * incoming[1]), 0.12, 0.03);
  f.controller.destroy();
});

ballTest("simultaneous corner impacts reflect both velocity components within the same step", () => {
  const f = themeFixture({ left: 0, top: 0 });
  Object.assign(f.documentRef.documentElement, { clientWidth: 244, clientHeight: 244 });
  const gravity = screenGravity(44);
  flick(f, { dx: 200, dy: 200, duration: 1 });
  const step = 1 / 120;
  f.tick(step * 1000);
  const expected = 200 - 0.74 * 2500 / Math.SQRT2 * step;
  close(f.position()[0], expected, 0.001);
  close(f.position()[1], expected + gravity * step ** 2 / 2, 0.001);
  f.controller.destroy();
});

ballTest("theme throw trajectories and docking agree at 30, 60 and 120 fps", () => {
  const trajectories = [];
  for (const fps of [30, 60, 120]) {
    const f = themeFixture();
    flick(f, { dx: -150, dy: -250, duration: 100 });
    const trajectory = [];
    for (let second = 0; second < 5; second++) {
      for (let frame = 0; frame < fps; frame++) {
        f.tick(1000 / fps);
        const [x, y] = f.position();
        assert.ok(x >= -330 && x <= 16);
        assert.ok(y >= -784 && y <= 16);
      }
      trajectory.push(f.position());
    }
    assertParked(f);
    assert.equal(f.frames.size, 0);
    trajectories.push(trajectory);
    f.controller.destroy();
  }
  for (const trajectory of trajectories.slice(1)) trajectory.forEach((position, index) => {
    position.forEach((value, axis) => close(value, trajectories[0][index][axis]));
  });
});

ballTest("delayed theme frames advance at most 100 ms without tunnelling outside the viewport", () => {
  const f = themeFixture({ left: 1000, top: 2000 });
  Object.assign(f.documentRef.documentElement, { clientWidth: 4000, clientHeight: 4000 });
  flick(f, { dx: 0, dy: -300, duration: 100, firstFrameDelay: 1000 });
  // Only 0.1s is integrated, with a(t) = (1.225 + 0.25t)G above home.
  close(f.position()[0], 0);
  close(f.position()[1], -300 - 2500 * 0.1 + screenGravity(44) * (1.225 * 0.1 ** 2 / 2 + 0.25 * 0.1 ** 3 / 6), 0.001);
  assert.equal(f.frames.size, 1);
  f.controller.destroy();
});

ballTest("theme throws start the home attraction on release while preserving momentum", () => {
  const f = themeFixture({ left: 1500, top: 1000 });
  f.documentRef.documentElement.clientWidth = 4000;
  f.documentRef.documentElement.clientHeight = 2000;
  f.wait(10000);
  flick(f);
  const before = f.position()[0];
  f.tick(100);
  assert.ok(f.position()[0] < before, "the return initially retains outward momentum");
  assert.ok(f.position()[0] > before - 100, "the new field bends the trajectory during the first 100 ms");
  advance(f, 1900);
  assert.ok(f.position()[0] > before, "the growing field reverses the throw");
  advance(f, 6000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("a delayed first theme frame captures the returning ball during the capped catch-up", () => {
  const f = themeFixture();
  flick(f, { firstFrameDelay: 40000 });
  assertParked(f);
  advance(f, 150);
  assert.equal(f.frames.size, 0);
  assert.equal(f.animations.length, 0);
  f.controller.destroy();
});

ballTest("a long frame gap preserves flight outside the magnetic zone", () => {
  const f = themeFixture();
  flick(f);
  f.tick(100);
  f.tick(10000);
  assert.ok(Math.hypot(...f.position()) > 44, "the ball remains in flight until it reaches the magnetic zone");
  assert.equal(f.root.hasAttribute("data-drag-active"), true);
  advance(f, 2000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("magnetic capture resets the attraction to 0G for the next throw", () => {
  const f = themeFixture();
  flick(f);
  const stale = [...f.frames.values()][0];
  advance(f, 6000);
  assertParked(f);
  assert.equal(f.frames.size, 0, "magnetic capture stops the attraction ramp");
  f.wait(60000);
  stale(f.windowRef.performance.now());
  assertParked(f);
  assert.equal(f.frames.size, 0, "a completed throw cannot resume while at home");

  const fresh = themeFixture();
  flick(f); flick(fresh);
  for (let frame = 0; frame < 120; frame++) {
    f.tick(1000 / 120);
    fresh.tick(1000 / 120);
    f.position().forEach((value, axis) => close(value, fresh.position()[axis]));
  }
  fresh.controller.destroy();
  f.controller.destroy();
});

ballTest("catching and throwing again restarts the attraction at 0G", () => {
  const f = themeFixture({ left: 1500, top: 1000 });
  f.documentRef.documentElement.clientWidth = 4000;
  f.documentRef.documentElement.clientHeight = 2000;
  flick(f);
  f.tick(2900);
  const before = f.position();
  const x = f.bounds.left + before[0] + 22;
  const y = f.bounds.top + before[1] + 22;
  const stale = [...f.frames.values()][0];
  f.pointer("pointerdown", x, y);
  f.wait(40);
  f.pointer("pointermove", x - 40, y);
  f.pointer("pointerup", x - 40, y);
  f.tick(0);
  const released = f.position();
  stale(20000);
  assert.deepEqual(f.position(), released);
  const fresh = themeFixture({ left: 1500, top: 1000 });
  Object.assign(fresh.documentRef.documentElement, { clientWidth: 4000, clientHeight: 2000 });
  fresh.pointer("pointerdown", 1522, 1022);
  fresh.wait(120);
  fresh.pointer("pointermove", 1522 + released[0] + 40, 1022 + released[1]);
  fresh.wait(40);
  fresh.pointer("pointermove", 1522 + released[0], 1022 + released[1]);
  fresh.pointer("pointerup", 1522 + released[0], 1022 + released[1]);
  for (let frame = 0; frame < 60; frame++) {
    f.tick(1000 / 120);
    fresh.tick(1000 / 120);
    f.position().forEach((value, axis) => close(value, fresh.position()[axis]));
  }
  advance(f, 8000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  fresh.controller.destroy();
  f.controller.destroy();
});

ballTest("catching a theme throw preserves its position and discards its old velocity and callback", () => {
  const f = themeFixture();
  flick(f);
  f.tick(100);
  const before = f.position();
  const stale = [...f.frames.values()][0];
  const x = f.bounds.left + before[0] + 22;
  const y = f.bounds.top + before[1] + 22;
  f.pointer("pointerdown", x, y);
  f.position().forEach((value, axis) => close(value, before[axis]));
  assert.equal(f.frames.size, 1, "the caught ball keeps its vortex animation");
  f.wait(40);
  f.pointer("pointermove", x + 40, y);
  f.pointer("pointerup", x + 40, y);
  f.tick(0);
  const released = f.position();
  stale(10000);
  assert.deepEqual(f.position(), released);
  assert.equal(f.frames.size, 1);
  f.tick(50);
  assert.ok(f.position()[0] > released[0], "the new throw uses the rightwards release velocity");
  assert.ok(f.position()[1] > released[1], "the old upwards velocity is discarded");
  f.controller.destroy();
});

for (const type of ["pointercancel", "lostpointercapture", "Escape"]) {
  ballTest(`${type} never turns a fast theme drag into a throw`, () => {
    const f = themeFixture();
    f.pointer("pointerdown"); f.wait(20); f.pointer("pointermove", 200, 180);
    if (type === "Escape") f.documentRef.emit("keydown", { key: type });
    else f.pointer(type);
    assert.equal(f.frames.size, 0);
    assert.equal(f.animations[0].options.duration, 400);
    f.complete();
    assertParked(f);
    f.controller.destroy();
  });
}

for (const type of ["Escape", "blur", "resize", "scroll", "visibilitychange", "reduced motion", "destroy", "viewport resize", "viewport scroll"]) {
  ballTest(`${type} cancels theme flight and docking without leaving animation callbacks`, () => {
    for (const elapsed of [0, 400]) {
      const f = themeFixture({ candidateCount: 3, random: randomPrefix(0, 0.5), visualViewport: {} });
      const selected = f.cpu;
      flick(f);
      advance(f, elapsed);
      assert.equal(f.frames.size, 1);
      const stale = [...f.frames.values()][0];
      if (type === "Escape") f.documentRef.emit("keydown", { key: type });
      else if (type === "visibilitychange") {
        f.documentRef.hidden = true; f.documentRef.emit(type);
      } else if (type === "reduced motion") {
        f.motion.matches = true; f.motion.emit("change");
      } else if (type === "destroy") f.controller.destroy();
      else if (type.startsWith("viewport")) f.windowRef.visualViewport.emit(type.split(" ")[1]);
      else f.windowRef.emit(type);
      assertParked(f);
      assert.equal(f.frames.size, 0);
      stale(10000);
      assertParked(f);
      if (type === "reduced motion" && gameEnabled) assert.notEqual(f.cpu, selected, "reduced motion completes the released find immediately");
      else assert.equal(f.cpu, selected, "cancellation discards the pending discovery");
      f.controller.destroy();
      for (const target of [f.documentRef, f.windowRef, f.windowRef.visualViewport, f.motion, f.link]) {
        assert.ok([...target.listeners.values()].every(listeners => listeners.size === 0));
      }
    }
  });
}

ballTest("theme flight uses visual viewport offsets and stays inside its visible bounds", () => {
  const f = themeFixture({ left: 250, top: 350, visualViewport: { offsetLeft: 100, offsetTop: 50, width: 250, height: 400 } });
  flick(f);
  for (let frame = 0; frame < 1200; frame++) {
    f.tick(1000 / 120);
    const [x, y] = f.position();
    assert.ok(x >= -150 && x <= 56);
    assert.ok(y >= -300 && y <= 56);
  }
  assertParked(f);
  f.controller.destroy();
});

ballGameTest("a thrown theme discovery reshuffles after docking, other surfaces landing and shaking", () => {
  const f = themeFixture({ candidateCount: 3, random: randomPrefix(0, 0.5) });
  const selected = f.cpu;
  flick(f);
  advance(f, 100);
  assert.equal(f.cpu, selected);
  const other = f.roots[1];
  other.pointer("pointerdown"); other.pointer("pointermove", 200, 180);
  advance(f, 6000);
  assert.equal(f.frames.size, 0);
  assert.equal(f.cpu, selected, "another held item delays the shuffle after docking");
  other.pointer("pointerup"); other.complete();
  assert.equal(f.cpu, selected, "docking and landing start feedback before replacement");
  finishShakes(f);
  assert.notEqual(f.cpu, selected);
  assert.notEqual(f.candidates.findIndex(candidate => candidate.children[0].name !== "cpu"), 0);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

ballTest("reduced motion skips theme throws and catches preference changes before their event", () => {
  const f = themeFixture({ reduced: true });
  flick(f);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.motion.matches = false;
  flick(f);
  f.motion.matches = true;
  f.tick(16);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

const impactProperty = "--ball-impact-highlight";
const highlight = f => parseFloat(f.link.style[impactProperty] || "0");
const tickUntil = (f, time) => f.tick(time - f.windowRef.performance.now());

function impactFixture(t, options = {}) {
  const f = themeFixture({ left: 1000, top: 1000, game: false, ...options });
  Object.assign(f.documentRef.documentElement, { clientWidth: 4000, clientHeight: 4000 });
  t.after(() => f.controller.destroy());
  return f;
}

function releaseAtEdge(f, { axis = 0, side = 1, speed = 1, tangent = 0, corner = false, preparation = 120, duration = 40 } = {}) {
  const scale = f.bounds.width / 0.067;
  const centre = [f.bounds.left + f.bounds.width / 2, f.bounds.top + f.bounds.height / 2];
  const limit = index => side
    ? [f.documentRef.documentElement.clientWidth, f.documentRef.documentElement.clientHeight][index] -
      [f.bounds.right, f.bounds.bottom][index]
    : -[f.bounds.left, f.bounds.top][index];
  const position = [0, 0];
  const velocity = [0, 0];
  position[axis] = limit(axis);
  velocity[axis] = (side ? 1 : -1) * speed * scale;
  if (corner) {
    position[1 - axis] = limit(1 - axis);
    velocity[1 - axis] = (side ? 1 : -1) * speed * scale;
  } else velocity[1 - axis] = tangent * scale;
  const current = f.position();
  if (f.root.hasAttribute("data-dragging")) {
    f.pointer("pointerup", centre[0] + current[0], centre[1] + current[1]);
  }
  f.pointer("pointerdown", centre[0] + current[0], centre[1] + current[1]);
  f.wait(preparation);
  f.pointer("pointermove", ...centre.map((value, index) => value + position[index] - velocity[index] * duration / 1000));
  f.wait(duration);
  f.pointer("pointermove", ...centre.map((value, index) => value + position[index]));
  f.pointer("pointerup", ...centre.map((value, index) => value + position[index]));
  return f.windowRef.performance.now();
}

function impactAndCatch(f, options) {
  const time = releaseAtEdge(f, options);
  f.tick(1000 / 120);
  const position = f.position();
  f.pointer("pointerdown", f.bounds.left + 22 + position[0], f.bounds.top + 22 + position[1]);
  assert.equal(f.frames.size, 1, "catching preserves a single cosmetic animation callback");
  return time;
}

ballTest("an impact fades in over 80 ms and out over 800 ms while the ball is held", t => {
  const f = impactFixture(t);
  const impact = impactAndCatch(f);
  tickUntil(f, impact + 40);
  close(highlight(f), 25);
  tickUntil(f, impact + 80);
  close(highlight(f), 50);
  tickUntil(f, impact + 480);
  close(highlight(f), 25);
  tickUntil(f, impact + 880);
  assert.equal(f.link.style[impactProperty], undefined);
  assert.equal(f.frames.size, 1, "the vortex continues after the last border pulse expires");
  assert.equal(f.root.hasAttribute("data-dragging"), true);
});

for (const speed of [0.5, 1, 2]) {
  ballTest(`an impact at ${speed} m/s contributes ${50 * speed}% peak colour`, t => {
    const f = impactFixture(t);
    const impact = impactAndCatch(f, { speed });
    tickUntil(f, impact + 80);
    close(highlight(f), 50 * speed);
  });
}

ballTest("glancing momentum parallel to the wall does not brighten its impact", t => {
  const f = impactFixture(t);
  const impact = impactAndCatch(f, { speed: 1, tangent: 2 });
  tickUntil(f, impact + 80);
  close(highlight(f), 50);
});

for (const [axis, side, name] of [[0, 0, "left"], [0, 1, "right"], [1, 0, "ceiling"], [1, 1, "floor"]]) {
  ballTest(`a rebound off the ${name} adds one pulse`, t => {
    const f = impactFixture(t);
    const impact = impactAndCatch(f, { axis, side });
    tickUntil(f, impact + 80);
    close(highlight(f), 50);
  });
}

ballTest("a simultaneous corner impact adds a pulse for each boundary", t => {
  const f = impactFixture(t);
  const impact = impactAndCatch(f, { corner: true });
  tickUntil(f, impact + 80);
  close(highlight(f), 100);
});

ballTest("saturated corner pulses retain their full contributions during the fade", t => {
  const f = impactFixture(t);
  const impact = impactAndCatch(f, { corner: true, speed: 1.25 });
  tickUntil(f, impact + 80);
  close(highlight(f), 100);
  tickUntil(f, impact + 240);
  close(highlight(f), 100);
  tickUntil(f, impact + 400);
  close(highlight(f), 75);
  tickUntil(f, impact + 880);
  assert.equal(f.link.style[impactProperty], undefined);
  assert.equal(f.frames.size, 1, "the held ball keeps its vortex animation");
});

ballTest("another throw adds to a pulse that is still fading in", t => {
  const f = impactFixture(t);
  const first = impactAndCatch(f);
  tickUntil(f, first + 40);
  const second = impactAndCatch(f, { preparation: 0, duration: 10 });
  close(second - first, 50);
  tickUntil(f, first + 80);
  close(highlight(f), 50 + 50 * 30 / 80);
  tickUntil(f, second + 80);
  close(highlight(f), 50 * (1 - 50 / 800) + 50);
});

ballTest("another throw adds to a fading pulse without restarting its fade", t => {
  const f = impactFixture(t);
  const first = impactAndCatch(f);
  tickUntil(f, first + 480);
  close(highlight(f), 25);
  const second = impactAndCatch(f, { preparation: 0, duration: 10 });
  tickUntil(f, second + 80);
  close(highlight(f), 50 * (1 - 490 / 800) + 50);
  tickUntil(f, first + 880);
  close(highlight(f), 50 * (1 - 310 / 800));
  tickUntil(f, second + 880);
  assert.equal(f.frames.size, 1, "the held ball keeps its vortex animation");
});

ballTest("dragging into a boundary and resting on the floor add no pulses", t => {
  const f = impactFixture(t);
  f.pointer("pointerdown", 1022, 1022);
  f.pointer("pointermove", 5000, 1022);
  f.tick(100);
  assert.equal(highlight(f), 0);
  assert.equal(f.frames.size, 0);
  releaseAtEdge(f, { axis: 1, speed: 0, tangent: 1 });
  advance(f, 100);
  assert.equal(highlight(f), 0, "sliding on the floor is not a new impact");
  assert.equal(f.frames.size, 1, "the ball is still in flight");
});

ballTest("a highlight finishes naturally after magnetic capture without keeping motion busy", t => {
  const f = themeFixture({ game: false });
  t.after(() => f.controller.destroy());
  flick(f, { dx: 0, dy: 8, duration: 8 });
  f.tick(1000 / 120);
  assertParked(f);
  assert.ok(highlight(f) > 0);
  assert.equal(f.frames.size, 1);
  assert.equal(f.link.emit("click", { detail: 0 }).defaultPrevented, false);
  advance(f, 880);
  assertParked(f);
  assert.equal(f.link.style[impactProperty], undefined);
  assert.equal(f.frames.size, 0);
});

ballGameTest("a cosmetic fade does not delay a completed discovery reshuffle", t => {
  const f = themeFixture({ top: 760, candidateCount: 3, random: randomPrefix(0, 0.5) });
  t.after(() => f.controller.destroy());
  const selected = f.cpu;
  flick(f, { dx: 0, dy: 40, duration: 20 });
  for (let frame = 0; frame < 120 && f.root.hasAttribute("data-drag-active"); frame++) f.tick(1000 / 120);
  assertParked(f);
  assert.ok(highlight(f) > 0);
  assert.ok(glow(f) > 0, "the halo can fade while discovery feedback completes");
  finishShakes(f);
  assert.notEqual(f.cpu, selected, "the remaining fade does not hold the game open");
  assert.ok(glow(f) > 0, "the glow does not delay the discovery reshuffle");
  assert.equal(f.frames.size, 1);
});

ballTest("impact colour follows elapsed time at 30, 60 and 120 fps and across delayed frames", t => {
  for (const frame of [1000 / 30, 1000 / 60, 1000 / 120, 480]) {
    const f = impactFixture(t);
    const impact = impactAndCatch(f);
    advance(f, impact + 480 - f.windowRef.performance.now(), frame);
    close(highlight(f), 25);
    f.tick(10000);
    assert.equal(f.link.style[impactProperty], undefined);
    assert.equal(f.frames.size, 1, "the held ball keeps its vortex animation");
  }
});

ballTest("an impact occurring within a frame uses its collision time", t => {
  const f = impactFixture(t);
  const x = 1022;
  const y = 1022;
  f.pointer("pointerdown", x, y);
  f.wait(120);
  f.pointer("pointermove", x + 2920, y);
  f.wait(20);
  f.pointer("pointermove", x + 2940, y);
  f.pointer("pointerup", x + 2940, y);
  f.tick(100);
  close(highlight(f), 50 * (1000 * 0.067 / 44) * (1 - 4 / 800), 0.02);
});

for (const type of ["Escape", "blur", "resize", "scroll", "visibilitychange", "reduced motion", "destroy", "viewport resize", "viewport scroll", "reduced motion before event", "invalid clock"]) {
  ballTest(`${type} clears a lingering highlight and invalidates its callback`, t => {
    const f = themeFixture({ game: false, visualViewport: {} });
    t.after(() => f.controller.destroy());
    flick(f, { dx: 0, dy: 8, duration: 8 });
    f.tick(1000 / 120);
    assertParked(f);
    assert.ok(highlight(f) > 0);
    const stale = [...f.frames.values()][0];
    if (type === "Escape") f.documentRef.emit("keydown", { key: type });
    else if (type === "visibilitychange") {
      f.documentRef.hidden = true; f.documentRef.emit(type);
    } else if (type.startsWith("reduced motion")) {
      f.motion.matches = true;
      if (type === "reduced motion") f.motion.emit("change");
      else f.tick(16);
    } else if (type === "destroy") f.controller.destroy();
    else if (type.startsWith("viewport")) f.windowRef.visualViewport.emit(type.split(" ")[1]);
    else if (type === "invalid clock") f.tick(NaN);
    else f.windowRef.emit(type);
    assert.equal(f.link.style[impactProperty], undefined);
    assert.equal(f.frames.size, 0);
    stale(20000);
    assert.equal(f.link.style[impactProperty], undefined);
    assert.equal(f.frames.size, 0);
  });
}

const vortexAngle = f => parseFloat(f.root.style["--ball-vortex-angle"]);
function assertNoVortex(f) {
  assert.equal(f.root.hasAttribute("data-ball-vortex"), false);
  assert.equal(f.root.style["--ball-vortex-angle"], undefined);
}

ballTest("a vortex starts only on a successful throw", t => {
  const f = themeFixture({ game: false });
  t.after(() => f.controller.destroy());
  f.pointer("pointerdown", 352, 806);
  f.pointer("pointermove", 312, 786);
  f.wait(120);
  assertNoVortex(f);
  f.pointer("pointerup", 312, 786);
  assertNoVortex(f);
  f.complete();
  flick(f);
  assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
  close(vortexAngle(f), 0);
});

ballTest("a held vortex accelerates steadily and caps at 1.5 turns per second", t => {
  const f = impactFixture(t);
  const start = impactAndCatch(f);
  const held = f.position();
  for (const [seconds, angle] of [[0.1, 0.9], [0.5, 22.5], [1, 90], [1.25, 140.625], [2.9, 36.9], [3, 90], [3.1, 144], [3.2, 198], [4.1, 324], [6, 270], [6.1, 324], [6.2, 18], [10.125, 337.5], [100.125, 337.5]]) {
    tickUntil(f, start + seconds * 1000);
    close(vortexAngle(f), angle);
    assert.deepEqual(f.position(), held, "spinning does not move a held ball");
    assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
    assert.equal(f.frames.size, 1);
  }
});

ballTest("catching and rethrowing preserve the original vortex clock and discard stale callbacks", t => {
  const f = impactFixture(t);
  const start = impactAndCatch(f);
  tickUntil(f, start + 4100);
  const stale = [...f.frames.values()][0];
  impactAndCatch(f, { preparation: 0, duration: 10 });
  const angle = vortexAngle(f);
  stale(start + 20000);
  close(vortexAngle(f), angle);
  assert.equal(f.frames.size, 1);
  tickUntil(f, start + 6100);
  close(vortexAngle(f), 324, 0.00001);
});

ballTest("a gentle release keeps the vortex spinning until the spring reaches home", t => {
  const f = impactFixture(t);
  const start = impactAndCatch(f);
  tickUntil(f, start + 6100);
  f.wait(120);
  const [x, y] = f.position();
  f.pointer("pointerup", 1022 + x, 1022 + y);
  assert.equal(f.animations.at(-1).options.duration, 400);
  f.tick(100);
  assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
  f.complete();
  assertParked(f);
  assert.equal(f.frames.size, 1, "the halo finishes fading after the spring reaches home");
  advance(f, 150);
  assert.equal(f.frames.size, 0);
});

ballTest("magnetic capture removes the vortex immediately and a later throw starts from rest", t => {
  const f = themeFixture({ game: false });
  t.after(() => f.controller.destroy());
  flick(f, { dx: 0, dy: 8, duration: 8 });
  assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
  f.tick(1000 / 120);
  assertParked(f);
  assert.ok(highlight(f) > 0, "the border pulse can finish independently after the vortex ends");
  f.wait(2000);
  flick(f);
  close(vortexAngle(f), 0);
});

ballTest("vortex phase agrees across frame rates and delayed frames", t => {
  for (const frame of [1000 / 30, 1000 / 60, 1000 / 120, 7125]) {
    const f = impactFixture(t);
    const start = impactAndCatch(f);
    advance(f, start + 7125 - f.windowRef.performance.now(), frame);
    close(vortexAngle(f), 157.5);
    assert.equal(f.frames.size, 1);
  }
});

for (const [name, game, choice] of [["CPU", false, 0.5], ["bug", true, 0.5], ["squirrel", true, 0.05]]) {
  const run = game ? ballGameTest : ballTest;
  run(`the vortex retains the ${name} icon and its discovery geometry`, t => {
    const f = themeFixture({ game, candidateCount: 2, random: randomPrefix(0, choice) });
    t.after(() => f.controller.destroy());
    const icon = f.cpu;
    const bounds = icon.getBoundingClientRect();
    assert.equal(icon.name, name === "CPU" ? "cpu" : name);
    flick(f);
    f.tick(100);
    assert.equal(f.cpu, icon);
    assert.deepEqual(icon.getBoundingClientRect(), bounds);
    assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
    assert.ok(vortexAngle(f) > 0);
  });
}

for (const type of ["Escape", "pointercancel", "lostpointercapture", "blur", "resize", "scroll", "visibilitychange", "reduced motion", "destroy", "reduced motion before event", "invalid clock"]) {
  ballTest(`${type} clears a held vortex after its border pulses have expired`, t => {
    const f = impactFixture(t);
    impactAndCatch(f);
    f.tick(10000);
    assert.equal(f.link.style[impactProperty], undefined);
    assert.equal(f.root.hasAttribute("data-ball-vortex"), true);
    const stale = [...f.frames.values()][0];
    if (type === "Escape") f.documentRef.emit("keydown", { key: type });
    else if (type === "pointercancel" || type === "lostpointercapture") f.pointer(type);
    else if (type === "visibilitychange") {
      f.documentRef.hidden = true; f.documentRef.emit(type);
    } else if (type.startsWith("reduced motion")) {
      f.motion.matches = true;
      if (type === "reduced motion") f.motion.emit("change");
      else f.tick(16);
    } else if (type === "destroy") f.controller.destroy();
    else if (type === "invalid clock") f.tick(NaN);
    else f.windowRef.emit(type);
    assertNoVortex(f);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
    stale(20000);
    assertNoVortex(f);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
  });
}

const glow = f => parseFloat(f.root.style["--ball-vortex-glow"] || "0");
function assertNoGlow(f) {
  assert.equal(f.root.hasAttribute("data-ball-glow"), false);
  assert.equal(f.root.style["--ball-vortex-glow"], undefined);
}

function dockHeldBall(f) {
  f.wait(120);
  const [x, y] = f.position();
  f.pointer("pointerup", f.bounds.left + f.bounds.width / 2 + x, f.bounds.top + f.bounds.height / 2 + y);
  assert.equal(f.animations.at(-1).options.duration, 400);
  f.tick(400);
  const opacity = glow(f);
  f.complete();
  assertParked(f);
  return { time: f.windowRef.performance.now(), opacity };
}

ballTest("the halo builds to a faint maximum while the icon spins", t => {
  const f = impactFixture(t);
  assertNoGlow(f);
  const start = impactAndCatch(f);
  for (const [seconds, expected] of [[0.1, 0.005], [1, 0.05], [3, 0.15], [6, 0.3], [20, 0.3]]) {
    tickUntil(f, start + seconds * 1000);
    close(glow(f), expected);
    assert.equal(f.root.hasAttribute("data-ball-glow"), true);
    assert.equal(f.frames.size, 1);
  }
});

ballTest("catching and rethrowing keep the halo building on the same clock", t => {
  const f = impactFixture(t);
  const start = impactAndCatch(f);
  tickUntil(f, start + 3000);
  close(glow(f), 0.15);
  const stale = [...f.frames.values()][0];
  impactAndCatch(f, { preparation: 0, duration: 10 });
  const opacity = glow(f);
  stale(start + 20000);
  close(glow(f), opacity);
  tickUntil(f, start + 4000);
  close(glow(f), 0.2);
  assert.equal(f.frames.size, 1);
});

for (const seconds of [2, 6]) {
  ballTest(`the halo fades from its actual strength after a ${seconds}-second hold over 150 ms`, t => {
    const f = impactFixture(t);
    const start = impactAndCatch(f);
    tickUntil(f, start + seconds * 1000);
    const { time, opacity } = dockHeldBall(f);
    close(glow(f), opacity);
    assert.equal(f.root.hasAttribute("data-ball-glow"), true);
    assert.equal(f.frames.size, 1, "the cosmetic fade continues after motion has stopped");
    tickUntil(f, time + 75);
    close(glow(f), opacity / 2);
    tickUntil(f, time + 149);
    assert.ok(glow(f) > 0);
    tickUntil(f, time + 150);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
  });
}

ballTest("clicking the returned ball does not restart or abruptly end its halo fade", t => {
  const f = impactFixture(t);
  impactAndCatch(f);
  f.tick(6000);
  const { time, opacity } = dockHeldBall(f);
  tickUntil(f, time + 50);
  f.pointer("pointerdown", 1022, 1022);
  f.pointer("pointerup", 1022, 1022);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
  close(glow(f), opacity * 2 / 3);
  tickUntil(f, time + 150);
  assertNoGlow(f);
  assert.equal(f.frames.size, 0);
});

ballTest("a new throw during the return fade starts a fresh halo from zero", t => {
  const f = impactFixture(t);
  impactAndCatch(f);
  f.tick(6000);
  const { time } = dockHeldBall(f);
  tickUntil(f, time + 50);
  const stale = [...f.frames.values()][0];
  flick(f);
  assertNoGlow(f);
  stale(time + 1000);
  assertNoGlow(f);
  assert.equal(f.frames.size, 1);
  f.tick(100);
  close(glow(f), 0.005);
  assert.equal(f.frames.size, 1);
});

ballTest("the halo fade follows elapsed time across frame rates and delayed frames", t => {
  for (const frame of [1000 / 30, 1000 / 60, 1000 / 120, 75]) {
    const f = impactFixture(t);
    impactAndCatch(f);
    f.tick(3000);
    const { opacity } = dockHeldBall(f);
    advance(f, 75, frame);
    close(glow(f), opacity / 2);
    f.tick(10000);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
  }
});

for (const type of ["Escape", "blur", "resize", "scroll", "visibilitychange", "reduced motion", "destroy", "viewport resize", "viewport scroll", "reduced motion before event", "invalid clock"]) {
  ballTest(`${type} immediately clears a return halo fade and its callback`, t => {
    const f = impactFixture(t, { visualViewport: { width: 4000, height: 4000 } });
    impactAndCatch(f);
    f.tick(6000);
    dockHeldBall(f);
    assert.ok(glow(f) > 0);
    const stale = [...f.frames.values()][0];
    if (type === "Escape") f.documentRef.emit("keydown", { key: type });
    else if (type === "visibilitychange") {
      f.documentRef.hidden = true; f.documentRef.emit(type);
    } else if (type.startsWith("reduced motion")) {
      f.motion.matches = true;
      if (type === "reduced motion") f.motion.emit("change");
      else f.tick(16);
    } else if (type === "destroy") f.controller.destroy();
    else if (type.startsWith("viewport")) f.windowRef.visualViewport.emit(type.split(" ")[1]);
    else if (type === "invalid clock") f.tick(NaN);
    else f.windowRef.emit(type);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
    stale(20000);
    assertNoGlow(f);
    assert.equal(f.frames.size, 0);
  });
}


ballTest("vortex events carry the original throw clock through grabs, releases and rethrows", t => {
  const f = impactFixture(t);
  const events = [];
  f.windowRef.addEventListener("libport:ball-vortex", event => events.push(event.detail));
  const start = impactAndCatch(f);
  assert.deepEqual(events.map(event => event.phase), ["start", "grab"]);
  assert.equal(events[1].pointerType, "mouse");
  assert.equal(events[1].pointerId, 1);
  assert.ok(Number.isFinite(events[1].clientX) && Number.isFinite(events[1].clientY));
  impactAndCatch(f, { preparation: 0, duration: 10 });
  assert.equal(events.filter(event => event.phase === "start").length, 1);
  assert.ok(events.some(event => event.phase === "release"));
  assert.ok(events.every(event => event.startedAt === start && event.root === f.root));
  f.windowRef.emit("blur");
  assert.equal(events.at(-1).phase, "cancel");
});

ballTest("natural capture announces home once while ordinary drags announce no vortex", t => {
  const f = themeFixture({ game: false });
  t.after(() => f.controller.destroy());
  const events = [];
  f.windowRef.addEventListener("libport:ball-vortex", event => events.push(event.detail));
  f.pointer("pointerdown", 352, 806); f.wait(120);
  f.pointer("pointermove", 312, 786); f.wait(120);
  f.pointer("pointerup", 312, 786); f.complete();
  assert.equal(events.length, 0);
  flick(f, { dx: 0, dy: 8, duration: 8 }); f.tick(1000 / 120);
  assert.deepEqual(events.map(event => event.phase), ["start", "home"]);
  assert.equal(events[0].startedAt, events[1].startedAt);
  f.tick(1000); f.controller.destroy();
  assert.equal(events.length, 2);
});
