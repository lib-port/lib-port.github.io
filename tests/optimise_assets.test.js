"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const script = path.join(root, "scripts", "optimise_assets.mjs");
const names = ["github_activity.js", "theme_toggle.js", "external_blog.js"];
const noise = Array.from({ length: 1024 }, (_, index) =>
  createHash("sha256").update(String(index)).digest("hex")
).join("");

function makeBuild(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lib-port-assets-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "assets", "js"), { recursive: true });
  fs.mkdirSync(path.join(directory, "assets", "css"));
  for (const name of names) {
    fs.writeFileSync(path.join(directory, "assets", "js", name),
      "/*! Example licence */\nwindow.example = function (value) { return value + 1; };\n");
  }
  fs.writeFileSync(path.join(directory, "assets", "css", "style.css"), "body{margin:0}");
  return directory;
}

function optimise(directory, optimiser = script) {
  return spawnSync(process.execPath, [optimiser, directory], { encoding: "utf8" });
}

test("minifies generated JavaScript, retains licence comments and reports gzip sizes", t => {
  const directory = makeBuild(t);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /JavaScript total: \d+ bytes; stylesheet: \d+ bytes gzipped/);
  for (const name of names) {
    const content = fs.readFileSync(path.join(directory, "assets", "js", name), "utf8");
    assert.match(content, /Example licence/);
    assert.doesNotMatch(content, /function \(value\)/);
  }
});

test("refuses to minify the repository's readable source files", t => {
  const directory = makeBuild(t);
  fs.mkdirSync(path.join(directory, "scripts"));
  const optimiser = path.join(directory, "scripts", "optimise_assets.mjs");
  fs.copyFileSync(script, optimiser);
  fs.symlinkSync(path.join(root, "node_modules"), path.join(directory, "node_modules"));
  const sourcePath = path.join(directory, "assets", "js", "github_activity.js");
  const original = fs.readFileSync(sourcePath, "utf8");
  const result = optimise(directory, optimiser);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /keep source files readable/);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), original);
});

for (const budget of ["activity", "combined", "stylesheet"]) {
  test(`rejects builds that exceed the ${budget} gzip budget`, t => {
    const directory = makeBuild(t);
    if (budget === "stylesheet") {
      fs.writeFileSync(path.join(directory, "assets", "css", "style.css"), noise);
    } else {
      const oversized = `window.fixture=${JSON.stringify(budget === "activity" ? noise : noise.slice(0, 20_000))};`;
      for (const name of budget === "activity" ? [names[0]] : names) {
        fs.writeFileSync(path.join(directory, "assets", "js", name), oversized);
      }
    }
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(budget === "activity" ? "16 KiB" : budget === "combined" ? "20 KiB" : "8 KiB"));
  });
}
