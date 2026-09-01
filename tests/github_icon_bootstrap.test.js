"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const bootstrapPath = path.join(
  __dirname,
  "..",
  "_includes",
  "github_icon_bootstrap.html"
);
const source = fs.readFileSync(bootstrapPath, "utf8");
const script = source.match(
  /<script data-github-icon-bootstrap>([\s\S]*?)<\/script>/
)?.[1];

assert.ok(script, "GitHub icon bootstrap script is present");

function runBootstrap(navigatorRef) {
  const root = { dataset: {} };
  const context = { document: { documentElement: root } };
  if (navigatorRef !== undefined) context.navigator = navigatorRef;

  vm.runInNewContext(script, context);
  return root.dataset.githubIconVariant;
}

test("recognises desktop Linux from User-Agent Client Hints", () => {
  assert.equal(
    runBootstrap({ userAgentData: { platform: " Linux " } }),
    "mark"
  );
});

test("uses the logo for non-Linux Client Hint platforms", () => {
  for (const platform of ["Windows", "macOS", "Android", "Chrome OS"]) {
    assert.equal(
      runBootstrap({ userAgentData: { platform } }),
      "logo",
      platform
    );
  }
});

test("falls back to legacy desktop Linux platform details", () => {
  assert.equal(
    runBootstrap({
      userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64)",
      platform: "Linux x86_64",
    }),
    "mark"
  );
});

test("legacy detection excludes Android and ChromeOS", () => {
  const platforms = [
    {
      userAgent: "Mozilla/5.0 (Linux; Android 16; Mobile)",
      platform: "Linux armv8l",
    },
    {
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64 16000.0.0)",
      platform: "Linux x86_64",
    },
  ];

  for (const navigatorRef of platforms) {
    assert.equal(runBootstrap(navigatorRef), "logo");
  }
});

test("Client Hints take precedence over conflicting legacy details", () => {
  assert.equal(
    runBootstrap({
      userAgentData: { platform: "Android" },
      userAgent: "Mozilla/5.0 (Linux x86_64)",
      platform: "Linux x86_64",
    }),
    "logo"
  );
});

test("missing or inaccessible platform details fall back to the logo", () => {
  assert.equal(runBootstrap(undefined), "logo");
  assert.equal(runBootstrap({ userAgent: "", platform: "" }), "logo");

  const navigatorRef = {};
  Object.defineProperty(navigatorRef, "userAgentData", {
    get() {
      throw new Error("platform details unavailable");
    },
  });
  assert.equal(runBootstrap(navigatorRef), "logo");
});
