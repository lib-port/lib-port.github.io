"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { fixture, assertParked, coordinates, assetPath } = require("./helpers/drag_fixture");
const enabled = fs.existsSync(assetPath("drag_surface.js"));
const dragTest = (name, callback) => test(name, { skip: !enabled && "The built homepage excludes the drag controller." }, callback);

function setup(options = {}, hooks = {}) {
  const states = [];
  const moves = [];
  const f = fixture({
    candidateCount: 1, game: false, ball: false, ...options,
    extensions: [() => ({ attach(state) {
      states.push(state);
      return { onMove(event) { moves.push({ id: event.pointerId, position: [...state.position] }); }, ...hooks };
    } })],
  });
  return Object.assign(f, { states, moves });
}

for (const count of [1, 11, 50]) {
  dragTest(`global listener counts stay constant with ${count} surfaces`, t => {
    const f = setup({ candidateCount: count, visualViewport: {} });
    t.after(() => f.controller.destroy());
    for (const type of ["pointermove", "pointerup", "pointercancel", "lostpointercapture", "blur", "resize", "scroll"]) {
      assert.equal(f.windowRef.listeners.get(type).size, 1, type);
    }
    assert.equal(f.documentRef.listeners.get("keydown").size, 1);
    assert.equal(f.documentRef.listeners.get("visibilitychange").size, 1);
    assert.equal(f.motion.listeners.get("change").size, 1);
    for (const item of f.roots) assert.equal(item.link.listeners.get("pointerdown").size, 1);
  });
}

dragTest("pointer samples update state immediately and paint only once per frame", t => {
  const f = setup();
  t.after(() => f.controller.destroy());
  let writes = 0;
  let value;
  Object.defineProperty(f.link.style, "transform", {
    configurable: true, get: () => value, set(next) { value = next; writes++; },
  });
  f.pointer("pointerdown");
  for (const x of [310, 320, 330]) f.pointer("pointermove", x, 50);
  assert.equal(writes, 0);
  assert.deepEqual(f.moves.map(move => move.position), [[10, 20], [20, 20], [30, 20]]);
  assert.deepEqual(f.states[0].position, [30, 20]);
  assert.equal(f.frames.size, 1);
  f.tick(0);
  assert.equal(writes, 1);
  assert.deepEqual(f.position(), [30, 20]);
  assert.equal(f.frames.size, 0);
});

dragTest("simultaneous pointers route to their owners and share the painting frame", t => {
  const f = setup({ candidateCount: 11 });
  t.after(() => f.controller.destroy());
  const other = f.roots[1];
  f.pointer("pointerdown");
  other.pointer("pointerdown", 30, 80, { pointerId: 2 });
  // An existing pointer cannot be stolen by another surface.
  f.roots[2].pointer("pointerdown", 30, 140);
  f.pointer("pointermove", 320, 50);
  other.pointer("pointermove", 50, 110, { pointerId: 2 });
  f.windowRef.emit("pointermove", { pointerId: 999 });
  assert.equal(f.frames.size, 1);
  assert.deepEqual(f.moves.map(move => move.id), [1, 2]);
  f.tick(0);
  assert.deepEqual(f.position(), [20, 20]);
  assert.deepEqual(other.position(), [20, 30]);
  f.pointer("pointerup");
  assert.equal(other.captures.has(2), true);
  other.pointer("pointercancel", 50, 110, { pointerId: 2 });
  assert.equal(other.captures.size, 0);
});

dragTest("release flushes the final position before a spring without waiting for a frame", t => {
  const f = setup();
  t.after(() => f.controller.destroy());
  f.pointer("pointerdown");
  f.pointer("pointermove", 320, 60);
  const stale = [...f.frames.values()][0];
  f.pointer("pointermove", 330, 70);
  f.pointer("pointerup", 330, 70);
  assert.deepEqual(f.position(), [30, 40]);
  assert.deepEqual(coordinates(f.animations[0].keyframes[0].transform), [30, 40]);
  assert.equal(f.frames.size, 0);
  f.complete();
  stale(0);
  assertParked(f);
});

