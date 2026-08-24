"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(
  __dirname,
  "..",
  "assets",
  "js",
  "recent_milestones.js"
);
const {
  API_VERSION,
  CACHE_TTL_MS,
  FAILURE_TTL_MS,
  buildHeaders,
  buildClosedIssueActivityUrl,
  buildMilestoneUrl,
  calculatePercentage,
  fetchRepositoryClosedIssueActivity,
  formatDueDate,
  getFailureKey,
  getStorageKey,
  hasRecentFailure,
  loadRecentMilestones,
  mergeMilestones,
  normalizeClosedIssueActivity,
  normalizeRepositories,
  readCache,
  renderMilestones,
  writeCache,
} = require(scriptPath);

const OWNER = "lib-port";
const NOW = Date.parse("2026-08-24T12:00:00Z");

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
    this.dateTime = "";
    this.href = "";
    this.selectors = new Map();
    this.style = {};
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
  const selectors = [
    "[data-recent-milestone-title]",
    "[data-recent-milestone-repo]",
    "[data-recent-milestone-repo-name]",
    "[data-recent-milestone-description]",
    "[data-recent-milestone-due-detail]",
    "[data-recent-milestone-due]",
    "[data-recent-milestone-closed-total]",
    "[data-recent-milestone-progress]",
    "[data-recent-milestone-progress-value]",
    "[data-recent-milestone-percentage]",
    "[data-recent-milestone-latest-closed-issue]",
  ];
  for (const selector of selectors) {
    item.selectors.set(selector, new FakeElement());
  }
  return item;
}

