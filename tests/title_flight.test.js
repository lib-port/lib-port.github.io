"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { clientAssetPath } = require("./client_assets");
const asset = clientAssetPath(path.join(__dirname, "..", "assets", "js", "title_flight.js"));
const homepage = process.env.CLIENT_ASSET_DIRECTORY
  ? fs.readFileSync(path.resolve(process.env.CLIENT_ASSET_DIRECTORY, "..", "..", "index.html"), "utf8")
  : null;
const planeEnabled = homepage === null || /<script\b[^>]*\bsrc="[^"]*\/assets\/js\/title_flight\.js"/.test(homepage);
const { flightPose, initTitleFlight } = planeEnabled ? require(asset) : {};
const flightTest = (name, callback) => test(name, {
  skip: !planeEnabled && "The built homepage disables the paper plane.",
}, callback);

if (homepage !== null) {
  test("built paper plane assets agree with the plane markup", () => {
    assert.equal(fs.existsSync(asset), planeEnabled, "flight script inclusion");
    for (const attribute of ["data-title-flight", "data-title-flight-plane", "data-title-flight-launch"]) {
      assert.equal(new RegExp(`\\b${attribute}(?:\\s|>)`).test(homepage), planeEnabled, `${attribute} inclusion`);
    }
  });
}

class Events {
  listeners = new Map();
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  removeAttribute(key) { this.attributes.delete(key); }
  hasAttribute(key) { return this.attributes.has(key); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) { this.listeners.get(type)?.forEach(callback => callback(event)); }
}

function fixture({ reduced = false, initialHover = false, observeResize = true } = {}) {
  const root = new Events();
  root.matches = selector => selector === ":hover" && initialHover;
  const launch = new Events();
  launch.hidden = true;
  launch.contains = target => target === launch;
  const bounds = { width: 350, height: 48 };
  const titleBounds = () => ({ left: 100, top: 50, width: bounds.width + 72, height: bounds.height + 52,
    right: 172 + bounds.width, bottom: 102 + bounds.height });
  root.getBoundingClientRect = titleBounds;
  launch.getBoundingClientRect = () => {
    const box = titleBounds();
    return { left: box.right - 34, right: box.right + 10, top: box.top + box.height / 2 - 22, bottom: box.top + box.height / 2 + 22 };
  };
  const text = { getBoundingClientRect: () => bounds };
  const plane = { style: {
    removeProperty(name) { delete this[name === "z-index" ? "zIndex" : name]; },
  } };
  root.querySelector = selector => ({
    "[data-title-flight-text]": text,
    "[data-title-flight-plane]": plane,
    "[data-title-flight-launch]": launch,
  })[selector];
  const documentRef = new Events();
  const overlays = [];
  plane.cloneNode = () => {
    const clone = new Events();
    clone.style = { removeProperty(key) { delete this[key]; } };
    clone.remove = () => { const index = overlays.indexOf(clone); if (index >= 0) overlays.splice(index, 1); };
    return clone;
  };
  documentRef.body = { append: element => overlays.push(element) };
  documentRef.querySelector = () => root;
  documentRef.hidden = false;
  const reducedMotion = Object.assign(new Events(), { matches: reduced });
  const windowRef = new Events();
  windowRef.matchMedia = () => reducedMotion;
  let time = 0;
  windowRef.performance = { now: () => time };
  let timerTime = 0;
  let nextTimer = 0;
  let nextFrame = 0;
  let observer;
  const frames = new Map();
  const timers = new Map();
  windowRef.setTimeout = (callback, delay) => {
    timers.set(++nextTimer, { callback, deadline: timerTime + delay });
    return nextTimer;
  };
  windowRef.clearTimeout = id => timers.delete(id);
  windowRef.requestAnimationFrame = callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  windowRef.cancelAnimationFrame = id => frames.delete(id);
  if (observeResize) windowRef.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(element) { assert.equal(element, text); }
    disconnect() { this.disconnected = true; }
  };
  const controller = initTitleFlight({ documentRef, windowRef });
  return {
    root, launch, plane, bounds, documentRef, windowRef, reducedMotion, frames, timers, controller, overlays,
    wait(elapsed) {
      const until = timerTime + elapsed;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].deadline - b[1].deadline)[0];
        if (!next || next[1].deadline > until) break;
        timerTime = next[1].deadline;
        timers.delete(next[0]);
        next[1].callback();
      }
      timerTime = until;
    },
    tick(elapsed) {
      time += elapsed;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    },
    activate(input = "mouse", legacy = false) {
      if (input === "mouse" || input === "pen") {
        this.enter(input);
        this.wait(62.5);
        return;
      }
      if (input !== "keyboard") documentRef.emit("pointerdown", { pointerType: input, target: launch });
      launch.emit("click", { detail: input === "keyboard" ? 0 : 1, pointerType: legacy ? undefined : input });
    },
    enter(pointerType = "mouse", clientX = 40, clientY = 20, pointerId = 1) {
      root.emit("pointerenter", { pointerType, clientX, clientY, pointerId });
    },
    move(clientX, clientY, pointerType = "mouse", pointerId = 1) {
      root.emit("pointermove", { pointerType, clientX, clientY, pointerId });
    },
    leave(pointerType = "mouse") { root.emit("pointerleave", { pointerType, pointerId: 1 }); },
    focus() { launch.emit("focus"); },
    blur() { launch.emit("blur"); },
    resize(width, height) {
      Object.assign(bounds, { width, height });
      if (observer) observer.callback();
      else windowRef.emit("resize");
    },
  };
}

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);
}

