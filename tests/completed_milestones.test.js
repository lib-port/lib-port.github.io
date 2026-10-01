"use strict";

const { clientAssetPath } = require("./client_assets");

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(
  __dirname,
  "..",
  "assets",
  "js",
  "github_activity.js"
);
const githubActivity = require(clientAssetPath(scriptPath));
const {
  LIMIT,
  buildClosedMilestoneUrl,
  buildCompletedMilestonesUrl,
  fetchRepositoryCompletedMilestones,
  getFailureKey,
  getStorageKey,
  loadCompletedMilestones,
  mergeCompletedMilestones,
  normalizeCompletedMilestones,
  readCache,
  renderCompletedMilestones,
  writeCache,
} = githubActivity.completedMilestones;
const { CACHE_TTL_MS } = githubActivity.shared;

const OWNER = "lib-port";
const NOW = Date.parse("2026-09-30T12:00:00Z");

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
  constructor() {
    this.attributes = new Map();
    this.href = "";
    this.selectors = new Map();
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectors.get(selector) || [];
  }
}

function makeContainer() {
  const container = new FakeElement();
  const list = new FakeElement();
  list.setAttribute("hidden", "");
  const items = Array.from({ length: LIMIT }, () => {
    const item = new FakeElement();
    item.setAttribute("hidden", "");
    item.selectors.set(
      "[data-recent-completed-milestone-link]",
      new FakeElement()
    );
    return item;
  });
  container.selectors.set("[data-recent-completed-milestones]", list);
  container.selectors.set("[data-recent-completed-milestone]", items);
  return { container, items, list };
}

function makeApiMilestone({
  number = 1,
  title = "IBM DSE PC",
  state = "closed",
  closedAt = "2026-09-30T06:57:15Z",
  openIssues = 0,
} = {}) {
  return {
    number,
    title,
    state,
    closed_at: closedAt,
    open_issues: openIssues,
  };
}

function makeMilestone(repository = "tech-lib", overrides = {}) {
  return normalizeCompletedMilestones(
    [makeApiMilestone(overrides)],
    repository
  )[0];
}

function makeEntry(repository = "tech-lib", milestones = null) {
  const values = milestones || [makeMilestone(repository)];
  return {
    pages: [
      {
        page: 1,
        etag: '"etag-1"',
        hasNext: false,
        itemCount: values.length,
        milestones: values,
      },
    ],
  };
}

function makeResponse({
  status = 200,
  payload = [],
  etag = '"etag"',
  link = "",
} = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (name.toLowerCase() === "etag") return etag;
        if (name.toLowerCase() === "link") return link;
        return null;
      },
    },
    async json() {
      return payload;
    },
  };
}

const silentLogger = { error() {} };

for (const count of [8, 15]) {
  test(`bounds completed milestone collection across ${count} repositories in page rounds`, async () => {
    const repositories = Array.from({ length: count }, (_, index) => `repo-${index}`);
    const storage = new FakeStorage();
    const config = { owner: OWNER, repositories };
    const calls = [];
    const options = {
      config, storage, now: NOW, logger: silentLogger,
      fetchImpl: async (url, _options, { priority }) => {
        const parsed = new URL(url);
        const page = Number(parsed.searchParams.get("page"));
        const repository = parsed.pathname.split("/")[3];
        assert.equal(parsed.searchParams.get("per_page"), "100");
        assert.equal(priority, page === 1 ? 0 : 1);
        calls.push([repository, page]);
        return makeResponse({
          payload: [makeApiMilestone({ number: page, title: repository })],
          link: '<https://api.github.com/example?page=99>; rel="next"',
        });
      },
    };
    assert.equal(await loadCompletedMilestones(makeContainer().container, options), true);
    assert.deepEqual(calls, [
      ...repositories.slice(0, 12).map(name => [name, 1]),
      ...repositories.slice(0, Math.max(0, 12 - count)).map(name => [name, 2]),
    ]);
    const cached = readCache(getStorageKey(OWNER), repositories, storage, NOW);
    assert.equal(cached.isFresh, true);
    for (const [index, name] of repositories.entries()) {
      const entry = cached.repositories[name];
      assert.equal(entry.pages.length, index < Math.max(0, 12 - count) ? 2 : index < 12 ? 1 : 0);
      assert.equal(entry.limited, true);
      assert.equal(entry.deferred, entry.pages.length < 2);
    }
    assert.equal(storage.getItem(getFailureKey(OWNER, repositories)), null);
    await loadCompletedMilestones(makeContainer().container, { ...options, now: NOW + 1 });
    assert.equal(calls.length, 12, "partial results remain fresh for seven days");
  });
}

