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
    if (homepage.includes('class="repo-section-heading"')) {
      assert.equal(/\bdata-drag-shuffle\b/.test(homepage), gameEnabled, "shuffle control inclusion");
    } else {
      assert.equal(/\bdata-drag-shuffle\b/.test(homepage), false, "shuffle requires a repository heading");
    }
  });
}

class Events {
  listeners = new Map();
  attributes = new Map();
  classes = new Set();
  classList = {
    add: name => this.classes.add(name),
    remove: name => this.classes.delete(name),
    contains: name => this.classes.has(name),
  };
  get hidden() { return this.hasAttribute("hidden"); }
  set hidden(value) { if (value) this.setAttribute("hidden", ""); else this.removeAttribute("hidden"); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  emit(type, data = {}) {
    const event = {
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      defaultPrevented: false, ...data,
    };
    this.listeners.get(type)?.forEach(callback => callback(event));
    return event;
  }
}

function coordinates(value) {
  return value ? [...value.matchAll(/(-?[\d.e+]+)px/g)].map(match => Number(match[1])) : [0, 0];
}

function makeIcon(name, sourceSize = 16) {
  return {
    name, sourceSize, style: {},
    cloneNode(deep) { assert.equal(deep, true); return makeIcon(name, sourceSize); },
  };
}

function makeUnderlay(bounds, size) {
  const underlay = {
    replaceChildren(...children) {
      this.children = children;
      children.forEach(icon => {
        icon.getBoundingClientRect = () => {
          const width = parseFloat(icon.style.width) || size;
          const height = parseFloat(icon.style.height) || size;
          const left = bounds.left + (bounds.width - width) / 2;
          const top = bounds.top + (bounds.height - height) / 2;
          return { left, top, width, height, right: left + width, bottom: top + height };
        };
      });
    },
  };
  underlay.replaceChildren(makeIcon("cpu", size));
  return underlay;
}

function fixture({ reduced = false, width = 92, animate = true, pointerEvents = true, card = false, top = 8, height = 44, candidateCount = 0, templates = true, random = Math.random, shuffle = false, milestones = [] } = {}) {
  const style = () => ({ removeProperty(name) { delete this[name]; } });
  const windowRef = new Events();
  windowRef.setTimeout = setTimeout;
  windowRef.clearTimeout = clearTimeout;
  function makeRoot({ left = 250, top = 8, width = 92, height = 44, card = false, eligible = true, hidden = false, ancestorHidden = false } = {}) {
    const root = new Events();
    const link = new Events();
    const bounds = { left, top, width, height, right: left + width, bottom: top + height };
    root.style = style();
    root.hidden = hidden;
    root.ancestorHidden = ancestorHidden;
    const handle = new Events();
    const icon = { getBoundingClientRect: () => ({ width: 18.4, height: 21.6 }) };
    const underlay = makeUnderlay(bounds, card ? 32 : 24);
    underlay.closest = selector => {
      assert.equal(selector, "[hidden]");
      return root.hidden || root.ancestorHidden ? root : null;
    };
    handle.querySelector = () => icon;
    handle.contains = target => target === handle || target === icon;
    root.getBoundingClientRect = () => ({ ...bounds });
    root.querySelector = selector => ({
      "[data-drag-surface]": link,
      "[data-drag-handle]": card ? handle : null,
      "[data-drag-surprise]": eligible ? underlay : null,
      ".card-cpu > svg": underlay.children[0],
    })[selector];
    link.style = style();
    const captures = new Set();
    link.setPointerCapture = id => captures.add(id);
    link.hasPointerCapture = id => captures.has(id);
    link.releasePointerCapture = id => {
      captures.delete(id);
      windowRef.emit("lostpointercapture", { pointerId: id, target: link });
    };
    const animations = [];
    let running;
    if (animate) link.animate = (keyframes, options) => {
      const animation = {
        keyframes, options,
        cancel() { this.cancelled = true; if (running === this) running = null; },
      };
      animations.push(animation);
      running = animation;
      return animation;
    };
    link.getBoundingClientRect = () => {
      const [x, y] = running?.visual || coordinates(link.style.transform);
      return { ...bounds, left: bounds.left + x, right: bounds.right + x, top: bounds.top + y, bottom: bounds.bottom + y };
    };
    const pointer = (type, x = 300, y = 30, extra = {}) => (type === "pointerdown" ? link : windowRef).emit(type, {
      pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: x, clientY: y, target: card ? handle : link, ...extra,
    });
    return {
      root, link, bounds, captures, animations, pointer, handle, icon, underlay,
      get cpu() { return underlay.children[0]; },
      position: () => coordinates(link.style.transform),
      complete: () => animations.at(-1).onfinish(),
      drag() { pointer("pointerdown"); pointer("pointermove", 200, 180); },
    };
  }
  const first = makeRoot({ top, width, height, card, eligible: candidateCount > 0 });
  const roots = [first, ...Array.from({ length: Math.max(0, candidateCount - 1) }, (_, index) =>
    makeRoot({ left: 20, top: 60 + index * 60, width: 44, card: index > 1 }))];
  const milestoneRoots = milestones.map(options => makeRoot({ card: true, width: 240, height: 120, ...options }));
  roots.push(...milestoneRoots);
  const candidates = [...roots.slice(0, candidateCount), ...milestoneRoots].map(entry => entry.underlay);
  const documentRef = new Events();
  documentRef.hidden = false;
  documentRef.documentElement = { clientWidth: 390, clientHeight: 844 };
  const template = {
    content: { children: [makeIcon("bug"), makeIcon("squirrel")] },
    removed: false,
    remove() { this.removed = true; },
  };
  const shuffleButton = new Events();
  const syncIcon = makeIcon("sync", 24);
  shuffleButton.querySelector = () => syncIcon;
  documentRef.querySelector = selector => ({
    "[data-drag-icons]": templates && !template.removed ? template : null,
    "[data-drag-shuffle]": shuffle ? shuffleButton : null,
  })[selector] || null;
  documentRef.querySelectorAll = selector => ({
    "[data-drag-reveal]": roots.map(entry => entry.root),
    "[data-drag-surprise]": candidates,
  })[selector] || [];
  documentRef.body = new Events();
  const observers = [];
  windowRef.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  };
  if (pointerEvents) windowRef.PointerEvent = function () {};
  const motion = Object.assign(new Events(), { matches: reduced });
  windowRef.matchMedia = () => motion;
  const controller = initDragReveal({ documentRef, windowRef, random });
  return {
    ...first, motion, windowRef, documentRef, controller, observers, candidates, template, roots, milestoneRoots, shuffleButton, syncIcon,
    get cpu() { return first.cpu; },
  };
}

