"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const { clientAssetPath } = require("./client_assets");
const root = path.join(__dirname, "..", "assets", "js");
const asset = name => clientAssetPath(path.join(root, name));
const loader = () => import(pathToFileURL(asset("ascii_banner.mjs")));
const manifest = JSON.parse(fs.readFileSync(asset("ascii-rest/manifest.json"), "utf8"));

function fixture(piece = "misty-forest") {
  const listeners = new Map();
  const attributes = new Map([["piece", piece]]);
  const art = {
    ready: false,
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    addEventListener: (type, listener) => listeners.set(type, listener),
    emit(type) { listeners.get(type)?.(); },
  };
  const section = {
    hidden: true,
    querySelector: selector => selector === "ascii-art" || art.ready ? art : null,
  };
  const document = { querySelectorAll: () => [section] };
  return { art, section, document };
}

test("reveals the hidden banner only after its component reports success", async () => {
  const { initAsciiBanners } = await loader();
  const { art, section, document } = fixture();
  await initAsciiBanners(document, async () => {
    assert.equal(section.hidden, true);
  });
  assert.equal(section.hidden, true);
  art.emit("ascii-art-ready");
  assert.equal(section.hidden, false);
  art.emit("ascii-art-error");
  assert.equal(section.hidden, true);
});

test("installs readiness listeners before the component can initialise", async () => {
  const { initAsciiBanners } = await loader();
  const { art, section, document } = fixture();
  await initAsciiBanners(document, async () => art.emit("ascii-art-ready"));
  assert.equal(section.hidden, false);
});

test("an already-mounted component reveals its wrapper", async () => {
  const { initAsciiBanners } = await loader();
  const { art, section, document } = fixture();
  art.ready = true;
  await initAsciiBanners(document, async () => {});
  assert.equal(section.hidden, false);
});

test("component import failure leaves the banner hidden", async () => {
  const { initAsciiBanners } = await loader();
  const { section, document } = fixture();
  let warnings = 0;
  await initAsciiBanners(document, async () => { throw new Error("missing local module"); },
    { warn: () => warnings++ });
  assert.equal(section.hidden, true);
  assert.equal(warnings, 1);
});

test("absent banners cause no component loading", async () => {
  const { initAsciiBanners } = await loader();
  await initAsciiBanners({ querySelectorAll: () => [] }, async () => assert.fail("unexpected import"));
});

for (const [label, draw, index] of [
  ["first", 0, 0],
  ["middle", 0.5, 7],
  ["last", 1 - Number.EPSILON, 14],
]) {
  test(`random selects the ${label} scene before component initialisation`, async () => {
    const { initAsciiBanners } = await loader();
    const { art, section, document } = fixture("random");
    await initAsciiBanners(document, async () => {
      assert.equal(art.getAttribute("piece"), manifest.scenes[index]);
      assert.equal(section.hidden, true);
      art.emit("ascii-art-ready");
    }, console, () => draw);
    assert.equal(section.hidden, false);
  });
}

test("repeated initialisation retains the randomly selected scene", async () => {
  const { initAsciiBanners } = await loader();
  const { art, document } = fixture("random");
  let draws = 0;
  const random = () => { draws++; return 0; };
  await initAsciiBanners(document, async () => {}, console, random);
  const chosen = art.getAttribute("piece");
  await initAsciiBanners(document, async () => {}, console, random);
  assert.equal(draws, 1);
  assert.equal(art.getAttribute("piece"), chosen);
});

test("fixed scene selections never call the random chooser", async () => {
  const { initAsciiBanners } = await loader();
  const { art, document } = fixture();
  await initAsciiBanners(document, async () => {},
    { warn: () => assert.fail("unexpected initialisation error") },
    () => assert.fail("unexpected random selection"));
  assert.equal(art.getAttribute("piece"), "misty-forest");
});

test("a failed component import keeps a random banner hidden", async () => {
  const { initAsciiBanners } = await loader();
  const { art, section, document } = fixture("random");
  let warnings = 0;
  await initAsciiBanners(document, async () => { throw new Error("missing local module"); },
    { warn: () => warnings++ }, () => 0);
  assert.equal(art.getAttribute("piece"), manifest.scenes[0]);
  assert.equal(section.hidden, true);
  assert.equal(warnings, 1);
});

test("the local registry contains exactly the complete imported scene catalogue", async () => {
  const { names, isPiece } = await import(pathToFileURL(asset("ascii-rest/library.js")));
  assert.equal(manifest.scenes.length, 15);
  assert.deepEqual(names, manifest.scenes);
  assert.equal(isPiece("misty-forest"), true);
  assert.equal(isPiece("donut"), false);
  assert.equal(isPiece("../mount"), false);
  assert.equal(isPiece("__proto__"), false);
  const files = fs.readdirSync(path.dirname(asset("ascii-rest/pieces/misty-forest.js")))
    .filter(name => name.endsWith(".js")).map(name => name.slice(0, -3)).sort();
  assert.deepEqual(files, [...names].sort());
});

for (const name of manifest.scenes) {
  test(`${name} produces valid local frames and palette indices`, async () => {
    const { load } = await import(pathToFileURL(asset("ascii-rest/library.js")));
    const piece = await load[name]();
    const { meta } = piece;
    assert.equal(meta.category, "scenes");
    assert.ok(meta.palette.length > 0);
    const frame = piece.default(meta.options);
    const color = new Uint8Array(meta.cols * meta.rows);
    for (const time of [0, 1]) {
      const rows = frame(time, { paper: false, color }).split("\n");
      assert.equal(rows.length, meta.rows);
      assert.ok(rows.every(row => row.length === meta.cols));
      assert.ok(color.every(index => index < meta.palette.length));
    }
  });
}
