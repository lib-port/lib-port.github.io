"use strict";

const { clientAssetPath } = require("./client_assets");

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const scriptPath = path.join(__dirname, "..", "assets", "js", "github_activity.js");
const { controller, recentCommits, shared } = require(clientAssetPath(scriptPath));

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

function makeResponse(status = 200, payload = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get(name) { return headers[name.toLowerCase()] ?? null; } },
    async json() {
      return payload;
    },
    clone() {
      return makeResponse(status, payload, headers);
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
  assert.equal(storage.getItem(shared.getGlobalFailureKey(OWNER)), null);
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

test("a network failure does not pause other sections", async () => {
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
    false
  );
  assert.equal((await coordinator.fetch("https://api.github.com/another-section")).status, 200);
  assert.equal(calls, 3);
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

test("reserves the 40-request visit budget before queueing and shares deduplicated reservations", async () => {
  let calls = 0;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(),
    fetchImpl: async () => { calls += 1; return makeResponse(); },
  });
  const requests = Array.from({ length: 40 }, (_, index) =>
    coordinator.fetch(`https://api.github.com/budget/${index}`)
  );
  const duplicate = coordinator.fetch("https://api.github.com/budget/0");
  assert.equal(shared.MAX_REQUESTS, 40);
  assert.equal(coordinator.issuedCount, 4);
  assert.equal(coordinator.reservedCount, 36);
  assert.equal(coordinator.queuedCount, 36);
  await assert.rejects(coordinator.fetch("https://api.github.com/over-budget"),
    error => shared.isDeferred(error) && error.reason === "budget");
  await Promise.all([...requests, duplicate]);
  assert.equal(calls, 40);
  assert.equal(coordinator.issuedCount, 40);
  assert.equal(coordinator.reservedCount, 0);
});

test("queued first pages run before extra pages", async () => {
  const gate = makeDeferred();
  const calls = [];
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(), maxConcurrent: 1,
    fetchImpl: async url => {
      calls.push(url);
      return url === "busy" ? gate.promise : makeResponse();
    },
  });
  const requests = [
    coordinator.fetch("busy"),
    coordinator.fetch("second-page", {}, { priority: 1 }),
    coordinator.fetch("first-page"),
  ];
  gate.resolve(makeResponse());
  await Promise.all(requests);
  assert.deepEqual(calls, ["busy", "first-page", "second-page"]);
});

test("cancelling a queued request releases its unused budget reservation", async () => {
  const gate = makeDeferred();
  const abort = new AbortController();
  const calls = [];
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(), maxConcurrent: 1, maxRequests: 2,
    fetchImpl: async url => { calls.push(url); return url === "busy" ? gate.promise : makeResponse(); },
  });
  const first = coordinator.fetch("busy");
  const queued = coordinator.fetch("cancelled", { signal: abort.signal });
  abort.abort(shared.createDeferredError("deadline"));
  await assert.rejects(queued, shared.isDeferred);
  assert.equal(coordinator.reservedCount, 0);
  const replacement = coordinator.fetch("replacement");
  assert.equal(coordinator.reservedCount, 1);
  gate.resolve(makeResponse());
  await Promise.all([first, replacement]);
  assert.deepEqual(calls, ["busy", "replacement"]);
  assert.equal(coordinator.issuedCount, 2);
});

test("cancelling one deduplicated consumer keeps the other request alive", async () => {
  const gate = makeDeferred();
  const abort = new AbortController();
  let signal;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(),
    fetchImpl: (_url, options) => { signal = options.signal; return gate.promise; },
  });
  const first = coordinator.fetch("shared", { signal: abort.signal });
  const second = coordinator.fetch("shared");
  await Promise.resolve();
  abort.abort(shared.createDeferredError("deadline"));
  await assert.rejects(first, shared.isDeferred);
  assert.equal(signal.aborted, false);
  gate.resolve(makeResponse(200, { alive: true }));
  assert.deepEqual(await (await second).json(), { alive: true });
  assert.equal(coordinator.issuedCount, 1);
});

test("a section deadline cancels its queued and active requests without recording failures", async () => {
  const storage = new FakeStorage();
  let signal;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage, maxConcurrent: 1,
    fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); },
  });
  const refresh = shared.createRefresh(coordinator.fetch, { timeoutMs: 10 });
  try {
    const result = await Promise.allSettled([refresh.fetch("active"), refresh.fetch("queued")]);
    assert.ok(result.every(value => value.status === "rejected" && shared.isDeferred(value.reason)));
    assert.equal(signal.aborted, true);
    assert.equal(coordinator.activeCount, 0);
    assert.equal(coordinator.queuedCount, 0);
    assert.equal(coordinator.reservedCount, 0);
    assert.equal(coordinator.issuedCount, 1);
    assert.equal(storage.getItem(shared.getGlobalFailureKey(OWNER)), null);
  } finally { refresh.close(); }
});

