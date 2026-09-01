"use strict";

process.env.TZ = "Australia/Sydney";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "assets", "js", "github_activity.js");
const githubActivity = require(scriptPath);
const {
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  formatPushedAt,
  getFailureKey,
  getStorageKey,
  loadOwnerUpdates,
  readCache,
  writeCache,
} = githubActivity.repositoryUpdates;
const { hasRecentFailure, writeFailure } = githubActivity.shared;

const OWNER = "libport";
const REPO_NAME = "example-repo";
const PUSHED_AT = "2026-08-02T23:00:00Z";
const NOW = Date.parse("2026-08-09T00:00:00Z");

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

function makeOwnerCards() {
  const classes = new Set();
  const textNode = { textContent: "" };
  const wrapper = {
    classList: {
      add(value) {
        classes.add(value);
      },
    },
  };

  return {
    classes,
    ownerCards: [{ repoName: REPO_NAME, wrapper, textNode }],
    textNode,
  };
}

function makeCatalogue(pushedAt = PUSHED_AT) {
  return {
    [REPO_NAME]: {
      archived: false,
      fork: false,
      pushedAt: new Date(pushedAt).toISOString(),
      url: `https://github.com/${OWNER}/${REPO_NAME}`,
    },
  };
}

function makeResponse({ status = 200, etag = '"etag-2"', repos = [] } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return name.toLowerCase() === "etag" ? etag : null;
      },
    },
    async json() {
      return repos.map((repository) => ({
        archived: false,
        fork: false,
        html_url: `https://github.com/${OWNER}/${repository.name}`,
        ...repository,
      }));
    },
  };
}

const silentLogger = { error() {} };

test("formats repository updates by the visitor's local calendar", () => {
  const now = new Date("2026-08-04T00:15:00+10:00");

  const cases = [
    ["2026-08-03T14:05:00Z", "updated today"],
    ["2026-08-02T23:00:00Z", "updated yesterday"],
    ["2026-08-01T23:00:00Z", "updated 2 days ago"],
    ["2026-07-28T23:00:00Z", "updated 6 days ago"],
    ["2026-07-27T23:00:00Z", "updated last week"],
    ["2026-07-21T23:00:00Z", "updated last week"],
    ["2026-07-20T23:00:00Z", "updated 2 weeks ago"],
    ["2026-07-07T23:00:00Z", "updated 3 weeks ago"],
    ["2026-07-06T23:00:00Z", "updated on 7 Jul"],
  ];

  for (const [timestamp, expected] of cases) {
    assert.equal(formatPushedAt(timestamp, now), expected, timestamp);
  }
});

test("uses an absolute date for a future calendar day", () => {
  const now = new Date("2026-08-04T12:00:00+10:00");

  assert.equal(formatPushedAt("2026-08-04T15:00:00Z", now), "updated on 5 Aug");
});

test("counts calendar days across a daylight-saving transition", () => {
  const now = new Date("2026-10-05T12:00:00+11:00");

  assert.equal(
    formatPushedAt("2026-10-03T12:00:00+10:00", now),
    "updated 2 days ago"
  );
});

test("chooses the displayed year from local dates", () => {
  const now = new Date("2026-02-05T12:00:00+11:00");

  assert.equal(formatPushedAt("2025-12-31T13:30:00Z", now), "updated on 1 Jan");
  assert.equal(
    formatPushedAt("2025-12-30T13:30:00Z", now),
    "updated on 31 Dec 2025"
  );
});

test("returns no label for invalid dates", () => {
  assert.equal(formatPushedAt("not-a-date", new Date()), "");
  assert.equal(formatPushedAt(new Date().toISOString(), new Date("not-a-date")), "");
});

test("keeps repository caches indefinitely but considers them fresh for seven days", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const repositories = makeCatalogue();

  assert.equal(CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  writeCache(storageKey, { etag: '"etag-1"', repositories }, storage, NOW);

  assert.equal(readCache(storageKey, storage, NOW + CACHE_TTL_MS - 1).isFresh, true);
  assert.equal(readCache(storageKey, storage, NOW + CACHE_TTL_MS).isFresh, false);
  assert.deepEqual(
    readCache(storageKey, storage, NOW + 365 * 24 * 60 * 60 * 1000).repositories,
    repositories
  );
  assert.ok(storage.getItem(storageKey));
});

test("deletes malformed and future-dated repository caches", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const invalidEntries = [
    "",
    "not json",
    "null",
    "false",
    "[]",
    JSON.stringify({ fetchedAt: NOW, repositories: [] }),
    JSON.stringify({ fetchedAt: "not-a-number", repositories: {} }),
    JSON.stringify({
      fetchedAt: NOW,
      repositories: { [REPO_NAME]: { pushedAt: "not-a-date" } },
    }),
    JSON.stringify({
      fetchedAt: NOW + 1,
      etag: '"etag-1"',
      repositories: makeCatalogue(),
    }),
  ];

  for (const invalidEntry of invalidEntries) {
    storage.setItem(storageKey, invalidEntry);
    assert.equal(readCache(storageKey, storage, NOW), null);
    assert.equal(storage.getItem(storageKey), null);
  }
});