dragTest("physics can render immediately and supersedes a queued pointer paint", t => {
  const f = setup();
  t.after(() => f.controller.destroy());
  f.pointer("pointerdown"); f.pointer("pointermove", 320, 60);
  const stale = [...f.frames.values()][0];
  f.states[0].position = [25, 35];
  f.states[0].render();
  assert.deepEqual(f.position(), [25, 35]);
  assert.equal(f.frames.size, 0);
  stale(0);
  assert.deepEqual(f.position(), [25, 35]);
});

for (const action of ["blur", "resize", "scroll", "visibility", "destroy"]) {
  dragTest(`${action} discards pending writes and ignores a stale callback`, () => {
    const f = setup();
    f.pointer("pointerdown"); f.pointer("pointermove", 320, 60);
    const stale = [...f.frames.values()][0];
    if (action === "destroy") f.controller.destroy();
    else if (action === "visibility") { f.documentRef.hidden = true; f.documentRef.emit("visibilitychange"); }
    else f.windowRef.emit(action);
    assert.equal(f.frames.size, 0);
    stale(0);
    assertParked(f);
    f.controller.destroy();
  });
}

for (const missing of ["requestAnimationFrame", "cancelAnimationFrame"]) {
  dragTest(`pointer painting is synchronous without ${missing}`, t => {
    const f = setup();
    t.after(() => f.controller.destroy());
    delete f.windowRef[missing];
    f.drag();
    assert.deepEqual(f.position(), [-100, 150]);
    assert.equal(f.frames.size, 0);
  });
}

dragTest("one observer covers held and returning cards and disconnects when empty", t => {
  const f = setup({ milestones: [{ left: 20, top: 200 }, { left: 20, top: 400 }] });
  t.after(() => f.controller.destroy());
  const [first, second] = f.milestoneRoots;
  first.pointer("pointerdown", 50, 220); first.pointer("pointermove", 70, 250);
  second.pointer("pointerdown", 50, 420, { pointerId: 2 });
  second.pointer("pointermove", 70, 450, { pointerId: 2 });
  assert.equal(f.observers.length, 1);
  const observer = f.observers[0];
  first.pointer("pointerup"); first.complete();
  assert.notEqual(observer.disconnected, true, "the second card still needs observation");
  observer.callback();
  assertParked(second);
  assert.equal(observer.disconnected, true);
  first.pointer("pointerdown", 50, 220); first.pointer("pointermove", 70, 250);
  assert.equal(f.observers.length, 2);
  observer.callback();
  assert.equal(first.root.hasAttribute("data-dragging"), true, "a stale observer cannot reset a new drag");
  f.observers[1].callback();
  assertParked(first);
});

dragTest("pickup geometry is cached throughout pointer movement and refreshed on regrab", t => {
  const f = setup({ card: true, candidateCount: 1 });
  t.after(() => f.controller.destroy());
  let reads = 0;
  for (const target of [f.root, f.link, f.icon, f.cpu]) {
    const original = target.getBoundingClientRect;
    target.getBoundingClientRect = () => { reads++; return original(); };
  }
  f.pointer("pointerdown");
  const initial = reads;
  for (let index = 0; index < 100; index++) f.pointer("pointermove", 310, 50 + index);
  f.tick(0);
  assert.equal(reads, initial);
  assert.equal(initial, 4);
  const state = f.states[0];
  assert.equal(state.underlayRect.width, 36.8);
  assert.equal(state.underlayRect.height, 43.2);
  assert.deepEqual([state.surfaceRect.left, state.surfaceRect.top], [f.bounds.left + 10, f.bounds.top + 119]);
  f.pointer("pointerup");
  f.animations[0].visual = [5, 10];
  f.pointer("pointerdown");
  assert.equal(reads, initial * 2);
  assert.deepEqual(state.position, [5, 10]);
});

dragTest("destroy removes every core listener, observer and scheduled paint", () => {
  const f = setup({ candidateCount: 50, card: true });
  f.drag();
  f.controller.destroy();
  assert.equal(f.frames.size, 0);
  assert.equal(f.observers[0].disconnected, true);
  for (const target of [f.windowRef, f.documentRef, f.motion, ...f.roots.map(item => item.link)]) {
    assert.ok([...target.listeners.values()].every(callbacks => callbacks.size === 0));
  }
  f.roots.forEach(item => {
    assertParked(item);
    assert.equal(item.root.hasAttribute("data-drag-ready"), false);
  });
});