function assertParked(f) {
  assert.deepEqual(f.position(), [0, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), false);
  assert.equal(f.root.hasAttribute("data-dragging"), false);
  assert.equal(f.captures.size, 0);
  assert.equal(f.root.style.height, undefined);
  for (const property of ["left", "top", "width", "height"]) assert.equal(f.link.style[property], undefined);
}

function randomSequence(...values) {
  return () => {
    assert.ok(values.length, "unexpected additional random draw");
    return values.shift();
  };
}

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
  dragTest(`the selected ${expected} keeps card sizing and remains fixed across drags and reinitialisation`, () => {
    const f = fixture({ card: true, candidateCount: 3, random: randomSequence(0, roll) });
    const selected = f.cpu;
    for (let attempt = 0; attempt < 2; attempt++) {
      f.drag();
      assert.equal(f.cpu, selected);
      assert.equal(f.cpu.name, expected);
      assert.equal(f.cpu.style.width, "36.8px");
      assert.equal(f.cpu.style.height, "43.2px");
      f.pointer("pointerup");
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
  assert.deepEqual(f.position(), [0, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), false);
  f.pointer("pointerup");
  assert.equal(f.link.emit("click", { detail: 1 }).defaultPrevented, false);
  assert.equal(f.animations.length, 0);
  f.pointer("pointerdown");
  f.pointer("pointermove", 306, 30);
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
    assert.deepEqual(f.position(), [390 - f.bounds.right, 844 - f.bounds.bottom]);
    f.pointer("pointermove", -10000, -10000);
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
  assert.deepEqual(f.position(), [-40, 60]);
  assert.equal(spring.cancelled, true);
  assert.equal(spring.onfinish, null);
  f.pointer("pointermove", 200, 90);
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
  assert.deepEqual(f.position(), [10, 10]);
  f.pointer("pointermove", 10000, -10000);
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

dragTest("re-grabbing a returning card retains its visible offset and releases its old observer", () => {
  const f = fixture({ card: true });
  f.drag();
  f.pointer("pointerup");
  f.animations[0].visual = [-40, 60];
  f.pointer("pointerdown", 220, 80);
  assert.deepEqual(f.position(), [-40, 60]);
  assert.equal(f.observers[0].disconnected, true);
  f.pointer("pointermove", 200, 90);
  assert.deepEqual(f.position(), [-60, 70]);
  f.controller.destroy();
  assertParked(f);
  assert.equal(f.observers[1].disconnected, true);
});

function randomPrefix(...values) {
  return () => values.length ? values.shift() : 0.5;
}

function gameFixture(options = {}) {
  return fixture({ candidateCount: 3, shuffle: true, random: randomPrefix(0, 0.5), ...options });
}

function creatureIndex(f) {
  const indices = f.candidates.flatMap((candidate, index) => candidate.children[0].name !== "cpu" ? [index] : []);
  assert.equal(indices.length, 1, "exactly one underlay contains a creature");
  return indices[0];
}

for (const options of [{}, { reduced: true }, { animate: false }]) {
  dragTest(`Sync highlights its first appearance for 500ms: ${JSON.stringify(options)}`, context => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    const f = gameFixture(options);
    context.mock.timers.tick(1000);
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
    f.drag();
    assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), true);
    context.mock.timers.tick(250);
    f.observers[0].callback();
    context.mock.timers.tick(249);
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), true, "visibility updates do not restart the timer");
    const selected = creatureIndex(f);
    f.shuffleButton.emit("click", { detail: 0 });
    assert.notEqual(creatureIndex(f), selected, "shuffling remains available during the highlight");
    assert.equal(f.syncIcon.style.transform, "rotate(180deg)");
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), true);
    context.mock.timers.tick(1);
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
    f.observers[0].callback();
    assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false, "the highlight does not replay");
    f.controller.destroy();
  });
}

