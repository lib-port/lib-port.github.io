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
const names = ["github_activity.js", "theme_toggle.js", "external_blog.js", "title_flight.js", "drag_surface.js", "light_dark_ball.js", "drag_reveal.js"];
const dragMarkup = '<script src="/project/assets/js/drag_surface.js" defer></script>';
const ballMarkup = '<script src="/project/assets/js/light_dark_ball.js" defer></script>';
const bannerMarkup = '<div data-home-section="ascii_banner" hidden><ascii-art piece="random"></ascii-art>' +
  '<script type="module" src="/project/assets/js/ascii_banner.mjs"></script></div>';
const gameMarkup = '<div class="repo-section-heading"><h2>Notes and Projects</h2>' +
  '<span class="repo-discovery-trophy" data-drag-trophy role="group" aria-hidden="true">' +
  '<span data-drag-trophy-progress role="progressbar" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0"></span></span>' +
  '</div>' +
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
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + ballMarkup + gameMarkup + planeMarkup);
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

test("keeps all real client scripts within the production gzip budgets", t => {
  const directory = makeBuild(t);
  for (const name of names) {
    fs.copyFileSync(path.join(root, "assets", "js", name),
      path.join(directory, "assets", "js", name));
  }
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("optimises a build with the ASCII banner excluded", t => {
  const directory = makeBuild(t);
  for (const name of ["ascii_banner.mjs", "ascii-rest"]) {
    fs.rmSync(path.join(directory, "assets", "js", name), { recursive: true });
  }
  fs.writeFileSync(path.join(directory, "index.html"), dragMarkup + ballMarkup + gameMarkup + planeMarkup);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ASCII JavaScript catalogue: skipped/);
  assert.match(result.stdout, /JavaScript total: \d+ bytes; stylesheet: \d+ bytes gzipped/);
  const bannerTests = testBuiltAssets(directory, "ascii_banner.test.js");
  assert.equal(bannerTests.status, 0, bannerTests.stdout + bannerTests.stderr);
});

test("exercises the enabled game against its minified build", t => {
  const directory = makeBuild(t);
  for (const name of ["drag_surface.js", "light_dark_ball.js", "drag_reveal.js", "theme_toggle.js"]) {
    fs.copyFileSync(path.join(root, "assets", "js", name),
      path.join(directory, "assets", "js", name));
  }
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /drag_reveal\.js: \d+ bytes gzipped/);
  const gameTests = testBuiltAssets(directory, "drag_reveal.test.js");
  assert.equal(gameTests.status, 0, gameTests.stdout + gameTests.stderr);
  assert.match(gameTests.stdout, /each eligible underlay occupies an equal interval/);
  assert.match(gameTests.stdout, /milestones loaded after initialisation join both the shuffle/);
  assert.match(gameTests.stdout, /completed finds reshuffle once after each shake sequence/);
  assert.match(gameTests.stdout, /discovery milestones fade in bronze and turn before changing to silver and gold/);
  assert.match(gameTests.stdout, /the twentieth full reveal redirects once and ends the run/);
  assert.doesNotMatch(gameTests.stdout, /# SKIP/);
  const ballTests = testBuiltAssets(directory, "light_dark_ball.test.js");
  assert.equal(ballTests.status, 0, ballTests.stdout + ballTests.stderr);
  assert.match(ballTests.stdout, /mouse theme throws follow release velocity and gravity/);
  assert.doesNotMatch(ballTests.stdout, /# SKIP/);
  const themeTests = testBuiltAssets(directory, "theme_toggle.test.js");
  assert.equal(themeTests.status, 0, themeTests.stdout + themeTests.stderr);
});

test("optimises a build with the game excluded and verifies its absence", t => {
  const directory = makeBuild(t);
  fs.rmSync(path.join(directory, "assets", "js", "drag_reveal.js"));
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + ballMarkup + planeMarkup);
  const result = optimise(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Find the bug game: skipped/);
  assert.doesNotMatch(result.stdout, /drag_reveal\.js: \d+ bytes gzipped/);
  const gameTests = testBuiltAssets(directory, "drag_reveal.test.js");
  assert.equal(gameTests.status, 0, gameTests.stdout + gameTests.stderr);
  assert.match(gameTests.stdout, /ok \d+ - built game assets agree with the game markup/);
  assert.match(gameTests.stdout, /# SKIP The built homepage disables/);
});

for (const game of [false, true]) {
  for (const ball of [false, true]) {
    test(`minified drag features work independently: game ${game}, ball ${ball}`, t => {
      const directory = makeBuild(t);
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup +
        (game || ball ? dragMarkup : "") + (ball ? ballMarkup : "") +
        (game ? gameMarkup : "") + planeMarkup);
      for (const [name, included] of [
        ["drag_surface.js", game || ball], ["light_dark_ball.js", ball],
        ["drag_reveal.js", game], ["theme_toggle.js", true],
      ]) {
        const destination = path.join(directory, "assets", "js", name);
        if (included) fs.copyFileSync(path.join(root, "assets", "js", name), destination);
        else fs.rmSync(destination);
      }
      const result = optimise(directory);
      assert.equal(result.status, 0, result.stderr);
      if (!ball) {
        assert.match(result.stdout, /Light\/dark ball: skipped/);
        assert.doesNotMatch(result.stdout, /light_dark_ball\.js: \d+ bytes/);
      }
      for (const suite of ["drag_features.test.js", "drag_surface.test.js", "drag_reveal.test.js", "light_dark_ball.test.js", "theme_toggle.test.js"]) {
        const checked = testBuiltAssets(directory, suite);
        assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      }
    });
  }
}

for (const mismatch of ["missing referenced ball asset", "leftover disabled ball asset", "non-file ball asset"]) {
  test(`rejects a ${mismatch}`, t => {
    const directory = makeBuild(t);
    const asset = path.join(directory, "assets", "js", "light_dark_ball.js");
    if (mismatch === "leftover disabled ball asset") {
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + gameMarkup + planeMarkup);
    } else {
      fs.rmSync(asset);
      if (mismatch === "non-file ball asset") fs.mkdirSync(asset);
    }
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Light\/dark ball asset inclusion mismatch/);
  });
}

