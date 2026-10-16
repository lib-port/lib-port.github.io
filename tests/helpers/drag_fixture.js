"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { clientAssetPath } = require("../client_assets");
const assetPath = name => clientAssetPath(path.join(__dirname, "..", "..", "assets", "js", name));
const loadAsset = name => require(assetPath(name));
const homepage = process.env.CLIENT_ASSET_DIRECTORY
  ? fs.readFileSync(path.resolve(process.env.CLIENT_ASSET_DIRECTORY, "..", "..", "index.html"), "utf8")
  : null;
const gameEnabled = homepage === null || /<script\b[^>]*\bsrc="[^"]*\/assets\/js\/drag_reveal\.js"/.test(homepage);
const ballEnabled = homepage === null || /<script\b[^>]*\bsrc="[^"]*\/assets\/js\/light_dark_ball\.js"/.test(homepage);

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
  dispatchEvent(event) { this.emit(event.type, event); return true; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  emit(type, data = {}) {
    const event = {
      type,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      defaultPrevented: false, ...data,
    };
    this.listeners.get(type)?.forEach(callback => callback(event));
    return event;
  }
}

function coordinates(value) {
  return value ? [...value.matchAll(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)px/g)].map(match => Number(match[1])) : [0, 0];
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

function fixture({ reduced = false, width = 92, animate = true, frameAnimation = true, pointerEvents = true, card = false, left = 250, top = 8, height = 44, candidateCount = 0, templates = true, trophy = false, random = Math.random, milestones = [], theme = false, themeIndex, visualViewport, game = gameEnabled, ball = ballEnabled, extensions = [] } = {}) {
  const style = () => ({
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { delete this[name]; },
  });
  const windowRef = new Events();
  const navigations = [];
  windowRef.location = { assign: url => navigations.push(url) };
  windowRef.CustomEvent = class {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  };
  let time = 0;
  windowRef.performance = { now: () => time };
  let nextFrame = 0;
  const frames = new Map();
  if (frameAnimation) {
    windowRef.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
    windowRef.cancelAnimationFrame = id => frames.delete(id);
  }
  if (visualViewport) windowRef.visualViewport = Object.assign(new Events(), {
    offsetLeft: 0, offsetTop: 0, width: 390, height: 844, ...visualViewport,
  });
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
      pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: x, clientY: y, timeStamp: time, target: card ? handle : link, ...extra,
    });
    return {
      root, link, bounds, captures, animations, pointer, handle, icon, underlay,
      get cpu() { return underlay.children[0]; },
      position: () => coordinates(link.style.transform),
      complete: () => animations.at(-1).onfinish(),
      drag() { pointer("pointerdown"); pointer("pointermove", 200, 180); },
    };
  }
  const first = makeRoot({ left, top, width, height, card, eligible: candidateCount > 0 });
  const roots = [first, ...Array.from({ length: Math.max(0, candidateCount - 1) }, (_, index) =>
    makeRoot({ left: 20, top: 60 + index * 60, width: 44, card: index > 1 }))];
  const milestoneRoots = milestones.map(options => makeRoot({ card: true, width: 240, height: 120, ...options }));
  roots.push(...milestoneRoots);
  if (theme || themeIndex !== undefined) roots[themeIndex ?? 0].link.setAttribute("data-theme-toggle", "");
  const candidates = [...roots.slice(0, candidateCount), ...milestoneRoots].map(entry => entry.underlay);
  const documentRef = new Events();
  documentRef.hidden = false;
  documentRef.documentElement = { clientWidth: 390, clientHeight: 844 };
  const template = {
    content: { children: [makeIcon("bug"), makeIcon("squirrel")] },
    removed: false,
    remove() { this.removed = true; },
  };
  const trophyElement = new Events();
  trophyElement.setAttribute("aria-hidden", "true");
  const trophyIcon = new Events();
  const trophyProgress = new Events();
  trophyProgress.style = style();
  trophyProgress.setAttribute("aria-valuemin", "0");
  trophyProgress.setAttribute("aria-valuemax", "5");
  trophyProgress.setAttribute("aria-valuenow", "0");
  trophyElement.querySelector = selector => ({
    ".octicon": trophyIcon,
    "[data-drag-trophy-progress]": trophyProgress,
  })[selector] || null;
  const trophyAnimations = [];
  if (animate) for (const target of [trophyElement, trophyIcon]) {
    target.animate = (keyframes, options) => {
      const animation = { target, keyframes, options, cancel() { this.cancelled = true; } };
      trophyAnimations.push(animation);
      return animation;
    };
  }
  documentRef.querySelector = selector => {
    if (selector === "[data-drag-trophy]") return trophy ? trophyElement : null;
    return selector === "[data-drag-icons]" && templates && !template.removed ? template : null;
  };
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
  const features = [];
  if (game) features.push(loadAsset("drag_reveal.js").createDragReveal({ random }));
  if (ball) features.push(loadAsset("light_dark_ball.js").createLightDarkBall());
  features.push(...extensions);
  const controller = features.length
    ? loadAsset("drag_surface.js").initDragSurfaces({ documentRef, windowRef, features })
    : null;
  return {
    ...first, motion, windowRef, documentRef, controller, observers, candidates, template, roots, milestoneRoots, frames,
    trophy: trophyElement, trophyIcon, trophyProgress, trophyAnimations, navigations,
    wait(elapsed) { time += elapsed; },
    tick(elapsed) {
      time += elapsed;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(time));
    },
    get cpu() { return first.cpu; },
  };
}

