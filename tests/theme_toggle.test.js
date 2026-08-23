"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "assets", "js", "theme_toggle.js");
const bootstrapPath = path.join(
  __dirname,
  "..",
  "_includes",
  "theme_bootstrap.html"
);
const {
  DARK_MODE_QUERY,
  DARK_THEME,
  LIGHT_THEME,
  THEME_STORAGE_KEY,
  initThemeToggle,
  readStoredTheme,
} = require(scriptPath);

class FakeStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.selectors = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get hidden() {
    return this.attributes.has("hidden");
  }

  set hidden(value) {
    if (value) {
      this.setAttribute("hidden", "");
    } else {
      this.removeAttribute("hidden");
    }
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type, event = {}) {
    this.listeners.get(type)?.(event);
  }
}

class FakeMediaQuery {
  constructor(matches = false) {
    this.matches = matches;
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === "change") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "change") this.listeners.delete(listener);
  }

  emit(matches) {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

class FakeWindow {
  constructor(storage, mediaQuery) {
    this.localStorage = storage;
    this.mediaQuery = mediaQuery;
    this.listeners = new Map();
    this.queries = [];
  }

  matchMedia(query) {
    this.queries.push(query);
    return this.mediaQuery;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  emitStorage(newValue) {
    this.listeners.get("storage")?.({ key: THEME_STORAGE_KEY, newValue });
  }
}

function makeFixture({ storedTheme = null, systemDark = false } = {}) {
  const storage = new FakeStorage(
    storedTheme === null ? [] : [[THEME_STORAGE_KEY, storedTheme]]
  );
  const mediaQuery = new FakeMediaQuery(systemDark);
  const windowRef = new FakeWindow(storage, mediaQuery);
  const root = new FakeElement();
  const button = new FakeElement();
  const lightIcon = new FakeElement();
  const darkIcon = new FakeElement();
  button.hidden = true;
  lightIcon.hidden = true;
  button.selectors.set('[data-theme-icon="light"]', lightIcon);
  button.selectors.set('[data-theme-icon="dark"]', darkIcon);

  const documentRef = {
    documentElement: root,
    querySelector(selector) {
      return selector === "[data-theme-toggle]" ? button : null;
    },
  };

  return {
    button,
    darkIcon,
    documentRef,
    lightIcon,
    mediaQuery,
    root,
    storage,
    windowRef,
  };
}

function runBootstrap({ storedTheme = null, systemDark = false } = {}) {
  const source = fs.readFileSync(bootstrapPath, "utf8");
  const script = source.match(/<script data-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, "theme bootstrap script is present");

  const storage = new FakeStorage(
    storedTheme === null ? [] : [[THEME_STORAGE_KEY, storedTheme]]
  );
  const root = new FakeElement();
  vm.runInNewContext(script, {
    document: { documentElement: root },
    window: {
      localStorage: storage,
      matchMedia(query) {
        assert.equal(query, DARK_MODE_QUERY);
        return { matches: systemDark };
      },
    },
  });
  return { root, storage };
}

test("the bootstrap applies a saved theme before consulting the system", () => {
  const { root } = runBootstrap({ storedTheme: LIGHT_THEME, systemDark: true });
  assert.equal(root.dataset.theme, LIGHT_THEME);
});

test("the bootstrap removes malformed storage and follows the system", () => {
  const { root, storage } = runBootstrap({ storedTheme: "sepia", systemDark: true });
  assert.equal(root.dataset.theme, DARK_THEME);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), null);
});

test("the bootstrap falls back to light when browser APIs are unavailable", () => {
  const source = fs.readFileSync(bootstrapPath, "utf8");
  const script = source.match(/<script data-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
  const root = new FakeElement();
  const windowRef = {
    get localStorage() {
      throw new Error("storage unavailable");
    },
    matchMedia() {
      throw new Error("media queries unavailable");
    },
  };

  vm.runInNewContext(script, {
    document: { documentElement: root },
    window: windowRef,
  });

  assert.equal(root.dataset.theme, LIGHT_THEME);
});

test("reads valid storage and removes invalid values", () => {
  const storage = new FakeStorage([[THEME_STORAGE_KEY, DARK_THEME]]);
  assert.equal(readStoredTheme(storage), DARK_THEME);

  storage.setItem(THEME_STORAGE_KEY, "invalid");
  assert.equal(readStoredTheme(storage), null);
  assert.equal(storage.getItem(THEME_STORAGE_KEY), null);
});

test("initializes from the system and renders the available action", () => {
  const fixture = makeFixture({ systemDark: true });
  const controller = initThemeToggle({
    documentRef: fixture.documentRef,
    windowRef: fixture.windowRef,
  });

  assert.equal(controller.getTheme(), DARK_THEME);
  assert.equal(fixture.root.dataset.theme, DARK_THEME);
  assert.equal(fixture.button.hidden, false);
  assert.equal(fixture.lightIcon.hidden, false);
  assert.equal(fixture.darkIcon.hidden, true);
  assert.equal(fixture.button.getAttribute("aria-label"), "Switch to light mode");
  assert.equal(fixture.button.getAttribute("title"), "Switch to light mode");
  assert.deepEqual(fixture.windowRef.queries, [DARK_MODE_QUERY]);
});

test("a click toggles and persists an explicit preference", () => {
  const fixture = makeFixture({ storedTheme: LIGHT_THEME, systemDark: true });
  const controller = initThemeToggle(fixture);

  fixture.button.dispatch("click");

  assert.equal(controller.getTheme(), DARK_THEME);
  assert.equal(fixture.storage.getItem(THEME_STORAGE_KEY), DARK_THEME);
  assert.equal(fixture.lightIcon.hidden, false);
  assert.equal(fixture.darkIcon.hidden, true);
});

test("system changes apply only until the visitor chooses a theme", () => {
  const fixture = makeFixture();
  const controller = initThemeToggle(fixture);

  fixture.mediaQuery.emit(true);
  assert.equal(controller.getTheme(), DARK_THEME);

  fixture.button.dispatch("click");
  assert.equal(controller.getTheme(), LIGHT_THEME);

  fixture.mediaQuery.emit(true);
  assert.equal(controller.getTheme(), LIGHT_THEME);
});

test("storage events synchronize preferences and removal restores the system", () => {
  const fixture = makeFixture({ systemDark: false });
  const controller = initThemeToggle(fixture);

  fixture.windowRef.emitStorage(DARK_THEME);
  assert.equal(controller.getTheme(), DARK_THEME);

  fixture.windowRef.emitStorage(null);
  assert.equal(controller.getTheme(), LIGHT_THEME);
});

test("unavailable storage does not prevent in-page toggling", () => {
  const fixture = makeFixture();
  const unavailableStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
    removeItem() {
      throw new Error("storage unavailable");
    },
  };
  const controller = initThemeToggle({ ...fixture, storage: unavailableStorage });

  fixture.button.dispatch("click");
  assert.equal(controller.getTheme(), DARK_THEME);
});

test("destroy removes theme listeners", () => {
  const fixture = makeFixture();
  const controller = initThemeToggle(fixture);
  controller.destroy();

  assert.equal(fixture.button.listeners.has("click"), false);
  assert.equal(fixture.mediaQuery.listeners.size, 0);
  assert.equal(fixture.windowRef.listeners.has("storage"), false);
});
