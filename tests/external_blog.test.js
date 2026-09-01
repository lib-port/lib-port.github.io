"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "assets", "js", "external_blog.js");
const {
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  buildProxyUrl,
  enhanceContainer,
  formatPublishedAt,
  getCacheKey,
  normalizeFeedItems,
  readCache,
  truncateText,
  writeCache,
} = require(scriptPath);

const FEED_URL = "https://example.com/feed.xml";
const ARCHIVE_URL = "https://example.com/archive";

class FakeStorage {
  constructor() {
    this.values = new Map();
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
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.href = "";
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children.flatMap((child) =>
      child.tagName === "#fragment" ? child.children : [child]
    );
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }

  createDocumentFragment() {
    return new FakeElement("#fragment");
  }
}

function makeContainer() {
  const container = new FakeElement("div");
  container.dataset = {
    feedUrl: FEED_URL,
    archiveUrl: ARCHIVE_URL,
    postLimit: "2",
  };
  container.children = [new FakeElement("fallback")];
  return container;
}

function makePosts() {
  return [
    {
      publishedAt: "2026-08-02T23:01:29.000Z",
      title: "Newest post",
      excerpt: "Newest summary",
      url: "https://example.com/p/newest",
    },
    {
      publishedAt: "2026-07-26T23:01:07.000Z",
      title: "Older post",
      excerpt: "Older & useful",
      url: "https://example.com/p/older",
    },
  ];
}

function stripTestHtml(value) {
  return String(value).replace(/<[^>]+>/g, "").replaceAll("&amp;", "&");
}

test("builds an encoded RSS2JSON request URL", () => {
  assert.equal(
    buildProxyUrl(FEED_URL),
    "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fexample.com%2Ffeed.xml"
  );
});

test("normalises, sorts, limits, and sanitises feed items", () => {
  const payload = {
    status: "ok",
    items: [
      {
        title: " Older post ",
        link: "https://example.com/p/older",
        pubDate: "2026-07-26 23:01:07",
        description: "<p>Older &amp; useful</p>",
      },
      {
        title: "Newest post",
        link: "https://example.com/p/newest",
        pubDate: "2026-08-02 23:01:29",
        description: "<strong>Newest summary</strong>",
      },
      {
        title: "Unsafe link",
        link: "javascript:alert(1)",
        pubDate: "2026-08-03 00:00:00",
      },
      {
        title: "Invalid date",
        link: "https://example.com/p/invalid",
        pubDate: "not-a-date",
      },
    ],
  };

  assert.deepEqual(normalizeFeedItems(payload, 2, stripTestHtml), makePosts());
});

test("rejects unsuccessful or malformed proxy payloads", () => {
  assert.deepEqual(normalizeFeedItems({ status: "error", items: [] }), []);
  assert.deepEqual(normalizeFeedItems({ status: "ok", items: null }), []);
});

test("formats RSS2JSON dates in UTC", () => {
  assert.equal(formatPublishedAt("2026-08-02 23:01:29"), "2 Aug 2026");
  assert.equal(formatPublishedAt("not-a-date"), "");
});

test("truncates excerpts to 280 characters at a word boundary", () => {
  const excerpt = `${"word ".repeat(70)}ending`;
  const truncated = truncateText(excerpt, 280);

  assert.ok(truncated.length <= 280);
  assert.ok(truncated.endsWith("..."));
  assert.equal(truncateText(" short   summary ", 280), "short summary");
});

test("persists valid posts for exactly seven days", () => {
  const storage = new FakeStorage();
  const now = Date.parse("2026-08-04T00:00:00Z");
  const posts = makePosts();

  assert.equal(CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  writeCache(FEED_URL, posts, storage, now);
  assert.deepEqual(readCache(FEED_URL, storage, now + CACHE_TTL_MS), posts);
  assert.equal(readCache(FEED_URL, storage, now + CACHE_TTL_MS + 1), null);
  assert.equal(storage.getItem(getCacheKey(FEED_URL)), null);
});

test("discards malformed cache entries", () => {
  const storage = new FakeStorage();
  const cacheKey = getCacheKey(FEED_URL);
  storage.setItem(cacheKey, "not json");

  assert.equal(readCache(FEED_URL, storage), null);
  assert.equal(storage.getItem(cacheKey), null);
});

test("discards a cached post list when any post is invalid", () => {
  const storage = new FakeStorage();
  const cacheKey = getCacheKey(FEED_URL);
  const now = Date.parse("2026-08-04T00:00:00Z");
  const posts = [...makePosts(), { ...makePosts()[0], url: "javascript:alert(1)" }];
  storage.setItem(cacheKey, JSON.stringify({ fetchedAt: now, posts }));

  assert.equal(readCache(FEED_URL, storage, now), null);
  assert.equal(storage.getItem(cacheKey), null);
});

test("discards cache entries dated in the future", () => {
  const storage = new FakeStorage();
  const cacheKey = getCacheKey(FEED_URL);
  const now = Date.parse("2026-08-04T00:00:00Z");
  writeCache(FEED_URL, makePosts(), storage, now + 1);

  assert.equal(readCache(FEED_URL, storage, now), null);
  assert.equal(storage.getItem(cacheKey), null);
});

test("renders a fresh cache without requesting the proxy", async () => {
  const storage = new FakeStorage();
  const container = makeContainer();
  const now = Date.parse("2026-08-04T00:00:00Z");
  let fetchCalls = 0;
  writeCache(FEED_URL, makePosts(), storage, now);

  const rendered = await enhanceContainer(container, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    },
    documentRef: new FakeDocument(),
    storage,
    now,
  });

  assert.equal(rendered, true);
  assert.equal(fetchCalls, 0);
  assert.equal(container.children[0].tagName, "ul");
  assert.equal(container.children[0].children[0].children[1].children[0].textContent, "Newest post");
  assert.equal(container.children[1].children[0].textContent, "View all posts");
});