test("migrates v1 completed caches as stale data and retains candidates beyond page two", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER);
  const legacyKey = key.replace(":v2:", ":v1:");
  const legacyFailure = getFailureKey(OWNER, ["tech-lib"]).replace(":v2:", ":v1:");
  const entry = { pages: [1, 2, 3].map(page => ({
    ...makeEntry("tech-lib", [makeMilestone("tech-lib", {
      number: page, title: `Page ${page}`, closedAt: `2026-09-30T0${page}:00:00Z`,
    })]).pages[0], page, etag: `"page-${page}"`, hasNext: page < 3,
  })) };
  writeCache(legacyKey, { fetchedAt: NOW, repoNames: ["tech-lib"], repositories: { "tech-lib": entry } }, storage);
  githubActivity.shared.writeFailure(legacyFailure, storage, NOW);
  const migrated = readCache(key, ["tech-lib"], storage, NOW);
  assert.equal(migrated.isFresh, false);
  assert.equal(migrated.fetchedAt, 0);
  assert.equal(migrated.repositories["tech-lib"].pages.length, 2);
  assert.deepEqual(mergeCompletedMilestones(migrated.repositories, ["tech-lib"]).map(value => value.title), ["Page 3", "Page 2"]);
  assert.equal(storage.getItem(legacyKey), null);
  const view = makeContainer();
  let calls = 0;
  assert.equal(await loadCompletedMilestones(view.container, {
    config: { owner: OWNER, repositories: ["tech-lib"] },
    storage, now: NOW, logger: silentLogger,
    fetchImpl: async () => { calls += 1; throw new Error("offline"); },
  }), true);
  assert.equal(calls, 1);
  assert.equal(storage.getItem(legacyFailure), null);
  assert.equal(view.items[0].querySelector("[data-recent-completed-milestone-link]").textContent, "Page 3");
});

test("a completed milestone deadline preserves cached results without failure backoff", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER);
  writeCache(key, { fetchedAt: NOW - CACHE_TTL_MS, repoNames: ["tech-lib"], repositories: { "tech-lib": makeEntry() } }, storage);
  const view = makeContainer();
  assert.equal(await loadCompletedMilestones(view.container, {
    config: { owner: OWNER, repositories: ["tech-lib"] },
    storage, now: NOW, refreshTimeoutMs: 10,
    logger: { error() { assert.fail("a deadline is not a failure"); } },
    fetchImpl: () => new Promise(() => {}),
  }), true);
  assert.equal(view.list.hasAttribute("hidden"), false);
  const cached = readCache(key, ["tech-lib"], storage, NOW);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.repositories["tech-lib"].deferred, true);
  assert.equal(cached.repositories["tech-lib"].pages[0].etag, '"etag-1"');
  assert.equal(storage.getItem(getFailureKey(OWNER, ["tech-lib"])), null);
});

