"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { clientAssetPath } = require("./client_assets");
const asset = clientAssetPath(path.join(__dirname, "..", "assets", "js", "drag_reveal.js"));
const homepage = process.env.CLIENT_ASSET_DIRECTORY
  ? fs.readFileSync(path.resolve(process.env.CLIENT_ASSET_DIRECTORY, "..", "..", "index.html"), "utf8")
  : null;
const gameEnabled = homepage === null || /<script\b[^>]*\bsrc="[^"]*\/assets\/js\/drag_reveal\.js"/.test(homepage);
const { initDragReveal } = gameEnabled ? require(asset) : {};
const dragTest = (name, callback) => test(name, {
  skip: !gameEnabled && "The built homepage disables the find the bug game.",
}, callback);

if (homepage !== null) {
  test("built game assets agree with the game markup", () => {
    assert.equal(fs.existsSync(asset), gameEnabled, "drag script inclusion");
    assert.equal(/<template\b[^>]*\bdata-drag-icons\b/.test(homepage), gameEnabled, "replacement icon template inclusion");
    assert.equal(/\bdata-drag-shuffle\b/.test(homepage), false, "automatic reshuffling has no manual control");
    const hasRepoHeading = /class="repo-section-heading"/.test(homepage);
    assert.equal(/\bdata-drag-trophy\b/.test(homepage), gameEnabled && hasRepoHeading, "discovery trophy inclusion");
    assert.equal(/\bdata-drag-trophy-progress\b/.test(homepage), gameEnabled && hasRepoHeading, "discovery progress inclusion");
  });
}

const {
  Events, fixture, assertParked, finishShakes, randomSequence, coordinates,
} = require("./helpers/drag_fixture");

dragTest("each eligible underlay occupies an equal interval of the random selection", () => {
  const count = 4;
  for (let index = 0; index < count; index++) {
    for (const fraction of [0, 0.5, 0.999999]) {
      const f = fixture({ candidateCount: count, random: randomSequence((index + fraction) / count, 0.5) });
      assert.deepEqual(f.candidates.map(candidate => candidate.children[0].name),
        Array.from({ length: count }, (_, current) => current === index ? "bug" : "cpu"));
      assert.equal(f.template.removed, true);
      assert.notEqual(f.candidates[index].children[0], f.template.content.children[0]);
      assert.equal(f.root.hasAttribute("data-drag-active"), false);
      f.controller.destroy();
    }
  }
});

for (const [roll, expected] of [[0, "squirrel"], [0.099999, "squirrel"], [0.1, "bug"], [0.999999, "bug"]]) {
  dragTest(`the icon roll ${roll} selects ${expected} independently of the target`, () => {
    for (const target of [0, 0.5, 0.999999]) {
      const f = fixture({ candidateCount: 3, random: randomSequence(target, roll) });
      const icons = f.candidates.map(candidate => candidate.children[0].name);
      assert.equal(icons.filter(name => name === expected).length, 1);
      assert.equal(icons.filter(name => name === "cpu").length, 2);
      assert.equal(icons[Math.floor(target * 3)], expected);
      f.controller.destroy();
    }
  });
}

dragTest("a page with only one eligible underlay still chooses either replacement", () => {
  for (const [roll, expected] of [[0.05, "squirrel"], [0.9, "bug"]]) {
    const f = fixture({ candidateCount: 1, random: randomSequence(0.999999, roll) });
    assert.equal(f.cpu.name, expected);
    assert.equal(f.template.removed, true);
    f.controller.destroy();
  }
});

dragTest("missing candidates, missing templates and unsupported pointers retain CPU fallbacks", () => {
  for (const options of [{ candidateCount: 0 }, { candidateCount: 3, templates: false }, { candidateCount: 3, pointerEvents: false }]) {
    const f = fixture({ ...options, random: () => assert.fail("fallback must not draw randomness") });
    assert.equal(f.cpu.name, "cpu");
    assert.ok(f.candidates.every(candidate => candidate.children[0].name === "cpu"));
    assert.equal(f.template.removed, false);
    f.controller?.destroy();
  }
});

for (const [roll, expected] of [[0.05, "squirrel"], [0.9, "bug"]]) {
  dragTest(`the selected ${expected} keeps card sizing across cancelled drags and reinitialisation`, () => {
    const f = fixture({ card: true, candidateCount: 3, random: randomSequence(0, roll) });
    const selected = f.cpu;
    for (let attempt = 0; attempt < 2; attempt++) {
      f.drag();
      assert.equal(f.cpu, selected);
      assert.equal(f.cpu.name, expected);
      assert.equal(f.cpu.style.width, "36.8px");
      assert.equal(f.cpu.style.height, "43.2px");
      f.pointer("pointercancel");
      f.complete();
      assertParked(f);
    }
    f.controller.destroy();
    const next = initDragReveal({ ...f, random: () => assert.fail("reinitialisation must not reroll") });
    assert.equal(f.cpu, selected);
    assert.deepEqual(f.candidates.map(candidate => candidate.children[0].name), [expected, "cpu", "cpu"]);
    next.destroy();
  });
}

dragTest("small movements stay clicks and the six-pixel threshold starts dragging", () => {
  const f = fixture();
  f.pointer("pointerdown");
  f.pointer("pointermove", 303, 34);
  f.tick(0);
  assert.deepEqual(f.position(), [0, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), false);
  f.pointer("pointerup");
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
  assert.equal(f.animations.length, 0);
  f.pointer("pointerdown");
  f.pointer("pointermove", 306, 30);
  f.tick(0);
  assert.deepEqual(f.position(), [6, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), true);
});

for (const pointerType of ["mouse", "pen", "touch"]) {
  dragTest(`${pointerType} dragging reveals the fixed CPU and springs home on release outside the icon`, () => {
    const f = fixture();
    f.pointer("pointerdown", 300, 30, { pointerType });
    assert.equal(f.captures.has(1), false);
    const original = f.root.getBoundingClientRect();
    const moved = f.pointer("pointermove", 200, 180, { pointerType });
    assert.equal(moved.defaultPrevented, true);
    assert.equal(f.captures.has(1), true);
    f.tick(0);
    assert.deepEqual(f.position(), [-100, 150]);
    assert.deepEqual(f.root.getBoundingClientRect(), original);
    assert.equal(f.root.hasAttribute("data-drag-active"), true);
    f.pointer("pointerup", 200, 180, { pointerType });
    assert.equal(f.captures.size, 0);
    const spring = f.animations[0];
    assert.equal(spring.options.duration, 400);
    assert.deepEqual(coordinates(spring.keyframes[0].transform), [-100, 150]);
    const overshoot = coordinates(spring.keyframes[1].transform);
    assert.ok(overshoot[0] > 0 && overshoot[1] < 0);
    assert.ok(Math.hypot(...overshoot) <= 8 + 1e-10);
    assert.deepEqual(coordinates(spring.keyframes.at(-1).transform), [0, 0]);
    assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, true);
    f.complete();
    assertParked(f);
  });
}

dragTest("ordinary, modified and keyboard clicks still work after a drag", () => {
  const f = fixture();
  f.drag();
  f.pointer("pointerup");
  f.complete();
  assert.equal(f.link.emit("click", { detail: 0 }).defaultPrevented, false);
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
    f.pointer("pointerdown", 300, 30, modifiers);
    f.pointer("pointerup", 300, 30, modifiers);
    assert.equal(f.link.emit("click", { detail: 1, ...modifiers }).defaultPrevented, false);
  }
});

dragTest("dragging back to the origin still suppresses the release click", () => {
  const f = fixture();
  f.drag();
  f.pointer("pointermove", 300, 30);
  f.pointer("pointerup");
  assertParked(f);
  assert.equal(f.animations.length, 0);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, true);
});