function renderedPosition(plane) {
  const values = plane.style.transform.match(/translate3d\(([^p]+)px, ([^p]+)px, 0\)/);
  return { x: Number(values[1]) + 8, y: Number(values[2]) + 8 };
}

function assertFlightPose(fixture, phase) {
  const expected = flightPose(phase, fixture.bounds);
  const position = renderedPosition(fixture.plane);
  const angle = Number(fixture.plane.style.transform.match(/rotate\(([^r]+)rad\)/)[1]);
  close(position.x, expected.x);
  close(position.y, expected.y);
  close(Math.sin(angle), Math.sin(expected.angle));
  close(Math.cos(angle), Math.cos(expected.angle));
  assert.equal(fixture.plane.style.zIndex, expected.front ? "2" : "0");
}

flightTest("the figure-of-eight closes smoothly and crosses the title on opposite layers", () => {
  const dimensions = { width: 350, height: 48 };
  for (const phase of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
    const a = flightPose(phase, dimensions);
    const b = flightPose(phase + 2 * Math.PI, dimensions);
    close(a.x, b.x);
    close(a.y, b.y);
    close(Math.sin(a.angle), Math.sin(b.angle));
    close(Math.cos(a.angle), Math.cos(b.angle));
  }
  const front = flightPose(0, dimensions);
  const rear = flightPose(Math.PI, dimensions);
  close(front.x, rear.x);
  close(front.y, rear.y);
  assert.equal(front.front, true);
  assert.equal(rear.front, false);
  for (const turn of [Math.PI / 2, 3 * Math.PI / 2]) {
    const before = flightPose(turn - 0.001, dimensions);
    const after = flightPose(turn + 0.001, dimensions);
    assert.notEqual(before.front, after.front);
    assert.ok(Math.abs(before.x) > dimensions.width / 2 + 23.4);
  }
});

flightTest("the nose follows the flight tangent and the full plane fits its reserved gutter", () => {
  for (const dimensions of [{ width: 350, height: 48 }, { width: 110, height: 144 }]) {
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.1) {
      const current = flightPose(phase, dimensions);
      const next = flightPose(phase + 0.0001, dimensions);
      const tangent = Math.atan2(next.y - current.y, next.x - current.x);
      close(Math.sin(current.angle), Math.sin(tangent), 0.002);
      close(Math.cos(current.angle), Math.cos(tangent), 0.002);
      assert.ok(Math.abs(current.x) + Math.SQRT2 * 8 <= dimensions.width / 2 + 36);
      assert.ok(Math.abs(current.y) + Math.SQRT2 * 8 <= dimensions.height / 2 + 26);
    }
  }
});

flightTest("flies a four-second loop and finishes the remaining path at twice the speed", () => {
  const f = fixture();
  const home = renderedPosition(f.plane);
  close(home.x, f.bounds.width / 2 + 24);
  close(home.y, 0);
  assertFlightPose(f, Math.PI / 2);
  assert.equal(f.frames.size, 0);
  assert.equal(f.launch.hidden, false);
  assert.equal(f.root.attributes.has("tabindex"), false);
  f.activate();
  f.tick(0);
  f.tick(1000);
  assert.notDeepEqual(renderedPosition(f.plane), home);
  f.tick(3000);
  close(renderedPosition(f.plane).x, home.x);
  close(renderedPosition(f.plane).y, home.y);
  f.tick(1500);
  f.leave();
  f.tick(500);
  assertFlightPose(f, 7 * Math.PI / 4);
  f.tick(250);
  assertFlightPose(f, 2 * Math.PI);
  assert.equal(f.frames.size, 1, "crossing the title is not the end of the loop");
  f.tick(375);
  assertFlightPose(f, 19 * Math.PI / 8);
  f.tick(124);
  assert.equal(f.frames.size, 1);
  f.tick(1);
  assert.deepEqual(renderedPosition(f.plane), home);
  assert.equal(f.plane.style.zIndex, "2");
  assert.equal(f.frames.size, 0);
  f.tick(4000);
  assert.deepEqual(renderedPosition(f.plane), home);
});

