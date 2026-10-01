"use strict";

const { clientAssetPath } = require("./client_assets");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "assets", "js", "github_activity.js");
const githubActivity = require(clientAssetPath(scriptPath));
const {
  AUTHOR_MODE,
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  LINKED_AUTHOR_MODE,
  buildCommitListUrl,
  formatUtcDate,
  getFailureKey,
  getMessageSubject,
  getStorageKey,
  hasRecentFailure,
  loadCommitHistory,
  mergeCommits,
  normalizeApiCommits,
  readCache,
  renderCommits,
  writeCache,
  writeFailure,
} = githubActivity.recentCommits;
const { createRequestCoordinator } = githubActivity.shared;

const OWNER = "lib-port";
const NOW = Date.parse("2026-08-23T15:00:00Z");
const REPOSITORY = {
  name: "example-repo",
  url: "https://github.com/lib-port/example-repo",
};

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
    this.dataset = {};
    this.textContent = "";
    this.href = "";
    this.dateTime = "";
    this.selectors = new Map();
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

  toggleAttribute(name, force) {
    const shouldHaveAttribute =
      force === undefined ? !this.attributes.has(name) : Boolean(force);
    if (shouldHaveAttribute) {
      this.setAttribute(name, "");
    } else {
      this.removeAttribute(name);
    }
    return shouldHaveAttribute;
  }

  get hidden() {
    return this.attributes.has("hidden");
  }

  set hidden(value) {
    this.toggleAttribute("hidden", value);
  }

  querySelector(selector) {
    return this.selectors.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectors.get(selector) || [];
  }
}

function makeItem() {
  const item = new FakeElement();
  item.setAttribute("hidden", "");
  item.selectors.set("[data-commit-history-marker]", new FakeElement());
  item.selectors.set("[data-commit-history-repo]", new FakeElement());
  item.selectors.set("[data-commit-history-message]", new FakeElement());
  item.selectors.set("[data-commit-history-date]", new FakeElement());
  return item;
}

function makeContainer({ limit = 2, repositories = [REPOSITORY] } = {}) {
  const container = new FakeElement();
  container.dataset.owner = OWNER;
  container.dataset.commitLimit = String(limit);

  const repositoryData = new FakeElement();
  repositoryData.textContent = JSON.stringify(repositories);
  const list = new FakeElement();
  list.setAttribute("hidden", "");
  const loading = new FakeElement();
  loading.textContent = "loading recent commits";
  const error = new FakeElement();
  error.textContent = "unable to load recent commits";
  error.setAttribute("hidden", "");
  const empty = new FakeElement();
  empty.textContent = "No recent commits found";
  empty.setAttribute("hidden", "");
  const limited = new FakeElement();
  limited.textContent = "Some repository history could not be searched completely.";
  limited.setAttribute("hidden", "");
  const items = Array.from({ length: limit }, makeItem);

  container.selectors.set("[data-commit-history-repositories]", repositoryData);
  container.selectors.set("[data-commit-history-list]", list);
  container.selectors.set("[data-commit-history-loading]", loading);
  container.selectors.set("[data-commit-history-error]", error);
  container.selectors.set("[data-commit-history-empty]", empty);
  container.selectors.set("[data-commit-history-limited]", limited);
  container.selectors.set("[data-commit-history-item]", items);
  return { container, empty, error, items, limited, list, loading };
}

function isVisible(element) {
  return !element.attributes.has("hidden");
}

function assertOnlyVisible(elements, visibleName) {
  for (const [name, element] of Object.entries(elements)) {
    assert.equal(
      isVisible(element),
      name === visibleName,
      `${name} visibility should ${name === visibleName ? "be on" : "be off"}`
    );
  }
}

function makeCommit({
  repo = REPOSITORY,
  sha = "abc123",
  owner = OWNER,
  message = "Fix the cache\n\nLong explanation",
  committedAt = "2026-08-23T12:34:56Z",
} = {}) {
  return {
    sha,
    html_url: `https://github.com/${OWNER}/${repo.name}/commit/${sha}`,
    author: owner ? { login: owner } : null,
    commit: {
      message,
      committer: { date: committedAt },
    },
  };
}