dragTest("hiding Sync cancels its highlight without replaying it when available again", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = gameFixture();
  f.drag();
  context.mock.timers.tick(250);
  const clearTimer = context.mock.method(f.windowRef, "clearTimeout");
  f.roots.slice(1).forEach(entry => { entry.root.hidden = true; });
  f.observers[0].callback();
  assert.equal(f.shuffleButton.classList.contains("is-visible"), false);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  assert.equal(clearTimer.mock.callCount(), 1, "the pending timer is cancelled");
  f.roots[1].root.hidden = false;
  f.observers[0].callback();
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  context.mock.timers.tick(500);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  f.controller.destroy();
});

dragTest("destroying during the highlight cancels it and reinitialisation does not replay it", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const f = gameFixture();
  f.drag();
  context.mock.timers.tick(100);
  const clearTimer = context.mock.method(f.windowRef, "clearTimeout");
  f.controller.destroy();
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  assert.equal(clearTimer.mock.callCount(), 1, "destroy clears the pending timer");
  const next = initDragReveal({ ...f, random: () => assert.fail("reinitialisation must not reroll") });
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  context.mock.timers.tick(500);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  next.destroy();
});

for (const [dx, dy] of [[34, 0], [-34, 0], [0, 34], [0, -34]]) {
  dragTest(`Sync appears only when the creature is fully uncovered at offset ${dx}, ${dy}`, () => {
    const f = gameFixture({ width: 44, top: 200 });
    assert.equal(f.shuffleButton.classList.contains("is-visible"), false);
    f.roots[1].drag();
    f.roots[1].pointer("pointerup");
    f.roots[1].complete();
    assert.equal(f.shuffleButton.classList.contains("is-visible"), false, "uncovering a CPU does not reveal Sync");
    f.pointer("pointerdown", 270, 220);
    f.pointer("pointermove", 270 + dx * 0.999, 220 + dy * 0.999);
    assert.equal(f.shuffleButton.classList.contains("is-visible"), false, "partial exposure is insufficient");
    f.pointer("pointermove", 270 + dx, 220 + dy);
    assert.equal(f.shuffleButton.classList.contains("is-visible"), true, "touching rectangle edges count as uncovered");
    f.pointer("pointerup");
    f.complete();
    assert.equal(f.shuffleButton.classList.contains("is-visible"), true, "Sync persists after the cover returns");
    f.controller.destroy();
  });
}