test("budget deferral on a later completed page retains both refreshed and cached candidates", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER);
  const entry = makeEntry("tech-lib", [makeMilestone("tech-lib", { title: "Retained", number: 7 })]);
  entry.pages[0].hasNext = true;
  entry.pages.push({ ...entry.pages[0], page: 2, etag: '"page-two"', hasNext: false });
  writeCache(key, { fetchedAt: NOW - CACHE_TTL_MS, repoNames: ["tech-lib"], repositories: { "tech-lib": entry } }, storage);
  assert.equal(await loadCompletedMilestones(makeContainer().container, {
    config: { owner: OWNER, repositories: ["tech-lib"] }, storage, now: NOW,
    logger: { error() { assert.fail("budget exhaustion is not a failure"); } },
    fetchImpl: async url => {
      if (new URL(url).searchParams.get("page") === "2") throw githubActivity.shared.createDeferredError("budget");
      return makeResponse({
        payload: [makeApiMilestone({ number: 8, title: "Refreshed", closedAt: "2026-09-30T07:00:00Z" })],
        etag: '"new-page-one"', link: '<https://api.github.com/example?page=2>; rel="next"',
      });
    },
  }), true);
  const cached = readCache(key, ["tech-lib"], storage, NOW);
  assert.deepEqual(mergeCompletedMilestones(cached.repositories, ["tech-lib"]).map(value => value.title), ["Refreshed", "Retained"]);
  assert.equal(cached.repositories["tech-lib"].pages[0].etag, '"new-page-one"');
  assert.equal(cached.repositories["tech-lib"].pages[1].etag, '"page-two"');
  assert.equal(cached.repositories["tech-lib"].deferred, true);
  assert.equal(storage.getItem(getFailureKey(OWNER, ["tech-lib"])), null);
});

test("builds encoded closed-milestone API and closed-issue page URLs", () => {
  assert.equal(LIMIT, 2);
  assert.equal(
    buildCompletedMilestonesUrl("lib port", "tech lib", 3),
    "https://api.github.com/repos/lib%20port/tech%20lib/milestones?state=closed&per_page=100&page=3"
  );
  assert.equal(
    buildClosedMilestoneUrl("lib port", "tech lib", 7),
    "https://github.com/lib%20port/tech%20lib/milestone/7?closed=1"
  );
});

test("normalises GitHub-closed milestones even when open issues remain", () => {
  const milestones = normalizeCompletedMilestones(
    [
      makeApiMilestone({ title: "  Finished release  ", openIssues: 4 }),
      makeApiMilestone({ number: 2, state: "open" }),
      makeApiMilestone({ number: 0 }),
      makeApiMilestone({ number: 3, title: "   " }),
      makeApiMilestone({ number: 4, closedAt: "invalid" }),
      makeApiMilestone({ number: 5, closedAt: null }),
    ],
    "tech-lib"
  );

  assert.deepEqual(milestones, [
    {
      repository: "tech-lib",
      number: 1,
      title: "Finished release",
      closedAt: "2026-09-30T06:57:15.000Z",
    },
  ]);
});

test("merges, deduplicates, and globally ranks milestones by closed_at", () => {
  const repositories = {
    alpha: {
      pages: [
        {
          milestones: [
            makeMilestone("alpha", {
              number: 3,
              title: "Newest",
              closedAt: "2026-09-30T11:00:00Z",
            }),
            makeMilestone("alpha", {
              number: 5,
              title: "Alpha tie",
              closedAt: "2026-09-30T10:00:00Z",
            }),
          ],
        },
        {
          milestones: [
            makeMilestone("alpha", {
              number: 3,
              title: "Older duplicate",
              closedAt: "2026-09-29T00:00:00Z",
            }),
          ],
        },
      ],
    },
    beta: {
      pages: [
        {
          milestones: [
            makeMilestone("beta", {
              number: 8,
              title: "Beta tie",
              closedAt: "2026-09-30T10:00:00Z",
            }),
          ],
        },
      ],
    },
  };

  assert.deepEqual(
    mergeCompletedMilestones(repositories, ["beta", "alpha"]).map(
      ({ repository, number, title }) => `${repository}:${number}:${title}`
    ),
    ["alpha:3:Newest", "beta:8:Beta tie"]
  );
});