function makeResponse({ status = 200, payload = [], etag = '"etag"', link = "" } = {}) {
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

test("builds filtered and fallback commit-list URLs", () => {
  assert.equal(
    buildCommitListUrl("repo name", OWNER, 10, AUTHOR_MODE),
    "https://api.github.com/repos/lib-port/repo%20name/commits?author=lib-port&per_page=10"
  );
  assert.equal(
    buildCommitListUrl("repo name", OWNER, 10, LINKED_AUTHOR_MODE, 2),
    "https://api.github.com/repos/lib-port/repo%20name/commits?per_page=100&page=2"
  );
});

test("uses the first nonblank message line and formats committed dates in UTC", () => {
  assert.equal(getMessageSubject("\n  Fix the cache  \n\nDetails"), "Fix the cache");
  assert.equal(formatUtcDate("2026-08-23T23:30:00-04:00"), "2026-08-24");
  assert.equal(formatUtcDate("not a date"), "");
});

test("normalises only commits linked to the owner and uses committer time", () => {
  const commits = normalizeApiCommits(
    [
      makeCommit({ sha: "older", committedAt: "2026-08-22T00:00:00Z" }),
      makeCommit({ sha: "other", owner: "someone-else" }),
      makeCommit({ sha: "newer", committedAt: "2026-08-23T00:00:00Z" }),
      makeCommit({ sha: "invalid", committedAt: "nope" }),
    ],
    REPOSITORY,
    OWNER,
    10
  );

  assert.deepEqual(
    commits.map(({ sha, message, committedAt }) => ({ sha, message, committedAt })),
    [
      {
        sha: "newer",
        message: "Fix the cache",
        committedAt: "2026-08-23T00:00:00.000Z",
      },
      {
        sha: "older",
        message: "Fix the cache",
        committedAt: "2026-08-22T00:00:00.000Z",
      },
    ]
  );
});

test("merges repositories, deduplicates SHAs per repository, sorts, and limits", () => {
  const normalized = normalizeApiCommits(
    [
      makeCommit({ sha: "same", committedAt: "2026-08-20T00:00:00Z" }),
      makeCommit({ sha: "latest", committedAt: "2026-08-23T00:00:00Z" }),
    ],
    REPOSITORY,
    OWNER,
    10
  );

  const commits = mergeCommits(
    {
      first: { commits: normalized },
      duplicate: { commits: [normalized[0]] },
    },
    1
  );

  assert.equal(commits.length, 1);
  assert.equal(commits[0].sha, "latest");
});

test("renders the timeline, its links and date, and marks only the last visible item", () => {
  const { container, empty, error, items, list, loading } = makeContainer({
    limit: 3,
  });
  const commits = normalizeApiCommits(
    [
      makeCommit({ sha: "newer", committedAt: "2026-08-23T12:34:56Z" }),
      makeCommit({ sha: "older", committedAt: "2026-08-22T12:34:56Z" }),
    ],
    REPOSITORY,
    OWNER,
    3
  );

  assert.equal(renderCommits(container, commits, 3), true);
  const repoLink = items[0].querySelector("[data-commit-history-repo]");
  const messageLink = items[0].querySelector("[data-commit-history-message]");
  const time = items[0].querySelector("[data-commit-history-date]");

  assert.equal(isVisible(items[0]), true);
  assert.equal(isVisible(items[1]), true);
  assert.equal(isVisible(items[2]), false);
  assert.equal(items[0].attributes.has("data-commit-history-last"), false);
  assert.equal(items[1].attributes.has("data-commit-history-last"), true);
  assert.equal(items[2].attributes.has("data-commit-history-last"), false);
  assertOnlyVisible({ list, loading, error, empty }, "list");
  assert.equal(repoLink.href, REPOSITORY.url);
  assert.equal(repoLink.textContent, REPOSITORY.name);
  assert.match(messageLink.href, /\/commit\/newer$/);
  assert.equal(messageLink.textContent, "Fix the cache");
  assert.equal(time.href, "");
  assert.equal(time.dateTime, "2026-08-23T12:34:56.000Z");
  assert.equal(time.textContent, "2026-08-23");

  assert.equal(renderCommits(container, commits.slice(0, 1), 3), true);
  assert.equal(items[0].attributes.has("data-commit-history-last"), true);
  assert.equal(items[1].attributes.has("data-commit-history-last"), false);
});

test("shows only the loading status while the initial request is pending", async () => {
  const storage = new FakeStorage();
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });
  let resolveFetch;
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  const pending = loadCommitHistory(container, {
    fetchImpl: async () => responsePromise,
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assertOnlyVisible({ list, loading, error, empty }, "loading");
  assert.equal(loading.textContent, "loading recent commits");

  resolveFetch(makeResponse({ payload: [makeCommit()] }));
  assert.equal(await pending, true);
  assertOnlyVisible({ list, loading, error, empty }, "list");
});

test("uses a distinct empty state after a successful search finds no commits", async () => {
  const storage = new FakeStorage();
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });
  let calls = 0;

  const loaded = await loadCommitHistory(container, {
    fetchImpl: async () => {
      calls += 1;
      return makeResponse({ payload: [] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(calls, 2, "the linked-author fallback should also complete");
  assertOnlyVisible({ list, loading, error, empty }, "empty");
  assert.equal(empty.textContent, "No recent commits found");
});

test("loads author-filtered commits and caches them for seven days", async () => {
  const storage = new FakeStorage();
  const { container, items } = makeContainer({ limit: 1 });
  let fetchCalls = 0;

  const loaded = await loadCommitHistory(container, {
    fetchImpl: async (url) => {
      fetchCalls += 1;
      assert.match(url, /author=lib-port/);
      return makeResponse({ payload: [makeCommit()] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(fetchCalls, 1);
  assert.equal(items[0].attributes.has("hidden"), false);

  await loadCommitHistory(makeContainer({ limit: 1 }).container, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fresh cache should avoid a request");
    },
    storage,
    now: NOW + CACHE_TTL_MS - 1,
    logger: silentLogger,
  });
  assert.equal(fetchCalls, 1);
});

test("treats a malformed successful GitHub payload as a refresh failure", async () => {
  const storage = new FakeStorage();
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });

  const loaded = await loadCommitHistory(container, {
    fetchImpl: async () => makeResponse({ payload: { commits: [] } }),
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, false);
  assertOnlyVisible({ list, loading, error, empty }, "error");
  assert.equal(error.textContent, "unable to load recent commits");
  assert.equal(
    hasRecentFailure(getFailureKey(OWNER, 1), storage, NOW),
    true
  );
});

test("shows the failure state when a commit request times out", async () => {
  const storage = new FakeStorage();
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });
  const coordinator = createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => NOW,
    requestTimeoutMs: 10,
    fetchImpl: () => new Promise(() => {}),
  });

  const loaded = await loadCommitHistory(container, {
    fetchImpl: coordinator.fetch,
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, false);
  assertOnlyVisible({ list, loading, error, empty }, "error");
  assert.equal(error.textContent, "unable to load recent commits");
  assert.equal(container.attributes.has("aria-busy"), false);
});

test("falls back to linked author history, paginates, and remembers the mode", async () => {
  const storage = new FakeStorage();
  const { container, items } = makeContainer({ limit: 2 });
  const requests = [];

  const responses = [
    makeResponse({ payload: [] }),
    makeResponse({
      payload: [
        makeCommit({ sha: "other", owner: "someone-else" }),
        makeCommit({ sha: "first", committedAt: "2026-08-22T00:00:00Z" }),
      ],
      link: '<https://api.github.com/example?page=2>; rel="next"',
    }),
    makeResponse({
      payload: [makeCommit({ sha: "second", committedAt: "2026-08-23T00:00:00Z" })],
    }),
  ];

  const loaded = await loadCommitHistory(container, {
    fetchImpl: async (url) => {
      requests.push(url);
      return responses.shift();
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(requests.length, 3);
  assert.match(requests[0], /author=lib-port/);
  assert.doesNotMatch(requests[1], /author=/);
  assert.match(requests[2], /page=2/);
  assert.equal(
    items[0].querySelector("[data-commit-history-message]").href.endsWith("/second"),
    true
  );
  assert.equal(
    JSON.parse(storage.getItem(getStorageKey(OWNER, 2))).repositories[REPOSITORY.name].mode,
    LINKED_AUTHOR_MODE
  );
});

test("finds an owner commit after 100 collaborator commits in three requests", async () => {
  const storage = new FakeStorage();
  const view = makeContainer({ limit: 1 });
  const requests = [];
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: async (url) => {
      requests.push(url);
      const query = new URL(url).searchParams;
      if (query.has("author")) return makeResponse();
      assert.equal(query.get("per_page"), "100");
      return makeResponse({
        payload: query.get("page") === "2"
          ? [makeCommit({ sha: "owner-after-collaborators" })]
          : Array.from({ length: 100 }, (_, index) => makeCommit({
            sha: `collaborator-${index}`, owner: "someone-else",
          })),
        link: '<https://api.github.com/example?page=3>; rel="next"',
      });
    },
    storage, now: NOW, logger: silentLogger,
  }), true);
  assert.equal(requests.length, 3);
  assert.equal(isVisible(view.limited), false, "finding the display limit completes the search");
  assert.match(view.items[0].querySelector("[data-commit-history-message]").href, /owner-after-collaborators$/);
});

test("stops an endless empty history after two fallback pages without failure backoff", async () => {
  const storage = new FakeStorage();
  const view = makeContainer({ limit: 1 });
  let requests = 0;
  const pushedAt = "2026-08-23T00:00:00.000Z";
  const options = {
    fetchImpl: async () => {
      requests += 1;
      return makeResponse({ link: '<https://api.github.com/example?page=99>; rel="next"' });
    },
    getCatalogueImpl: async () => ({
      validated: true, complete: true, repositories: { [REPOSITORY.name]: { pushedAt } },
    }),
    storage, now: NOW, logger: silentLogger,
  };
  assert.equal(await loadCommitHistory(view.container, options), true);
  assert.equal(requests, 3);
  assertOnlyVisible({ list: view.list, loading: view.loading, error: view.error, empty: view.empty }, "empty");
  assert.equal(view.empty.textContent, "No recent commits found");
  const cached = readCache(getStorageKey(OWNER, 1), [REPOSITORY], storage, NOW);
  const entry = cached.repositories[REPOSITORY.name];
  assert.equal(cached.isFresh, true);
  assert.equal(entry.limited, true);
  assert.equal(entry.deferred, false);
  assert.equal(entry.pages.length, 2);
  assert.equal(entry.pushedAt, pushedAt);
  assert.equal(storage.getItem(getFailureKey(OWNER, 1)), null);
  assert.equal(storage.getItem(githubActivity.shared.getGlobalFailureKey(OWNER)), null);

  for (const now of [NOW + 1, NOW + CACHE_TTL_MS]) {
    const cachedView = makeContainer({ limit: 1 });
    assert.equal(await loadCommitHistory(cachedView.container, { ...options, now }), true);
    assert.equal(cachedView.empty.textContent, "No recent commits found");
    assert.equal(requests, 3, "fresh results and unchanged pushes avoid repeating a capped search");
  }
});

test("silently renders collected commits and restores partial results from cache", async () => {
  const storage = new FakeStorage();
  const view = makeContainer();
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: async (url) => makeResponse({
      payload: new URL(url).searchParams.get("page") === "2" ? [makeCommit()] : [],
      link: '<https://api.github.com/example?page=3>; rel="next"',
    }),
    storage, now: NOW, logger: silentLogger,
  }), true);
  assert.equal(isVisible(view.list), true);
  assert.equal(isVisible(view.limited), false);
  assert.equal(view.items.filter(isVisible).length, 1);
  assert.equal(storage.getItem(getFailureKey(OWNER, 2)), null);

  const cachedView = makeContainer();
  await loadCommitHistory(cachedView.container, {
    fetchImpl: async () => { throw new Error("fresh partial results must be cached"); },
    storage, now: NOW + 1, logger: silentLogger,
  });
  assert.equal(isVisible(cachedView.limited), false);
  assert.equal(renderCommits(cachedView.container, normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 2), 2), true);
  assert.equal(isVisible(cachedView.limited), false, "complete results clear the notice");
  renderCommits(view.container, [], 2);
  assert.equal(view.empty.textContent, "No recent commits found");
  assert.equal(isVisible(view.limited), false);
});