function makeContainer({ limit = 2, repositories = ["tech-lib"] } = {}) {
  const container = new FakeElement();
  container.dataset.owner = OWNER;
  container.dataset.milestoneLimit = String(limit);

  const repositoryData = new FakeElement();
  repositoryData.textContent = JSON.stringify(repositories);
  const list = new FakeElement();
  list.setAttribute("hidden", "");
  const loading = new FakeElement();
  loading.textContent = "loading recent milestones";
  const error = new FakeElement();
  error.textContent = "unable to load recent milestones";
  error.setAttribute("hidden", "");
  const empty = new FakeElement();
  empty.textContent = "No open milestones with completed issues found";
  empty.setAttribute("hidden", "");
  const items = Array.from({ length: limit }, makeItem);

  container.selectors.set(
    "[data-recent-milestones-repositories]",
    repositoryData
  );
  container.selectors.set("[data-recent-milestones-list]", list);
  container.selectors.set("[data-recent-milestones-loading]", loading);
  container.selectors.set("[data-recent-milestones-error]", error);
  container.selectors.set("[data-recent-milestones-empty]", empty);
  container.selectors.set("[data-recent-milestone-item]", items);
  return { container, empty, error, items, list, loading };
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

function makeApiIssue({
  number = 1,
  title = "IBM AI Engineering PC",
  description = "Complete notes and projects.",
  openIssues = 3,
  closedIssues = 1,
  updatedAt = "2026-08-24T08:37:31Z",
  closedAt = "2026-08-24T08:00:00Z",
  issueNumber = 101,
  issueTitle = "Complete the current milestone task",
  issueUrl = `https://github.com/${OWNER}/tech-lib/issues/${issueNumber}`,
  milestoneUpdatedAt = "2026-08-01T00:00:00Z",
  dueOn = "2027-03-31T00:00:00Z",
  issueState = "closed",
  stateReason = "completed",
  milestoneState = "open",
  pullRequest = false,
} = {}) {
  const issue = {
    number: issueNumber,
    title: issueTitle,
    html_url: issueUrl,
    state: issueState,
    state_reason: stateReason,
    closed_at: closedAt,
    updated_at: updatedAt,
    milestone: {
      number,
      title,
      description,
      open_issues: openIssues,
      closed_issues: closedIssues,
      updated_at: milestoneUpdatedAt,
      due_on: dueOn,
      state: milestoneState,
    },
  };
  if (pullRequest) issue.pull_request = { url: "https://api.github.com/pulls/1" };
  return issue;
}

function makeNormalizedMilestone(repository = "tech-lib", overrides = {}) {
  return normalizeClosedIssueActivity([makeApiIssue(overrides)], repository)[0];
}

function makeEntry(repository = "tech-lib", milestones = null, etag = '"etag"') {
  const values = milestones || [makeNormalizedMilestone(repository)];
  return {
    pages: [
      {
        page: 1,
        etag,
        hasNext: false,
        itemCount: values.length,
        oldestUpdatedAt: "2026-08-24T08:37:31.000Z",
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

test("builds encoded closed milestone-issue requests and versioned headers", () => {
  assert.equal(
    buildClosedIssueActivityUrl("lib port", "tech lib", 2),
    "https://api.github.com/repos/lib%20port/tech%20lib/issues?state=closed&milestone=*&sort=updated&direction=desc&per_page=100&page=2"
  );
  assert.deepEqual(buildHeaders('"etag"'), {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "If-None-Match": '"etag"',
  });
});

test("builds encoded milestone links", () => {
  assert.equal(
    buildMilestoneUrl(OWNER, "tech lib", 7),
    "https://github.com/lib-port/tech%20lib/milestone/7"
  );
});

test("validates repository configuration in order", () => {
  assert.deepEqual(normalizeRepositories([" tech-lib ", "bus-lib"]), [
    "tech-lib",
    "bus-lib",
  ]);
  assert.equal(normalizeRepositories([]), null);
  assert.equal(normalizeRepositories(["tech-lib", "tech-lib"]), null);
  assert.equal(normalizeRepositories(["tech-lib", 3]), null);
});

test("normalizes closed issues for open milestones and rejects malformed candidates", () => {
  const milestones = normalizeClosedIssueActivity(
    [
      makeApiIssue({
        number: 1,
        title: "  Current work  ",
        issueTitle: "  Finished task  ",
        stateReason: "not_planned",
        dueOn: null,
      }),
      makeApiIssue({ number: 2, milestoneState: "closed" }),
      makeApiIssue({ number: 3, updatedAt: "invalid" }),
      makeApiIssue({ number: 4, closedAt: "invalid" }),
      makeApiIssue({ number: 5, openIssues: -1 }),
      makeApiIssue({ number: 6, pullRequest: true }),
      makeApiIssue({ number: 7, issueState: "open", closedAt: null }),
      makeApiIssue({ number: 8, issueUrl: "http://github.com/unsafe" }),
      makeApiIssue({ number: 9, issueUrl: "https://example.com/issues/9" }),
      makeApiIssue({
        number: 10,
        closedAt: "2026-08-24T10:00:00Z",
        updatedAt: "2026-08-24T09:00:00Z",
      }),
    ],
    "tech-lib"
  );

  assert.deepEqual(milestones, [
    {
      repository: "tech-lib",
      number: 1,
      title: "Current work",
      description: "Complete notes and projects.",
      openIssues: 3,
      closedIssues: 1,
      dueOn: null,
      latestClosedIssue: {
        number: 101,
        title: "Finished task",
        url: "https://github.com/lib-port/tech-lib/issues/101",
        closedAt: "2026-08-24T08:00:00.000Z",
      },
    },
  ]);
});

test("compacts a milestone by newest closure and then higher issue number", () => {
  const milestones = normalizeClosedIssueActivity(
    [
      makeApiIssue({
        number: 1,
        issueNumber: 201,
        issueTitle: "Older closure",
        closedAt: "2026-08-24T08:00:00Z",
        updatedAt: "2026-08-24T11:00:00Z",
      }),
      makeApiIssue({
        number: 1,
        issueNumber: 202,
        issueTitle: "Newest closure, lower issue",
        closedAt: "2026-08-24T10:00:00Z",
        updatedAt: "2026-08-24T10:00:00Z",
      }),
      makeApiIssue({
        number: 1,
        issueNumber: 203,
        issueTitle: "Newest closure, higher issue",
        closedAt: "2026-08-24T10:00:00Z",
        updatedAt: "2026-08-24T10:30:00Z",
      }),
      makeApiIssue({
        number: 2,
        issueNumber: 301,
        issueTitle: "Another milestone",
        closedAt: "2026-08-24T09:00:00Z",
        updatedAt: "2026-08-24T09:00:00Z",
      }),
    ],
    "tech-lib"
  );

  assert.equal(milestones.length, 2);
  assert.deepEqual(
    milestones.map(({ number }) => number),
    [1, 2]
  );
  assert.equal(
    milestones[0].latestClosedIssue.title,
    "Newest closure, higher issue"
  );
  assert.equal(milestones[0].latestClosedIssue.number, 203);
});

test("merges repositories, deduplicates, globally sorts, ties by configuration, and limits", () => {
  const newest = makeNormalizedMilestone("alpha", {
    number: 3,
    title: "Newest",
    closedAt: "2026-08-24T09:00:00Z",
    updatedAt: "2026-08-24T09:00:00Z",
  });
  const alphaTie = makeNormalizedMilestone("alpha", {
    number: 2,
    title: "Alpha tie",
    closedAt: "2026-08-24T08:00:00Z",
    updatedAt: "2026-08-24T08:00:00Z",
  });
  const betaTie = makeNormalizedMilestone("beta", {
    number: 4,
    title: "Beta tie",
    closedAt: "2026-08-24T08:00:00Z",
    updatedAt: "2026-08-24T08:00:00Z",
  });
  const olderDuplicate = {
    ...newest,
    latestClosedIssue: {
      ...newest.latestClosedIssue,
      closedAt: "2026-08-20T00:00:00.000Z",
    },
  };
  const repositories = {
    alpha: {
      pages: [
        { milestones: [olderDuplicate, alphaTie] },
        { milestones: [newest] },
      ],
    },
    beta: { pages: [{ milestones: [betaTie] }] },
  };

  assert.deepEqual(
    mergeMilestones(repositories, ["beta", "alpha"], 2).map(
      ({ repository, number }) => `${repository}:${number}`
    ),
    ["alpha:3", "beta:4"]
  );
});

test("ranks by closure time rather than later issue or milestone updates", () => {
  const recentlyUpdatedOlderClosure = makeNormalizedMilestone("alpha", {
    number: 1,
    closedAt: "2026-08-24T08:00:00Z",
    updatedAt: "2026-08-24T11:00:00Z",
    milestoneUpdatedAt: "2026-08-01T00:00:00Z",
  });
  const newerClosure = makeNormalizedMilestone("alpha", {
    number: 2,
    closedAt: "2026-08-24T09:00:00Z",
    updatedAt: "2026-08-24T09:00:00Z",
    milestoneUpdatedAt: "2026-08-25T00:00:00Z",
  });

  const ranked = mergeMilestones(
    {
      alpha: {
        pages: [{ milestones: [recentlyUpdatedOlderClosure, newerClosure] }],
      },
    },
    ["alpha"],
    2
  );

  assert.deepEqual(
    ranked.map(({ number }) => number),
    [2, 1]
  );
});

test("formats due dates in UTC and calculates rounded progress", () => {
  assert.equal(formatDueDate("2027-03-31T00:00:00Z"), "March 31, 2027");
  assert.equal(formatDueDate("2027-03-31T00:00:00+14:00"), "March 30, 2027");
  assert.equal(formatDueDate("invalid"), "");
  assert.equal(calculatePercentage(0, 0), 0);
  assert.equal(calculatePercentage(1, 3), 33);
  assert.equal(calculatePercentage(2, 3), 67);
});

test("renders the GitHub-style milestone fields and safe text values", () => {
  const { container, empty, error, items, list, loading } = makeContainer({
    limit: 1,
  });
  const milestone = makeNormalizedMilestone("tech-lib", {
    title: "<strong>Current</strong>",
    issueTitle: "<em>Finished issue</em>",
    issueUrl: "https://github.com/lib-port/tech-lib/issues/101",
    openIssues: 3,
    closedIssues: 1,
  });

  assert.equal(renderMilestones(container, [milestone], 1, OWNER), true);
  assertOnlyVisible({ list, loading, error, empty }, "list");
  assert.equal(isVisible(items[0]), true);

  const title = items[0].querySelector("[data-recent-milestone-title]");
  const repoName = items[0].querySelector(
    "[data-recent-milestone-repo-name]"
  );
  const dueDetail = items[0].querySelector(
    "[data-recent-milestone-due-detail]"
  );
  const due = items[0].querySelector("[data-recent-milestone-due]");
  const total = items[0].querySelector(
    "[data-recent-milestone-closed-total]"
  );
  const progress = items[0].querySelector(
    "[data-recent-milestone-progress]"
  );
  const progressValue = items[0].querySelector(
    "[data-recent-milestone-progress-value]"
  );
  const latestClosedIssue = items[0].querySelector(
    "[data-recent-milestone-latest-closed-issue]"
  );

  assert.equal(title.textContent, "<strong>Current</strong>");
  assert.match(title.href, /\/tech-lib\/milestone\/1$/);
  assert.equal(repoName.textContent, "tech-lib");
  assert.equal(dueDetail.hidden, false);
  assert.equal(due.textContent, "Due by March 31, 2027");
  assert.equal(total.textContent, "1/4");
  assert.equal(progress.attributes.get("aria-valuenow"), "25");
  assert.equal(progressValue.style.width, "25%");
  assert.equal(latestClosedIssue.textContent, "<em>Finished issue</em>");
  assert.equal(latestClosedIssue.href, "");
});

test("fails safely when the latest closed-issue binding is missing", () => {
  const view = makeContainer({ limit: 1 });
  view.items[0].selectors.delete(
    "[data-recent-milestone-latest-closed-issue]"
  );

  assert.equal(
    renderMilestones(
      view.container,
      [makeNormalizedMilestone("tech-lib")],
      1,
      OWNER
    ),
    false
  );
  assertOnlyVisible(
    {
      list: view.list,
      loading: view.loading,
      error: view.error,
      empty: view.empty,
    },
    "error"
  );
});

test("renders missing optional fields, zero progress, and the empty state", () => {
  const first = makeContainer({ limit: 1 });
  const milestone = makeNormalizedMilestone("tech-lib", {
    description: "",
    dueOn: null,
    openIssues: 0,
    closedIssues: 0,
  });

  assert.equal(renderMilestones(first.container, [milestone], 1, OWNER), true);
  assert.equal(
    first.items[0].querySelector("[data-recent-milestone-description]").hidden,
    true
  );
  assert.equal(
    first.items[0].querySelector("[data-recent-milestone-due-detail]").hidden,
    true
  );
  assert.equal(
    first.items[0].querySelector("[data-recent-milestone-due]").textContent,
    ""
  );
  assert.equal(
    first.items[0].querySelector("[data-recent-milestone-closed-total]")
      .textContent,
    "0/0"
  );
  assert.equal(
    first.items[0].querySelector("[data-recent-milestone-percentage]").textContent,
    "0%"
  );

  const second = makeContainer({ limit: 1 });
  assert.equal(renderMilestones(second.container, [], 1, OWNER), true);
  assertOnlyVisible(
    {
      list: second.list,
      loading: second.loading,
      error: second.error,
      empty: second.empty,
    },
    "empty"
  );
});

test("resets the optional due-date detail when reusing a milestone item", () => {
  const view = makeContainer({ limit: 1 });
  const dueDetail = view.items[0].querySelector(
    "[data-recent-milestone-due-detail]"
  );
  const due = view.items[0].querySelector("[data-recent-milestone-due]");

  assert.equal(
    renderMilestones(
      view.container,
      [makeNormalizedMilestone("tech-lib")],
      1,
      OWNER
    ),
    true
  );
  assert.equal(dueDetail.hidden, false);
  assert.equal(due.textContent, "Due by March 31, 2027");

  assert.equal(
    renderMilestones(
      view.container,
      [makeNormalizedMilestone("tech-lib", { dueOn: null })],
      1,
      OWNER
    ),
    true
  );
  assert.equal(dueDetail.hidden, true);
  assert.equal(due.textContent, "");

  assert.equal(
    renderMilestones(
      view.container,
      [makeNormalizedMilestone("tech-lib")],
      1,
      OWNER
    ),
    true
  );
  assert.equal(dueDetail.hidden, false);
  assert.equal(due.textContent, "Due by March 31, 2027");
});

test("continues through duplicate-heavy pages until enough closed milestones exist", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    makeApiIssue({
      number: 1,
      updatedAt: new Date(NOW - index * 1000).toISOString(),
    })
  );
  const requests = [];
  const responses = [
    makeResponse({
      payload: firstPage,
      etag: '"page-1"',
      link: '<https://api.github.com/example?page=2>; rel="next"',
    }),
    makeResponse({
      payload: [makeApiIssue({ number: 2 })],
      etag: '"page-2"',
    }),
  ];

  const entry = await fetchRepositoryClosedIssueActivity(
    OWNER,
    "tech-lib",
    2,
    null,
    async (url) => {
      requests.push(url);
      return responses.shift();
    }
  );

  assert.equal(requests.length, 2);
  assert.match(requests[0], /page=1$/);
  assert.match(requests[1], /page=2$/);
  assert.equal(entry.pages.length, 2);
  assert.equal(entry.pages[0].etag, '"page-1"');
  assert.equal(entry.pages[0].itemCount, 100);
  assert.equal(
    entry.pages[0].oldestUpdatedAt,
    new Date(NOW - 99 * 1000).toISOString()
  );
  assert.equal(entry.pages[0].milestones.length, 1);
  assert.equal(entry.pages[0].milestones[0].number, 1);
  assert.equal(entry.pages[1].milestones[0].number, 2);
});

test("stops when the closure cutoff is strictly newer than the page boundary", async () => {
  let requests = 0;
  const entry = await fetchRepositoryClosedIssueActivity(
    OWNER,
    "tech-lib",
    1,
    null,
    async () => {
      requests += 1;
      return makeResponse({
        payload: [
          makeApiIssue({
            number: 1,
            closedAt: "2026-08-24T10:00:00Z",
            updatedAt: "2026-08-24T10:00:00Z",
          }),
          makeApiIssue({
            number: 2,
            closedAt: "2026-08-24T09:00:00Z",
            updatedAt: "2026-08-24T09:00:00Z",
          }),
        ],
        link: '<https://api.github.com/example?page=2>; rel="next"',
      });
    }
  );

  assert.equal(requests, 1);
  assert.equal(entry.pages.length, 1);
});

test("continues on an equal pagination boundary so issue-number ties remain exact", async () => {
  const responses = [
    makeResponse({
      payload: [
        makeApiIssue({
          number: 1,
          issueNumber: 101,
          closedAt: "2026-08-24T09:00:00Z",
          updatedAt: "2026-08-24T09:00:00Z",
        }),
      ],
      link: '<https://api.github.com/example?page=2>; rel="next"',
    }),
    makeResponse({
      payload: [
        makeApiIssue({
          number: 1,
          issueNumber: 102,
          closedAt: "2026-08-24T09:00:00Z",
          updatedAt: "2026-08-24T09:00:00Z",
        }),
      ],
    }),
  ];

  const entry = await fetchRepositoryClosedIssueActivity(
    OWNER,
    "tech-lib",
    1,
    null,
    async () => responses.shift()
  );
  const ranked = mergeMilestones({ "tech-lib": entry }, ["tech-lib"], 1);

  assert.equal(entry.pages.length, 2);
  assert.equal(ranked[0].latestClosedIssue.number, 102);
});

test("rejects a page whose raw update boundary cannot be validated", async () => {
  await assert.rejects(
    fetchRepositoryClosedIssueActivity(
      OWNER,
      "tech-lib",
      1,
      null,
      async () =>
        makeResponse({
          payload: [makeApiIssue({ updatedAt: "invalid" })],
        })
    ),
    /malformed issue update data/
  );
});

test("conditionally revalidates and reuses a cached closed-issue page", async () => {
  const cachedEntry = makeEntry("tech-lib");
  cachedEntry.pages[0].hasNext = true;
  cachedEntry.pages[0].oldestUpdatedAt = "2026-08-24T07:00:00.000Z";
  let request;

  const entry = await fetchRepositoryClosedIssueActivity(
    OWNER,
    "tech-lib",
    1,
    cachedEntry,
    async (url, options) => {
      request = { url, options };
      return makeResponse({ status: 304, etag: "" });
    }
  );

  assert.equal(request.options.headers["If-None-Match"], '"etag"');
  assert.deepEqual(entry, cachedEntry);
});

test("keeps complete milestone caches indefinitely but fresh for seven days", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  const repositories = { "tech-lib": makeEntry("tech-lib") };

  assert.match(storageKey, /^recent-milestones:v3:/);
  assert.match(
    getFailureKey(OWNER, ["tech-lib"], 1),
    /^recent-milestones:v3:failure:/
  );
  assert.equal(CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  writeCache(
    storageKey,
    { fetchedAt: NOW, repoNames: ["tech-lib"], repositories },
    storage
  );

  assert.equal(
    readCache(storageKey, ["tech-lib"], storage, NOW + CACHE_TTL_MS - 1)
      .isFresh,
    true
  );
  assert.equal(
    readCache(storageKey, ["tech-lib"], storage, NOW + CACHE_TTL_MS).isFresh,
    false
  );
  assert.equal(
    readCache(
      storageKey,
      ["tech-lib"],
      storage,
      NOW + 365 * 24 * 60 * 60 * 1000
    ).complete,
    true
  );
});

test("removes only the current v2 data and failure keys", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  const legacyDataKey = `recent-milestones:v2:${OWNER}:limit:1`;
  const legacyFailureKey =
    `recent-milestones:v2:failure:${OWNER}:limit:1:tech-lib`;
  const unrelatedLegacyKey = `recent-milestones:v2:${OWNER}:limit:2`;
  storage.setItem(legacyDataKey, "legacy data");
  storage.setItem(legacyFailureKey, "legacy failure");
  storage.setItem(unrelatedLegacyKey, "keep me");
  writeCache(
    storageKey,
    {
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry("tech-lib") },
    },
    storage
  );

  const { container } = makeContainer({ limit: 1 });
  assert.equal(
    await loadRecentMilestones(container, {
      fetchImpl: async () => {
        throw new Error("fresh v3 cache should prevent a request");
      },
      storage,
      now: NOW,
      logger: silentLogger,
    }),
    true
  );
  assert.equal(storage.getItem(legacyDataKey), null);
  assert.equal(storage.getItem(legacyFailureKey), null);
  assert.equal(storage.getItem(unrelatedLegacyKey), "keep me");
});

test("compacts duplicate v3 candidates per cached page", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 2);
  const older = makeNormalizedMilestone("tech-lib", {
    number: 1,
    title: "Older snapshot",
    closedAt: "2026-08-24T08:00:00Z",
    updatedAt: "2026-08-24T08:00:00Z",
  });
  const newer = makeNormalizedMilestone("tech-lib", {
    number: 1,
    title: "Newest snapshot",
    closedAt: "2026-08-24T10:00:00Z",
    updatedAt: "2026-08-24T10:00:00Z",
  });
  const sameMilestoneOnNextPage = makeNormalizedMilestone("tech-lib", {
    number: 1,
    title: "Next page snapshot",
    closedAt: "2026-08-23T10:00:00Z",
    updatedAt: "2026-08-23T10:00:00Z",
  });

  writeCache(
    storageKey,
    {
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: {
        "tech-lib": {
          pages: [
            {
              page: 1,
              etag: '"page-1"',
              hasNext: true,
              itemCount: 2,
              oldestUpdatedAt: "2026-08-24T08:00:00.000Z",
              milestones: [older, newer],
            },
            {
              page: 2,
              etag: '"page-2"',
              hasNext: false,
              itemCount: 1,
              oldestUpdatedAt: "2026-08-23T10:00:00.000Z",
              milestones: [sameMilestoneOnNextPage],
            },
          ],
        },
      },
    },
    storage
  );

  const cached = readCache(storageKey, ["tech-lib"], storage, NOW);
  assert.deepEqual(
    cached.repositories["tech-lib"].pages.map((page) => page.milestones.length),
    [1, 1]
  );
  assert.equal(
    cached.repositories["tech-lib"].pages[0].milestones[0].title,
    "Newest snapshot"
  );

  const persisted = JSON.parse(storage.getItem(storageKey));
  assert.deepEqual(
    persisted.repositories["tech-lib"].pages.map(
      (page) => page.milestones.length
    ),
    [1, 1]
  );
  assert.match(storageKey, /^recent-milestones:v3:/);
});