for (const [departure, returnTime] of [[1, 2000], [1000, 1500], [2000, 1000], [3500, 250], [3999, 1]]) {
  flightTest(`leaving ${departure}ms into a loop parks after ${returnTime}ms at twice the speed`, () => {
    const f = fixture();
    const home = f.plane.style.transform;
    f.activate();
    f.tick(0);
    f.tick(departure);
    f.leave();
    f.tick(returnTime - 1);
    assert.equal(f.frames.size, 1);
    f.tick(1);
    assert.equal(f.plane.style.transform, home);
    assert.equal(f.frames.size, 0);
  });
}

flightTest("a delayed frame clamps to home without starting another loop", () => {
  const f = fixture();
  const home = f.plane.style.transform;
  f.activate();
  f.tick(0);
  f.tick(1500);
  f.leave();
  f.tick(20000);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
});

flightTest("leaving at rest does not start an extra loop", () => {
  for (const elapsed of [null, 0, 4000]) {
    const f = fixture();
    const home = f.plane.style.transform;
    f.activate();
    if (elapsed !== null) { f.tick(0); f.tick(elapsed); }
    f.leave();
    assert.equal(f.plane.style.transform, home);
    assert.equal(f.frames.size, 0);
  }
});

flightTest("focus, touch entry and an already-hovered title do not launch the plane", () => {
  const f = fixture({ initialHover: true });
  const home = f.plane.style.transform;
  f.enter("touch");
  f.focus();
  f.wait(1000);
  f.tick(500);
  assert.equal(f.frames.size, 0);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.launch.hidden, false);
});

for (const input of ["mouse", "pen"]) {
  flightTest(`${input} launches only after a 62.5 ms stationary pause`, () => {
    const f = fixture();
    const home = f.plane.style.transform;
    f.enter(input);
    assert.equal(f.timers.size, 1);
    f.wait(62);
    assert.equal(f.frames.size, 0);
    assert.equal(f.plane.style.transform, home);
    f.wait(0.5);
    assert.equal(f.frames.size, 1);
    assert.equal(f.timers.size, 0);
    f.wait(1000);
    assert.equal(f.frames.size, 1, "the pause launches just once");
    f.controller.destroy();
  });

  flightTest(`${input} movement restarts the pause without launching while crossing the title`, () => {
    const f = fixture();
    f.enter(input);
    for (let x = 41; x <= 45; x++) {
      f.wait(50);
      f.move(x, 20, input);
      assert.equal(f.timers.size, 1);
      assert.equal(f.frames.size, 0);
    }
    f.wait(62);
    assert.equal(f.frames.size, 0);
    f.wait(0.5);
    assert.equal(f.frames.size, 1);
    f.controller.destroy();
  });
}

flightTest("unchanged coordinates and other pointers do not restart or cancel the pause", () => {
  const f = fixture();
  f.enter(); f.wait(50);
  assert.equal(f.frames.size, 0);
  f.move(40, 20);
  f.move(50, 20, "touch", 2);
  f.move(50, 20, "mouse", 2);
  f.root.emit("pointerleave", { pointerType: "mouse", pointerId: 2 });
  f.root.emit("pointercancel", { pointerType: "mouse", pointerId: 2 });
  f.wait(12);
  assert.equal(f.frames.size, 0);
  f.wait(0.5);
  assert.equal(f.frames.size, 1);
  f.controller.destroy();
});

for (const action of ["leave", "pointercancel", "scroll", "resize", "title resize", "blur", "hidden", "reduced motion", "destroy"]) {
  flightTest(`${action} cancels a pending pause and cannot launch from an expired callback`, () => {
    const f = fixture();
    f.enter(); f.wait(50);
    const staleCallback = [...f.timers.values()][0].callback;
    if (action === "leave") f.leave();
    else if (action === "pointercancel") f.root.emit(action, { pointerType: "mouse", pointerId: 1 });
    else if (action === "scroll") f.documentRef.emit(action);
    else if (action === "title resize") f.resize(110, 144);
    else if (action === "hidden") {
      f.documentRef.hidden = true;
      f.documentRef.emit("visibilitychange");
      f.documentRef.hidden = false;
      f.documentRef.emit("visibilitychange");
    } else if (action === "reduced motion") {
      f.reducedMotion.matches = true;
      f.reducedMotion.emit("change");
      f.reducedMotion.matches = false;
      f.reducedMotion.emit("change");
    } else if (action === "destroy") f.controller.destroy();
    else f.windowRef.emit(action);
    assert.equal(f.timers.size, 0);
    staleCallback();
    f.move(50, 20); f.wait(1000);
    assert.equal(f.frames.size, 0, "movement alone cannot re-arm a cancelled hover");
    if (action !== "destroy") {
      f.enter();
      staleCallback();
      f.wait(62);
      assert.equal(f.frames.size, 0);
      f.wait(0.5);
      assert.equal(f.frames.size, 1, "a fresh entry can launch after cancellation");
      f.controller.destroy();
    }
    for (const target of [f.root, f.launch, f.documentRef, f.windowRef, f.reducedMotion]) {
      assert.ok([...target.listeners.values()].every(callbacks => callbacks.size === 0));
    }
  });
}