test("shares 12 fallback requests across concurrent repositories in fair page rounds", async () => {
  const repositories = Array.from({ length: 8 }, (_, index) => ({
    name: `repo-${index}`, url: `https://github.com/${OWNER}/repo-${index}`,
  }));
  const pushedDays = [20, 23, 21, 23, 19, 22, 18, 17];
  const catalogue = Object.fromEntries(repositories.map((repo, index) => [repo.name, {
    pushedAt: `2026-08-${pushedDays[index]}T00:00:00.000Z`,
  }]));
  const requests = [];
  const storage = new FakeStorage();
  let active = 0;
  let maximumActive = 0;
  const coordinator = createRequestCoordinator({
    owner: OWNER, storage, now: () => NOW,
    fetchImpl: async (url) => {
      requests.push(url);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const query = new URL(url).searchParams;
      await new Promise((resolve) => setTimeout(resolve, query.has("author") ? 3 : 1));
      active -= 1;
      return makeResponse({ link: '<https://api.github.com/example?page=99>; rel="next"' });
    },
  });
  assert.equal(await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, {
    fetchImpl: coordinator.fetch,
    getCatalogueImpl: async () => ({ validated: true, complete: true, repositories: catalogue }),
    storage, now: NOW, logger: silentLogger,
  }), true);
  assert.equal(requests.length, 20);
  assert.equal(maximumActive, 4);
  const fallbackRequests = requests.filter((url) => !new URL(url).searchParams.has("author"));
  const requestOrder = fallbackRequests.map((url) => {
    const parsed = new URL(url);
    return `${parsed.pathname.split("/")[3]}:${parsed.searchParams.get("page") || "1"}`;
  });
  assert.deepEqual(requestOrder, [
    "repo-1:1", "repo-3:1", "repo-5:1", "repo-2:1", "repo-0:1", "repo-4:1", "repo-6:1", "repo-7:1",
    "repo-1:2", "repo-3:2", "repo-5:2", "repo-2:2",
  ]);
  const cached = readCache(getStorageKey(OWNER, 1), repositories, storage, NOW);
  assert.equal(cached.isFresh, true);
  for (const { name } of repositories) {
    const entry = cached.repositories[name];
    assert.equal(entry.limited, true);
    assert.equal(entry.deferred, !["repo-1", "repo-3", "repo-5", "repo-2"].includes(name));
    assert.equal(entry.pushedAt, entry.deferred ? "" : catalogue[name].pushedAt);
  }
  assert.equal(storage.getItem(getFailureKey(OWNER, 1)), null);
  assert.equal(storage.getItem(githubActivity.shared.getGlobalFailureKey(OWNER)), null);
});

