"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { clientAssetPath } = require("./client_assets");
const {
  Events, fixture, themeFixture, flick, advance, close, assertParked,
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

for (const seconds of [3, 4, 5, 20]) {
  ballTest(`home attraction grows continuously to ${seconds - 3}G at ${seconds} real seconds`, () => {
    close(probePull(seconds), seconds - 3 + 1 / 120, 0.03);
  });
}

ballTest("home attraction has the same G strength at different distances and button diameters", () => {
  for (const diameter of [44, 88]) {
    close(probePull(4, -500, diameter), probePull(4, -4000, diameter), 0.03);
  }
});

ballTest("a resting ball below home lifts only after the home attraction exceeds downward gravity", () => {
  const f = themeFixture();
  flick(f, { dx: 0, dy: 8, duration: 8 });
  advance(f, 3800);
  close(f.position()[1], 16, 0.01);
  advance(f, 200);
  close(f.position()[1], 16, 0.01);
  assert.equal(f.frames.size, 1);
  advance(f, 100);
  assert.ok(f.position()[1] < 16, "the stronger home pull lifts the ball off the floor");
  advance(f, 2000);
  assertParked(f);
  f.controller.destroy();
});

ballTest("one metre follows the rendered 6.7 cm ball diameter", () => {
  for (const diameter of [44, 88]) {
    const f = themeFixture({ left: 1000, top: 1000, width: diameter, height: diameter });
    Object.assign(f.documentRef.documentElement, { clientWidth: 4000, clientHeight: 4000 });
    flick(f, { dx: -80, dy: 0 });
    f.tick(100);
    close(f.position()[0], -180);
    close(f.position()[1] / (diameter / 0.067), 9.80665 * 0.1 ** 2 / 2);
    f.controller.destroy();
  }
});

ballTest("a fast crossing of home overshoots before settling", () => {
  const f = themeFixture({ top: 800 });
  flick(f);
  let previous = f.position();
  let crossing = false;
  for (let frame = 0; frame < 600 && f.frames.size; frame++) {
    f.tick(1000 / 120);
    const position = f.position();
    if (frame > 360 && previous[0] < 0 && position[0] > 0) {
      assert.ok(Math.hypot(...position) < 44 / 0.067 * 0.001, "the ball crosses inside the capture radius");
      assert.ok((position[0] - previous[0]) * 120 > 44 / 0.067 * 0.02, "the crossing exceeds capture speed");
      assert.equal(f.frames.size, 1, "a fast crossing keeps its momentum");
      crossing = true;
    }
    previous = position;
  }
  assert.equal(crossing, true);
  assertParked(f);
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
  f.tick(4000);
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
    let previous;
    for (let frame = 0; frame < 1440 && f.frames.size; frame++) {
      previous = f.position();
      f.tick(1000 / 120);
      const [x, y] = f.position();
      assert.ok(Number.isFinite(x) && x >= -left - 1e-6 && x <= width - 44 - left + 1e-6);
      assert.ok(Number.isFinite(y) && y >= -top - 1e-6 && y <= height - 44 - top + 1e-6);
      if (frame < 360) assert.equal(f.frames.size, 1, "physical flight runs until the home field starts");
    }
    assertParked(f);
    assert.ok(Math.hypot(...previous) < 1, "the final rendered movement into home is smaller than a pixel");
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
    close(f.position()[0], -180);
    close(f.position()[1], -180 + screenGravity(44) * 0.1 ** 2 / 2);
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
  flick(f, { duration: 1 });
  f.tick(100);
  const distance = 2500 / Math.SQRT2 * 0.1;
  close(f.position()[0], -80 - distance);
  close(f.position()[1], -80 - distance + screenGravity(44) * 0.1 ** 2 / 2);
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

for (const [dx, expected] of [[50, 121.24], [-50, -110.8]]) {
  ballTest(`theme throws reflect off the ${dx > 0 ? "right" : "left"} wall with tennis-ball restitution`, () => {
    const f = themeFixture({ left: 170, top: 300 });
    flick(f, { dx, dy: 0, duration: 50 });
    advance(f, 200);
    close(f.position()[0], expected);
    f.controller.destroy();
  });
}

ballTest("an upwards theme throw bounces off the ceiling and accelerates downwards", () => {
  const f = themeFixture({ left: 170, top: 200 });
  flick(f, { dx: 0, dy: -50, duration: 25 });
  advance(f, 200);
  const gravity = screenGravity(44);
  const incoming = Math.sqrt(2000 ** 2 - 2 * gravity * 150);
  const collision = (2000 - incoming) / gravity;
  const remainder = 0.2 - collision;
  close(f.position()[1], -200 + 0.74 * incoming * remainder + gravity * remainder ** 2 / 2);
  f.controller.destroy();
});

ballTest("floor impacts lose energy and produce successively lower tennis-ball rebounds", () => {
  const f = themeFixture({ left: 170, top: 300 });
  flick(f, { dx: 0, dy: 50, duration: 50 });
  const peaks = [];
  let before = f.position()[1];
  let previous = before;
  for (let frame = 0; frame < 360; frame++) {
    f.tick(1000 / 120);
    const [x, y] = f.position();
    assert.ok(x >= -170 && x <= 176);
    assert.ok(y >= -300 - 1e-6 && y <= 500 + 1e-6);
    if (previous < before && previous <= y) peaks.push(500 - previous);
    before = previous; previous = y;
  }
  assert.ok(peaks.length >= 2, peaks);
  close(peaks[0], 0.74 ** 2 * (450 + 1000 ** 2 / (2 * screenGravity(44))), 0.1);
  close(peaks[1] / peaks[0], 0.74 ** 2, 0.001);
  f.controller.destroy();
});

ballTest("floor contact friction reduces tangential throwing speed", () => {
  const f = themeFixture({ left: 500, top: 300 });
  f.documentRef.documentElement.clientWidth = 4000;
  flick(f, { dx: 40, dy: 50, duration: 50 });
  advance(f, 500);
  const gravity = screenGravity(44);
  const incoming = Math.sqrt(1000 ** 2 + 2 * gravity * 450);
  const collision = (incoming - 1000) / gravity;
  const after = 800 - 0.12 * 1.74 * incoming;
  close(f.position()[0], 40 + 800 * collision + after * (0.5 - collision));
  f.controller.destroy();
});

ballTest("simultaneous corner impacts reflect both velocity components within the same step", () => {
  const f = themeFixture({ left: 266, top: 710 });
  const gravity = screenGravity(44);
  const dy = (90 - gravity * 0.03 ** 2 / 2) / 1.6;
  flick(f, { dx: 50, dy, duration: 50 });
  advance(f, 50);
  close(f.position()[0], 65.2);
  close(f.position()[1], 90 - 0.74 * (20 * dy + gravity * 0.03) * 0.02 + gravity * 0.02 ** 2 / 2);
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
      if (second === 2) assert.equal(f.frames.size, 1, "free flight runs for three seconds before docking");
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
  const normal = themeFixture();
  const delayed = themeFixture();
  flick(normal); flick(delayed);
  normal.tick(100); delayed.tick(1000);
  delayed.position().forEach((value, axis) => close(value, normal.position()[axis]));
  normal.controller.destroy(); delayed.controller.destroy();
});

ballTest("theme throws start returning three real seconds after release while preserving momentum", () => {
  const f = themeFixture({ left: 1500, top: 1000 });
  f.documentRef.documentElement.clientWidth = 4000;
  f.documentRef.documentElement.clientHeight = 2000;
  f.wait(10000);
  flick(f);
  for (let second = 1; second <= 3; second++) {
    f.tick(1000);
    close(f.position()[0], -80 - 100 * second);
  }
  const before = f.position()[0];
  const step = 1 / 120;
  f.tick(step * 1000);
  close(f.position()[0], before - 1000 * step, 0.001);
  assert.ok(f.position()[0] < before, "the return initially retains outward momentum");
  advance(f, 1500);
  assert.ok(f.position()[0] > before, "the growing field reverses the throw");
  advance(f, 6000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("a delayed first theme frame counts the return deadline from release", () => {
  const f = themeFixture();
  flick(f, { firstFrameDelay: 10000 });
  assert.ok(f.position()[0] > -80, "the overdue field reverses the throw during the capped catch-up");
  assert.notDeepEqual(f.position(), [0, 0], "the frame does not teleport the ball home");
  advance(f, 2000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("a long gap between theme frames starts the return without a jump home", () => {
  const f = themeFixture();
  flick(f);
  f.tick(10000);
  assert.ok(f.position()[0] > -80, "the field uses real elapsed time after the gap");
  assert.notDeepEqual(f.position(), [0, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), true);
  advance(f, 2000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
  f.controller.destroy();
});

ballTest("catching and throwing again starts a fresh three-second return deadline", () => {
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
  stale(20000);
  for (let second = 1; second <= 3; second++) {
    f.tick(1000);
    close(f.position()[0], before[0] - 40 - 100 * second);
  }
  const positionAtDeadline = f.position()[0];
  f.tick(1000 / 120);
  close(f.position()[0], positionAtDeadline - 1000 / 120, 0.001);
  advance(f, 8000);
  assertParked(f);
  assert.equal(f.frames.size, 0);
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
  assert.equal(f.frames.size, 0);
  f.wait(40);
  f.pointer("pointermove", x + 40, y);
  f.pointer("pointerup", x + 40, y);
  f.tick(0);
  const released = f.position();
  stale(10000);
  assert.deepEqual(f.position(), released);
  assert.equal(f.frames.size, 1);
  f.tick(50);
  close(f.position()[0], before[0] + 90);
  close(f.position()[1], before[1] + screenGravity(44) * 0.05 ** 2 / 2);
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
    for (const returning of [false, true]) {
      const f = themeFixture({ candidateCount: 3, random: randomPrefix(0, 0.5), visualViewport: {} });
      const selected = f.cpu;
      flick(f);
      if (returning) advance(f, 3200);
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
  for (let frame = 0; frame < 600; frame++) {
    f.tick(1000 / 120);
    const [x, y] = f.position();
    assert.ok(x >= -150 && x <= 56);
    assert.ok(y >= -300 && y <= 56);
  }
  assertParked(f);
  f.controller.destroy();
});

ballGameTest("a thrown theme discovery reshuffles only after docking and waits for other moving surfaces", () => {
  const f = themeFixture({ candidateCount: 3, random: randomPrefix(0, 0.5) });
  const selected = f.cpu;
  flick(f);
  advance(f, 3000);
  assert.equal(f.cpu, selected);
  const other = f.roots[1];
  other.pointer("pointerdown"); other.pointer("pointermove", 200, 180);
  advance(f, 3000);
  assert.equal(f.frames.size, 0);
  assert.equal(f.cpu, selected, "another held item delays the shuffle after docking");
  other.pointer("pointerup"); other.complete();
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