for (const blocked of ["hidden", "reduced motion"]) {
  flightTest(`${blocked} prevents a pending launch even before its change event arrives`, () => {
    const f = fixture();
    f.enter();
    if (blocked === "hidden") f.documentRef.hidden = true;
    else f.reducedMotion.matches = true;
    f.wait(62.5);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    f.controller.destroy();
  });
}

flightTest("movement while flying does not start a new pause or request a return", () => {
  const f = fixture();
  f.activate(); f.tick(0); f.tick(500);
  f.move(50, 20);
  f.wait(1000); f.tick(500);
  assertFlightPose(f, Math.PI);
  assert.equal(f.timers.size, 0);
  f.controller.destroy();
});

for (const input of ["touch", "keyboard"]) {
  flightTest(`${input} activation launches immediately and consumes a pending mouse pause`, () => {
    const f = fixture();
    f.enter(); f.wait(50);
    f.activate(input);
    assert.equal(f.frames.size, 1);
    assert.equal(f.timers.size, 0);
    f.tick(0); f.tick(500); f.wait(62.5);
    f.leave(); f.tick(500);
    assertFlightPose(f, Math.PI);
    f.controller.destroy();
  });
}

flightTest("movement over a title already hovered during initialisation cannot arm a pause", () => {
  const f = fixture({ initialHover: true });
  f.move(50, 20); f.wait(1000);
  assert.equal(f.frames.size, 0);
  assert.equal(f.timers.size, 0);
  f.controller.destroy();
});

for (const input of ["mouse", "pen"]) {
  flightTest(`${input} clicks without title entry do not launch the plane`, () => {
    const f = fixture();
    const home = f.plane.style.transform;
    f.documentRef.emit("pointerdown", { pointerType: input, target: f.launch });
    f.launch.emit("click", { detail: 1, pointerType: input });
    f.tick(500);
    assert.equal(f.frames.size, 0);
    assert.equal(f.plane.style.transform, home);
    f.enter(input);
    assert.equal(f.frames.size, 0, "entering the title waits for a pause");
    f.wait(62.5);
    assert.equal(f.frames.size, 1, "pausing over the title launches without a click");
    f.controller.destroy();
  });
}

for (const input of ["mouse", "pen", "keyboard"]) {
  flightTest(`${input} ${input === "keyboard" ? "activation" : "title hover"} launches and its departure requests the faster return`, () => {
    const f = fixture();
    f.focus();
    f.activate(input);
    f.tick(0);
    f.tick(1000);
    assertFlightPose(f, Math.PI);
    assert.equal(f.launch.attributes.get("aria-disabled"), "true");
    if (input === "keyboard") {
      f.leave(); // Mouse movement does not end a keyboard-launched flight.
      f.tick(500);
      assertFlightPose(f, 5 * Math.PI / 4);
      f.blur();
    } else {
      f.blur(); // Pointer focus does not latch or end a pointer-launched flight.
      f.tick(500);
      assertFlightPose(f, 5 * Math.PI / 4);
      f.leave(input);
    }
    f.tick(1249);
    assert.equal(f.frames.size, 1);
    f.tick(1);
    assertFlightPose(f, Math.PI / 2);
    assert.equal(f.frames.size, 0);
    assert.equal(f.launch.hidden, false);
    assert.equal(f.launch.attributes.get("aria-disabled"), "false");
  });
}

for (const action of ["enter", "focus", "activate"]) {
  flightTest(`${action} cannot restart a pending return or extend the loop`, () => {
    const f = fixture();
    const home = f.plane.style.transform;
    f.activate(); f.tick(0); f.tick(1500); f.leave(); f.tick(500);
    const returning = f.plane.style.transform;
    f[action]();
    assert.equal(f.plane.style.transform, returning);
    f.tick(749);
    assert.equal(f.frames.size, 1);
    f.tick(1);
    assert.equal(f.plane.style.transform, home);
    assert.equal(f.frames.size, 0);
    f.wait(1000); f.move(60, 20); f.wait(62.5);
    assert.equal(f.frames.size, 0, "entry while returning cannot queue another launch");
    f.focus(); f.tick(500);
    assert.equal(f.frames.size, 0);
    f.enter(); f.wait(62.5); f.tick(0); f.tick(500);
    assert.notEqual(f.plane.style.transform, home);
  });
}