for (const width of [44, 92]) {
  dragTest(`${width}px icons and their bounce stay inside viewport edges`, () => {
    const f = fixture({ width });
    f.drag();
    f.pointer("pointermove", 10000, 10000);
    f.tick(0);
    assert.deepEqual(f.position(), [390 - f.bounds.right, 844 - f.bounds.bottom]);
    f.pointer("pointermove", -10000, -10000);
    f.tick(0);
    assert.deepEqual(f.position(), [-f.bounds.left, -f.bounds.top]);
    f.pointer("pointerup");
    for (const keyframe of f.animations[0].keyframes) {
      const [x, y] = coordinates(keyframe.transform);
      assert.ok(f.bounds.left + x >= 0 && f.bounds.right + x <= 390);
      assert.ok(f.bounds.top + y >= 0 && f.bounds.bottom + y <= 844);
    }
  });
}

dragTest("grabbing a returning icon continues from its visible position without jumping", () => {
  const f = fixture();
  f.drag();
  f.pointer("pointerup");
  const spring = f.animations[0];
  spring.visual = [-40, 60];
  f.pointer("pointerdown", 220, 80);
  f.tick(0);
  assert.deepEqual(f.position(), [-40, 60]);
  assert.equal(spring.cancelled, true);
  assert.equal(spring.onfinish, null);
  f.pointer("pointermove", 200, 90);
  f.tick(0);
  assert.deepEqual(f.position(), [-60, 70]);
  f.pointer("pointerup", 200, 90);
  assert.equal(f.animations.length, 2);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, true);
  f.complete();
  assertParked(f);
});

for (const type of ["pointercancel", "lostpointercapture", "Escape"]) {
  dragTest(`${type} returns the dragged icon safely`, () => {
    const f = fixture();
    f.drag();
    if (type === "Escape") {
      assert.equal(f.documentRef.emit("keydown", { key: "Escape" }).defaultPrevented, true);
    } else f.pointer(type);
    assert.equal(f.animations.length, 1);
    f.complete();
    assertParked(f);
  });
}

for (const type of ["blur", "resize", "scroll", "visibilitychange"]) {
  dragTest(`${type} resets a drag or return immediately`, () => {
    for (const returning of [false, true]) {
      const f = fixture();
      f.drag();
      if (returning) f.pointer("pointerup");
      if (type === "visibilitychange") {
        f.documentRef.hidden = true;
        f.documentRef.emit(type);
      } else f.windowRef.emit(type);
      assertParked(f);
      if (returning) assert.equal(f.animations[0].cancelled, true);
    }
  });
}

dragTest("Escape during a return keeps the existing spring without jumping", () => {
  const f = fixture();
  f.drag();
  f.pointer("pointerup");
  f.animations[0].visual = [-40, 60];
  f.documentRef.emit("keydown", { key: "Escape" });
  assert.equal(f.animations.length, 1);
  assert.equal(f.animations[0].cancelled, undefined);
  f.complete();
  assertParked(f);
});

dragTest("reduced motion permits direct dragging and parks immediately on release", () => {
  const f = fixture({ reduced: true });
  f.drag();
  f.tick(0);
  assert.deepEqual(f.position(), [-100, 150]);
  f.pointer("pointerup");
  assertParked(f);
  assert.equal(f.animations.length, 0);
});

dragTest("enabling reduced motion during the return cancels the spring", () => {
  const f = fixture();
  f.drag();
  f.pointer("pointerup");
  f.motion.matches = true;
  f.motion.emit("change");
  assertParked(f);
  assert.equal(f.animations[0].cancelled, true);
});

dragTest("secondary pointers and non-primary buttons cannot take over a drag", () => {
  const f = fixture();
  for (const ignored of [{ isPrimary: false }, { button: 1 }, { button: 2 }]) {
    f.pointer("pointerdown", 300, 30, ignored);
    f.pointer("pointermove", 200, 180, ignored);
    assertParked(f);
  }
  f.drag();
  for (const type of ["pointerdown", "pointermove", "pointerup"]) {
    f.pointer(type, 10, 20, { pointerId: 2 });
  }
  f.tick(0);
  assert.deepEqual(f.position(), [-100, 150]);
  assert.equal(f.captures.has(1), true);
  assert.equal(f.animations.length, 0);
  assert.equal(f.link.emit("dragstart").defaultPrevented, true);
});

dragTest("missing animation support parks immediately; unavailable pointers leave an ordinary link", () => {
  const f = fixture({ animate: false });
  f.drag();
  f.pointer("pointerup");
  assertParked(f);
  const fallback = fixture({ pointerEvents: false });
  assert.equal(fallback.controller, null);
  assert.equal(fallback.root.hasAttribute("data-drag-ready"), false);
  assert.equal(initDragReveal({ documentRef: null, windowRef: null }), null);
});

dragTest("failed pointer capture leaves the link unchanged", () => {
  const f = fixture();
  f.link.setPointerCapture = () => { throw new Error("Inactive pointer"); };
  f.drag();
  assertParked(f);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
});

dragTest("cleanup cancels dragging and animation and removes every listener", () => {
  for (const returning of [false, true]) {
    const f = fixture();
    f.drag();
    if (returning) f.pointer("pointerup");
    f.controller.destroy();
    assertParked(f);
    assert.equal(f.root.hasAttribute("data-drag-ready"), false);
    for (const target of [f.link, f.documentRef, f.windowRef, f.motion]) {
      assert.ok([...target.listeners.values()].every(callbacks => callbacks.size === 0));
    }
    f.drag();
    assertParked(f);
  }
});

dragTest("the whole card moves while its space is reserved and the CPU is twice the rendered title icon", () => {
  const f = fixture({ card: true, width: 360, height: 240 });
  f.pointer("pointerdown", 300, 100, { target: f.link });
  assert.equal(f.captures.size, 0, "ordinary nested links keep their click targets");
  assert.equal(f.root.style.height, undefined);
  f.pointer("pointermove", 200, 250);
  f.tick(0);
  assert.deepEqual(f.position(), [-100, 150]);
  assert.equal(f.root.style.height, "240px");
  assert.equal(f.link.style.width, "360px");
  assert.equal(f.link.style.height, "240px");
  assert.equal(f.cpu.style.width, "36.8px");
  assert.equal(f.cpu.style.height, "43.2px");
  f.pointer("pointerup");
  assert.equal(f.animations[0].options.duration, 400);
  f.complete();
  assertParked(f);
  assert.equal(f.observers[0].disconnected, true);
});

dragTest("touch scrolling outside the title handle stays native, including after a drag", () => {
  const f = fixture({ card: true });
  f.drag();
  f.pointer("pointerup");
  f.complete();
  f.pointer("pointerdown", 300, 100, { pointerType: "touch", target: f.link });
  assert.equal(f.pointer("pointermove", 300, 200, { pointerType: "touch" }).defaultPrevented, false);
  f.pointer("pointerup", 300, 200, { pointerType: "touch" });
  assertParked(f);
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
  f.pointer("pointerdown", 300, 100, { pointerType: "touch", target: f.icon });
  f.pointer("pointermove", 250, 200, { pointerType: "touch" });
  f.tick(0);
  assert.deepEqual(f.position(), [-50, 100]);
  assert.equal(f.root.hasAttribute("data-drag-active"), true);
});

dragTest("transferring implicit touch capture from the title handle keeps the drag running", () => {
  const f = fixture({ card: true });
  f.pointer("pointerdown", 300, 100, { pointerType: "touch" });
  f.pointer("pointermove", 250, 200, { pointerType: "touch" });
  f.pointer("lostpointercapture", 250, 200, { pointerType: "touch", target: f.handle });
  assert.equal(f.root.hasAttribute("data-dragging"), true);
  assert.equal(f.animations.length, 0);
  f.pointer("pointermove", 230, 240, { pointerType: "touch" });
  f.tick(0);
  assert.deepEqual(f.position(), [-70, 140]);
  f.pointer("pointerup", 230, 240, { pointerType: "touch" });
  assert.equal(f.animations.length, 1);
  f.complete();
  assertParked(f);
});

