from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
GAME_ASSET = Path("assets/js/drag_reveal.js")


class FindTheBugGameBuildTests(unittest.TestCase):
    def test_switch_controls_output_and_cleans_previous_builds(self) -> None:
        # An isolated local site exercises Jekyll's real exclusion and cleanup
        # without fetching the remote theme or GitHub repository metadata.
        for environment in ("development", "production"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source"
                destination = Path(directory) / "site"
                for relative in (
                    "_plugins/find_the_bug_game_assets.rb",
                    "_includes/sub-footer.html",
                    str(GAME_ASSET),
                    "assets/js/theme_toggle.js",
                ):
                    target = source / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / relative, target)
                (source / "index.html").write_text(
                    "---\n---\n{% include sub-footer.html %}", encoding="utf-8"
                )
                (source / "ignored.txt").write_text("Existing exclusion", encoding="utf-8")
                original_asset = (source / GAME_ASSET).read_bytes()
                states = (
                    ({"find_the_bug_game": {"switch": True}}, True),
                    ({"find_the_bug_game": {"switch": False}}, False),
                    ({}, False),
                    ({"find_the_bug_game": {}}, False),
                    ({"find_the_bug_game": None}, False),
                    ({"find_the_bug_game": {"switch": None}}, False),
                    ({"find_the_bug_game": {"switch": "true"}}, False),
                    ({"find_the_bug_game": {"switch": True}}, True),
                )
                for settings, enabled in states:
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
                            },
                            capture_output=True, text=True, timeout=30,
                        )
                        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        html = (destination / "index.html").read_text(encoding="utf-8")
                        self.assertEqual((destination / GAME_ASSET).is_file(), enabled)
                        self.assertEqual('src="/project/assets/js/drag_reveal.js"' in html, enabled)
                        self.assertEqual("<template data-drag-icons>" in html, enabled)
                        self.assertEqual("octicon-bug" in html, enabled)
                        self.assertEqual("octicon-squirrel" in html, enabled)
                        self.assertTrue((destination / "assets/js/theme_toggle.js").is_file())
                        self.assertIn('src="/project/assets/js/theme_toggle.js" defer', html)
                        self.assertIn("data-theme-toggle", html)
                        self.assertNotIn("data-drag-ready", html)
                        self.assertFalse((destination / "ignored.txt").exists())
                        self.assertEqual((source / GAME_ASSET).read_bytes(), original_asset)
                        if enabled:
                            self.assertLess(html.index("theme_toggle.js"), html.index("drag_reveal.js"))


if __name__ == "__main__":
    unittest.main()