flightTest("repeated activations during flight do not change its clock or input method", () => {
  const f = fixture();
  f.activate(); f.tick(0); f.tick(1000);
  f.activate("touch"); f.activate("keyboard"); f.tick(500);
  assertFlightPose(f, 5 * Math.PI / 4);
  f.leave(); f.tick(1250);
  assert.equal(f.frames.size, 0);
});

for (const legacy of [false, true]) {
  for (const exit of ["touch", "scroll"]) {
    flightTest(`touch launch survives release and returns on ${exit}${legacy ? " with legacy click events" : ""}`, () => {
      const f = fixture();
      f.activate("touch", legacy);
      f.leave("touch"); f.blur();
      f.tick(0); f.tick(4500);
      assertFlightPose(f, 3 * Math.PI / 4);
      f.documentRef.emit("pointerdown", { pointerType: "touch", target: f.launch });
      f.tick(500);
      assertFlightPose(f, Math.PI);
      const event = {
        pointerType: "touch", target: f.root,
        preventDefault() { assert.fail("outside interactions must remain native"); },
        stopPropagation() { assert.fail("outside interactions must reach their targets"); },
      };
      f.documentRef.emit(exit === "touch" ? "pointerdown" : "scroll", event);
      f.tick(1499);
      assert.equal(f.frames.size, 1);
      f.tick(1);
      assert.equal(f.frames.size, 0);
      assertFlightPose(f, Math.PI / 2);
    });
  }
}

flightTest("repeated departure events do not extend the current loop", () => {
  const f = fixture();
  const home = f.plane.style.transform;
  f.activate();
  f.tick(0);
  f.tick(1500);
  f.leave();
  f.tick(1000);
  f.leave();
  f.blur();
  f.tick(249);
  assert.equal(f.frames.size, 1);
  f.tick(1);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
});

flightTest("reduced motion hides the launch control and needs a fresh activation when restored", () => {
  const f = fixture({ reduced: true });
  const home = f.plane.style.transform;
  f.activate(); f.focus();
  assert.equal(f.frames.size, 0);
  assert.equal(f.launch.hidden, true);
  f.reducedMotion.matches = false;
  f.reducedMotion.emit("change");
  assert.equal(f.launch.hidden, false);
  assert.equal(f.frames.size, 0);
  f.activate("keyboard"); f.tick(0); f.tick(500);
  assert.notEqual(f.plane.style.transform, home);
  f.reducedMotion.matches = true;
  f.reducedMotion.emit("change");
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
  assert.equal(f.launch.hidden, true);
  f.reducedMotion.matches = false;
  f.reducedMotion.emit("change");
  f.focus();
  assert.equal(f.frames.size, 0);
  f.enter();
  f.wait(62.5);
  assert.equal(f.frames.size, 1, "a fresh title entry and pause launch after reduced motion is disabled");
  f.controller.destroy();
});

flightTest("an active frame parks when reduced motion changes before its event is delivered", () => {
  const f = fixture();
  const home = f.plane.style.transform;
  f.activate();
  f.tick(0);
  f.tick(500);
  f.reducedMotion.matches = true;
  f.tick(16);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
  assert.equal(f.launch.hidden, true);
});

flightTest("reduced motion interrupts loop completion and parks immediately", () => {
  const f = fixture();
  const home = f.plane.style.transform;
  f.activate();
  f.tick(0);
  f.tick(1500);
  f.leave();
  f.tick(500);
  f.reducedMotion.matches = true;
  f.reducedMotion.emit("change");
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
  f.reducedMotion.matches = false;
  f.reducedMotion.emit("change");
  assert.equal(f.frames.size, 0);
});

flightTest("hidden pages suspend both flight and loop completion without advancing the clock", () => {
  const f = fixture();
  f.activate();
  f.tick(0);
  f.tick(500);
  for (const finishing of [false, true]) {
    if (finishing) { f.leave(); f.tick(50); }
    const before = f.plane.style.transform;
    f.documentRef.hidden = true;
    f.documentRef.emit("visibilitychange");
    assert.equal(f.frames.size, 0);
    f.tick(60000);
    f.documentRef.hidden = false;
    f.documentRef.emit("visibilitychange");
    f.tick(0);
    assert.equal(f.plane.style.transform, before);
  }
  f.tick(1699);
  assert.equal(f.frames.size, 1);
  f.tick(1);
  assert.equal(f.frames.size, 0);
  assertFlightPose(f, Math.PI / 2);
});