test("defers repositories beyond the budget and retries them after cache expiry", async () => {
  const repositories = Array.from({ length: 15 }, (_, index) => ({
    name: `repo-${index}`, url: `https://github.com/${OWNER}/repo-${index}`,
  }));
  const storage = new FakeStorage();
  const requests = [];
  const catalogue = Object.fromEntries(repositories.map(({ name }) => [name, {
    pushedAt: "2026-08-23T00:00:00.000Z",
  }]));
  const options = {
    fetchImpl: async (url) => {
      requests.push(url);
      const parsed = new URL(url);
      const repository = repositories.find(({ name }) => name === parsed.pathname.split("/")[3]);
      return makeResponse({ payload: parsed.searchParams.has("author") ? [] : [makeCommit({ repo: repository })] });
    },
    getCatalogueImpl: async () => ({ validated: true, complete: true, repositories: catalogue }),
    storage, now: NOW, logger: silentLogger,
  };
  assert.equal(await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, options), true);
  assert.equal(requests.length, 27);
  assert.deepEqual(requests.slice(15).map((url) => new URL(url).pathname.split("/")[3]), repositories.slice(0, 12).map(({ name }) => name));
  const cached = readCache(getStorageKey(OWNER, 1), repositories, storage, NOW);
  for (const { name } of repositories.slice(12)) {
    assert.equal(cached.repositories[name].deferred, true);
    assert.equal(cached.repositories[name].pushedAt, "");
    assert.deepEqual(cached.repositories[name].pages, []);
  }
  await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, { ...options, now: NOW + 1 });
  assert.equal(requests.length, 27);
  requests.length = 0;
  assert.equal(await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, {
    ...options, now: NOW + CACHE_TTL_MS,
  }), true);
  assert.deepEqual(requests, repositories.slice(12).map(({ name }) => buildCommitListUrl(name, OWNER, 1, LINKED_AUTHOR_MODE)));
  const refreshed = readCache(getStorageKey(OWNER, 1), repositories, storage, NOW + CACHE_TTL_MS);
  assert.equal(refreshed.limited, false);
});

test("preserves cached commits, page ETags and verified push times for deferred searches", async () => {
  const repositories = Array.from({ length: 13 }, (_, index) => ({
    name: `repo-${index}`, url: `https://github.com/${OWNER}/repo-${index}`,
  }));
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 2);
  const pushedAt = "2026-08-20T00:00:00.000Z";
  const cachedRepositories = Object.fromEntries(repositories.map((repository) => {
    const commits = normalizeApiCommits([makeCommit({ repo: repository, sha: "cached" })], repository, OWNER, 2);
    return [repository.name, {
      mode: LINKED_AUTHOR_MODE, commits, pushedAt, limited: false, deferred: false,
      pages: [
        { page: 1, etag: '"page-one"', hasNext: true, commits: [] },
        { page: 2, etag: '"page-two"', hasNext: false, commits },
      ],
    }];
  }));
  writeCache(key, { fetchedAt: NOW - CACHE_TTL_MS, repoNames: repositories.map(({ name }) => name), repositories: cachedRepositories }, storage);
  let requests = 0;
  const view = makeContainer({ repositories });
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: async (url, { headers }) => {
      requests += 1;
      assert.equal(headers["If-None-Match"], '"page-one"');
      assert.doesNotMatch(url, /page=2|author=/);
      return makeResponse({ etag: '"updated-page-one"', link: '<https://api.github.com/example?page=2>; rel="next"' });
    },
    getCatalogueImpl: async () => ({
      validated: true, complete: true,
      repositories: Object.fromEntries(repositories.map(({ name }) => [name, { pushedAt: "2026-08-23T00:00:00.000Z" }])),
    }),
    storage, now: NOW, logger: silentLogger,
  }), true);
  assert.equal(requests, 12);
  assert.equal(isVisible(view.list), true);
  assert.equal(isVisible(view.limited), false);
  const cached = readCache(key, repositories, storage, NOW);
  assert.equal(cached.isFresh, true);
  for (const [index, { name }] of repositories.entries()) {
    const entry = cached.repositories[name];
    assert.equal(entry.commits[0].sha, "cached");
    assert.equal(entry.pushedAt, pushedAt);
    assert.equal(entry.deferred, true);
    assert.equal(entry.pages[0].etag, index < 12 ? '"updated-page-one"' : '"page-one"');
    assert.equal(entry.pages[1].etag, '"page-two"');
  }
  assert.deepEqual(githubActivity.recentCommits.selectRepositoriesToFetch(repositories, cached.repositories, {
    validated: true, repositories: Object.fromEntries(repositories.map(({ name }) => [name, { pushedAt }])),
  }), repositories, "deferred searches retry even when their old push timestamp matches");
  assert.equal(storage.getItem(getFailureKey(OWNER, 2)), null);
});

test("revalidates page two separately when page one returns 304", async () => {
  const storage = new FakeStorage();
  const options = { storage, now: NOW, logger: silentLogger };
  await loadCommitHistory(makeContainer({ limit: 1 }).container, {
    ...options,
    fetchImpl: async (url) => {
      const query = new URL(url).searchParams;
      if (query.has("author")) return makeResponse();
      const secondPage = query.get("page") === "2";
      return makeResponse({
        payload: secondPage ? [makeCommit({ sha: "old-page-two" })] : [],
        etag: secondPage ? '"page-two"' : '"page-one"',
        link: secondPage ? "" : '<https://api.github.com/example?page=2>; rel="next"',
      });
    },
  });
  const requests = [];
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    ...options, now: NOW + CACHE_TTL_MS,
    fetchImpl: async (url, { headers }) => {
      requests.push({ url, etag: headers["If-None-Match"] });
      return url.includes("page=2")
        ? makeResponse({ payload: [makeCommit({ sha: "new-page-two" })], etag: '"updated-page-two"' })
        : makeResponse({ status: 304 });
    },
  }), true);
  assert.deepEqual(requests, [
    { url: buildCommitListUrl(REPOSITORY.name, OWNER, 1, LINKED_AUTHOR_MODE), etag: '"page-one"' },
    { url: buildCommitListUrl(REPOSITORY.name, OWNER, 1, LINKED_AUTHOR_MODE, 2), etag: '"page-two"' },
  ]);
  assert.match(view.items[0].querySelector("[data-commit-history-message]").href, /new-page-two$/);
  const cached = readCache(getStorageKey(OWNER, 1), [REPOSITORY], storage, NOW + CACHE_TTL_MS);
  assert.equal(cached.repositories[REPOSITORY.name].pages[1].etag, '"updated-page-two"');

  requests.length = 0;
  const unchangedView = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(unchangedView.container, {
    ...options, now: NOW + CACHE_TTL_MS * 2,
    fetchImpl: async (url, { headers }) => {
      requests.push({ url, etag: headers["If-None-Match"] });
      return makeResponse({ status: 304 });
    },
  }), true);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].etag, '"updated-page-two"');
  assert.match(unchangedView.items[0].querySelector("[data-commit-history-message]").href, /new-page-two$/);
});

test("keeps genuine fallback HTTP failures under shared rate-limit protection", async () => {
  const storage = new FakeStorage();
  const coordinator = createRequestCoordinator({
    owner: OWNER, storage, now: () => NOW,
    fetchImpl: async (url) => makeResponse({ status: url.includes("author=") ? 200 : 429 }),
  });
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: coordinator.fetch, storage, now: NOW, logger: silentLogger,
  }), false);
  assert.equal(isVisible(view.error), true);
  assert.equal(hasRecentFailure(getFailureKey(OWNER, 1), storage, NOW), true);
  assert.equal(hasRecentFailure(githubActivity.shared.getGlobalFailureKey(OWNER), storage, NOW), true);
});