test("deletes malformed and future-dated milestone caches", () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  const missingBoundary = makeEntry("tech-lib");
  delete missingBoundary.pages[0].oldestUpdatedAt;
  const unsafeIssueUrl = makeEntry("tech-lib");
  unsafeIssueUrl.pages[0].milestones[0].latestClosedIssue.url =
    "https://example.com/issues/101";
  const invalidEntries = [
    "not json",
    "[]",
    JSON.stringify({ fetchedAt: NOW, repoNames: [], repositories: [] }),
    JSON.stringify({
      fetchedAt: NOW + 1,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry("tech-lib") },
    }),
    JSON.stringify({
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": { pages: [] } },
    }),
    JSON.stringify({
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": missingBoundary },
    }),
    JSON.stringify({
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": unsafeIssueUrl },
    }),
  ];

  for (const invalidEntry of invalidEntries) {
    storage.setItem(storageKey, invalidEntry);
    assert.equal(readCache(storageKey, ["tech-lib"], storage, NOW), null);
    assert.equal(storage.getItem(storageKey), null);
  }
});

test("renders a fresh cache without requesting GitHub", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  const { container, items } = makeContainer({ limit: 1 });
  let fetchCalls = 0;

  writeCache(
    storageKey,
    {
      fetchedAt: NOW,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry("tech-lib") },
    },
    storage
  );

  const loaded = await loadRecentMilestones(container, {
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fresh cache should prevent a request");
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(fetchCalls, 0);
  assert.equal(isVisible(items[0]), true);
});

