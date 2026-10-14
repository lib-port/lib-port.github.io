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
  documentRef.querySelector = () => root;
  documentRef.hidden = false;
  const reducedMotion = Object.assign(new Events(), { matches: reduced });
  const windowRef = new Events();
  windowRef.matchMedia = () => reducedMotion;
  let time = 0;
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
    root, launch, plane, bounds, documentRef, windowRef, reducedMotion, frames, timers, controller,
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
        this.wait(250);
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

flightTest("flies an eight-second loop and finishes the remaining path at twice the speed", () => {
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
  f.tick(2000);
  assert.notDeepEqual(renderedPosition(f.plane), home);
  f.tick(6000);
  close(renderedPosition(f.plane).x, home.x);
  close(renderedPosition(f.plane).y, home.y);
  f.tick(3000);
  f.leave();
  f.tick(1000);
  assertFlightPose(f, 7 * Math.PI / 4);
  f.tick(500);
  assertFlightPose(f, 2 * Math.PI);
  assert.equal(f.frames.size, 1, "crossing the title is not the end of the loop");
  f.tick(750);
  assertFlightPose(f, 19 * Math.PI / 8);
  f.tick(249);
  assert.equal(f.frames.size, 1);
  f.tick(1);
  assert.deepEqual(renderedPosition(f.plane), home);
  assert.equal(f.plane.style.zIndex, "2");
  assert.equal(f.frames.size, 0);
  f.tick(8000);
  assert.deepEqual(renderedPosition(f.plane), home);
});

for (const [departure, returnTime] of [[1, 4000], [2000, 3000], [4000, 2000], [7000, 500], [7999, 1]]) {
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
  f.tick(3000);
  f.leave();
  f.tick(20000);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.frames.size, 0);
});

flightTest("leaving at rest does not start an extra loop", () => {
  for (const elapsed of [null, 0, 8000]) {
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
  f.tick(1000);
  assert.equal(f.frames.size, 0);
  assert.equal(f.plane.style.transform, home);
  assert.equal(f.launch.hidden, false);
});

for (const input of ["mouse", "pen"]) {
  flightTest(`${input} launches only after a 250 ms stationary pause`, () => {
    const f = fixture();
    const home = f.plane.style.transform;
    f.enter(input);
    assert.equal(f.timers.size, 1);
    f.wait(249);
    assert.equal(f.frames.size, 0);
    assert.equal(f.plane.style.transform, home);
    f.wait(1);
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
      f.wait(100);
      f.move(x, 20, input);
      assert.equal(f.timers.size, 1);
      assert.equal(f.frames.size, 0);
    }
    f.wait(249);
    assert.equal(f.frames.size, 0);
    f.wait(1);
    assert.equal(f.frames.size, 1);
    f.controller.destroy();
  });
}

flightTest("unchanged coordinates and other pointers do not restart or cancel the pause", () => {
  const f = fixture();
  f.enter(); f.wait(200);
  f.move(40, 20);
  f.move(50, 20, "touch", 2);
  f.move(50, 20, "mouse", 2);
  f.root.emit("pointerleave", { pointerType: "mouse", pointerId: 2 });
  f.root.emit("pointercancel", { pointerType: "mouse", pointerId: 2 });
  f.wait(50);
  assert.equal(f.frames.size, 1);
  f.controller.destroy();
});

for (const action of ["leave", "pointercancel", "scroll", "resize", "title resize", "blur", "hidden", "reduced motion", "destroy"]) {
  flightTest(`${action} cancels a pending pause and cannot launch from an expired callback`, () => {
    const f = fixture();
    f.enter(); f.wait(100);
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
      f.wait(249);
      assert.equal(f.frames.size, 0);
      f.wait(1);
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
    f.wait(250);
    assert.equal(f.frames.size, 0);
    assert.equal(f.timers.size, 0);
    f.controller.destroy();
  });
}

flightTest("movement while flying does not start a new pause or request a return", () => {
  const f = fixture();
  f.activate(); f.tick(0); f.tick(1000);
  f.move(50, 20);
  f.wait(1000); f.tick(1000);
  assertFlightPose(f, Math.PI);
  assert.equal(f.timers.size, 0);
  f.controller.destroy();
});