for (const observeResize of [true, false]) {
  flightTest(`resizing a wrapped title updates geometry using ${observeResize ? "ResizeObserver" : "window resize"}`, () => {
    const f = fixture({ observeResize });
    const home = renderedPosition(f.plane);
    f.resize(110, 144);
    const resized = renderedPosition(f.plane);
    assert.ok(resized.x < home.x);
    close(resized.x, f.bounds.width / 2 + 24);
    close(resized.y, 0);
    assert.equal(f.frames.size, 0);
    f.activate();
    f.tick(0);
    f.tick(1500);
    f.leave();
    f.tick(500);
    f.resize(350, 48);
    assertFlightPose(f, 7 * Math.PI / 4);
    f.tick(749);
    assert.equal(f.frames.size, 1);
    f.tick(1);
    assert.deepEqual(renderedPosition(f.plane), home);
    assert.equal(f.frames.size, 0);
  });
}

flightTest("cleanup removes the ready state and pages without the title are harmless", () => {
  assert.equal(initTitleFlight({ documentRef: null, windowRef: null }), null);
  const f = fixture();
  f.activate();
  f.tick(0);
  f.tick(500);
  f.controller.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.root.attributes.has("tabindex"), false);
  assert.equal(f.root.attributes.has("data-flight-ready"), false);
  assert.equal(f.launch.hidden, true);
  assert.equal(f.launch.attributes.has("aria-disabled"), false);
  assert.equal(f.plane.style.transform, undefined);
  f.activate();
  f.focus();
  f.resize(110, 144);
  assert.equal(f.frames.size, 0);
  assert.equal(f.plane.style.transform, undefined);
});

function vortexFixture(t) {
  const f = fixture();
  t.after(() => f.controller.destroy());
  const ball = { getBoundingClientRect: () => ({ left: 878, top: 678, width: 44, height: 44 }) };
  let startedAt;
  f.vortex = (phase, pointer = {}) => {
    if (phase === "start") startedAt = f.windowRef.performance.now();
    f.windowRef.emit("libport:ball-vortex", { detail: { root: ball, startedAt, phase, ...pointer } });
  };
  f.to = time => f.tick(time - f.windowRef.performance.now());
  f.stage = () => f.root.attributes.get("data-plane-motion");
  f.moveHeld = (clientX = 120, clientY = 75, extra = {}) => f.windowRef.emit("pointermove", {
    pointerId: 1, pointerType: "mouse", clientX, clientY, ...extra,
  });
  f.grab = (clientX = 0, clientY = 0, extra = {}) => f.vortex("grab", {
    pointerId: 1, pointerType: "mouse", clientX, clientY, ...extra,
  });
  f.ball = ball;
  return f;
}

flightTest("a resting plane tugs at two seconds and is swallowed at 6.2 seconds without shrinking", t => {
  const f = vortexFixture(t);
  const home = renderedPosition(f.plane);
  f.vortex("start");
  f.to(1999); assert.deepEqual(renderedPosition(f.plane), home);
  f.to(2150);
  const half = renderedPosition(f.plane);
  close(Math.hypot(half.x - home.x, half.y - home.y), 6);
  f.to(2300);
  const tug = renderedPosition(f.plane);
  close(Math.hypot(tug.x - home.x, tug.y - home.y), 12);
  f.to(4999); assert.equal(f.overlays.length, 0);
  f.to(5000); assert.equal(f.stage(), "suction");
  const from = renderedPosition(f.overlays[0]);
  f.to(5600); assert.equal(f.stage(), "suction");
  const midway = renderedPosition(f.overlays[0]);
  close(midway.x, from.x + (900 - from.x) / 8);
  close(midway.y, from.y + (700 - from.y) / 8);
  assert.doesNotMatch(f.overlays[0].style.transform, /scale/);
  f.to(6199); assert.equal(f.overlays.length, 1);
  f.to(6200);
  assert.equal(f.stage(), "swallowed");
  assert.equal(f.root.hasAttribute("data-plane-swallowed"), true);
  assert.equal(f.overlays.length, 0);
  assert.equal(f.launch.hidden, true);
  assert.equal(f.frames.size, 0);
});

flightTest("returning home before the pull preserves normal flight and returning during a tug settles it", t => {
  const f = vortexFixture(t);
  f.activate("keyboard"); f.tick(0);
  f.vortex("start"); f.to(1000); f.vortex("home");
  assert.equal(f.stage(), "flying");
  f.to(1500); assertFlightPose(f, 5 * Math.PI / 4);
  f.blur(); f.tick(1250);
  const home = renderedPosition(f.plane);
  f.vortex("start"); f.tick(2500); f.vortex("home");
  assert.equal(f.stage(), "settling");
  f.tick(125);
  const halfway = renderedPosition(f.plane);
  close(Math.hypot(halfway.x - home.x, halfway.y - home.y), 6);
  f.tick(125);
  assert.equal(f.stage(), "idle");
  assert.deepEqual(renderedPosition(f.plane), home);
  assert.equal(f.frames.size, 0);
});

