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
const names = ["github_activity.js", "theme_toggle.js", "external_blog.js", "title_flight.js", "drag_reveal.js"];
const bannerMarkup = '<div data-home-section="ascii_banner" hidden><ascii-art piece="random"></ascii-art>' +
  '<script type="module" src="/project/assets/js/ascii_banner.mjs"></script></div>';
const gameMarkup = '<div class="repo-section-heading"><h2>Notes and Projects</h2>' +
  '<button class="repo-shuffle" data-drag-shuffle type="button"></button></div>' +
  '<template data-drag-icons></template>' +
  '<script src="/project/assets/js/drag_reveal.js" defer></script>';
const planeMarkup = '<span data-title-flight><span data-title-flight-plane></span>' +
  '<button data-title-flight-launch></button></span>' +
  '<script src="/project/assets/js/title_flight.js" defer></script>';
const noise = Array.from({ length: 1024 }, (_, index) =>
  createHash("sha256").update(String(index)).digest("hex")
).join("");

function makeBuild(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lib-port-assets-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "assets", "js"), { recursive: true });
  fs.mkdirSync(path.join(directory, "assets", "css"));
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + gameMarkup + planeMarkup);
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

function testBuiltAssets(directory, suite) {
  const env = { ...process.env, CLIENT_ASSET_DIRECTORY: path.join(directory, "assets", "js") };
  // Run a separate suite; inheriting the parent's context makes Node skip it.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(__dirname, suite)], {
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
  const bannerTests = testBuiltAssets(directory, "ascii_banner.test.js");
  assert.equal(bannerTests.status, 0, bannerTests.stdout + bannerTests.stderr);
  assert.match(bannerTests.stdout, /produces valid local frames and palette indices/);
  assert.doesNotMatch(bannerTests.stdout, /# SKIP/);
});

test("optimises a build with the ASCII banner excluded", t => {
  const directory = makeBuild(t);
  for (const name of ["ascii_banner.mjs", "ascii-rest"]) {
    fs.rmSync(path.join(directory, "assets", "js", name), { recursive: true });
  }
  fs.writeFileSync(path.join(directory, "index.html"), gameMarkup + planeMarkup);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ASCII JavaScript catalogue: skipped/);
  assert.match(result.stdout, /JavaScript total: \d+ bytes; stylesheet: \d+ bytes gzipped/);
  const bannerTests = testBuiltAssets(directory, "ascii_banner.test.js");
  assert.equal(bannerTests.status, 0, bannerTests.stdout + bannerTests.stderr);
});

test("exercises the enabled game against its minified build", t => {
  const directory = makeBuild(t);
  fs.copyFileSync(path.join(root, "assets", "js", "drag_reveal.js"),
    path.join(directory, "assets", "js", "drag_reveal.js"));
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /drag_reveal\.js: \d+ bytes gzipped/);
  const gameTests = testBuiltAssets(directory, "drag_reveal.test.js");
  assert.equal(gameTests.status, 0, gameTests.stdout + gameTests.stderr);
  assert.match(gameTests.stdout, /each eligible underlay occupies an equal interval/);
  assert.match(gameTests.stdout, /milestones loaded after initialisation join both the shuffle/);
  assert.match(gameTests.stdout, /rapid keyboard activations each shuffle/);
  assert.doesNotMatch(gameTests.stdout, /# SKIP/);
});

test("optimises a build with the game excluded and verifies its absence", t => {
  const directory = makeBuild(t);
  fs.rmSync(path.join(directory, "assets", "js", "drag_reveal.js"));
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + planeMarkup);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Find the bug game: skipped/);
  assert.doesNotMatch(result.stdout, /drag_reveal\.js: \d+ bytes gzipped/);
  const gameTests = testBuiltAssets(directory, "drag_reveal.test.js");
  assert.equal(gameTests.status, 0, gameTests.stdout + gameTests.stderr);
  assert.match(gameTests.stdout, /ok \d+ - built game assets agree with the game markup/);
  assert.match(gameTests.stdout, /# SKIP The built homepage disables/);
});

for (const mismatch of ["missing referenced game asset", "leftover disabled game asset"]) {
  test(`rejects a ${mismatch}`, t => {
    const directory = makeBuild(t);
    if (mismatch === "missing referenced game asset") {
      fs.rmSync(path.join(directory, "assets", "js", "drag_reveal.js"));
    } else {
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + planeMarkup);
    }
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Game asset inclusion mismatch/);
  });
}

test("exercises the enabled paper plane against its minified build", t => {
  const directory = makeBuild(t);
  fs.copyFileSync(path.join(root, "assets", "js", "title_flight.js"),
    path.join(directory, "assets", "js", "title_flight.js"));
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /title_flight\.js: \d+ bytes gzipped/);
  const planeTests = testBuiltAssets(directory, "title_flight.test.js");
  assert.equal(planeTests.status, 0, planeTests.stdout + planeTests.stderr);
  assert.match(planeTests.stdout, /flies an eight-second loop and finishes the remaining path at twice the speed/);
  assert.doesNotMatch(planeTests.stdout, /# SKIP/);
});

test("optimises a build with the paper plane excluded and verifies its absence", t => {
  const directory = makeBuild(t);
  fs.rmSync(path.join(directory, "assets", "js", "title_flight.js"));
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + gameMarkup);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Paper plane: skipped/);
  assert.doesNotMatch(result.stdout, /title_flight\.js: \d+ bytes gzipped/);
  const planeTests = testBuiltAssets(directory, "title_flight.test.js");
  assert.equal(planeTests.status, 0, planeTests.stdout + planeTests.stderr);
  assert.match(planeTests.stdout, /ok \d+ - built paper plane assets agree with the plane markup/);
  assert.match(planeTests.stdout, /# SKIP The built homepage disables/);
});

for (const mismatch of ["missing referenced paper plane asset", "leftover disabled paper plane asset", "non-file paper plane asset"]) {
  test(`rejects a ${mismatch}`, t => {
    const directory = makeBuild(t);
    const asset = path.join(directory, "assets", "js", "title_flight.js");
    if (mismatch === "leftover disabled paper plane asset") {
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + gameMarkup);
    } else {
      fs.rmSync(asset);
      if (mismatch === "non-file paper plane asset") fs.mkdirSync(asset);
    }
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Paper plane asset inclusion mismatch/);
  });
}

test("still rejects a missing required script", t => {
  const directory = makeBuild(t);
  fs.rmSync(path.join(directory, "assets", "js", "theme_toggle.js"));
  const result = optimise(directory);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /theme_toggle\.js/);
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
    assert.match(result.stderr, new RegExp(budget === "activity" ? "16 KiB" : budget === "combined" ? "21 KiB" : budget === "ascii" ? "100 KiB" : "8 KiB"));
  });
}