for (const input of ["touch", "keyboard"]) {
  flightTest(`${input} activation launches immediately and consumes a pending mouse pause`, () => {
    const f = fixture();
    f.enter(); f.wait(100);
    f.activate(input);
    assert.equal(f.frames.size, 1);
    assert.equal(f.timers.size, 0);
    f.tick(0); f.tick(1000); f.wait(250);
    f.leave(); f.tick(1000);
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
    f.tick(1000);
    assert.equal(f.frames.size, 0);
    assert.equal(f.plane.style.transform, home);
    f.enter(input);
    assert.equal(f.frames.size, 0, "entering the title waits for a pause");
    f.wait(250);
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
    f.tick(2000);
    assertFlightPose(f, Math.PI);
    assert.equal(f.launch.attributes.get("aria-disabled"), "true");
    if (input === "keyboard") {
      f.leave(); // Mouse movement does not end a keyboard-launched flight.
      f.tick(1000);
      assertFlightPose(f, 5 * Math.PI / 4);
      f.blur();
    } else {
      f.blur(); // Pointer focus does not latch or end a pointer-launched flight.
      f.tick(1000);
      assertFlightPose(f, 5 * Math.PI / 4);
      f.leave(input);
    }
    f.tick(2499);
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
    f.activate(); f.tick(0); f.tick(3000); f.leave(); f.tick(1000);
    const returning = f.plane.style.transform;
    f[action]();
    assert.equal(f.plane.style.transform, returning);
    f.tick(1499);
    assert.equal(f.frames.size, 1);
    f.tick(1);
    assert.equal(f.plane.style.transform, home);
    assert.equal(f.frames.size, 0);
    f.wait(1000); f.move(60, 20); f.wait(250);
    assert.equal(f.frames.size, 0, "entry while returning cannot queue another launch");
    f.focus(); f.tick(1000);
    assert.equal(f.frames.size, 0);
    f.enter(); f.wait(250); f.tick(0); f.tick(1000);
    assert.notEqual(f.plane.style.transform, home);
  });
}

flightTest("repeated activations during flight do not change its clock or input method", () => {
  const f = fixture();
  f.activate(); f.tick(0); f.tick(2000);
  f.activate("touch"); f.activate("keyboard"); f.tick(1000);
  assertFlightPose(f, 5 * Math.PI / 4);
  f.leave(); f.tick(2500);
  assert.equal(f.frames.size, 0);
});

for (const legacy of [false, true]) {
  for (const exit of ["touch", "scroll"]) {
    flightTest(`touch launch survives release and returns on ${exit}${legacy ? " with legacy click events" : ""}`, () => {
      const f = fixture();
      f.activate("touch", legacy);
      f.leave("touch"); f.blur();
      f.tick(0); f.tick(9000);
      assertFlightPose(f, 3 * Math.PI / 4);
      f.documentRef.emit("pointerdown", { pointerType: "touch", target: f.launch });
      f.tick(1000);
      assertFlightPose(f, Math.PI);
      const event = {
        pointerType: "touch", target: f.root,
        preventDefault() { assert.fail("outside interactions must remain native"); },
        stopPropagation() { assert.fail("outside interactions must reach their targets"); },
      };
      f.documentRef.emit(exit === "touch" ? "pointerdown" : "scroll", event);
      f.tick(2999);
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
  f.tick(3000);
  f.leave();
  f.tick(2000);
  f.leave();
  f.blur();
  f.tick(499);
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
  f.activate("keyboard"); f.tick(0); f.tick(1000);
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
  f.wait(250);
  assert.equal(f.frames.size, 1, "a fresh title entry and pause launch after reduced motion is disabled");
  f.controller.destroy();
});

flightTest("an active frame parks when reduced motion changes before its event is delivered", () => {
  const f = fixture();
  const home = f.plane.style.transform;
  f.activate();
  f.tick(0);
  f.tick(1000);
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
  f.tick(3000);
  f.leave();
  f.tick(1000);
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
  f.tick(1000);
  for (const finishing of [false, true]) {
    if (finishing) { f.leave(); f.tick(100); }
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
  f.tick(3399);
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
    f.tick(3000);
    f.leave();
    f.tick(1000);
    f.resize(350, 48);
    assertFlightPose(f, 7 * Math.PI / 4);
    f.tick(1499);
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
  f.tick(1000);
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