test("renders best-effort commits when another repository fails", async () => {
  const storage = new FakeStorage();
  const workingRepository = {
    name: "working-repo",
    url: "https://github.com/lib-port/working-repo",
  };
  const failedRepository = {
    name: "failed-repo",
    url: "https://github.com/lib-port/failed-repo",
  };
  const { container, empty, error, items, list, loading } = makeContainer({
    limit: 1,
    repositories: [workingRepository, failedRepository],
  });

  const loaded = await loadCommitHistory(container, {
    fetchImpl: async (url) => {
      if (url.includes("failed-repo")) throw new Error("repository unavailable");
      return makeResponse({ payload: [makeCommit({ repo: workingRepository })] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assertOnlyVisible({ list, loading, error, empty }, "list");
  assert.equal(
    items[0].querySelector("[data-commit-history-repo]").textContent,
    workingRepository.name
  );
  assert.equal(items[0].attributes.has("data-commit-history-last"), true);
});

test("loads linked-author fallback even when another repository returns 404", async () => {
  const missingRepository = { name: "removed-repo", url: `https://github.com/${OWNER}/removed-repo` };
  const view = makeContainer({ repositories: [REPOSITORY, missingRepository], limit: 1 });
  const requests = [];
  const storage = new FakeStorage();

  const loaded = await loadCommitHistory(view.container, {
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.includes("/removed-repo/")) return makeResponse({ status: 404 });
      return makeResponse({ payload: url.includes("author=") ? [] : [makeCommit()] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  const { list, loading, error, empty } = view;
  assertOnlyVisible({ list, loading, error, empty }, "list");
  assert.equal(requests.filter((url) => url.includes("/removed-repo/")).length, 1);
  assert.equal(requests.filter((url) => !url.includes("author=")).length, 1);
  assert.equal(hasRecentFailure(getFailureKey(OWNER, 1), storage, NOW), true);
});

test("combines author-filtered results with another repository's fallback", async () => {
  const otherRepository = { name: "other-repo", url: `https://github.com/${OWNER}/other-repo` };
  const view = makeContainer({ repositories: [REPOSITORY, otherRepository], limit: 2 });

  const loaded = await loadCommitHistory(view.container, {
    fetchImpl: async (url) => {
      if (url.includes("/other-repo/")) {
        return makeResponse({ payload: url.includes("author=") ? [] : [makeCommit({ repo: otherRepository })] });
      }
      return makeResponse({ payload: [makeCommit({ committedAt: "2026-08-22T00:00:00Z" })] });
    },
    storage: new FakeStorage(),
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.deepEqual(view.items.map((item) => item.querySelector("[data-commit-history-repo]").textContent), [otherRepository.name, REPOSITORY.name]);
});

test("excludes confirmed missing repositories without defeating cache freshness", async () => {
  const missingRepository = { name: "removed-repo", url: `https://github.com/${OWNER}/removed-repo` };
  const repositories = [REPOSITORY, missingRepository];
  const storage = new FakeStorage();
  const requests = [];
  let catalogueCalls = 0;
  const options = {
    fetchImpl: async (url) => {
      requests.push(url);
      assert.equal(url.includes("/removed-repo/"), false);
      return makeResponse({ payload: [makeCommit()] });
    },
    getCatalogueImpl: async () => {
      catalogueCalls += 1;
      return {
        validated: true,
        complete: true,
        repositories: { [REPOSITORY.name]: { archived: false, fork: false, pushedAt: "2026-08-23T00:00:00.000Z" } },
      };
    },
    storage,
    now: NOW,
    logger: silentLogger,
  };

  assert.equal(await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, options), true);
  assert.equal(await loadCommitHistory(makeContainer({ repositories, limit: 1 }).container, { ...options, now: NOW + 1 }), true);
  assert.equal(requests.length, 1);
  assert.equal(catalogueCalls, 1);
  assert.equal(readCache(getStorageKey(OWNER, 1), repositories, storage, NOW).isFresh, true);
});

test("revalidates stale repository entries with ETags", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
  writeCache(
    key,
    {
      fetchedAt: NOW - CACHE_TTL_MS,
      mode: AUTHOR_MODE,
      repoNames: [REPOSITORY.name],
      repositories: {
        [REPOSITORY.name]: { etag: '"old-etag"', commits: [commit] },
      },
    },
    storage
  );

  let options;
  await loadCommitHistory(makeContainer({ limit: 1 }).container, {
    fetchImpl: async (_url, requestOptions) => {
      options = requestOptions;
      return makeResponse({ status: 304 });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(options.headers["If-None-Match"], '"old-etag"');
  assert.equal(JSON.parse(storage.getItem(key)).fetchedAt, NOW);
});

test("keeps each repository's mode and ETag during mixed-source revalidation", async () => {
  const other = { name: "other-repo", url: `https://github.com/${OWNER}/other-repo` };
  const repositories = [REPOSITORY, other];
  const storage = new FakeStorage();
  const firstRequests = [];
  await loadCommitHistory(makeContainer({ repositories }).container, {
    fetchImpl: async (url, { headers }) => {
      firstRequests.push(url);
      assert.equal(headers["If-None-Match"], undefined);
      if (url.includes("/other-repo/")) {
        return makeResponse({
          payload: url.includes("author=") ? [] : [makeCommit({ repo: other })],
          etag: url.includes("author=") ? '"empty-author"' : '"linked"',
        });
      }
      return makeResponse({ payload: [makeCommit()], etag: '"author"' });
    },
    storage, now: NOW, logger: silentLogger,
  });
  assert.equal(firstRequests.length, 3);
  const saved = readCache(getStorageKey(OWNER, 2), repositories, storage, NOW);
  assert.equal(saved.repositories[REPOSITORY.name].mode, AUTHOR_MODE);
  assert.equal(saved.repositories[other.name].mode, LINKED_AUTHOR_MODE);

  const requests = [];
  const view = makeContainer({ repositories });
  const loaded = await loadCommitHistory(view.container, {
    fetchImpl: async (url, { headers }) => {
      requests.push({ url, etag: headers["If-None-Match"] });
      return makeResponse({ status: 304 });
    },
    storage, now: NOW + CACHE_TTL_MS, logger: silentLogger,
  });
  assert.equal(loaded, true);
  assert.deepEqual(requests, [
    { url: buildCommitListUrl(REPOSITORY.name, OWNER, 2, AUTHOR_MODE), etag: '"author"' },
    { url: buildCommitListUrl(other.name, OWNER, 2, LINKED_AUTHOR_MODE), etag: '"linked"' },
  ]);
  assert.equal(view.items.filter(isVisible).length, 2);
});

test("retains repositories absent from incomplete, old or unavailable catalogues", async () => {
  const catalogues = [
    { validated: true, complete: false, repositories: {} },
    { validated: true, repositories: {} },
    { validated: false, complete: true, repositories: {} },
    null,
  ];
  for (const catalogue of catalogues) {
    let requests = 0;
    const loaded = await loadCommitHistory(makeContainer({ limit: 1 }).container, {
      fetchImpl: async () => {
        requests += 1;
        return makeResponse({ payload: [makeCommit()] });
      },
      getCatalogueImpl: async () => catalogue,
      storage: new FakeStorage(), now: NOW, logger: silentLogger,
    });
    assert.equal(loaded, true);
    assert.equal(requests, 1);
  }
});

test("reconsiders missing, archived and forked repositories after cache expiry", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  let catalogue = { validated: true, complete: true, repositories: {} };
  let requests = 0;
  const options = {
    fetchImpl: async () => {
      requests += 1;
      return makeResponse({ payload: [makeCommit()] });
    },
    getCatalogueImpl: async () => catalogue,
    storage, now: NOW, logger: silentLogger,
  };
  for (const excludedEntry of [null, { archived: true }, { fork: true }]) {
    storage.removeItem(key);
    requests = 0;
    catalogue.repositories = excludedEntry ? { [REPOSITORY.name]: excludedEntry } : {};
    const first = makeContainer({ limit: 1 });
    assert.equal(await loadCommitHistory(first.container, options), true);
    assert.equal(isVisible(first.empty), true);
    assert.equal(requests, 0);
    assert.deepEqual(readCache(key, [REPOSITORY], storage, NOW).excludedRepoNames, [REPOSITORY.name]);

    catalogue.repositories = { [REPOSITORY.name]: { archived: false, fork: false } };
    assert.equal(await loadCommitHistory(makeContainer({ limit: 1 }).container, {
      ...options, now: NOW + CACHE_TTL_MS,
    }), true);
    assert.equal(requests, 1);
    assert.deepEqual(readCache(key, [REPOSITORY], storage, NOW + CACHE_TTL_MS).excludedRepoNames, []);
  }
});

test("migrates all legacy caches and retries despite their old failure records", async () => {
  const legacyKeys = [
    [`github-activity:v2:${OWNER}:commits:limit:1`, `github-activity:v2:failure:${OWNER}:commits:limit:1`],
    [`github-activity:v1:${OWNER}:commits:limit:1`, `github-activity:v1:failure:${OWNER}:commits:limit:1`],
    [`commit-history:v1:${OWNER}:limit:1`, `commit-history:v1:failure:${OWNER}:limit:1`],
  ];
  for (const [dataKey, failureKey] of legacyKeys) {
    for (const mode of [AUTHOR_MODE, LINKED_AUTHOR_MODE]) {
      const storage = new FakeStorage();
      const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
      writeCache(dataKey, {
        fetchedAt: NOW,
        mode,
        repoNames: [REPOSITORY.name],
        repositories: { [REPOSITORY.name]: { mode, commits: [commit], etag: '"legacy"', pushedAt: "2026-08-23T00:00:00.000Z" } },
      }, storage);
      writeFailure(failureKey, storage, NOW);
      const requests = [];
      const options = {
        fetchImpl: async (url, { headers }) => {
          requests.push(url);
          assert.equal(headers["If-None-Match"], undefined);
          return makeResponse({ payload: [makeCommit({ sha: "refreshed" })] });
        },
        getCatalogueImpl: async () => ({
          validated: true, complete: true,
          repositories: { [REPOSITORY.name]: { pushedAt: "2026-08-23T00:00:00.000Z" } },
        }),
        storage, now: NOW, logger: silentLogger,
      };
      assert.equal(await loadCommitHistory(makeContainer({ limit: 1 }).container, options), true);
      assert.deepEqual(requests, [buildCommitListUrl(REPOSITORY.name, OWNER, 1, mode)]);
      assert.equal(storage.getItem(dataKey), null);
      assert.equal(storage.getItem(failureKey), null);
      const migrated = readCache(getStorageKey(OWNER, 1), [REPOSITORY], storage, NOW);
      assert.equal(migrated.repositories[REPOSITORY.name].commits[0].sha, "refreshed");
      assert.equal(migrated.isFresh, true);
      await loadCommitHistory(makeContainer({ limit: 1 }).container, { ...options, now: NOW + 1 });
      assert.equal(requests.length, 1);
    }
  }
});

test("preserves migrated commits when their first refresh fails", async () => {
  const storage = new FakeStorage();
  const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
  writeCache(`github-activity:v1:${OWNER}:commits:limit:1`, {
    fetchedAt: NOW, mode: AUTHOR_MODE, repoNames: [REPOSITORY.name],
    repositories: { [REPOSITORY.name]: { commits: [commit], etag: '"legacy"' } },
  }, storage);
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: async () => makeResponse({ status: 500 }),
    storage, now: NOW, logger: silentLogger,
  }), true);
  assert.equal(isVisible(view.list), true);
  assert.equal(readCache(getStorageKey(OWNER, 1), [REPOSITORY], storage, NOW).isFresh, false);
  assert.equal(hasRecentFailure(getFailureKey(OWNER, 1), storage, NOW), true);
});

test("retains global rate-limit protection when replacing old commit failures", async () => {
  const storage = new FakeStorage();
  const globalKey = githubActivity.shared.getGlobalFailureKey(OWNER);
  githubActivity.shared.writeFailure(globalKey, storage, NOW, "rate-limit");
  writeFailure(`github-activity:v1:failure:${OWNER}:commits:limit:1`, storage, NOW);
  let requests = 0;
  const coordinator = createRequestCoordinator({
    owner: OWNER, storage, now: () => NOW,
    fetchImpl: async () => {
      requests += 1;
      return makeResponse({ payload: [makeCommit()] });
    },
  });
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: coordinator.fetch, storage, now: NOW, logger: silentLogger,
  }), false);
  assert.equal(requests, 0);
  assert.equal(isVisible(view.error), true);
  assert.equal(githubActivity.shared.hasRecentFailure(globalKey, storage, NOW), true);
});

test("skips commit requests when the repository has not been pushed", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const pushedAt = "2026-08-22T12:00:00.000Z";
  const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
  writeCache(
    key,
    {
      fetchedAt: NOW - CACHE_TTL_MS,
      mode: AUTHOR_MODE,
      repoNames: [REPOSITORY.name],
      repositories: {
        [REPOSITORY.name]: {
          etag: '"old-etag"',
          commits: [commit],
          pushedAt,
        },
      },
    },
    storage
  );

  let fetchCalls = 0;
  let catalogueWasForced = false;
  const loaded = await loadCommitHistory(makeContainer({ limit: 1 }).container, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected commit request");
    },
    getCatalogueImpl: async (force) => {
      catalogueWasForced = force;
      return {
        repositories: {
          [REPOSITORY.name]: {
            archived: false,
            fork: false,
            pushedAt,
            url: REPOSITORY.url,
          },
        },
        validated: true,
      };
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(catalogueWasForced, true);
  assert.equal(fetchCalls, 0);
  assert.equal(JSON.parse(storage.getItem(key)).fetchedAt, NOW);
});

test("keeps stale commits visible throughout a failed refresh", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const failureKey = getFailureKey(OWNER, 1);
  const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
  writeCache(
    key,
    {
      fetchedAt: 1,
      mode: AUTHOR_MODE,
      repoNames: [REPOSITORY.name],
      repositories: { [REPOSITORY.name]: { etag: "", commits: [commit] } },
    },
    storage
  );

  let calls = 0;
  const coordinator = createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => NOW,
    requestTimeoutMs: 10,
    fetchImpl: () => {
      calls += 1;
      return new Promise(() => {});
    },
  });
  const fetchImpl = coordinator.fetch;
  const first = makeContainer({ limit: 1 });
  const refresh = loadCommitHistory(first.container, {
    fetchImpl,
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assertOnlyVisible(
    {
      list: first.list,
      loading: first.loading,
      error: first.error,
      empty: first.empty,
    },
    "list"
  );
  assert.equal(first.items[0].attributes.has("hidden"), false);

  assert.equal(await refresh, true);
  assertOnlyVisible(
    {
      list: first.list,
      loading: first.loading,
      error: first.error,
      empty: first.empty,
    },
    "list"
  );
  assert.equal(first.items[0].attributes.has("hidden"), false);

  const duringBackoff = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(duringBackoff.container, {
    fetchImpl,
    storage,
    now: NOW + githubActivity.shared.TRANSIENT_FAILURE_TTL_MS - 1,
    logger: silentLogger,
  }), true);

  assert.equal(calls, 1);
  assertOnlyVisible(
    {
      list: duringBackoff.list,
      loading: duringBackoff.loading,
      error: duringBackoff.error,
      empty: duringBackoff.empty,
    },
    "list"
  );
  assert.equal(hasRecentFailure(failureKey, storage, NOW + githubActivity.shared.TRANSIENT_FAILURE_TTL_MS - 1), true);
  assert.equal(readCache(key, [REPOSITORY], storage, NOW).repositories[REPOSITORY.name].commits.length, 1);
});

test("keeps a cached empty result visible throughout a failed refresh", async () => {
  const storage = new FakeStorage();
  writeCache(
    getStorageKey(OWNER, 1),
    {
      fetchedAt: 1,
      mode: AUTHOR_MODE,
      repoNames: [REPOSITORY.name],
      repositories: { [REPOSITORY.name]: { etag: "", commits: [] } },
    },
    storage
  );
  const view = makeContainer({ limit: 1 });

  const refresh = loadCommitHistory(view.container, {
    fetchImpl: async () => {
      throw new Error("offline");
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assertOnlyVisible(
    {
      list: view.list,
      loading: view.loading,
      error: view.error,
      empty: view.empty,
    },
    "empty"
  );
  assert.equal(await refresh, true);
  assertOnlyVisible(
    {
      list: view.list,
      loading: view.loading,
      error: view.error,
      empty: view.empty,
    },
    "empty"
  );
});

test("preserves a complete author-mode empty cache when linked fallback fails", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  writeCache(
    storageKey,
    {
      fetchedAt: NOW - CACHE_TTL_MS,
      mode: AUTHOR_MODE,
      repoNames: [REPOSITORY.name],
      repositories: { [REPOSITORY.name]: { etag: '"old-etag"', commits: [] } },
    },
    storage
  );
  const first = makeContainer({ limit: 1 });
  let calls = 0;

  const loaded = await loadCommitHistory(first.container, {
    fetchImpl: async (url) => {
      calls += 1;
      if (url.includes("author=lib-port")) {
        return makeResponse({ payload: [], etag: '"new-etag"' });
      }
      throw new Error("linked-author fallback unavailable");
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(calls, 2);
  assertOnlyVisible(
    {
      list: first.list,
      loading: first.loading,
      error: first.error,
      empty: first.empty,
    },
    "empty"
  );

  const cached = readCache(storageKey, [REPOSITORY], storage, NOW);
  assert.equal(cached.complete, true);
  assert.equal(cached.repositories[REPOSITORY.name].mode, AUTHOR_MODE);
  assert.deepEqual(cached.repositories[REPOSITORY.name].commits, []);

  const duringBackoff = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(duringBackoff.container, {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("failure backoff should avoid a request");
    },
    storage,
    now: NOW + 1,
    logger: silentLogger,
  }), true);
  assert.equal(calls, 2);
  assertOnlyVisible(
    {
      list: duringBackoff.list,
      loading: duringBackoff.loading,
      error: duringBackoff.error,
      empty: duringBackoff.empty,
    },
    "empty"
  );
});

test("shows the error state for invalid configuration and backoff without cache", async () => {
  const invalid = makeContainer({ limit: 1 });
  invalid.container.dataset.owner = "";
  let calls = 0;

  assert.equal(await loadCommitHistory(invalid.container, {
    fetchImpl: async () => {
      calls += 1;
      return makeResponse();
    },
    storage: new FakeStorage(),
    now: NOW,
    logger: silentLogger,
  }), false);
  assertOnlyVisible(
    {
      list: invalid.list,
      loading: invalid.loading,
      error: invalid.error,
      empty: invalid.empty,
    },
    "error"
  );

  const storage = new FakeStorage();
  writeFailure(getFailureKey(OWNER, 1), storage, NOW);
  const backedOff = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(backedOff.container, {
    fetchImpl: async () => {
      calls += 1;
      return makeResponse();
    },
    storage,
    now: NOW + 1,
    logger: silentLogger,
  }), false);
  assertOnlyVisible(
    {
      list: backedOff.list,
      loading: backedOff.loading,
      error: backedOff.error,
      empty: backedOff.empty,
    },
    "error"
  );
  assert.equal(calls, 0);
});

test("shows the error state when the Fetch API is unavailable", async () => {
  const storage = new FakeStorage();
  const view = makeContainer({ limit: 1 });

  assert.equal(await loadCommitHistory(view.container, {
    fetchImpl: null,
    storage,
    now: NOW,
    logger: silentLogger,
  }), false);
  assertOnlyVisible(
    {
      list: view.list,
      loading: view.loading,
      error: view.error,
      empty: view.empty,
    },
    "error"
  );
  assert.equal(
    hasRecentFailure(getFailureKey(OWNER, 1), storage, NOW),
    true
  );
});

test("deletes malformed, future-dated cache and failure records", () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const failureKey = getFailureKey(OWNER, 1);

  storage.setItem(key, JSON.stringify({ fetchedAt: NOW + 1 }));
  assert.equal(readCache(key, [REPOSITORY], storage, NOW), null);
  assert.equal(storage.getItem(key), null);

  writeFailure(failureKey, storage, NOW + 1);
  assert.equal(hasRecentFailure(failureKey, storage, NOW), false);
  assert.equal(storage.getItem(failureKey), null);
});

test("rejects malformed fallback page caches before using their ETags", () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const page = { page: 1, etag: '"page-one"', hasNext: false, commits: [] };
  const invalidEntries = [
    {},
    { pages: [] },
    { pages: [null] },
    { pages: [{ ...page, page: 2 }] },
    { pages: [{ ...page, hasNext: "false" }] },
    { pages: [{ ...page, commits: [{ sha: "invalid" }] }] },
    { pages: [page, { ...page, page: 2 }, { ...page, page: 3 }] },
    { pages: [page], deferred: "true" },
  ];
  for (const fields of invalidEntries) {
    writeCache(key, {
      fetchedAt: NOW, repoNames: [REPOSITORY.name],
      repositories: { [REPOSITORY.name]: { mode: LINKED_AUTHOR_MODE, commits: [], ...fields } },
    }, storage);
    assert.equal(readCache(key, [REPOSITORY], storage, NOW), null);
    assert.equal(storage.getItem(key), null);
  }
});

test("the unified controller selects commit-history containers", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /querySelectorAll\("\[data-commit-history\]"\)/);
  assert.match(source, /\[data-home-section="recent_commits"\]/);
});

