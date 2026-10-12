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
  fs.writeFileSync(path.join(directory, "index.html"),
    '<div data-home-section="ascii-banner" hidden><ascii-art piece="random"></ascii-art>' +
    '<script type="module" src="/project/assets/js/ascii_banner.mjs"></script></div>');
  for (const name of names) {
    fs.writeFileSync(path.join(directory, "assets", "js", name),
      "/*! Example licence */\nwindow.example = function (value) { return value + 1; };\n");
  }
  fs.writeFileSync(path.join(directory, "assets", "css", "style.css"), "body{margin:0}");
  fs.cpSync(path.join(root, "assets", "js", "ascii-rest"),
    path.join(directory, "assets", "js", "ascii-rest"), { recursive: true });
  fs.copyFileSync(path.join(root, "assets", "js", "ascii_banner.mjs"),
    path.join(directory, "assets", "js", "ascii_banner.mjs"));
  return directory;
}

function optimise(directory, optimiser = script) {
  return spawnSync(process.execPath, [optimiser, directory], { encoding: "utf8" });
}

function testBannerBuild(directory) {
  const env = { ...process.env, CLIENT_ASSET_DIRECTORY: path.join(directory, "assets", "js") };
  // Run a separate suite; inheriting the parent's context makes Node skip it.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, "ascii_banner.test.js")], {
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
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
  const scene = fs.readFileSync(path.join(directory, "assets", "js", "ascii-rest", "pieces", "misty-forest.js"), "utf8");
  assert.match(scene, /MIT licence/);
  assert.match(scene, /export/);
  assert.match(result.stdout, /ASCII JavaScript catalogue: \d+ bytes gzipped/);
  const bannerTests = testBannerBuild(directory);
  assert.equal(bannerTests.status, 0, bannerTests.stdout + bannerTests.stderr);
  assert.match(bannerTests.stdout, /produces valid local frames and palette indices/);
  assert.doesNotMatch(bannerTests.stdout, /# SKIP/);
});

test("optimises a build with the ASCII banner excluded", t => {
  const directory = makeBuild(t);
  for (const name of ["ascii_banner.mjs", "ascii-rest"]) {
    fs.rmSync(path.join(directory, "assets", "js", name), { recursive: true });
  }
  fs.writeFileSync(path.join(directory, "index.html"), "<p>Banner disabled</p>");
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ASCII JavaScript catalogue: skipped/);
  assert.match(result.stdout, /JavaScript total: \d+ bytes; stylesheet: \d+ bytes gzipped/);
  const bannerTests = testBannerBuild(directory);
  assert.equal(bannerTests.status, 0, bannerTests.stdout + bannerTests.stderr);
});

for (const missing of ["ascii_banner.mjs", "ascii-rest"]) {
  test(`rejects an incomplete ASCII build missing ${missing}`, t => {
    const directory = makeBuild(t);
    fs.rmSync(path.join(directory, "assets", "js", missing), { recursive: true });
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Incomplete ASCII assets/);
  });
}

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

for (const budget of ["activity", "combined", "stylesheet", "ascii"]) {
  test(`rejects builds that exceed the ${budget} gzip budget`, t => {
    const directory = makeBuild(t);
    if (budget === "ascii") {
      for (let index = 0; index < 4; index++) {
        fs.writeFileSync(path.join(directory, "assets", "js", "ascii-rest", `oversized-${index}.js`),
          `export const fixture=${JSON.stringify(noise)};`);
      }
    } else if (budget === "stylesheet") {
      fs.writeFileSync(path.join(directory, "assets", "css", "style.css"), noise);
    } else {
      const oversized = `window.fixture=${JSON.stringify(budget === "activity" ? noise : noise.slice(0, 20_000))};`;
      for (const name of budget === "activity" ? [names[0]] : names) {
        fs.writeFileSync(path.join(directory, "assets", "js", name), oversized);
      }
    }
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(budget === "activity" ? "16 KiB" : budget === "combined" ? "20 KiB" : budget === "ascii" ? "100 KiB" : "8 KiB"));
  });
}