test("fetches both available milestone pages before ranking", async () => {
  const calls = [];
  const entry = await fetchRepositoryCompletedMilestones(
    OWNER,
    "tech-lib",
    null,
    async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return makeResponse({
          payload: [
            makeApiMilestone({ number: 3 }),
            makeApiMilestone({ number: 2 }),
          ],
          link: '<https://api.github.com/example?page=2>; rel="next"',
        });
      }
      return makeResponse({
        payload: [
          makeApiMilestone({
            number: 1,
            closedAt: "2025-01-01T00:00:00Z",
          }),
        ],
      });
    }
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /page=1$/);
  assert.match(calls[1].url, /page=2$/);
  assert.deepEqual(
    entry.pages.flatMap(({ milestones }) => milestones.map(({ number }) => number)),
    [3, 2, 1]
  );
});

test("conditionally reuses both cached pages after 304 responses", async () => {
  const cachedEntry = {
    pages: [
      {
        page: 1,
        etag: '"one"',
        hasNext: true,
        itemCount: 1,
        milestones: [makeMilestone("tech-lib", { number: 2 })],
      },
      {
        page: 2,
        etag: '"two"',
        hasNext: false,
        itemCount: 1,
        milestones: [makeMilestone("tech-lib", { number: 1 })],
      },
    ],
  };
  const headers = [];

  const result = await fetchRepositoryCompletedMilestones(
    OWNER,
    "tech-lib",
    cachedEntry,
    async (_url, options) => {
      headers.push(options.headers);
      return makeResponse({ status: 304 });
    }
  );

  assert.equal(result.pages.length, 2);
  assert.equal(headers[0]["If-None-Match"], '"one"');
  assert.equal(headers[1]["If-None-Match"], '"two"');
  assert.deepEqual(
    result.pages.flatMap(({ milestones }) => milestones.map(({ number }) => number)),
    [2, 1]
  );
});

test("renders two safe milestone links and hides unused placeholders", () => {
  const view = makeContainer();
  const milestones = [
    makeMilestone("tech-lib", {
      number: 2,
      title: "<strong>Newest</strong>",
    }),
    makeMilestone("full-stack-pm", {
      number: 4,
      title: "Second",
      closedAt: "2026-09-29T06:57:15Z",
    }),
  ];

  assert.equal(
    renderCompletedMilestones(view.container, milestones, OWNER),
    true
  );
  assert.equal(view.list.hasAttribute("hidden"), false);
  assert.equal(view.items[0].hasAttribute("hidden"), false);
  assert.equal(view.items[1].hasAttribute("hidden"), false);

  const firstLink = view.items[0].querySelector(
    "[data-recent-completed-milestone-link]"
  );
  assert.equal(firstLink.textContent, "<strong>Newest</strong>");
  assert.equal(
    firstLink.href,
    "https://github.com/lib-port/tech-lib/milestone/2?closed=1"
  );
  assert.equal(
    firstLink.attributes.get("aria-label"),
    "View closed issues for milestone <strong>Newest</strong> in tech-lib"
  );

  assert.equal(
    renderCompletedMilestones(view.container, milestones.slice(0, 1), OWNER),
    true
  );
  assert.equal(view.items[0].hasAttribute("hidden"), false);
  assert.equal(view.items[1].hasAttribute("hidden"), true);

  assert.equal(renderCompletedMilestones(view.container, [], OWNER), true);
  assert.equal(view.list.hasAttribute("hidden"), true);
});

test("reads fresh and stale completed-milestone caches", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const cache = {
    fetchedAt: NOW - 1,
    repoNames: ["tech-lib"],
    repositories: { "tech-lib": makeEntry() },
  };

  assert.equal(writeCache(storageKey, cache, storage), true);
  const fresh = readCache(storageKey, ["tech-lib"], storage, NOW);
  assert.equal(fresh.complete, true);
  assert.equal(fresh.isFresh, true);

  storage.setItem(
    storageKey,
    JSON.stringify({ ...cache, fetchedAt: NOW - CACHE_TTL_MS })
  );
  const stale = readCache(storageKey, ["tech-lib"], storage, NOW);
  assert.equal(stale.complete, true);
  assert.equal(stale.isFresh, false);
});