for (const pointerType of ["mouse", "pen", "touch"]) {
  dragTest(`${pointerType} discovery uses the resized card creature and leaves its drag running`, () => {
    const f = gameFixture({ card: true, width: 360, height: 240 });
    f.pointer("pointerdown", 300, 100, { pointerType });
    f.pointer("pointermove", 300, 241.5, { pointerType });
    assert.equal(f.shuffleButton.classList.contains("is-visible"), false);
    f.pointer("pointermove", 300, 242, { pointerType });
    assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
    assert.equal(f.root.hasAttribute("data-dragging"), true);
    assert.equal(f.captures.size, 1);
    assert.notEqual(f.observers.at(-1).disconnected, true, "revealing Sync does not reset the card observer");
    assert.equal(f.shuffleButton.hasAttribute("hidden"), false);
    f.controller.destroy();
  });
}

dragTest("each alternative target has an equal interval and each shuffle rerolls the creature", () => {
  const count = 4;
  for (let previous = 0; previous < count; previous++) {
    const alternatives = Array.from({ length: count }, (_, index) => index).filter(index => index !== previous);
    for (let target = 0; target < alternatives.length; target++) {
      for (const fraction of [0, 0.5, 0.999999]) {
        for (const [roll, expected] of [[0, "squirrel"], [0.099999, "squirrel"], [0.1, "bug"], [0.999999, "bug"]]) {
          const f = gameFixture({ candidateCount: count, reduced: true,
            random: randomSequence((previous + 0.5) / count, 0.5, (target + fraction) / alternatives.length, roll) });
          f.roots[previous].drag();
          assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
          f.shuffleButton.emit("click");
          assert.equal(creatureIndex(f), alternatives[target]);
          assert.equal(f.candidates[alternatives[target]].children[0].name, expected);
          assert.equal(f.candidates[previous].children[0].name, "cpu");
          f.roots.forEach(assertParked);
          f.controller.destroy();
        }
      }
    }
  }
});

dragTest("loaded milestones participate in the initial pool while hidden cards and sections do not", () => {
  const f = gameFixture({ candidateCount: 2, milestones: [{}, { hidden: true }, { ancestorHidden: true }],
    random: randomSequence(0.999999, 0.05) });
  assert.equal(creatureIndex(f), 2);
  assert.equal(f.milestoneRoots[0].cpu.name, "squirrel");
  f.milestoneRoots[0].drag();
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  f.controller.destroy();
});

dragTest("milestones loaded after initialisation join both the shuffle and independent shake pool", () => {
  const f = gameFixture({ candidateCount: 2, milestones: [{ hidden: true }, { hidden: true }, { ancestorHidden: true }],
    random: randomPrefix(0, 0.5, 0.999999, 0.05) });
  f.drag();
  f.milestoneRoots[0].root.hidden = false;
  f.observers[0].callback();
  f.shuffleButton.emit("click");
  assert.equal(creatureIndex(f), 2);
  assert.equal(f.milestoneRoots[0].cpu.name, "squirrel");
  assert.equal(f.milestoneRoots[0].animations.length, 1);
  assert.equal(f.milestoneRoots[1].animations.length, 0);
  assert.equal(f.milestoneRoots[2].animations.length, 0);
  f.roots.forEach(assertParked);
  f.controller.destroy();
});