test("a deadline preserves commit data and its last verified push state", async () => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const [commit] = normalizeApiCommits([makeCommit()], REPOSITORY, OWNER, 1);
  const pushedAt = "2026-08-01T00:00:00.000Z";
  writeCache(key, {
    fetchedAt: NOW - CACHE_TTL_MS, repoNames: [REPOSITORY.name],
    repositories: { [REPOSITORY.name]: { mode: AUTHOR_MODE, etag: '"cached"', commits: [commit], pushedAt } },
  }, storage);
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    storage, now: NOW, refreshTimeoutMs: 10,
    getCatalogueImpl: async () => ({ validated: true, complete: true, repositories: { [REPOSITORY.name]: { pushedAt: "2026-08-23T00:00:00.000Z" } } }),
    fetchImpl: () => new Promise(() => {}),
    logger: { error() { assert.fail("a deadline is not a failure"); } },
  }), true);
  const cached = readCache(key, [REPOSITORY], storage, NOW);
  assert.equal(cached.isFresh, true);
  assert.equal(cached.repositories[REPOSITORY.name].commits[0].sha, commit.sha);
  assert.equal(cached.repositories[REPOSITORY.name].pushedAt, pushedAt);
  assert.equal(cached.repositories[REPOSITORY.name].deferred, true);
  assert.equal(storage.getItem(getFailureKey(OWNER, 1)), null);
  assert.equal(view.container.hasAttribute("aria-busy"), false);
});