test("removes malformed completed-milestone caches", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  storage.setItem(
    storageKey,
    JSON.stringify({
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: {
        "tech-lib": {
          pages: [
            {
              page: 1,
              etag: '"etag"',
              hasNext: false,
              itemCount: 1,
              milestones: [{ repository: "wrong-repo" }],
            },
          ],
        },
      },
    })
  );

  assert.equal(readCache(storageKey, ["tech-lib"], storage, NOW), null);
  assert.equal(storage.getItem(storageKey), null);
});

test("uses a fresh completed-milestone cache without fetching", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  writeCache(
    storageKey,
    {
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry() },
    },
    storage
  );
  const view = makeContainer();
  let fetches = 0;

  assert.equal(
    await loadCompletedMilestones(view.container, {
      config: { owner: OWNER, repositories: ["tech-lib"] },
      fetchImpl: async () => {
        fetches += 1;
        throw new Error("fresh cache should avoid a request");
      },
      logger: silentLogger,
      now: NOW,
      storage,
    }),
    true
  );
  assert.equal(fetches, 0);
  assert.equal(view.list.hasAttribute("hidden"), false);
});

test("loads completed repositories concurrently and ranks after all settle", async () => {
  const view = makeContainer();
  const requests = [];
  let resolveAlpha;
  const alphaResponse = new Promise(resolve => { resolveAlpha = resolve; });
  const pending = loadCompletedMilestones(view.container, {
    config: { owner: OWNER, repositories: ["alpha", "beta"] },
    fetchImpl: async url => {
      requests.push(url);
      return url.includes("/alpha/") ? alphaResponse : makeResponse({ payload: [makeApiMilestone({ title: "Beta" })] });
    },
    storage: new FakeStorage(), now: NOW, logger: silentLogger,
  });
  assert.equal(requests.length, 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.list.hasAttribute("hidden"), true);
  resolveAlpha(makeResponse({ payload: [makeApiMilestone({ title: "Alpha" })] }));
  assert.equal(await pending, true);
  assert.deepEqual(view.items.map(item => item.querySelector("[data-recent-completed-milestone-link]").textContent), ["Alpha", "Beta"]);
});

for (const scenario of [
  { name: "replaces stale completed milestones", cached: true, payload: [makeApiMilestone({ title: "Refreshed" })] },
  { name: "hides completed milestones after a refresh returns empty", cached: true, payload: [] },
  { name: "keeps a complete empty completed cache hidden during refresh", cached: false, payload: [makeApiMilestone({ title: "Refreshed" })] },
  { name: "revalidates visible completed milestones with a 304", cached: true, status: 304 },
]) {
  test(scenario.name, async () => {
    const storage = new FakeStorage();
    const storageKey = getStorageKey(OWNER);
    const view = makeContainer();
    writeCache(storageKey, {
      fetchedAt: NOW - CACHE_TTL_MS,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry("tech-lib", scenario.cached ? null : []) },
    }, storage);
    let resolveFetch;
    let requestHeaders;
    const response = new Promise(resolve => { resolveFetch = resolve; });
    const pending = loadCompletedMilestones(view.container, {
      config: { owner: OWNER, repositories: ["tech-lib"] },
      fetchImpl: (_url, options) => { requestHeaders = options.headers; return response; },
      storage, now: NOW, logger: silentLogger,
    });
    assert.equal(view.list.hasAttribute("hidden"), !scenario.cached);
    assert.equal(requestHeaders["If-None-Match"], '"etag-1"');
    assert.equal(JSON.parse(storage.getItem(storageKey)).fetchedAt, NOW - CACHE_TTL_MS);
    resolveFetch(makeResponse({ status: scenario.status, payload: scenario.payload }));
    assert.equal(await pending, true);
    assert.equal(view.list.hasAttribute("hidden"), scenario.payload?.length === 0);
    assert.equal(JSON.parse(storage.getItem(storageKey)).fetchedAt, NOW);
    if (scenario.payload?.length) assert.equal(view.items[0].querySelector("[data-recent-completed-milestone-link]").textContent, "Refreshed");
  });
}

