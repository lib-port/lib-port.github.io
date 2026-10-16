"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const {
  fixture, flick, advance, assertParked, finishShakes, gameEnabled, ballEnabled, assetPath,
} = require("./helpers/drag_fixture");

for (const game of [false, true]) {
  for (const ball of [false, true]) {
    const options = {
      skip: (game && !gameEnabled) || (ball && !ballEnabled)
        ? "The built homepage excludes a feature required by this scenario." : false,
    };
    test(`independent drag switches: game ${game}, ball ${ball}`, options, () => {
      const f = fixture({ game, ball, theme: true, width: 44, left: 330, top: 784, candidateCount: 4 });
      assert.equal(f.root.hasAttribute("data-drag-ready"), game || ball);
      f.roots.slice(1).forEach(item => assert.equal(item.root.hasAttribute("data-drag-ready"), game));
      assert.equal(f.link.listeners.get("pointerdown")?.size || 0, Number(game || ball));
      flick(f);
      assert.equal(f.frames.size, Number(ball));
      assert.equal(f.root.hasAttribute("data-ball-vortex"), ball);
      assert.equal(f.animations.length, Number(game && !ball));
      if (game && !ball) {
        assert.equal(f.animations[0].options.duration, 400);
        f.complete();
      } else if (ball) advance(f, 5000);
      assertParked(f);
      assert.equal(f.link.emit("click", { detail: 0 }).defaultPrevented, false);
      if (!game) {
        const other = f.roots[1];
        other.pointer("pointerdown"); other.pointer("pointermove", 200, 180);
        other.pointer("pointerup");
        assertParked(other);
        assert.equal(other.animations.length, 0);
        f.roots.forEach(item => assert.equal(item.cpu.name, "cpu"));
      }
      f.controller?.destroy();
    });

    test(`distant drops respect independent switches: game ${game}, ball ${ball}`, options, t => {
      const f = fixture({ game, ball, theme: true, width: 44, left: 330, top: 784, candidateCount: 4 });
      t.after(() => f.controller?.destroy());
      flick(f, { pause: 150 });
      assert.equal(f.frames.size, Number(ball));
      assert.equal(f.root.hasAttribute("data-ball-vortex"), ball);
      assert.equal(f.animations.length, Number(game && !ball));
      if (game && !ball) f.complete();
      else if (ball) advance(f, 15000);
      assertParked(f);
    });

    test(`deferred feature registration boots one controller: game ${game}, ball ${ball}`, options, () => {
      const f = fixture({ game: false, ball: false, theme: true, candidateCount: 4 });
      f.documentRef.readyState = "interactive";
      const context = vm.createContext({ window: f.windowRef, document: f.documentRef });
      if (game || ball) {
        vm.runInContext(fs.readFileSync(assetPath("drag_surface.js"), "utf8"), context);
        if (ball) vm.runInContext(fs.readFileSync(assetPath("light_dark_ball.js"), "utf8"), context);
        if (game) vm.runInContext(fs.readFileSync(assetPath("drag_reveal.js"), "utf8"), context);
        assert.equal(f.link.listeners.get("pointerdown")?.size || 0, 0);
        f.documentRef.emit("DOMContentLoaded");
        assert.equal(f.link.listeners.get("pointerdown").size, 1);
        f.roots.slice(1).forEach(item => assert.equal(item.link.listeners.get("pointerdown")?.size || 0, Number(game)));
        const controller = f.windowRef.LibPortDrag.init();
        assert.equal(f.link.listeners.get("pointerdown").size, 1, "reinitialisation removes old listeners");
        controller.destroy();
        f.roots.forEach(item => assert.equal(item.link.listeners.get("pointerdown")?.size || 0, 0));
      } else assert.equal(f.link.listeners.get("pointerdown")?.size || 0, 0);
    });
  }
}

for (const viewport of [false, true]) {
  test(`scroll stops theme-button physics and preserves the revealed creature's shuffle: viewport=${viewport}`, {
    skip: !gameEnabled || !ballEnabled ? "The built homepage excludes a feature required by this scenario." : false,
  }, () => {
    const rolls = [0, 0.5];
    const f = fixture({ game: true, ball: true, theme: true, width: 44, left: 330, top: 784,
      candidateCount: 3, trophy: true, visualViewport: {}, random: () => rolls.length ? rolls.shift() : 0.5 });
    flick(f);
    assert.equal(f.frames.size, 1);
    const target = viewport ? f.windowRef.visualViewport : f.windowRef;
    target.emit("scroll");
    assert.equal(f.frames.size, 0);
    f.roots.forEach(assertParked);
    assert.notEqual(f.cpu.name, "cpu", "the creature waits for the normal shakes");
    finishShakes(f);
    assert.equal(f.cpu.name, "cpu");
    assert.equal(f.candidates.filter(candidate => candidate.children[0].name !== "cpu").length, 1);
    assert.equal(f.trophyProgress.getAttribute("aria-valuenow"), "1");
    f.controller.destroy();
  });
}