for (const mismatch of ["missing shared controller", "unused shared controller", "wrong script order"]) {
  test(`rejects ${mismatch}`, t => {
    const directory = makeBuild(t);
    let markup;
    if (mismatch === "missing shared controller") {
      fs.rmSync(path.join(directory, "assets", "js", "drag_surface.js"));
      markup = ballMarkup + gameMarkup;
    } else if (mismatch === "unused shared controller") {
      for (const name of ["light_dark_ball.js", "drag_reveal.js"]) {
        fs.rmSync(path.join(directory, "assets", "js", name));
      }
      markup = dragMarkup;
    } else markup = ballMarkup + dragMarkup + gameMarkup;
    fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + markup + planeMarkup);
    const result = optimise(directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Drag controller (dependency mismatch|must load before)/);
  });
}

for (const mismatch of ["missing referenced game asset", "leftover disabled game asset"]) {
  test(`rejects a ${mismatch}`, t => {
    const directory = makeBuild(t);
    if (mismatch === "missing referenced game asset") {
      fs.rmSync(path.join(directory, "assets", "js", "drag_reveal.js"));
    } else {
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + ballMarkup + planeMarkup);
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
  assert.match(planeTests.stdout, /flies a four-second loop and finishes the remaining path at twice the speed/);
  assert.doesNotMatch(planeTests.stdout, /# SKIP/);
});

test("optimises a build with the paper plane excluded and verifies its absence", t => {
  const directory = makeBuild(t);
  fs.rmSync(path.join(directory, "assets", "js", "title_flight.js"));
  fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + ballMarkup + gameMarkup);
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
      fs.writeFileSync(path.join(directory, "index.html"), bannerMarkup + dragMarkup + ballMarkup + gameMarkup);
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
    assert.match(result.stderr, new RegExp(budget === "activity" ? "16 KiB" : budget === "combined" ? "28 KiB" : budget === "ascii" ? "100 KiB" : "8 KiB"));
  });
}