dragTest("a partly visible card taller than the viewport follows the pointer without jumping", () => {
  const f = fixture({ card: true, top: -300, height: 1400 });
  f.pointer("pointerdown", 300, 150);
  f.pointer("pointermove", 310, 160);
  f.tick(0);
  assert.deepEqual(f.position(), [10, 10]);
  f.pointer("pointermove", 10000, -10000);
  f.tick(0);
  assert.deepEqual(f.position(), [90, -150], "the grabbed point stays within the viewport");
  f.pointer("pointerup");
  f.complete();
  assertParked(f);
});

dragTest("live content and hidden-state changes safely reset moving and returning cards", () => {
  for (const returning of [false, true]) {
    const f = fixture({ card: true });
    f.drag();
    if (returning) f.pointer("pointerup");
    const observer = f.observers[0];
    assert.equal(observer.target, f.documentRef.body);
    assert.equal(observer.options.childList, true);
    assert.equal(observer.options.characterData, true);
    assert.deepEqual(observer.options.attributeFilter, ["hidden"]);
    observer.callback();
    assertParked(f);
    assert.equal(observer.disconnected, true);
  }
});

dragTest("re-grabbing a returning card retains its visible offset and shared observer", () => {
  const f = fixture({ card: true });
  f.drag();
  f.pointer("pointerup");
  f.animations[0].visual = [-40, 60];
  f.pointer("pointerdown", 220, 80);
  f.tick(0);
  assert.deepEqual(f.position(), [-40, 60]);
  assert.notEqual(f.observers[0].disconnected, true);
  assert.equal(f.observers.length, 1);
  f.pointer("pointermove", 200, 90);
  f.tick(0);
  assert.deepEqual(f.position(), [-60, 70]);
  f.controller.destroy();
  assertParked(f);
  assert.equal(f.observers[0].disconnected, true);
});

function randomPrefix(...values) {
  return () => values.length ? values.shift() : 0.5;
}

function gameFixture(options = {}) {
  return fixture({ candidateCount: 3, random: randomPrefix(0, 0.5), ...options });
}

function creatureIndex(f) {
  const indices = f.candidates.flatMap((candidate, index) => candidate.children[0].name !== "cpu" ? [index] : []);
  assert.equal(indices.length, 1, "exactly one underlay contains a creature");
  return indices[0];
}

function findAndLand(f, index = creatureIndex(f)) {
  const item = f.roots[index];
  item.drag();
  const previousAnimations = item.animations.length;
  item.pointer("pointerup");
  const spring = item.animations[previousAnimations];
  if (spring?.options.fill === "forwards") spring.onfinish();
  return item;
}

const hidingPlaces = [
  ["GitHub icon", {}],
  ["repository card", { card: true, width: 360, height: 240 }],
  ["theme switcher", { themeIndex: 1, random: () => 0.5 }],
  ["milestone card", { candidateCount: 2, milestones: [{}], random: () => 0.999999 }],
];
for (const [name, options] of hidingPlaces) {
  for (const pointerType of ["mouse", "pen", "touch"]) {
    dragTest(`${pointerType} find beneath the ${name} reshuffles only after release, landing and shaking`, () => {
      const f = gameFixture(options);
      const selected = creatureIndex(f);
      const item = f.roots[selected];
      const creature = f.candidates[selected].children[0];
      item.pointer("pointerdown", 300, 30, { pointerType });
      item.pointer("pointermove", 200, 180, { pointerType });
      assert.equal(f.candidates[selected].children[0], creature, "the found creature stays put while held");
      assert.equal(item.root.hasAttribute("data-dragging"), true);
      const release = item.link.hasAttribute("data-theme-toggle") ? [300, 70] : [200, 180];
      item.pointer("pointermove", ...release, { pointerType });
      f.wait(120);
      item.pointer("pointerup", ...release, { pointerType });
      assert.equal(f.candidates[selected].children[0], creature, "release alone does not reshuffle");
      const spring = item.animations.at(-1);
      assert.equal(spring.options.duration, 400);
      spring.onfinish();
      assert.equal(f.candidates[selected].children[0], creature, "landing starts feedback without replacing the creature");
      finishShakes(f);
      assert.notEqual(creatureIndex(f), selected);
      assert.equal(item.cpu.name, "cpu");
      assert.equal(item.cpu.sourceSize, item.root.querySelector("[data-drag-handle]") ? 32 : 24);
      f.roots.forEach(assertParked);
      assert.equal(item.link.emit("click", { detail: 1 }).defaultPrevented, true, "landing preserves drag-click suppression");
      assert.equal(item.link.emit("click", { detail: 0 }).defaultPrevented, false, "keyboard links stay available");
      f.controller.destroy();
    });
  }
}

for (const [dx, dy] of [[34, 0], [-34, 0], [0, 34], [0, -34]]) {
  dragTest(`only fully uncovering the creature qualifies at offset ${dx}, ${dy}`, () => {
    const f = gameFixture({ width: 44, top: 200 });
    const selected = f.cpu;
    findAndLand(f, 1);
    assert.equal(f.cpu, selected, "revealing a CPU does not qualify");
    f.pointer("pointerdown", 270, 220);
    f.pointer("pointermove", 270 + dx * 0.999, 220 + dy * 0.999);
    f.pointer("pointerup");
    f.complete();
    assert.equal(f.cpu, selected, "a partial reveal does not qualify");
    f.pointer("pointerdown", 270, 220);
    f.pointer("pointermove", 270 + dx, 220 + dy);
    assert.equal(f.cpu, selected);
    f.pointer("pointerup");
    f.complete();
    finishShakes(f);
    assert.notEqual(creatureIndex(f), 0, "touching rectangle edges counts as fully uncovered");
    f.controller.destroy();
  });
}

for (const pointerType of ["mouse", "pen", "touch"]) {
  dragTest(`${pointerType} discovery uses the resized card creature without ending the drag`, () => {
    const f = gameFixture({ card: true, width: 360, height: 240 });
    const selected = f.cpu;
    f.pointer("pointerdown", 300, 100, { pointerType });
    f.pointer("pointermove", 300, 241.5, { pointerType });
    f.pointer("pointerup"); f.complete();
    assert.equal(f.cpu, selected, "partial exposure of the resized creature does not qualify");
    f.pointer("pointerdown", 300, 100, { pointerType });
    f.pointer("pointermove", 300, 242, { pointerType });
    assert.equal(f.root.hasAttribute("data-dragging"), true);
    assert.equal(f.captures.size, 1);
    assert.notEqual(f.observers.at(-1).disconnected, true);
    f.pointer("pointerup"); f.complete();
    finishShakes(f);
    assert.notEqual(creatureIndex(f), 0);
    assert.equal(f.observers.at(-1).disconnected, true, "observers disconnect before SVG replacement");
    f.controller.destroy();
  });
}

for (const options of [{}, { reduced: true }, { animate: false }]) {
  dragTest(`returning while still held waits for release: ${JSON.stringify(options)}`, () => {
    const f = gameFixture(options);
    const selected = f.cpu;
    f.drag();
    f.pointer("pointermove", 300, 30);
    assert.equal(f.cpu, selected, "moving back to the origin while held does not reshuffle");
    assert.equal(f.captures.size, 1);
    f.pointer("pointerup");
    if (!options.reduced && options.animate !== false) assert.equal(f.cpu, selected, "release at the origin still waits for shaking");
    finishShakes(f);
    assert.notEqual(creatureIndex(f), 0, "release at the origin completes the find after feedback");
    f.roots.forEach(assertParked);
    f.controller.destroy();
  });
}