flightTest("an already-flying plane is sucked in two seconds after the throw", t => {
  const f = vortexFixture(t);
  f.activate("keyboard"); f.tick(0); f.tick(500); f.vortex("start");
  f.to(2499); assert.equal(f.stage(), "flying");
  f.to(2500); assert.equal(f.stage(), "suction");
  f.to(3100); assert.equal(f.stage(), "suction");
  f.to(3700); assert.equal(f.stage(), "swallowed");
});

flightTest("a plane that finishes its old loop before two seconds waits for the resting-plane deadline", t => {
  const f = vortexFixture(t);
  f.activate("keyboard"); f.tick(0); f.tick(3500); f.leave("keyboard"); f.blur();
  f.vortex("start"); f.tick(2300);
  assert.equal(f.stage(), "tug"); assert.equal(f.overlays.length, 0);
  f.tick(2700); assert.equal(f.stage(), "suction");
});

for (const launchTime of [0, 500, 1500, 4500]) {
  flightTest(`launching at ${launchTime} ms always gets a full two-second struggle`, t => {
    const f = vortexFixture(t);
    f.vortex("start"); f.to(launchTime);
    const before = renderedPosition(f.plane);
    f.activate("keyboard"); f.tick(0);
    assert.equal(f.stage(), "struggling");
    const after = renderedPosition(f.plane);
    close(after.x, before.x); close(after.y, before.y);
    assert.equal(f.launch.hidden, true);
    f.tick(500); f.leave(); f.blur(); f.activate("touch");
    f.to(launchTime + 1999); assert.equal(f.stage(), "struggling");
    f.to(launchTime + 2000); assert.equal(f.stage(), "suction");
    f.to(launchTime + 2600); assert.equal(f.stage(), "suction");
    f.to(launchTime + 3200); assert.equal(f.stage(), "swallowed");
  });
}

for (const stage of ["struggle", "suction"]) {
  flightTest(`the plane turns home from ${stage} and lands without a position jump`, t => {
    const f = vortexFixture(t);
    f.vortex("start");
    if (stage === "struggle") { f.activate("keyboard"); f.tick(1000); }
    else f.to(5300);
    const source = stage === "struggle" ? renderedPosition(f.plane) : renderedPosition(f.overlays[0]);
    const origin = f.root.getBoundingClientRect();
    f.vortex("home");
    assert.equal(f.stage(), "returning");
    const start = renderedPosition(f.overlays[0]);
    close(start.x, source.x + (stage === "struggle" ? origin.left + origin.width / 2 : 0));
    close(start.y, source.y + (stage === "struggle" ? origin.top + origin.height / 2 : 0));
    f.tick(999); assert.equal(f.stage(), "returning");
    f.tick(1);
    assert.equal(f.stage(), "idle"); assert.equal(f.overlays.length, 0);
    assertFlightPose(f, Math.PI / 2);
    assert.equal(f.launch.hidden, false); assert.equal(f.frames.size, 0);
  });
}

flightTest("each rescue chooses a fresh smooth route once rather than jittering per frame", t => {
  const f = vortexFixture(t);
  const values = [0, 0.2, 0.4, 1, 0.9, 0.8];
  let calls = 0;
  f.windowRef.Math = { random: () => { calls++; return values.shift(); } };
  const midpoints = [];
  for (let run = 0; run < 2; run++) {
    f.vortex("start"); f.tick(5300); f.vortex("home");
    f.tick(500); midpoints.push(renderedPosition(f.overlays[0]));
    const transform = f.overlays[0].style.transform;
    f.tick(0); assert.equal(f.overlays[0].style.transform, transform);
    f.tick(500);
  }
  assert.equal(calls, 6);
  assert.notDeepEqual(midpoints[0], midpoints[1]);
});

flightTest("captured movement uses the same stationary pause, including the control outside the title bounds", t => {
  const f = vortexFixture(t);
  f.vortex("start"); f.to(3000); f.grab();
  f.moveHeld(120, 75); f.wait(50);
  f.moveHeld(121, 75); f.wait(62);
  assert.equal(f.stage(), "tug");
  f.moveHeld(121, 75, { pointerId: 2 });
  f.moveHeld(121, 75); f.wait(0.5); f.tick(0);
  assert.equal(f.stage(), "struggling");
  f.tick(1999); assert.equal(f.stage(), "struggling");
  f.tick(1); assert.equal(f.stage(), "suction");
  f.vortex("cancel");
  f.vortex("start"); f.grab(529, 100); f.wait(62.5); f.tick(0);
  assert.equal(f.stage(), "struggling");
});

for (const action of ["leave", "release", "cancel", "home"]) {
  flightTest(`${action} cancels a pending captured-pointer pause and its stale callback`, t => {
    const f = vortexFixture(t);
    f.vortex("start"); f.grab(120, 75);
    const stale = [...f.timers.values()][0].callback;
    f.wait(50);
    if (action === "leave") f.moveHeld(0, 0);
    else f.vortex(action);
    assert.equal(f.timers.size, 0);
    stale(); f.wait(100); f.tick(0);
    assert.notEqual(f.stage(), "struggling");
  });
}