test("loads posts, replaces the fallback, and writes the cache", async () => {
  const storage = new FakeStorage();
  const container = makeContainer();
  const now = Date.parse("2026-08-04T00:00:00Z");
  let requestedUrl = "";

  const rendered = await enhanceContainer(container, {
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return {
            status: "ok",
            items: [
              {
                title: "Newest post",
                link: "https://example.com/p/newest",
                pubDate: "2026-08-02 23:01:29",
                description: "Newest summary",
              },
            ],
          };
        },
      };
    },
    documentRef: new FakeDocument(),
    storage,
    now,
    htmlToText: stripTestHtml,
  });

  assert.equal(rendered, true);
  assert.equal(requestedUrl, buildProxyUrl(FEED_URL));
  assert.equal(container.children[0].children.length, 1);
  assert.ok(storage.getItem(getCacheKey(FEED_URL)));
  assert.equal(container.attributes.has("aria-busy"), false);
});

test("leaves the fallback intact when loading fails", async () => {
  const container = makeContainer();
  const fallback = container.children[0];
  const errors = [];

  const rendered = await enhanceContainer(container, {
    fetchImpl: async () => {
      throw new Error("offline");
    },
    documentRef: new FakeDocument(),
    storage: new FakeStorage(),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.equal(rendered, false);
  assert.equal(container.children[0], fallback);
  assert.equal(container.attributes.has("aria-busy"), false);
  assert.equal(errors.length, 1);
});

test("aborts a stalled external blog request using the 15-second policy", async () => {
  const container = makeContainer();
  const errors = [];
  let requestSignal;

  const rendered = await enhanceContainer(container, {
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
    documentRef: new FakeDocument(),
    storage: new FakeStorage(),
    logger: { error: (...args) => errors.push(args) },
    requestTimeoutMs: 10,
  });

  assert.equal(REQUEST_TIMEOUT_MS, 15_000);
  assert.equal(rendered, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1].name, "TimeoutError");
  assert.equal(container.attributes.has("aria-busy"), false);
});

test("handles a missing Fetch API without rejecting outside the loader", async () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  const sandbox = {
    Date,
    Intl,
    URL,
    URLSearchParams,
    clearTimeout,
    module: { exports: {} },
    setTimeout,
  };
  vm.runInNewContext(source, sandbox);
  const errors = [];

  const rendered = await sandbox.module.exports.enhanceContainer(makeContainer(), {
    documentRef: new FakeDocument(),
    storage: new FakeStorage(),
    logger: { error: (...args) => errors.push(args) },
  });

  assert.equal(rendered, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0][1].message, /Fetch API unavailable/);
});

test("leaves the fallback intact when the feed has no valid posts", async () => {
  const container = makeContainer();
  const fallback = container.children[0];

  const rendered = await enhanceContainer(container, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { status: "ok", items: [] };
      },
    }),
    documentRef: new FakeDocument(),
    storage: new FakeStorage(),
    logger: { error() {} },
  });

  assert.equal(rendered, false);
  assert.equal(container.children[0], fallback);
});

test("loads from the network when local storage is unavailable", async () => {
  const container = makeContainer();
  let fetchCalls = 0;
  const unavailableStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    removeItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };

  const rendered = await enhanceContainer(container, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        async json() {
          return {
            status: "ok",
            items: [
              {
                title: "Newest post",
                link: "https://example.com/p/newest",
                pubDate: "2026-08-02 23:01:29",
                description: "Newest summary",
              },
            ],
          };
        },
      };
    },
    documentRef: new FakeDocument(),
    storage: unavailableStorage,
    htmlToText: stripTestHtml,
  });

  assert.equal(rendered, true);
  assert.equal(fetchCalls, 1);
});

test("the template contains the progressive fallback and deferred loader", () => {
  const templatePath = path.join(__dirname, "..", "_includes", "external_blog.html");
  const template = fs.readFileSync(templatePath, "utf8");

  assert.match(template, /<h2[^>]*data-external-blog-heading[^>]*hidden/);
  assert.match(template, /class="post-link"[^>]*>View Posts\b/);
  assert.match(template, /data-feed-url=/);
  assert.match(template, /data-archive-url=/);
  assert.match(template, /external_blog\.js[^>]*defer/);
  assert.doesNotMatch(template, /site\.data\.external_posts/);
});

test("starts normally when loaded as a browser script", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  const heading = new FakeElement("h2");
  heading.setAttribute("hidden", "");
  const selectors = [];

  vm.runInNewContext(source, {
    Date,
    Intl,
    URL,
    URLSearchParams,
    console,
    document: {
      querySelectorAll(value) {
        selectors.push(value);
        if (value === "[data-external-blog-heading]") return [heading];
        return [];
      },
    },
  });

  assert.deepEqual(selectors, [
    "[data-external-blog-heading]",
    "[data-external-blog]",
  ]);
  assert.equal(heading.attributes.has("hidden"), false);
});