for (const options of [{ reduced: true }, { animate: false }]) {
  dragTest(`automatic reshuffling works without motion: ${JSON.stringify(options)}`, () => {
    const f = gameFixture({ ...options, random: randomSequence(0, 0.5, 0, 0.05) });
    f.drag();
    assert.equal(creatureIndex(f), 0);
    f.pointer("pointerup");
    assert.equal(creatureIndex(f), 1);
    assert.equal(f.roots[1].cpu.name, "squirrel");
    f.roots.forEach(item => { assertParked(item); assert.equal(item.animations.length, 0); });
    f.controller.destroy();
  });
}

for (const type of ["pointercancel", "lostpointercapture", "Escape"]) {
  dragTest(`${type} cancels a found creature's automatic reshuffle`, () => {
    const f = gameFixture({ random: randomSequence(0, 0.5) });
    const selected = f.cpu;
    f.drag();
    if (type === "Escape") f.documentRef.emit("keydown", { key: "Escape" });
    else f.pointer(type);
    f.complete();
    assert.equal(f.cpu, selected);
    f.roots.forEach(assertParked);
    f.controller.destroy();
  });
}

dragTest("Escape during a found item's return keeps the spring but cancels reshuffling", () => {
  const f = gameFixture({ random: randomSequence(0, 0.5) });
  const selected = f.cpu;
  f.drag(); f.pointer("pointerup");
  const spring = f.animations[0];
  f.documentRef.emit("keydown", { key: "Escape" });
  assert.equal(spring.cancelled, undefined);
  f.complete();
  assert.equal(f.cpu, selected);
  f.controller.destroy();
});

for (const type of ["blur", "resize", "visibilitychange", "layout", "hidden", "destroy"]) {
  dragTest(`${type} discards a found creature's held or returning reset`, () => {
    for (const returning of [false, true]) {
      const f = gameFixture({ card: true, random: randomSequence(0, 0.5) });
      const selected = f.cpu;
      f.drag();
      if (returning) f.pointer("pointerup");
      if (type === "visibilitychange") {
        f.documentRef.hidden = true;
        f.documentRef.emit(type);
      } else if (type === "layout" || type === "hidden") {
        if (type === "hidden") f.root.hidden = true;
        f.observers.at(-1).callback();
      } else if (type === "destroy") f.controller.destroy();
      else f.windowRef.emit(type);
      assert.equal(f.cpu, selected);
      assertParked(f);
      if (returning) assert.equal(f.animations[0].cancelled, true);
      if (type !== "destroy") f.controller.destroy();
    }
  });
}

for (const returning of [false, true]) {
  for (const card of [false, true]) {
    dragTest(`scroll preserves a full reveal and its shuffle: returning=${returning}, card=${card}`, () => {
      const f = gameFixture({ card, trophy: true });
      const selected = f.cpu;
      f.drag();
      let staleLanding;
      if (returning) {
        f.pointer("pointerup");
        staleLanding = f.animations.at(-1).onfinish;
      }
      f.windowRef.emit("scroll");
      f.roots.forEach(assertParked);
      assert.equal(f.cpu, selected, "replacement waits for the normal shakes");
      const feedback = f.roots.map(item => item.animations.at(-1));
      const staleFinishes = feedback.map(animation => animation.onfinish);
      feedback.forEach(animation => {
        assert.notEqual(animation.options.fill, "forwards");
        assert.ok(animation.options.duration >= 640 && animation.options.duration <= 880);
      });
      if (returning) assert.equal(f.animations[0].cancelled, true);
      f.windowRef.emit("scroll");
      f.windowRef.emit("scroll");
      f.pointer("pointerup");
      staleLanding?.();
      assert.deepEqual(f.roots.map(item => item.animations.at(-1)), feedback, "scrolling does not restart feedback");
      feedback.forEach(animation => assert.notEqual(animation.cancelled, true));
      finishShakes(f);
      assert.notEqual(creatureIndex(f), 0);
      const replacement = f.candidates.map(candidate => candidate.children[0]);
      staleFinishes.forEach(finish => finish());
      staleLanding?.();
      f.windowRef.emit("scroll");
      assert.deepEqual(f.candidates.map(candidate => candidate.children[0]), replacement, "replacement happens once");
      assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1", "scrolling retains the single credited find");
      f.roots.forEach(assertParked);
      f.controller.destroy();
    });
  }
}

dragTest("scroll preserves a queued shuffle while returning every moving item immediately", () => {
  const f = gameFixture({ trophy: true });
  const selected = f.cpu;
  f.drag();
  const other = f.roots[1];
  other.pointer("pointerdown", 50, 80, { pointerId: 2 });
  other.pointer("pointermove", 60, 90, { pointerId: 2 });
  f.pointer("pointerup"); f.complete();
  assert.equal(f.cpu, selected);
  assert.equal(other.root.hasAttribute("data-dragging"), true);
  f.windowRef.emit("scroll");
  f.roots.forEach(assertParked);
  assert.equal(f.cpu, selected, "the queued find starts shaking after all items return");
  assert.equal(other.animations.length, 1, "the other item shakes without a spring return");
  finishShakes(f);
  assert.notEqual(creatureIndex(f), 0);
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
  f.controller.destroy();
});

for (const index of [0, 1]) {
  dragTest(`scroll finishes feedback waiting for re-grabbed item ${index} without restarting shakes`, () => {
    const f = gameFixture({ trophy: true });
    findAndLand(f);
    const target = f.roots[index];
    target.drag();
    finishShakes(f);
    assert.equal(creatureIndex(f), 0, "a held item defers replacement after the other shakes finish");
    const animationCounts = f.roots.map(item => item.animations.length);
    f.windowRef.emit("scroll");
    assert.notEqual(creatureIndex(f), 0);
    assert.deepEqual(f.roots.map(item => item.animations.length), animationCounts);
    assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
    f.roots.forEach(assertParked);
    f.controller.destroy();
  });
}

for (const options of [{ reduced: true }, { animate: false }]) {
  dragTest(`scroll completes a revealed creature's shuffle without motion: ${JSON.stringify(options)}`, () => {
    const f = gameFixture({ ...options, trophy: true });
    f.drag();
    f.windowRef.emit("scroll");
    assert.notEqual(creatureIndex(f), 0);
    assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
    f.roots.forEach(item => { assertParked(item); assert.equal(item.animations.length, 0); });
    f.controller.destroy();
  });
}

for (const cpu of [false, true]) {
  dragTest(`scroll after ${cpu ? "revealing a CPU" : "a partial reveal"} returns immediately without shuffling`, () => {
    const f = gameFixture({ card: true, trophy: true });
    const selected = f.cpu;
    if (cpu) f.roots[1].drag();
    else {
      f.pointer("pointerdown");
      f.pointer("pointermove", 306, 30);
    }
    f.windowRef.emit("scroll");
    assert.equal(f.cpu, selected);
    assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "0");
    f.roots.forEach(item => { assertParked(item); assert.equal(item.animations.length, 0); });
    f.controller.destroy();
  });
}