test("renders a fresh cache without requesting GitHub", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const { classes, ownerCards, textNode } = makeOwnerCards();
  let fetchCalls = 0;

  writeCache(
    storageKey,
    { etag: '"etag-1"', repositories: makeCatalogue() },
    storage,
    NOW - CACHE_TTL_MS + 1
  );

  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(fetchCalls, 0);
  assert.equal(classes.has("is-visible"), true);
  assert.equal(textNode.textContent, formatPushedAt(PUSHED_AT));
});

test("revalidates a seven-day-old cache with its ETag", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const failureKey = getFailureKey(OWNER);
  const { ownerCards } = makeOwnerCards();
  let request;

  writeCache(
    storageKey,
    { etag: '"etag-1"', repositories: makeCatalogue() },
    storage,
    NOW - CACHE_TTL_MS
  );
  writeFailure(failureKey, storage, NOW - FAILURE_TTL_MS);

  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return makeResponse({ status: 304 });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(
    request.url,
    "https://api.github.com/users/libport/repos?per_page=100&sort=pushed&direction=desc&type=public"
  );
  assert.equal(request.options.headers["If-None-Match"], '"etag-1"');
  assert.equal(JSON.parse(storage.getItem(storageKey)).fetchedAt, NOW);
  assert.equal(storage.getItem(failureKey), null);
  assert.equal(readCache(storageKey, storage, NOW).isFresh, true);
});

test("replaces stale cache data and ETag after a successful response", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const { ownerCards, textNode } = makeOwnerCards();
  const replacementTimestamp = "2026-08-08T12:00:00Z";

  writeCache(
    storageKey,
    { etag: "", repositories: makeCatalogue() },
    storage,
    NOW - CACHE_TTL_MS
  );

  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl: async (_url, options) => {
      assert.equal("If-None-Match" in options.headers, false);
      return makeResponse({
        etag: '"etag-2"',
        repos: [{ name: REPO_NAME, pushed_at: replacementTimestamp }],
      });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.deepEqual(JSON.parse(storage.getItem(storageKey)), {
    etag: '"etag-2"',
    fetchedAt: NOW,
    repositories: makeCatalogue(replacementTimestamp),
  });
  assert.equal(textNode.textContent, formatPushedAt(replacementTimestamp));
});

test("retains stale data and backs off for six hours after a failed validation", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER);
  const failureKey = getFailureKey(OWNER);
  const { ownerCards, textNode } = makeOwnerCards();
  let fetchCalls = 0;

  writeCache(
    storageKey,
    { etag: '"etag-1"', repositories: makeCatalogue() },
    storage,
    NOW - 100 * CACHE_TTL_MS
  );

  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error("offline");
  };

  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl,
    storage,
    now: NOW,
    logger: silentLogger,
  });
  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl,
    storage,
    now: NOW + FAILURE_TTL_MS - 1,
    logger: silentLogger,
  });

  assert.equal(FAILURE_TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(fetchCalls, 1);
  assert.equal(textNode.textContent, formatPushedAt(PUSHED_AT));
  assert.ok(storage.getItem(storageKey));
  assert.equal(hasRecentFailure(failureKey, storage, NOW + FAILURE_TTL_MS - 1), true);
  assert.equal(hasRecentFailure(failureKey, storage, NOW + FAILURE_TTL_MS), false);
  assert.equal(storage.getItem(failureKey), null);
});

test("deletes malformed and future-dated failure records", () => {
  const storage = new FakeStorage();
  const failureKey = getFailureKey(OWNER);
  const invalidEntries = [
    "",
    "not json",
    "null",
    "false",
    "[]",
    JSON.stringify({ failedAt: "not-a-number" }),
    JSON.stringify({ failedAt: NOW + 1 }),
  ];

  for (const invalidEntry of invalidEntries) {
    storage.setItem(failureKey, invalidEntry);
    assert.equal(hasRecentFailure(failureKey, storage, NOW), false);
    assert.equal(storage.getItem(failureKey), null);
  }
});

test("loads from GitHub when local storage is unavailable", async () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
    removeItem() {
      throw new Error("storage disabled");
    },
  };
  const { ownerCards, textNode } = makeOwnerCards();
  let fetchCalls = 0;

  await loadOwnerUpdates(OWNER, ownerCards, {
    fetchImpl: async () => {
      fetchCalls += 1;
      return makeResponse({ repos: [{ name: REPO_NAME, pushed_at: PUSHED_AT }] });
    },
    storage: unavailableStorage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(fetchCalls, 1);
  assert.equal(textNode.textContent, formatPushedAt(PUSHED_AT));
});

test("starts the unified browser controller by reading its page configuration", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  let selector = "";

  vm.runInNewContext(source, {
    Date,
    Intl,
    console,
    document: {
      querySelector(value) {
        selector = value;
        return null;
      },
    },
  });

  assert.equal(selector, "[data-github-activity-config]");
});