test("shows loading while the initial request is pending", async () => {
  const storage = new FakeStorage();
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });
  let resolveFetch;
  const responsePromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });

  const pending = loadRecentMilestones(container, {
    fetchImpl: async () => responsePromise,
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assertOnlyVisible({ list, loading, error, empty }, "loading");
  assert.equal(container.attributes.get("aria-busy"), "true");
  resolveFetch(makeResponse({ payload: [makeApiIssue()] }));
  assert.equal(await pending, true);
  assert.equal(container.attributes.has("aria-busy"), false);
});

test("loads configured repositories serially", async () => {
  const storage = new FakeStorage();
  const { container } = makeContainer({
    limit: 1,
    repositories: ["alpha", "beta"],
  });
  const requests = [];
  let resolveAlpha;
  let resolveBetaStarted;
  const alphaResponse = new Promise((resolve) => {
    resolveAlpha = resolve;
  });
  const betaStarted = new Promise((resolve) => {
    resolveBetaStarted = resolve;
  });

  const pending = loadRecentMilestones(container, {
    fetchImpl: async (url) => {
      const repository = url.includes("/alpha/") ? "alpha" : "beta";
      requests.push(repository);
      if (repository === "alpha") return alphaResponse;
      resolveBetaStarted();
      return makeResponse({ payload: [makeApiIssue({ title: "Beta" })] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.deepEqual(requests, ["alpha"]);
  resolveAlpha(makeResponse({ payload: [makeApiIssue({ title: "Alpha" })] }));
  await betaStarted;
  assert.deepEqual(requests, ["alpha", "beta"]);
  assert.equal(await pending, true);
});

test("continues serially after a failure and renders best-effort results", async () => {
  const storage = new FakeStorage();
  const { container, items } = makeContainer({
    limit: 1,
    repositories: ["alpha", "beta"],
  });

  const loaded = await loadRecentMilestones(container, {
    fetchImpl: async (url) => {
      if (url.includes("/alpha/")) {
        return makeResponse({ status: 500 });
      }
      return makeResponse({ payload: [makeApiIssue({ title: "Beta" })] });
    },
    storage,
    now: NOW,
    logger: silentLogger,
  });

  assert.equal(loaded, true);
  assert.equal(
    items[0].querySelector("[data-recent-milestone-title]").textContent,
    "Beta"
  );
  assert.equal(
    hasRecentFailure(
      getFailureKey(OWNER, ["alpha", "beta"], 1),
      storage,
      NOW
    ),
    true
  );
});

test("restores stale data after failure and backs off for six hours", async () => {
  const storage = new FakeStorage();
  const storageKey = getStorageKey(OWNER, 1);
  const first = makeContainer({ limit: 1 });
  let fetchCalls = 0;

  writeCache(
    storageKey,
    {
      fetchedAt: NOW - CACHE_TTL_MS,
      repoNames: ["tech-lib"],
      repositories: { "tech-lib": makeEntry("tech-lib") },
    },
    storage
  );

  const fetchImpl = async () => {
    fetchCalls += 1;
    throw new Error("offline");
  };
  assert.equal(
    await loadRecentMilestones(first.container, {
      fetchImpl,
      storage,
      now: NOW,
      logger: silentLogger,
    }),
    true
  );
  assert.equal(isVisible(first.items[0]), true);

  const second = makeContainer({ limit: 1 });
  assert.equal(
    await loadRecentMilestones(second.container, {
      fetchImpl,
      storage,
      now: NOW + FAILURE_TTL_MS - 1,
      logger: silentLogger,
    }),
    true
  );
  assert.equal(FAILURE_TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(fetchCalls, 1);
});

test("distinguishes a complete empty result from an unavailable result", async () => {
  const emptyResult = makeContainer({ limit: 1 });
  assert.equal(
    await loadRecentMilestones(emptyResult.container, {
      fetchImpl: async () => makeResponse({ payload: [] }),
      storage: new FakeStorage(),
      now: NOW,
      logger: silentLogger,
    }),
    true
  );
  assertOnlyVisible(
    {
      list: emptyResult.list,
      loading: emptyResult.loading,
      error: emptyResult.error,
      empty: emptyResult.empty,
    },
    "empty"
  );

  const unavailable = makeContainer({ limit: 1 });
  assert.equal(
    await loadRecentMilestones(unavailable.container, {
      fetchImpl: async () => makeResponse({ status: 403 }),
      storage: new FakeStorage(),
      now: NOW,
      logger: silentLogger,
    }),
    false
  );
  assertOnlyVisible(
    {
      list: unavailable.list,
      loading: unavailable.loading,
      error: unavailable.error,
      empty: unavailable.empty,
    },
    "error"
  );
});

test("shows an error for invalid runtime configuration", async () => {
  const { container, empty, error, list, loading } = makeContainer({ limit: 1 });
  container.dataset.milestoneLimit = "11";

  assert.equal(
    await loadRecentMilestones(container, {
      storage: new FakeStorage(),
      now: NOW,
      logger: silentLogger,
    }),
    false
  );
  assertOnlyVisible({ list, loading, error, empty }, "error");
});

test("starts by selecting recent-milestone containers in a browser", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  let selector = "";

  vm.runInNewContext(source, {
    Date,
    Intl,
    URLSearchParams,
    console,
    document: {
      querySelectorAll(value) {
        selector = value;
        return [];
      },
    },
  });

  assert.equal(selector, "[data-recent-milestones]");
});
