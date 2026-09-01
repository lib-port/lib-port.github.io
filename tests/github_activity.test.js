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

function makeResponse(status = 200, payload = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return payload;
    },
    clone() {
      return makeResponse(status, payload);
    },
  };
}

function makeDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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

test("observes concrete activity containers instead of their wrappers", () => {
  const observed = [];
  const revealed = [];
  const makeSection = (name) => ({
    removeAttribute(attribute) {
      revealed.push([name, attribute]);
    },
  });
  const milestoneSection = makeSection("milestones");
  const commitSection = makeSection("commits");
  const milestoneContainer = {
    closest(selector) {
      assert.equal(selector, '[data-home-section="recent_milestones"]');
      return milestoneSection;
    },
  };
  const commitContainer = {
    closest(selector) {
      assert.equal(selector, '[data-home-section="recent_commits"]');
      return commitSection;
    },
  };
  const documentImpl = {
    querySelector(selector) {
      assert.equal(selector, "[data-github-activity-config]");
      return makeConfigElement({
        owner: OWNER,
        repositoryUpdates: false,
        repositories: REPOSITORIES,
        commitLimit: 1,
        milestones: { limit: 1, repositories: ["alpha"] },
      });
    },
    querySelectorAll(selector) {
      if (selector === "[data-recent-milestones]") return [milestoneContainer];
      if (selector === "[data-commit-history]") return [commitContainer];
      assert.fail(`Unexpected selector: ${selector}`);
    },
  };

  const instance = controller.createController({
    documentImpl,
    observerFactory() {
      return {
        disconnect() {},
        observe(target) {
          observed.push(target);
        },
      };
    },
    windowImpl: null,
  });

  assert.equal(instance.start(), true);
  assert.deepEqual(observed, [milestoneContainer, commitContainer]);
  assert.deepEqual(revealed, [
    ["milestones", "hidden"],
    ["commits", "hidden"],
  ]);
  instance.destroy();
});

test("deduplicates identical in-flight GitHub requests", async () => {
  const storage = new FakeStorage();
  const payload = { repositories: 2 };
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    fetchImpl: async () => {
      calls += 1;
      return makeResponse(200, payload);
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
  assert.deepEqual(await first.json(), payload);
  assert.deepEqual(await second.json(), payload);
});

test("times out and aborts a GitHub request that never responds", async () => {
  const storage = new FakeStorage();
  let requestSignal;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => 1000,
    requestTimeoutMs: 10,
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    },
  });

  assert.equal(shared.REQUEST_TIMEOUT_MS, 15_000);
  await assert.rejects(
    coordinator.fetch("https://api.github.com/hung"),
    (error) => error.name === "TimeoutError"
  );
  assert.equal(requestSignal.aborted, true);
  assert.equal(coordinator.activeCount, 0);
  assert.equal(coordinator.queuedCount, 0);
  assert.equal(
    JSON.parse(storage.getItem(shared.getGlobalFailureKey(OWNER))).kind,
    "timeout"
  );
});

test("times out while reading a GitHub response body", async () => {
  const storage = new FakeStorage();
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => 1000,
    requestTimeoutMs: 10,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get() { return null; } },
      json: () => new Promise(() => {}),
    }),
  });

  await assert.rejects(
    coordinator.fetch("https://api.github.com/hung-body"),
    (error) => error.name === "TimeoutError"
  );
  assert.equal(coordinator.activeCount, 0);
});

test("preserves caller cancellation when coordinating a request", async () => {
  const storage = new FakeStorage();
  const callerController = new AbortController();
  let requestSignal;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    requestTimeoutMs: 1000,
    fetchImpl: (_url, options) => {
      requestSignal = options.signal;
      return new Promise((_resolve, reject) => {
        if (requestSignal.aborted) {
          reject(requestSignal.reason);
          return;
        }
        requestSignal.addEventListener(
          "abort",
          () => reject(requestSignal.reason),
          { once: true }
        );
      });
    },
  });

  const request = coordinator.fetch("https://api.github.com/cancelled", {
    signal: callerController.signal,
  });
  callerController.abort(new Error("cancelled by caller"));

  await assert.rejects(request, /cancelled by caller/);
  assert.equal(requestSignal.aborted, true);
  assert.equal(coordinator.activeCount, 0);
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
  await Promise.resolve();
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

test("retains a concurrent rate-limit failure after another request succeeds", async () => {
  const storage = new FakeStorage();
  const rateLimited = makeDeferred();
  const successful = makeDeferred();
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => 1000,
    fetchImpl: (url) => {
      calls += 1;
      return url.endsWith("rate-limited") ? rateLimited.promise : successful.promise;
    },
  });

  const rateLimitRequest = coordinator.fetch("https://api.github.com/rate-limited");
  const successfulRequest = coordinator.fetch("https://api.github.com/successful");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);

  rateLimited.resolve(makeResponse(429));
  assert.equal((await rateLimitRequest).status, 429);
  successful.resolve(makeResponse(200));
  assert.equal((await successfulRequest).status, 200);

  assert.equal(
    shared.hasRecentFailure(shared.getGlobalFailureKey(OWNER), storage, 1000),
    true
  );
  await assert.rejects(
    coordinator.fetch("https://api.github.com/paused"),
    /temporarily paused/
  );
  assert.equal(calls, 2);
});

test("retains a concurrent network failure after another request succeeds", async () => {
  const storage = new FakeStorage();
  const failed = makeDeferred();
  const successful = makeDeferred();
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER,
    storage,
    now: () => 1000,
    fetchImpl: (url) => {
      calls += 1;
      return url.endsWith("failed") ? failed.promise : successful.promise;
    },
  });

  const failedRequest = coordinator.fetch("https://api.github.com/failed");
  const successfulRequest = coordinator.fetch("https://api.github.com/successful");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);

  failed.reject(new Error("offline"));
  await assert.rejects(failedRequest, /offline/);
  successful.resolve(makeResponse(200));
  assert.equal((await successfulRequest).status, 200);

  assert.equal(
    shared.hasRecentFailure(shared.getGlobalFailureKey(OWNER), storage, 1000),
    true
  );
  await assert.rejects(
    coordinator.fetch("https://api.github.com/paused"),
    /temporarily paused/
  );
  assert.equal(calls, 2);
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