function assertParked(f) {
  assert.deepEqual(f.position(), [0, 0]);
  assert.equal(f.root.hasAttribute("data-drag-active"), false);
  assert.equal(f.root.hasAttribute("data-dragging"), false);
  assert.equal(f.root.hasAttribute("data-ball-vortex"), false);
  assert.equal(f.root.style["--ball-vortex-angle"], undefined);
  assert.equal(f.captures.size, 0);
  assert.equal(f.root.style.height, undefined);
  for (const property of ["left", "top", "width", "height"]) assert.equal(f.link.style[property], undefined);
}

function finishShakes(f) {
  for (const item of f.roots) {
    const animation = item.animations.at(-1);
    if (animation && !animation.cancelled && animation.options.fill !== "forwards") animation.onfinish?.();
  }
}

function randomSequence(...values) {
  return () => {
    assert.ok(values.length, "unexpected additional random draw");
    return values.shift();
  };
}

function themeFixture(options = {}) {
  return fixture({ theme: true, width: 44, left: 330, top: 784, ...options });
}

function flick(f, { dx = -80, dy = -80, duration = 80, pause = 0, pointerType = "mouse", release = {}, firstFrameDelay = 0 } = {}) {
  const x = f.bounds.left + f.bounds.width / 2;
  const y = f.bounds.top + f.bounds.height / 2;
  f.pointer("pointerdown", x, y, { pointerType });
  f.wait(duration / 2);
  f.pointer("pointermove", x + dx / 2, y + dy / 2, { pointerType });
  f.wait(duration / 2);
  f.pointer("pointermove", x + dx, y + dy, { pointerType });
  f.wait(pause);
  f.pointer("pointerup", x + dx, y + dy, { pointerType, ...release });
  f.tick(firstFrameDelay);
}

function advance(f, duration, frame = 1000 / 60) {
  for (let remaining = duration; remaining > 1e-7;) {
    const elapsed = Math.min(frame, remaining);
    f.tick(elapsed);
    remaining -= elapsed;
  }
}

function close(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
}

module.exports = {
  Events, fixture, assertParked, finishShakes, randomSequence, themeFixture, flick, advance, close,
  coordinates, gameEnabled, ballEnabled, homepage, assetPath,
};