dragTest("hiding a selected milestone excludes it on the next shuffle and restores its original CPU", () => {
  const f = gameFixture({ candidateCount: 2, milestones: [{}, {}], reduced: true,
    random: randomSequence(0.625, 0.05, 0.999999, 0.5) });
  f.milestoneRoots[0].drag();
  f.milestoneRoots[0].root.hidden = true;
  f.observers[0].callback();
  f.shuffleButton.emit("click");
  assert.equal(creatureIndex(f), 3);
  assert.equal(f.milestoneRoots[0].cpu.name, "cpu");
  assert.equal(f.milestoneRoots[0].cpu.sourceSize, 32);
  f.controller.destroy();
});

dragTest("Sync becomes available when a loaded milestone supplies the first alternative location", () => {
  const f = gameFixture({ candidateCount: 1, milestones: [{ hidden: true }], reduced: true,
    random: randomSequence(0, 0.5, 0, 0.05) });
  f.drag();
  assert.equal(f.shuffleButton.classList.contains("is-visible"), false);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), false);
  f.shuffleButton.emit("click");
  assert.equal(creatureIndex(f), 0);
  f.milestoneRoots[0].root.hidden = false;
  f.observers[0].callback();
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  assert.equal(f.shuffleButton.classList.contains("is-highlighted"), true);
  f.shuffleButton.emit("click");
  assert.equal(creatureIndex(f), 1);
  f.controller.destroy();
});

