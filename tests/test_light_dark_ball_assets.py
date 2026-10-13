from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ("drag_surface.js", "light_dark_ball.js", "drag_reveal.js")


class LightDarkBallBuildTests(unittest.TestCase):
    def test_independent_switches_exclude_assets_and_clean_previous_builds(self) -> None:
        # A local Jekyll fixture exercises real exclusions without GitHub calls.
        for environment in ("development", "production"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source"
                destination = Path(directory) / "site"
                for relative in (
                    "_plugins/find_the_bug_game_assets.rb",
                    "_includes/sub-footer.html",
                    "assets/js/theme_toggle.js",
                    *(f"assets/js/{name}" for name in ASSETS),
                ):
                    target = source / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / relative, target)
                (source / "index.html").write_text(
                    "---\n---\n{% include sub-footer.html %}", encoding="utf-8"
                )
                (source / "ignored.txt").write_text("Existing exclusion", encoding="utf-8")
                originals = {name: (source / "assets/js" / name).read_bytes() for name in ASSETS}
                states = (
                    ({"find_the_bug_game": {"switch": True}, "light_dark_ball": {"switch": True}}, True, True),
                    ({"find_the_bug_game": {"switch": True}, "light_dark_ball": {"switch": False}}, True, False),
                    ({"find_the_bug_game": {"switch": False}, "light_dark_ball": {"switch": True}}, False, True),
                    ({"find_the_bug_game": {"switch": False}, "light_dark_ball": {"switch": False}}, False, False),
                    ({"find_the_bug_game": {"switch": True}}, True, False),
                    ({"light_dark_ball": {"switch": True}}, False, True),
                    ({"light_dark_ball": None}, False, False),
                    ({"light_dark_ball": {"switch": None}}, False, False),
                    ({}, False, False),
                    ({"find_the_bug_game": {"switch": True}, "light_dark_ball": {"switch": True}}, True, True),
                )
                for settings, game, ball in states:
                    with self.subTest(settings=settings):
                        config_path = source / "_config.yml"
                        config_path.write_text(json.dumps({
                            "plugins": ["jekyll-octicons"],
                            "baseurl": "/project",
                            "exclude": ["ignored.txt"],
                            **settings,
                        }), encoding="utf-8")
                        result = subprocess.run(
                            ["bundle", "exec", "jekyll", "build", "--quiet",
                             "--config", str(config_path), "--source", str(source),
                             "--destination", str(destination)],
                            cwd=ROOT, env={
                                **os.environ, "JEKYLL_ENV": environment,
                                "JEKYLL_NO_BUNDLER_REQUIRE": "true",
                            }, capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        html = (destination / "index.html").read_text(encoding="utf-8")
                        expected = {
                            "drag_surface.js": game or ball,
                            "light_dark_ball.js": ball,
                            "drag_reveal.js": game,
                        }
                        for name, included in expected.items():
                            self.assertEqual((destination / "assets/js" / name).is_file(), included, name)
                            reference = f'src="/project/assets/js/{name}" defer'
                            self.assertEqual(html.count(reference), int(included), name)
                            self.assertEqual((source / "assets/js" / name).read_bytes(), originals[name])
                            if included and name != "drag_surface.js":
                                self.assertLess(html.index("drag_surface.js"), html.index(reference))
                        self.assertEqual("<template data-drag-icons>" in html, game)
                        self.assertEqual("octicon-bug" in html, game)
                        self.assertTrue((destination / "assets/js/theme_toggle.js").is_file())
                        self.assertIn('src="/project/assets/js/theme_toggle.js" defer', html)
                        self.assertFalse((destination / "ignored.txt").exists())


if __name__ == "__main__":
    unittest.main()