test("a deadline while validating the catalogue settles without starting commit requests", async () => {
  const storage = new FakeStorage();
  let calls = 0;
  const view = makeContainer({ limit: 1 });
  assert.equal(await loadCommitHistory(view.container, {
    storage, now: NOW, refreshTimeoutMs: 10,
    getCatalogueImpl: () => new Promise(() => {}),
    fetchImpl: async () => { calls += 1; return makeResponse(); },
    logger: { error() { assert.fail("a deadline is not a failure"); } },
  }), true);
  assert.equal(calls, 0);
  const entry = readCache(getStorageKey(OWNER, 1), [REPOSITORY], storage, NOW).repositories[REPOSITORY.name];
  assert.equal(entry.deferred, true);
  assert.equal(entry.pushedAt, "");
  assert.equal(storage.getItem(getFailureKey(OWNER, 1)), null);
});

test("displays cached commits before a browser lock and renders storage updates directly", async t => {
  const storage = new FakeStorage();
  const key = getStorageKey(OWNER, 1);
  const view = makeContainer({ limit: 1 });
  const writeResult = (timestamp, sha) => {
    const commits = normalizeApiCommits([makeCommit({ sha })], REPOSITORY, OWNER, 1);
    writeCache(key, { fetchedAt: timestamp, repoNames: [REPOSITORY.name], repositories: { [REPOSITORY.name]: { mode: AUTHOR_MODE, etag: "", commits } } }, storage);
  };
  writeResult(NOW - CACHE_TTL_MS, "cached");
  let release;
  let task;
  let locks = 0;
  let fetches = 0;
  let storageEvent;
  let activate;
  const gate = new Promise(resolve => { release = resolve; });
  const instance = githubActivity.controller.createController({
    documentImpl: {
      querySelector() { return { textContent: JSON.stringify({ owner: OWNER, repositoryUpdates: false, repositories: [REPOSITORY], commitLimit: 1, milestones: null }) }; },
      querySelectorAll(selector) { assert.equal(selector, "[data-commit-history]"); return [view.container]; },
    },
    windowImpl: { addEventListener(_name, listener) { storageEvent = listener; }, removeEventListener() {} },
    observerFactory: callback => { activate = () => callback([{ isIntersecting: true }]); return { observe() {}, disconnect() {} }; },
    locks: { request(name, callback) {
      assert.equal(name, `github-activity:${OWNER}:commits`);
      locks += 1; task = gate.then(callback); return task;
    } },
    storage, now: () => NOW, logger: silentLogger,
    fetchImpl: async () => { fetches += 1; return makeResponse(); },
  });
  t.after(() => instance.destroy());
  instance.start();
  storageEvent({ key, newValue: storage.getItem(key) });
  assert.equal(isVisible(view.list), false);
  activate();
  assert.equal(isVisible(view.list), true);
  assert.equal(locks, 1);
  assert.equal(fetches, 0);
  writeResult(NOW - CACHE_TTL_MS, "other-tab");
  const snapshot = storage.getItem(key);
  storageEvent({ key, newValue: snapshot });
  assert.match(view.items[0].querySelector("[data-commit-history-message]").href, /other-tab$/);
  assert.equal(locks, 1);
  assert.equal(fetches, 0);
  assert.equal(storage.getItem(key), snapshot);
  assert.equal(storage.getItem(getFailureKey(OWNER, 1)), null);
  writeResult(NOW, "fresh-from-other-tab");
  release();
  assert.equal(await task, true);
  assert.equal(fetches, 0);
});