test("a section deadline does not abort a shared request with another live consumer", async () => {
  const gate = makeDeferred();
  let signal;
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(),
    fetchImpl: (_url, options) => { signal = options.signal; return gate.promise; },
  });
  const refresh = shared.createRefresh(coordinator.fetch, { timeoutMs: 10 });
  try {
    const expired = refresh.fetch("shared");
    const live = coordinator.fetch("shared");
    await assert.rejects(expired, error => shared.isDeferred(error) && error.reason === "deadline");
    assert.equal(signal.aborted, false);
    gate.resolve(makeResponse());
    assert.equal((await live).status, 200);
  } finally { refresh.close(); }
});

test("refreshes honour caller cancellation as well as their own deadline", async () => {
  const caller = new AbortController();
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage: new FakeStorage(), fetchImpl: () => new Promise(() => {}),
  });
  const refresh = shared.createRefresh(coordinator.fetch);
  try {
    const request = refresh.fetch("cancelled", { signal: caller.signal });
    caller.abort(new Error("caller cancelled"));
    await assert.rejects(request, /caller cancelled/);
    assert.equal(coordinator.activeCount, 0);
  } finally { refresh.close(); }
});

test("section deadlines settle even when a raw fetch ignores cancellation", async () => {
  const refresh = shared.createRefresh(() => new Promise(() => {}), { timeoutMs: 10 });
  try {
    assert.equal(shared.SECTION_TIMEOUT_MS, 30_000);
    await assert.rejects(refresh.fetch("hung"), shared.isDeferred);
    await assert.rejects(refresh.fetch("already-expired"), shared.isDeferred);
  } finally { refresh.close(); }
});

for (const example of [
  { name: "Retry-After seconds", status: 429, headers: { "retry-after": "120" }, delay: 120_000 },
  { name: "Retry-After date", status: 429, headers: { "retry-after": "Thu, 01 Oct 2026 12:02:00 GMT" }, delay: 120_000 },
  { name: "primary reset time", status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Date.parse("2026-10-01T12:03:00Z") / 1000) }, delay: 180_000 },
  { name: "secondary rate-limit message", status: 403, payload: { message: "You have exceeded a secondary rate limit." }, headers: {}, delay: 60_000 },
]) {
  test(`global rate-limit protection respects ${example.name}`, async () => {
    const start = Date.parse("2026-10-01T12:00:00Z");
    let now = start;
    let calls = 0;
    const storage = new FakeStorage();
    const coordinator = shared.createRequestCoordinator({
      owner: OWNER, storage, now: () => now,
      fetchImpl: async () => ++calls === 1
        ? makeResponse(example.status, example.payload, example.headers) : makeResponse(),
    });
    const response = await coordinator.fetch("limited");
    const error = shared.createHttpError(response, "test", start);
    assert.equal(error.kind, "rate-limit");
    assert.equal(error.retryAt, start + example.delay);
    assert.equal(JSON.parse(storage.getItem(shared.getGlobalFailureKey(OWNER))).retryAt, error.retryAt);
    now = start + example.delay - 1;
    await assert.rejects(coordinator.fetch("paused"), /temporarily paused/);
    now += 1;
    assert.equal((await coordinator.fetch("retry")).status, 200);
    assert.equal(calls, 2);
  });
}

test("permission errors and server failures do not create an owner-wide pause", async () => {
  const storage = new FakeStorage();
  const coordinator = shared.createRequestCoordinator({
    owner: OWNER, storage,
    fetchImpl: async url => makeResponse(url === "forbidden" ? 403 : url === "server" ? 503 : 200),
  });
  assert.equal(shared.createHttpError(await coordinator.fetch("forbidden")).kind, "resource");
  assert.equal(shared.createHttpError(await coordinator.fetch("server")).kind, "transient");
  assert.equal((await coordinator.fetch("healthy")).status, 200);
  assert.equal(storage.getItem(shared.getGlobalFailureKey(OWNER)), null);
});

test("section failures use appropriate retry periods and ignore deferrals", () => {
  const storage = new FakeStorage();
  const now = 1000;
  shared.recordFailures("section", storage, now, [shared.createDeferredError("budget")]);
  assert.equal(storage.getItem("section"), null);
  shared.recordFailures("section", storage, now, [shared.createHttpError(makeResponse(503))]);
  assert.equal(JSON.parse(storage.getItem("section")).retryAt, now + 5 * 60 * 1000);
  assert.equal(shared.hasRecentFailure("section", storage, now + 5 * 60 * 1000), false);
  shared.recordFailures("section", storage, now, [shared.createHttpError(makeResponse(404))]);
  assert.equal(JSON.parse(storage.getItem("section")).retryAt, now + 6 * 60 * 60 * 1000);
});

test("retires legacy global transport failures while retaining rate-limit records", () => {
  for (const kind of ["network", "timeout", "unavailable", "rate-limit"]) {
    const storage = new FakeStorage();
    const key = shared.getGlobalFailureKey(OWNER);
    shared.writeFailure(key, storage, 1000, kind);
    shared.createRequestCoordinator({ owner: OWNER, storage, now: () => 2000 });
    assert.equal(shared.hasRecentFailure(key, storage, 2000), kind === "rate-limit");
    if (kind === "rate-limit") {
      assert.equal(shared.hasRecentFailure(key, storage, 1000 + shared.FAILURE_TTL_MS), false);
    }
  }
});
