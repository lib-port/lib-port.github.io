"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "assets", "js", "github_activity.js");
const { controller, recentCommits, shared } = require(scriptPath);

const OWNER = "lib-port";
const REPOSITORIES = [
  { name: "alpha", url: "https://github.com/lib-port/alpha" },
  { name: "beta", url: "https://github.com/lib-port/beta" },
];

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

function makeConfigElement(value) {
  return { textContent: JSON.stringify(value) };
}

function makeDocument(value) {
  return {
    querySelector(selector) {
      assert.equal(selector, "[data-github-activity-config]");
      return value === null ? null : makeConfigElement(value);
    },
  };
}

function makeResponse(status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    clone() {
      return makeResponse(status);
    },
  };
}

test("reads enabled features from the single page configuration", () => {
  assert.deepEqual(
    controller.readPageConfiguration(
      makeDocument({
        owner: OWNER,
        repositoryUpdates: true,
        repositories: REPOSITORIES,
        commitLimit: 5,
        milestones: { limit: 2, repositories: ["alpha"] },
      })
    ),
    {
      owner: OWNER,
      repositoryUpdates: true,
      repositories: REPOSITORIES,
      commits: { owner: OWNER, repositories: REPOSITORIES, limit: 5 },
      milestones: { owner: OWNER, repositories: ["alpha"], limit: 2 },
    }
  );
});

test("represents disabled commit and milestone sections without work", () => {
  assert.deepEqual(
    controller.readPageConfiguration(
      makeDocument({
        owner: OWNER,
        repositoryUpdates: false,
        repositories: [],
        commitLimit: null,
        milestones: null,
      })
    ),
    {
      owner: OWNER,
      repositoryUpdates: false,
      repositories: [],
      commits: null,
      milestones: null,
    }
  );
  assert.equal(controller.readPageConfiguration(makeDocument(null)), null);
});

test("does not inspect or start disabled GitHub features", () => {
  let featureQueries = 0;
  const documentImpl = {
    querySelector(selector) {
      assert.equal(selector, "[data-github-activity-config]");
      return makeConfigElement({
        owner: OWNER,
        repositoryUpdates: false,
        repositories: [],
        commitLimit: null,
        milestones: null,
      });
    },
    querySelectorAll() {
      featureQueries += 1;
      return [];
    },
  };

  assert.equal(
    controller.createController({ documentImpl, windowImpl: null }).start(),
    true
  );
  assert.equal(featureQueries, 0);
});

test("rejects malformed page configuration", () => {
  assert.equal(
    controller.readPageConfiguration(
      makeDocument({
        owner: OWNER,
        repositoryUpdates: false,
        repositories: REPOSITORIES,
        commitLimit: 11,
        milestones: null,
      })
    ),
    null
  );
  assert.equal(
    controller.readPageConfiguration(
      makeDocument({
        owner: OWNER,
        repositoryUpdates: false,
        repositories: REPOSITORIES,
        commitLimit: null,
        milestones: { limit: 1, repositories: [] },
      })
    ),
    null
  );
});

test("defers a task until its section is near the viewport", () => {
  let callback;
  let disconnected = false;
  let observed = null;
  let runs = 0;
  const target = {};
  const schedule = controller.scheduleNearViewport(
    target,
    () => {
      runs += 1;
    },
    (observerCallback, options) => {
      callback = observerCallback;
      assert.deepEqual(options, { rootMargin: controller.OBSERVER_MARGIN });
      return {
        disconnect() {
          disconnected = true;
        },
        observe(value) {
          observed = value;
        },
      };
    }
  );

  assert.equal(observed, target);
  assert.equal(runs, 0);
  callback([{ isIntersecting: false }]);
  assert.equal(runs, 0);
  callback([{ isIntersecting: true }]);
  callback([{ isIntersecting: true }]);
  assert.equal(runs, 1);
  assert.equal(disconnected, true);
  schedule.disconnect();
});

test("runs immediately when viewport observation is unavailable", () => {
  let runs = 0;
  controller.scheduleNearViewport({}, () => {
    runs += 1;
  });
  assert.equal(runs, 1);
});

test("deduplicates identical in-flight GitHub requests", async () => {
  const storage = new FakeStorage();
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    fetchImpl: async () => {
      calls += 1;
      return makeResponse();
    },
  });

  const [first, second] = await Promise.all([
    coordinator.fetch("https://api.github.com/example"),
    coordinator.fetch("https://api.github.com/example"),
  ]);

  assert.equal(calls, 1);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first, second);
});

test("limits concurrent GitHub requests", async () => {
  const storage = new FakeStorage();
  const pendingResponses = [];
  let active = 0;
  let peak = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    maxConcurrent: 2,
    fetchImpl: () => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise((resolve) => {
        pendingResponses.push(() => {
          active -= 1;
          resolve(makeResponse());
        });
      });
    },
  });

  const requests = Array.from({ length: 5 }, (_value, index) =>
    coordinator.fetch(`https://api.github.com/example/${index}`)
  );
  assert.equal(pendingResponses.length, 2);
  assert.equal(coordinator.queuedCount, 3);

  while (pendingResponses.length > 0) {
    pendingResponses.shift()();
    await new Promise((resolve) => setImmediate(resolve));
  }
  await Promise.all(requests);

  assert.equal(peak, 2);
});

test("pauses new requests after GitHub signals a rate limit", async () => {
  const storage = new FakeStorage();
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => 1000,
    fetchImpl: async () => {
      calls += 1;
      return makeResponse(429);
    },
  });

  assert.equal(
    (await coordinator.fetch("https://api.github.com/rate-limited")).status,
    429
  );
  await assert.rejects(
    coordinator.fetch("https://api.github.com/paused"),
    /temporarily paused/
  );
  assert.equal(calls, 1);
  assert.equal(
    shared.hasRecentFailure(shared.getGlobalFailureKey(OWNER), storage, 1000),
    true
  );
});

test("selects only repositories whose push state changed", () => {
  const cached = {
    alpha: { pushedAt: "2026-08-01T00:00:00.000Z" },
    beta: { pushedAt: "2026-08-01T00:00:00.000Z" },
  };
  const catalogue = {
    validated: true,
    repositories: {
      alpha: { pushedAt: "2026-08-01T00:00:00.000Z" },
      beta: { pushedAt: "2026-08-02T00:00:00.000Z" },
    },
  };

  assert.deepEqual(
    recentCommits
      .selectRepositoriesToFetch(REPOSITORIES, cached, catalogue)
      .map(({ name }) => name),
    ["beta"]
  );
  assert.deepEqual(
    recentCommits
      .selectRepositoriesToFetch(REPOSITORIES, cached, {
        ...catalogue,
        validated: false,
      })
      .map(({ name }) => name),
    ["alpha", "beta"]
  );
});
