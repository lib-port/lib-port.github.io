"use strict";

process.env.TZ = "Australia/Sydney";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const scriptPath = path.join(__dirname, "..", "assets", "js", "repo_updates.js");
const { formatPushedAt } = require(scriptPath);

test("formats repository updates by the visitor's local calendar", () => {
  const now = new Date("2026-08-04T00:15:00+10:00");

  const cases = [
    ["2026-08-03T14:05:00Z", "Updated today"],
    ["2026-08-02T23:00:00Z", "Updated yesterday"],
    ["2026-08-01T23:00:00Z", "Updated 2 days ago"],
    ["2026-07-28T23:00:00Z", "Updated 6 days ago"],
    ["2026-07-27T23:00:00Z", "Updated last week"],
    ["2026-07-21T23:00:00Z", "Updated last week"],
    ["2026-07-20T23:00:00Z", "Updated 2 weeks ago"],
    ["2026-07-07T23:00:00Z", "Updated 3 weeks ago"],
    ["2026-07-06T23:00:00Z", "Updated on Jul 7"],
  ];

  for (const [timestamp, expected] of cases) {
    assert.equal(formatPushedAt(timestamp, now), expected, timestamp);
  }
});

test("uses an absolute date for a future calendar day", () => {
  const now = new Date("2026-08-04T12:00:00+10:00");

  assert.equal(formatPushedAt("2026-08-04T15:00:00Z", now), "Updated on Aug 5");
});

test("counts calendar days across a daylight-saving transition", () => {
  const now = new Date("2026-10-05T12:00:00+11:00");

  assert.equal(
    formatPushedAt("2026-10-03T12:00:00+10:00", now),
    "Updated 2 days ago"
  );
});

test("chooses the displayed year from local dates", () => {
  const now = new Date("2026-02-05T12:00:00+11:00");

  assert.equal(formatPushedAt("2025-12-31T13:30:00Z", now), "Updated on Jan 1");
  assert.equal(
    formatPushedAt("2025-12-30T13:30:00Z", now),
    "Updated on Dec 31, 2025"
  );
});

test("returns no label for invalid dates", () => {
  assert.equal(formatPushedAt("not-a-date", new Date()), "");
  assert.equal(formatPushedAt(new Date().toISOString(), new Date("not-a-date")), "");
});

test("starts normally when loaded as a browser script", () => {
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

  assert.equal(selector, ".repo-card[data-repo-owner][data-repo-name]");
});