flightTest("ordinary captured drags and touch movement do not activate the title", t => {
  const f = vortexFixture(t);
  f.grab(120, 75); f.moveHeld(); f.wait(100);
  assert.equal(f.frames.size, 0);
  f.vortex("start"); f.grab(120, 75, { pointerType: "touch" });
  f.moveHeld(120, 75, { pointerType: "touch" }); f.wait(100);
  assert.equal(f.timers.size, 0);
  f.vortex("cancel");
});

for (const phase of ["tug", "struggle", "suction", "return"]) {
  for (const action of ["cancel", "hidden", "reduced", "resize", "scroll", "blur", "destroy"]) {
    flightTest(`${action} clears ${phase}, its overlay and stale frames`, t => {
      const f = vortexFixture(t);
      f.vortex("start");
      if (phase === "struggle") { f.activate("keyboard"); f.tick(1000); }
      else f.to(phase === "tug" ? 2300 : 5300);
      if (phase === "return") f.vortex("home");
      const stale = [...f.frames.values()][0];
      if (action === "cancel") {
        if (phase === "return") f.documentRef.emit("keydown", { key: "Escape" });
        else f.vortex("cancel");
      } else if (action === "hidden") {
        f.documentRef.hidden = true; f.documentRef.emit("visibilitychange");
      } else if (action === "reduced") {
        f.reducedMotion.matches = true; f.reducedMotion.emit("change");
      } else if (action === "destroy") f.controller.destroy();
      else (action === "scroll" ? f.documentRef : f.windowRef).emit(action);
      assert.equal(f.overlays.length, 0); assert.equal(f.frames.size, 0);
      assert.equal(f.root.hasAttribute("data-plane-detached"), false);
      stale(100000); assert.equal(f.overlays.length, 0); assert.equal(f.frames.size, 0);
    });
  }
}

flightTest("swallowing persists through preference changes and controller reinitialisation until a fresh page", t => {
  const f = vortexFixture(t);
  f.vortex("start"); f.to(6200);
  f.vortex("home"); f.vortex("start"); f.activate("keyboard");
  f.reducedMotion.matches = true; f.reducedMotion.emit("change");
  f.reducedMotion.matches = false; f.reducedMotion.emit("change");
  f.controller.destroy();
  f.controller = initTitleFlight({ documentRef: f.documentRef, windowRef: f.windowRef });
  assert.equal(f.stage(), "swallowed"); assert.equal(f.launch.hidden, true);
  assert.equal(f.frames.size, 0);
  const fresh = fixture();
  assert.equal(fresh.root.hasAttribute("data-plane-swallowed"), false);
  assert.equal(fresh.launch.hidden, false); fresh.controller.destroy();
});

flightTest("delayed frames and different frame rates agree on struggle, suction and return", t => {
  const positions = [];
  for (const step of [1000 / 30, 1000 / 60, 1000 / 120, 2300]) {
    const f = vortexFixture(t);
    f.windowRef.Math = { random: () => 0.25 };
    f.vortex("start"); f.activate("keyboard");
    const advance = target => {
      while (f.windowRef.performance.now() < target - 1e-7) {
        f.tick(Math.min(step, target - f.windowRef.performance.now()));
      }
    };
    advance(2300); assert.equal(f.stage(), "suction");
    positions.push(renderedPosition(f.overlays[0]));
    f.vortex("home"); advance(2650); positions.push(renderedPosition(f.overlays[0]));
    advance(3300); assert.equal(f.frames.size, 0);
  }
  for (let index = 2; index < positions.length; index++) {
    close(positions[index].x, positions[index % 2].x, 1e-5);
    close(positions[index].y, positions[index % 2].y, 1e-5);
  }
});

flightTest("an overdue activation cannot bypass automatic detachment without a rendered frame", t => {
  const f = vortexFixture(t);
  f.vortex("start");
  f.frames.clear();
  f.tick(7000);
  f.activate("keyboard");
  assert.equal(f.stage(), "swallowed");
});

flightTest("a disappearing vortex target or an invalid frame clock restores the plane safely", t => {
  for (const cause of ["removed", "geometry", "clock"]) {
    const f = vortexFixture(t);
    f.vortex("start"); f.to(5300);
    if (cause === "removed") f.ball.isConnected = false;
    else if (cause === "geometry") f.ball.getBoundingClientRect = () => ({ left: NaN, top: 0, width: 44, height: 44 });
    f.tick(cause === "clock" ? NaN : 16);
    assert.equal(f.overlays.length, 0); assert.equal(f.frames.size, 0);
    assert.equal(f.stage(), "idle");
  }
});