dragTest("shakes stay horizontal and independent and return every eligible surface to rest", () => {
  const f = gameFixture({ card: true, milestones: [{}, { hidden: true }] });
  f.drag();
  f.shuffleButton.emit("click");
  assert.equal(f.cpu.sourceSize, 32, "restoring a card CPU preserves its source size");
  const eligible = f.roots.filter(entry => !entry.root.hidden);
  const keyframes = eligible.map(entry => entry.animations.at(-1).keyframes);
  assert.notDeepEqual(keyframes[0], keyframes[1], "even identical random draws produce separate movements");
  eligible.forEach(entry => {
    assertParked(entry);
    const animation = entry.animations.at(-1);
    assert.ok(animation.options.duration >= 320 && animation.options.duration <= 440);
    assert.deepEqual(animation.keyframes[0], animation.keyframes.at(-1));
    assert.deepEqual(coordinates(animation.keyframes[0].transform), [0, 0]);
    animation.keyframes.forEach(frame => {
      const [x, y] = coordinates(frame.transform);
      assert.ok(Math.abs(x) <= 3);
      assert.equal(y, 0, "shakes never move vertically");
      assert.doesNotMatch(frame.transform, /rotate\(/, "shakes never rock or rotate");
    });
    animation.keyframes.slice(1, -1).forEach(frame => {
      const [x] = coordinates(frame.transform);
      assert.ok(Math.abs(x) >= 0.75, "intermediate frames retain horizontal movement");
    });
    entry.complete();
    assert.equal(animation.cancelled, true);
    assertParked(entry);
  });
  assert.equal(f.milestoneRoots[1].animations.length, 0);
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  f.controller.destroy();
});

dragTest("rapid keyboard activations each shuffle, add a half-turn and replace running shakes", () => {
  const f = gameFixture();
  f.drag();
  f.shuffleButton.emit("click", { detail: 0 });
  const previous = creatureIndex(f);
  const firstShakes = f.roots.map(entry => entry.animations.at(-1));
  assert.equal(f.syncIcon.style.transform, "rotate(180deg)");
  f.shuffleButton.emit("click", { detail: 0 });
  assert.notEqual(creatureIndex(f), previous);
  assert.equal(f.syncIcon.style.transform, "rotate(360deg)");
  firstShakes.forEach(animation => assert.equal(animation.cancelled, true));
  f.roots.forEach(entry => assert.equal(entry.animations.length, 2));
  f.controller.destroy();
});

dragTest("shuffling during a spring return cancels it and parks before replacing icons", () => {
  const f = gameFixture({ card: true });
  f.drag();
  f.pointer("pointerup");
  const spring = f.animations[0];
  spring.visual = [-40, 60];
  f.shuffleButton.emit("click");
  assert.equal(spring.cancelled, true);
  assert.equal(spring.onfinish, null);
  assert.equal(f.observers[1].disconnected, true);
  f.roots.forEach(assertParked);
  assert.equal(f.animations.length, 2);
  f.controller.destroy();
});

dragTest("starting a drag cancels only that surface's shake before measuring its position", () => {
  const f = gameFixture();
  f.drag();
  f.shuffleButton.emit("click");
  const target = f.roots[1];
  const shake = target.animations[0];
  shake.visual = [1.25, 0];
  target.pointer("pointerdown");
  assert.equal(shake.cancelled, true);
  assert.notEqual(f.animations[0].cancelled, true);
  assert.deepEqual(target.position(), [0, 0]);
  target.pointer("pointerup");
  assert.equal(target.link.emit("click", { detail: 1 }).defaultPrevented, false);
  f.controller.destroy();
});

for (const options of [{ reduced: true }, { animate: false }]) {
  dragTest(`shuffle still works without motion: ${JSON.stringify(options)}`, () => {
    const f = gameFixture({ ...options, random: randomSequence(0, 0.5, 0, 0.05) });
    f.drag();
    f.shuffleButton.emit("click");
    assert.equal(creatureIndex(f), 1);
    assert.equal(f.syncIcon.style.transform, "rotate(180deg)");
    f.roots.forEach(entry => { assertParked(entry); assert.equal(entry.animations.length, 0); });
    f.controller.destroy();
  });
}

for (const type of ["blur", "resize", "scroll", "visibilitychange", "reduced motion", "destroy"]) {
  dragTest(`${type} clears running shuffle effects`, () => {
    const f = gameFixture();
    f.drag();
    f.shuffleButton.emit("click");
    let finished = 0;
    f.syncIcon.getAnimations = () => [{ finish() { finished++; } }];
    if (type === "visibilitychange") {
      f.documentRef.hidden = true;
      f.documentRef.emit(type);
    } else if (type === "reduced motion") {
      f.motion.matches = true;
      f.motion.emit("change");
    } else if (type === "destroy") f.controller.destroy();
    else f.windowRef.emit(type);
    assert.equal(finished, 1);
    f.roots.forEach(entry => assert.equal(entry.animations[0].cancelled, true));
    assert.equal(f.syncIcon.style.transform, "rotate(180deg)");
    if (type !== "destroy") f.controller.destroy();
    for (const target of [f.shuffleButton, f.windowRef, f.documentRef, f.motion, ...f.roots.map(entry => entry.link)]) {
      assert.ok([...target.listeners.values()].every(callbacks => callbacks.size === 0));
    }
    assert.equal(f.observers[0].disconnected, true);
  });
}

dragTest("reinitialisation preserves a shuffled creature, discovery and accumulated rotation", () => {
  const f = gameFixture();
  f.drag();
  f.shuffleButton.emit("click");
  const selected = creatureIndex(f);
  const icon = f.candidates[selected].children[0];
  f.controller.destroy();
  const next = initDragReveal({ ...f, random: () => assert.fail("reinitialisation must not reroll") });
  assert.equal(f.candidates[selected].children[0], icon);
  assert.equal(f.shuffleButton.classList.contains("is-visible"), true);
  assert.equal(f.syncIcon.style.transform, "rotate(180deg)");
  next.destroy();
});

dragTest("an undiscovered game, one candidate and unsupported pointers keep Sync unavailable", () => {
  for (const options of [{}, { candidateCount: 1 }, { templates: false }, { pointerEvents: false }]) {
    const f = gameFixture(options);
    assert.equal(f.shuffleButton.classList.contains("is-visible"), false);
    f.shuffleButton.emit("click");
    assert.equal(f.syncIcon.style.transform === "rotate(180deg)", false);
    f.controller?.destroy();
  }
});