dragTest("re-grabbing a found item's spring waits for the next release and landing", () => {
  const f = gameFixture({ card: true });
  const selected = f.cpu;
  f.drag(); f.pointer("pointerup");
  const spring = f.animations[0];
  spring.visual = [-10, 20];
  f.pointer("pointerdown", 220, 80);
  assert.equal(spring.cancelled, true);
  assert.equal(spring.onfinish, null);
  assert.equal(f.cpu, selected);
  f.pointer("pointerup", 220, 80);
  assert.equal(f.cpu, selected);
  f.complete();
  finishShakes(f);
  assert.notEqual(creatureIndex(f), 0, "the original find survives re-grabbing");
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

dragTest("reshuffling waits for other drags and returns without interrupting them", () => {
  const f = gameFixture();
  const selected = f.cpu;
  f.drag();
  const other = f.roots[1];
  other.pointer("pointerdown", 50, 80, { pointerId: 2 });
  other.pointer("pointermove", 60, 90, { pointerId: 2 });
  f.pointer("pointerup"); f.complete();
  assert.equal(f.cpu, selected);
  assert.equal(other.root.hasAttribute("data-dragging"), true);
  f.tick(0);
  assert.deepEqual(other.position(), [10, 10]);
  other.pointer("pointerup", 60, 90, { pointerId: 2 });
  assert.equal(f.cpu, selected, "another returning item still defers the shuffle");
  other.complete();
  assert.equal(f.cpu, selected, "all items landing starts shaking before replacement");
  finishShakes(f);
  assert.notEqual(creatureIndex(f), 0);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

dragTest("Escape clears a completed find waiting for another item to land", () => {
  const f = gameFixture({ random: randomSequence(0, 0.5) });
  const selected = f.cpu;
  f.drag();
  const other = f.roots[1];
  other.pointer("pointerdown", 50, 80, { pointerId: 2 });
  other.pointer("pointermove", 60, 90, { pointerId: 2 });
  f.pointer("pointerup"); f.complete();
  f.documentRef.emit("keydown", { key: "Escape" });
  other.complete();
  assert.equal(f.cpu, selected);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

dragTest("a queued find can be re-grabbed while another item is moving", () => {
  const f = gameFixture();
  const selected = f.cpu;
  f.drag();
  const other = f.roots[1];
  other.pointer("pointerdown", 50, 80, { pointerId: 2 });
  other.pointer("pointermove", 60, 90, { pointerId: 2 });
  f.pointer("pointerup"); f.complete();
  f.pointer("pointerdown", 300, 30, { pointerId: 3 });
  other.pointer("pointerup", 60, 90, { pointerId: 2 }); other.complete();
  assert.equal(f.cpu, selected);
  f.pointer("pointerup", 300, 30, { pointerId: 3 });
  finishShakes(f);
  assert.notEqual(creatureIndex(f), 0);
  f.controller.destroy();
});

dragTest("each alternative target has an equal interval and every landing rerolls the creature", () => {
  const count = 4;
  for (let previous = 0; previous < count; previous++) {
    const alternatives = Array.from({ length: count }, (_, index) => index).filter(index => index !== previous);
    for (let target = 0; target < alternatives.length; target++) {
      for (const fraction of [0, 0.5, 0.999999]) {
        for (const [roll, expected] of [[0, "squirrel"], [0.099999, "squirrel"], [0.1, "bug"], [0.999999, "bug"]]) {
          const f = gameFixture({ candidateCount: count, reduced: true,
            random: randomSequence((previous + 0.5) / count, 0.5, (target + fraction) / alternatives.length, roll) });
          findAndLand(f);
          assert.equal(creatureIndex(f), alternatives[target]);
          assert.equal(f.candidates[alternatives[target]].children[0].name, expected);
          f.controller.destroy();
        }
      }
    }
  }
});

dragTest("loaded milestones participate in the initial pool while hidden cards and sections do not", () => {
  const f = gameFixture({ candidateCount: 2, milestones: [{ hidden: true }, {}, { ancestorHidden: true }],
    random: randomSequence(0.999999, 0.05) });
  assert.equal(creatureIndex(f), 3);
  assert.equal(f.milestoneRoots[1].cpu.name, "squirrel");
  f.controller.destroy();
});

dragTest("milestones loaded after initialisation join both the shuffle and independent shake pool", () => {
  const rolls = [0, 0.5];
  const f = gameFixture({ candidateCount: 2, milestones: [{ hidden: true }, { hidden: true }, { ancestorHidden: true }],
    random: () => rolls.length ? rolls.shift() : 0.5 });
  f.drag();
  f.milestoneRoots[0].root.hidden = false;
  f.pointer("pointerup"); f.complete();
  assert.equal(creatureIndex(f), 0, "newly loaded milestones shake before the next creature is set");
  rolls.push(0.999999, 0.05);
  finishShakes(f);
  assert.equal(creatureIndex(f), 2);
  assert.equal(f.milestoneRoots[0].cpu.name, "squirrel");
  assert.equal(f.milestoneRoots[0].animations.length, 1);
  assert.equal(f.milestoneRoots[1].animations.length, 0);
  assert.equal(f.milestoneRoots[2].animations.length, 0);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

dragTest("hidden milestone cards leave the pool before a completed find chooses its next target", () => {
  const f = gameFixture({ candidateCount: 2, milestones: [{}, {}], reduced: true,
    random: randomSequence(0, 0.5, 0.999999, 0.05) });
  f.drag();
  f.milestoneRoots[1].root.hidden = true;
  f.pointer("pointerup");
  assert.equal(creatureIndex(f), 2);
  assert.equal(f.milestoneRoots[0].cpu.name, "squirrel");
  f.controller.destroy();
});

dragTest("one candidate stays put until another hiding place loads and a fresh find lands", () => {
  const f = gameFixture({ candidateCount: 1, milestones: [{ hidden: true }], reduced: true,
    random: randomSequence(0, 0.5, 0, 0.05) });
  const selected = f.cpu;
  findAndLand(f);
  assert.equal(f.cpu, selected);
  f.milestoneRoots[0].root.hidden = false;
  assert.equal(f.cpu, selected, "loading a milestone alone does not trigger reshuffling");
  findAndLand(f);
  assert.equal(creatureIndex(f), 1);
  assert.equal(f.milestoneRoots[0].cpu.name, "squirrel");
  f.controller.destroy();
});

dragTest("shakes stay horizontal and independent and return every eligible surface to rest", () => {
  const f = gameFixture({ card: true, milestones: [{}, { hidden: true }] });
  findAndLand(f);
  const eligible = f.roots.filter(item => !item.root.hidden);
  const keyframes = eligible.map(item => item.animations.at(-1).keyframes);
  assert.notDeepEqual(keyframes[0], keyframes[1], "even identical random draws produce separate movements");
  eligible.forEach(item => {
    assertParked(item);
    const animation = item.animations.at(-1);
    assert.ok(animation.options.duration >= 640 && animation.options.duration <= 880);
    assert.deepEqual(animation.keyframes[0], animation.keyframes.at(-1));
    assert.deepEqual(coordinates(animation.keyframes[0].transform), [0, 0]);
    animation.keyframes.forEach(frame => {
      const [x, y] = coordinates(frame.transform);
      assert.ok(Math.abs(x) <= 6);
      assert.equal(y, 0, "shakes never move vertically");
      assert.doesNotMatch(frame.transform, /rotate\(/, "shakes never rock or rotate");
    });
    animation.keyframes.slice(1, -1).forEach(frame => {
      assert.ok(Math.abs(coordinates(frame.transform)[0]) >= 1.5);
    });
    item.complete();
    assert.equal(animation.cancelled, true);
    assertParked(item);
  });
  assert.equal(f.cpu.sourceSize, 32, "restoring a card CPU preserves its source size");
  assert.equal(f.milestoneRoots[1].animations.length, 0);
  f.controller.destroy();
});

dragTest("completed finds reshuffle once after each shake sequence", () => {
  const f = gameFixture();
  f.drag(); f.pointer("pointerup");
  const land = f.animations[0].onfinish;
  land();
  const previous = creatureIndex(f);
  const firstShakes = f.roots.map(item => item.animations.at(-1));
  const staleFinishes = firstShakes.map(animation => animation.onfinish);
  land();
  assert.equal(creatureIndex(f), previous, "a repeated landing callback cannot reshuffle again");
  assert.deepEqual(f.roots.map(item => item.animations.at(-1)), firstShakes);
  finishShakes(f);
  assert.notEqual(creatureIndex(f), previous);
  firstShakes.forEach(animation => assert.equal(animation.cancelled, true));
  const next = creatureIndex(f);
  findAndLand(f);
  const nextShakes = f.roots.map(item => item.animations.at(-1));
  staleFinishes.forEach(finish => finish());
  assert.equal(creatureIndex(f), next, "a fresh find waits for its own feedback");
  nextShakes.forEach(animation => assert.notEqual(animation.cancelled, true, "old callbacks cannot cancel new shakes"));
  finishShakes(f);
  assert.notEqual(creatureIndex(f), next);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

for (const order of [[0, 1, 2], [2, 0, 1]]) {
  for (const [initialRoll, nextRoll, expected] of [[0.05, 0.9, "bug"], [0.9, 0.05, "squirrel"]]) {
    dragTest(`${expected} replacement waits for the last shake in order ${order}`, () => {
      const rolls = [0, initialRoll];
      let shakeRoll = 0;
      const f = gameFixture({ random: () => rolls.length ? rolls.shift() : (shakeRoll++ % 9) / 10 });
      const original = f.candidates.map(candidate => candidate.children[0]);
      findAndLand(f);
      const feedback = f.roots.map(item => item.animations.at(-1));
      assert.equal(new Set(feedback.map(animation => animation.options.duration)).size, 3);
      rolls.push(0.999999, nextRoll);
      for (const index of order.slice(0, -1)) {
        feedback[index].onfinish();
        assert.deepEqual(f.candidates.map(candidate => candidate.children[0]), original, "no underlay changes during feedback");
        assert.equal(rolls.length, 2, "selection randomness is drawn only after feedback");
      }
      feedback[order.at(-1)].onfinish();
      assert.equal(rolls.length, 0);
      assert.equal(creatureIndex(f), 2);
      assert.equal(f.roots[2].cpu.name, expected);
      assert.equal(f.cpu.name, "cpu");
      f.controller.destroy();
    });
  }
}

for (const index of [0, 1]) {
  for (const timing of ["last shake cancelled", "return before other shakes", "other shakes finish while held"]) {
    dragTest(`dragging hiding place ${index} during feedback waits until settled: ${timing}`, () => {
      const f = gameFixture();
      const selected = f.cpu;
      findAndLand(f);
      const feedback = f.roots.map(item => item.animations.at(-1));
      if (timing === "last shake cancelled") {
        feedback.forEach((animation, current) => { if (current !== index) animation.onfinish(); });
      }
      const target = f.roots[index];
      target.pointer("pointerdown");
      assert.equal(feedback[index].cancelled, true);
      assert.equal(f.cpu, selected, "cancelling the last shake in beforeStart cannot replace the creature");
      target.pointer("pointermove", 200, 180);
      if (timing === "other shakes finish while held") {
        finishShakes(f);
        assert.equal(f.cpu, selected, "finishing every shake still waits for a held item");
      }
      target.pointer("pointerup");
      assert.equal(f.cpu, selected, "replacement still waits for the returning item");
      target.complete();
      if (timing === "return before other shakes") {
        assert.equal(f.cpu, selected, "landing during feedback does not start another shake sequence");
        assert.deepEqual(f.roots.map(item => item.animations.filter(animation => animation.options.fill !== "forwards").length), [1, 1, 1]);
        finishShakes(f);
      }
      assert.notEqual(creatureIndex(f), 0);
      f.roots.forEach(assertParked);
      f.controller.destroy();
    });
  }
}

for (const type of ["pointercancel", "lostpointercapture", "layout", "hidden"]) {
  dragTest(`${type} on the creature's hiding place discards replacement during feedback`, () => {
    const f = gameFixture({ card: true });
    const selected = f.cpu;
    findAndLand(f);
    const feedback = f.roots.map(item => item.animations.at(-1));
    const staleFinishes = feedback.map(animation => animation.onfinish);
    f.drag();
    if (type === "layout" || type === "hidden") {
      if (type === "hidden") f.root.hidden = true;
      f.observers.at(-1).callback();
    } else {
      f.pointer(type, 300, 30, { target: f.link });
      f.complete();
    }
    staleFinishes.forEach(finish => finish());
    assert.equal(f.cpu, selected);
    feedback.forEach(animation => assert.equal(animation.cancelled, true));
    f.roots.forEach(assertParked);
    f.controller.destroy();
  });
}

dragTest("milestones that load or hide during shaking update the final selection pool", () => {
  const rolls = [0, 0.5];
  const f = gameFixture({ candidateCount: 1, milestones: [{}, { hidden: true }],
    random: () => rolls.length ? rolls.shift() : 0.5 });
  findAndLand(f);
  f.milestoneRoots[0].root.hidden = true;
  f.milestoneRoots[1].root.hidden = false;
  rolls.push(0, 0.05);
  finishShakes(f);
  assert.equal(creatureIndex(f), 2);
  assert.equal(f.milestoneRoots[1].cpu.name, "squirrel");
  assert.equal(f.milestoneRoots[1].animations.length, 0, "a milestone loaded during feedback joins selection without restarting shakes");
  f.controller.destroy();
});

for (const hiddenIndex of [0, 1]) {
  dragTest(`hiding ${hiddenIndex === 0 ? "the creature" : "the only alternative"} during feedback retains the existing creature`, () => {
    const f = gameFixture({ candidateCount: 2 });
    const selected = f.cpu;
    findAndLand(f);
    f.roots[hiddenIndex].root.hidden = true;
    finishShakes(f);
    assert.equal(f.cpu, selected);
    assert.equal(creatureIndex(f), 0);
    f.controller.destroy();
  });
}

dragTest("surfaces without animation support do not delay the remaining shakes", () => {
  const f = gameFixture();
  const selected = f.cpu;
  f.roots[1].link.animate = undefined;
  findAndLand(f);
  assert.equal(f.roots[1].animations.length, 0);
  f.complete();
  assert.equal(f.cpu, selected, "one animated surface is still shaking");
  f.roots[2].complete();
  assert.notEqual(creatureIndex(f), 0);
  f.controller.destroy();
});

dragTest("starting a drag cancels only that surface's shake before measuring its position", () => {
  const f = gameFixture();
  findAndLand(f);
  const target = f.roots[1];
  const shake = target.animations[0];
  shake.visual = [1.25, 0];
  target.pointer("pointerdown");
  assert.equal(shake.cancelled, true);
  assert.notEqual(f.animations.at(-1).cancelled, true);
  assert.deepEqual(target.position(), [0, 0]);
  target.pointer("pointerup");
  assert.equal(target.link.emit("click", { detail: 1 }).defaultPrevented, false);
  f.controller.destroy();
});

for (const type of ["blur", "resize", "visibilitychange", "Escape", "destroy"]) {
  dragTest(`${type} clears running automatic shuffle feedback`, () => {
    const f = gameFixture();
    findAndLand(f);
    const feedback = f.roots.map(item => item.animations.at(-1));
    const staleFinishes = feedback.map(animation => animation.onfinish);
    const selected = creatureIndex(f);
    if (type === "visibilitychange") {
      f.documentRef.hidden = true;
      f.documentRef.emit(type);
    } else if (type === "Escape") f.documentRef.emit("keydown", { key: "Escape" });
    else if (type === "destroy") f.controller.destroy();
    else f.windowRef.emit(type);
    feedback.forEach(animation => assert.equal(animation.cancelled, true));
    staleFinishes.forEach(finish => finish());
    assert.equal(creatureIndex(f), selected);
    f.roots.forEach(assertParked);
    if (type !== "destroy") f.controller.destroy();
    for (const target of [f.windowRef, f.documentRef, f.motion, ...f.roots.map(item => item.link)]) {
      assert.ok([...target.listeners.values()].every(callbacks => callbacks.size === 0));
    }
  });
}

for (const held of [false, true]) {
  dragTest(`enabling reduced motion during feedback finishes replacement when items are at rest: held=${held}`, () => {
    const f = gameFixture();
    const selected = f.cpu;
    findAndLand(f);
    const feedback = f.roots.map(item => item.animations.at(-1));
    const staleFinishes = feedback.map(animation => animation.onfinish);
    const other = f.roots[1];
    if (held) other.drag();
    f.motion.matches = true;
    f.motion.emit("change");
    feedback.forEach(animation => assert.equal(animation.cancelled, true));
    if (held) {
      assert.equal(f.cpu, selected, "reduced motion does not replace a creature while an item is held");
      other.pointer("pointerup");
    }
    assert.notEqual(creatureIndex(f), 0);
    const replacement = f.candidates.map(candidate => candidate.children[0]);
    staleFinishes.forEach(finish => finish());
    assert.deepEqual(f.candidates.map(candidate => candidate.children[0]), replacement);
    f.roots.forEach(assertParked);
    f.controller.destroy();
  });
}

dragTest("enabling reduced motion completes a released find immediately without feedback", () => {
  const f = gameFixture({ random: randomSequence(0, 0.5, 0, 0.05) });
  f.drag(); f.pointer("pointerup");
  f.motion.matches = true;
  f.motion.emit("change");
  assert.equal(f.animations[0].cancelled, true);
  assert.equal(creatureIndex(f), 1);
  assert.equal(f.roots[1].cpu.name, "squirrel");
  assert.equal(f.roots[1].animations.length, 0);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

for (const stage of ["returning", "shaking"]) {
  dragTest(`reinitialisation preserves the creature but discards a discovery while ${stage}`, () => {
    const f = gameFixture();
    const selected = f.cpu;
    f.drag(); f.pointer("pointerup");
    if (stage === "shaking") f.complete();
    f.controller.destroy();
    const next = initDragReveal({ ...f, random: () => assert.fail("reinitialisation must not reroll") });
    assert.equal(f.cpu, selected);
    f.pointer("pointerdown", 300, 30);
    f.pointer("pointermove", 306, 30);
    f.pointer("pointerup"); f.complete();
    assert.equal(f.cpu, selected, "a partial reveal after reinitialisation cannot reuse the old find");
    next.destroy();
  });
}

dragTest("reinitialisation preserves the newly hidden creature after an automatic shuffle", () => {
  const f = gameFixture();
  findAndLand(f);
  finishShakes(f);
  const selected = creatureIndex(f);
  const icon = f.candidates[selected].children[0];
  f.controller.destroy();
  const next = initDragReveal({ ...f, random: () => assert.fail("reinitialisation must not reroll") });
  assert.equal(f.candidates[selected].children[0], icon);
  next.destroy();
});

function completeDiscoveries(f, count, { finishTrophy = true } = {}) {
  for (let index = 0; index < count; index++) {
    findAndLand(f);
    finishShakes(f);
    if (finishTrophy) f.trophyAnimations.at(-1)?.onfinish?.();
  }
}

dragTest("discovery milestones fade in bronze and turn before changing to silver and gold", () => {
  const f = gameFixture({ trophy: true });
  assert.equal(f.trophy.getAttribute("aria-hidden"), "true");
  for (let count = 1; count <= 19; count++) {
    completeDiscoveries(f, 1, { finishTrophy: false });
    assert.equal(f.trophyAnimations.length, Math.min(3, Math.floor(count / 5)));
    if (count < 5) {
      assert.equal(f.trophy.getAttribute("data-trophy-tier"), null);
    } else if (count % 5 === 0) {
      const animation = f.trophyAnimations.at(-1);
      if (count === 5) {
        assert.equal(animation.target, f.trophy, "the icon and progress bar fade in together");
        assert.equal(animation.options.duration, 300);
        assert.deepEqual(animation.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
      } else {
        assert.equal(animation.target, f.trophyIcon, "the progress bar stays still during trophy spins");
        assert.equal(f.trophy.getAttribute("data-trophy-tier"), count === 10 ? "bronze" : "silver");
        assert.equal(animation.options.duration, 600);
        assert.deepEqual(animation.keyframes.map(frame => frame.transform), [
          "perspective(8rem) rotateY(0deg)", "perspective(8rem) rotateY(360deg)",
        ]);
      }
      animation.onfinish();
      const tier = count === 5 ? "bronze" : count === 10 ? "silver" : "gold";
      assert.equal(f.trophy.getAttribute("data-trophy-tier"), tier);
      assert.match(f.trophy.getAttribute("aria-label"), new RegExp(tier, "i"));
      assert.equal(f.trophy.hasAttribute("aria-hidden"), false);
    }
    assert.deepEqual(f.navigations, []);
  }
  assert.equal(f.trophy.getAttribute("data-trophy-tier"), "gold");
  f.controller.destroy();
});

for (const options of [{}, { reduced: true }, { animate: false }]) {
  dragTest(`progress tracks each find through all stages with ${options.reduced ? "reduced motion" : options.animate === false ? "no animation support" : "animations"}`, () => {
    const f = gameFixture({ trophy: true, ...options });
    const expectedProgress = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 5];
    const targets = ["bronze trophy", "silver trophy", "gold trophy", "game completion"];
    assert.equal(f.trophyProgress.getAttribute("aria-valuemin"), "0");
    assert.equal(f.trophyProgress.getAttribute("aria-valuemax"), "5");
    for (let count = 0; count <= 20; count++) {
      if (count) completeDiscoveries(f, 1);
      const progress = expectedProgress[count];
      const target = targets[Math.min(Math.floor(count / 5), 3)];
      const description = `${count} completed; ${progress} of 5 towards ${target}; ${5 - progress} remaining`;
      assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), String(progress));
      assert.equal(f.trophyProgress.style["--trophy-progress"], String(progress / 5));
      assert.equal(f.trophyProgress.getAttribute("aria-label"), `Progress towards ${target}`);
      assert.equal(f.trophyProgress.getAttribute("aria-valuetext"), description);
      assert.equal(f.trophy.getAttribute("title"), description);
      assert.equal(f.trophy.getAttribute("aria-hidden"), count < 5 ? "true" : null);
    }
    assert.deepEqual(f.navigations, ["https://www.khanacademy.org/"]);
    f.controller.destroy();
  });
}

dragTest("progress updates while a trophy upgrade is pending and survives reinitialisation", () => {
  const f = gameFixture({ trophy: true });
  completeDiscoveries(f, 9);
  completeDiscoveries(f, 1, { finishTrophy: false });
  const animation = f.trophyAnimations.at(-1);
  assert.equal(f.trophy.getAttribute("data-trophy-tier"), "bronze");
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "0");
  assert.match(f.trophyProgress.getAttribute("aria-label"), /gold/);
  completeDiscoveries(f, 1, { finishTrophy: false });
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
  animation.onfinish();
  assert.equal(f.trophy.getAttribute("data-trophy-tier"), "silver");
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
  f.controller.destroy();
  f.trophyProgress.setAttribute("aria-valuenow", "0");
  f.trophyProgress.style.setProperty("--trophy-progress", "0");
  let randomCalls = 0;
  f.controller = initDragReveal({ ...f, random: () => { randomCalls++; return 0.5; } });
  assert.equal(randomCalls, 0, "reinitialisation must not reroll");
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
  assert.equal(f.trophyProgress.style["--trophy-progress"], "0.2");
  assert.equal(f.trophy.getAttribute("title"), "11 completed; 1 of 5 towards gold trophy; 4 remaining");
  completeDiscoveries(f, 1);
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "2");
  f.controller.destroy();
});

dragTest("full reveals award once before release and cannot repeat until a new hiding place", () => {
  const f = gameFixture({ trophy: true });
  completeDiscoveries(f, 4);
  findAndLand(f, (creatureIndex(f) + 1) % f.roots.length);
  const item = f.roots[creatureIndex(f)];
  item.pointer("pointerdown"); item.pointer("pointermove", 306, 30); item.pointer("pointerup"); item.complete();
  assert.equal(f.trophyAnimations.length, 0, "CPUs and partial reveals add nothing");
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "4");
  item.drag();
  assert.equal(f.trophyAnimations.length, 1, "the fifth full reveal starts the fade while held");
  assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "0", "the new stage starts before release");
  item.pointer("pointermove", 180, 200);
  item.pointer("pointercancel"); item.complete();
  assert.equal(f.trophy.getAttribute("data-trophy-tier"), "bronze", "cancelling does not undo a full reveal");
  item.drag();
  assert.equal(f.trophyAnimations.length, 1, "revealing the same hiding place again adds nothing");
  assert.equal(f.trophy.getAttribute("title"), "5 completed; 0 of 5 towards silver trophy; 5 remaining");
  item.pointer("pointerup");
  const land = item.animations.at(-1).onfinish;
  land();
  const staleFinishes = f.roots.map(entry => entry.animations.at(-1).onfinish);
  land();
  finishShakes(f);
  assert.equal(f.trophyAnimations.length, 1);
  staleFinishes.forEach(finish => finish());
  completeDiscoveries(f, 4);
  assert.equal(f.trophyAnimations.length, 1, "duplicate callbacks cannot advance the next milestone");
  completeDiscoveries(f, 1);
  assert.equal(f.trophy.getAttribute("data-trophy-tier"), "silver");
  f.controller.destroy();
});

dragTest("the twentieth full reveal redirects once and ends the run", () => {
  const f = gameFixture({ trophy: true });
  completeDiscoveries(f, 19);
  assert.deepEqual(f.navigations, []);
  const selected = creatureIndex(f);
  const item = f.roots[selected];
  item.drag();
  assert.deepEqual(f.navigations, ["https://www.khanacademy.org/"], "the twentieth reveal redirects while held");
  item.pointer("pointerup");
  const land = item.animations.at(-1).onfinish;
  land();
  assert.equal(creatureIndex(f), selected, "the completed run does not choose a new hiding place");
  land();
  completeDiscoveries(f, 2);
  f.controller.destroy();
  f.controller = initDragReveal({ ...f, random: () => assert.fail("a completed run cannot reroll") });
  completeDiscoveries(f, 1);
  assert.deepEqual(f.navigations, ["https://www.khanacademy.org/"]);
  f.controller.destroy();
});

for (const [count, previous, next] of [[10, "bronze", "silver"], [15, "silver", "gold"]]) {
  dragTest(`the ${next} upgrade starts on a full reveal while held, before landing or shuffling`, () => {
    const f = gameFixture({ trophy: true });
    completeDiscoveries(f, count - 1);
    const item = f.roots[creatureIndex(f)];
    item.drag();
    assert.equal(item.root.hasAttribute("data-dragging"), true);
    assert.equal(f.trophy.getAttribute("data-trophy-tier"), previous);
    const animation = f.trophyAnimations.at(-1);
    assert.equal(animation.options.duration, 600);
    animation.onfinish();
    assert.equal(f.trophy.getAttribute("data-trophy-tier"), next);
    assert.equal(item.root.hasAttribute("data-dragging"), true);
    f.controller.destroy();
    f.controller = initDragReveal({ ...f, random: () => 0.5 });
    completeDiscoveries(f, 1);
    assert.equal(f.trophyAnimations.length, count / 5, "reinitialisation cannot count the same reveal twice");
    f.controller.destroy();
  });
}

dragTest("bugs and squirrels share progress and the redirect works without a repo heading", () => {
  let roll = 0.05;
  const f = gameFixture({ reduced: true, random: () => roll });
  const creatures = new Set();
  for (let count = 1; count <= 20; count++) {
    creatures.add(f.candidates[creatureIndex(f)].children[0].name);
    roll = count % 2 ? 0.9 : 0.05;
    completeDiscoveries(f, 1);
    assert.equal(f.navigations.length, count === 20 ? 1 : 0);
  }
  assert.deepEqual([...creatures].sort(), ["bug", "squirrel"]);
  assert.deepEqual(f.navigations, ["https://www.khanacademy.org/"]);
  f.controller.destroy();
});

for (const options of [{ reduced: true }, { animate: false }]) {
  dragTest(`trophy tiers apply immediately with ${options.reduced ? "reduced motion" : "no animation support"}`, () => {
    const f = gameFixture({ trophy: true, ...options });
    completeDiscoveries(f, 5);
    assert.equal(f.trophy.getAttribute("data-trophy-tier"), "bronze");
    completeDiscoveries(f, 5);
    assert.equal(f.trophy.getAttribute("data-trophy-tier"), "silver");
    completeDiscoveries(f, 5);
    assert.equal(f.trophy.getAttribute("data-trophy-tier"), "gold");
    assert.equal(f.trophyAnimations.length, 0);
    f.controller.destroy();
  });
}

for (const [count, tier] of [[5, "bronze"], [10, "silver"], [15, "gold"]]) {
  for (const interruption of ["reduced motion", "hidden page", "destroy", "animation cancellation"]) {
    dragTest(`${interruption} settles the trophy earned on discovery ${count} and ignores stale finishes`, () => {
      const f = gameFixture({ trophy: true });
      completeDiscoveries(f, count - 1);
      completeDiscoveries(f, 1, { finishTrophy: false });
      const animation = f.trophyAnimations.at(-1);
      const staleFinish = animation.onfinish;
      if (interruption === "reduced motion") {
        f.motion.matches = true; f.motion.emit("change");
      } else if (interruption === "hidden page") {
        f.documentRef.hidden = true; f.documentRef.emit("visibilitychange");
      } else if (interruption === "destroy") f.controller.destroy();
      else animation.oncancel();
      assert.equal(animation.cancelled, true);
      assert.equal(f.trophy.getAttribute("data-trophy-tier"), tier);
      assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "0");
      f.documentRef.hidden = false;
      f.controller.destroy();
      f.controller = initDragReveal({ ...f, random: () => 0.5 });
      assert.equal(f.trophyAnimations.length, Math.floor(count / 5), "initialisation cannot replay trophy effects");
      if (count === 5) {
        completeDiscoveries(f, 5);
        assert.equal(f.trophy.getAttribute("data-trophy-tier"), "silver");
      }
      staleFinish();
      assert.equal(f.trophy.getAttribute("data-trophy-tier"), count === 5 ? "silver" : tier);
      f.controller.destroy();
    });
  }
}

dragTest("a new document resets trophy progress and a single hiding place cannot earn repeated finds", () => {
  const first = gameFixture({ trophy: true, reduced: true });
  completeDiscoveries(first, 15);
  first.controller.destroy();
  const fresh = gameFixture({ trophy: true, reduced: true });
  completeDiscoveries(fresh, 4);
  assert.equal(fresh.trophy.getAttribute("data-trophy-tier"), null);
  assert.equal(fresh.trophyProgress.getAttribute("aria-valuenow"), "4");
  completeDiscoveries(fresh, 1);
  assert.equal(fresh.trophy.getAttribute("data-trophy-tier"), "bronze");
  fresh.controller.destroy();
  const single = gameFixture({ trophy: true, reduced: true, candidateCount: 1 });
  completeDiscoveries(single, 20);
  assert.equal(single.trophy.getAttribute("data-trophy-tier"), null);
  assert.deepEqual(single.navigations, []);
  single.controller.destroy();
});