test("keeps stale completed milestones visible after a refresh fails", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const config = { owner: OWNER, repositories: ["tech-lib"] };
  const view = makeContainer();
  writeCache(storageKey, { fetchedAt: NOW - CACHE_TTL_MS, repoNames: config.repositories, repositories: { "tech-lib": makeEntry() } }, storage);
  let rejectFetch;
  const response = new Promise((_resolve, reject) => { rejectFetch = reject; });
  const pending = loadCompletedMilestones(view.container, { config, fetchImpl: () => response, storage, now: NOW, logger: silentLogger });
  assert.equal(view.list.hasAttribute("hidden"), false);
  rejectFetch(new Error("Offline"));
  assert.equal(await pending, true);
  assert.equal(view.list.hasAttribute("hidden"), false);
  assert.equal(JSON.parse(storage.getItem(storageKey)).fetchedAt, NOW - CACHE_TTL_MS);
  assert.notEqual(storage.getItem(getFailureKey(OWNER, config.repositories)), null);
});

test("retains failed completed-milestone caches alongside refreshed repositories", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const config = { owner: OWNER, repositories: ["alpha", "beta"] };
  const view = makeContainer();
  writeCache(storageKey, {
    fetchedAt: NOW - CACHE_TTL_MS,
    repoNames: config.repositories,
    repositories: {
      alpha: makeEntry("alpha", [makeMilestone("alpha", { title: "Cached Alpha" })]),
      beta: makeEntry("beta", []),
    },
  }, storage);
  assert.equal(await loadCompletedMilestones(view.container, {
    config,
    fetchImpl: async url => url.includes("/alpha/")
      ? makeResponse({ status: 500 })
      : makeResponse({ payload: [makeApiMilestone({ title: "Refreshed Beta", closedAt: "2026-09-30T08:00:00Z" })] }),
    storage,
    now: NOW,
    logger: silentLogger,
  }), true);
  assert.deepEqual(
    view.items.map(item => item.querySelector("[data-recent-completed-milestone-link]").textContent),
    ["Refreshed Beta", "Cached Alpha"]
  );
  assert.equal(JSON.parse(storage.getItem(storageKey)).fetchedAt, NOW - CACHE_TTL_MS);
});

test("keeps successful repository data when another repository fails", async () => {
  const storage = new FakeStorage();
  const config = { owner: OWNER, repositories: ["alpha", "beta"] };
  const firstView = makeContainer();
  let fetches = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    if (url.includes("/alpha/")) {
      return makeResponse({
        payload: [makeApiMilestone({ title: "Alpha complete" })],
      });
    }
    return makeResponse({ status: 500 });
  };

  assert.equal(
    await loadCompletedMilestones(firstView.container, {
      config,
      fetchImpl,
      logger: silentLogger,
      now: NOW,
      storage,
    }),
    true
  );
  assert.equal(fetches, 2);
  assert.equal(
    firstView.items[0].querySelector(
      "[data-recent-completed-milestone-link]"
    ).textContent,
    "Alpha complete"
  );
  assert.notEqual(storage.getItem(getFailureKey(OWNER, config.repositories)), null);

  const secondView = makeContainer();
  assert.equal(
    await loadCompletedMilestones(secondView.container, {
      config,
      fetchImpl: async () => {
        throw new Error("failure backoff should avoid another request");
      },
      logger: silentLogger,
      now: NOW + 1,
      storage,
    }),
    true
  );
  assert.equal(
    secondView.items[0].querySelector(
      "[data-recent-completed-milestone-link]"
    ).textContent,
    "Alpha complete"
  );
});

test("hides the compact list after a successful empty search", async () => {
  const view = makeContainer();
  assert.equal(
    await loadCompletedMilestones(view.container, {
      config: { owner: OWNER, repositories: ["tech-lib"] },
      fetchImpl: async () => makeResponse(),
      logger: silentLogger,
      now: NOW,
      storage: new FakeStorage(),
    }),
    true
  );
  assert.equal(view.list.hasAttribute("hidden"), true);
});
