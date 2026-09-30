"use strict";

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
const githubActivity = require(scriptPath);
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

test("fetches every milestone page before ranking", async () => {
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

test("conditionally reuses every cached page after 304 responses", async () => {
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
