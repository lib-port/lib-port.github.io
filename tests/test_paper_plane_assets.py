from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PLANE_ASSET = Path("assets/js/title_flight.js")


class PaperPlaneBuildTests(unittest.TestCase):
    def test_switch_controls_output_and_cleans_previous_builds(self) -> None:
        # Exercise the real homepage, exclusion and cleanup in a local site
        # without fetching the remote theme or GitHub repository metadata.
        for environment in ("development", "production"):
            with self.subTest(environment=environment), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "source"
                destination = Path(directory) / "site"
                for relative in (
                    "_plugins/paper_plane_assets.rb",
                    "index.html",
                    str(PLANE_ASSET),
                    "assets/js/theme_toggle.js",
                ):
                    target = source / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(ROOT / relative, target)
                (source / "_layouts").mkdir()
                (source / "_layouts/home.html").write_text("{{ content }}", encoding="utf-8")
                (source / "ignored.txt").write_text("Existing exclusion", encoding="utf-8")
                original_asset = (source / PLANE_ASSET).read_bytes()
                states = (
                    ({"paper_plane": {"switch": True}}, True),
                    ({"paper_plane": {"switch": False}}, False),
                    ({}, False),
                    ({"paper_plane": {}}, False),
                    ({"paper_plane": None}, False),
                    ({"paper_plane": {"switch": None}}, False),
                    ({"paper_plane": {"switch": "true"}}, False),
                    ({"paper_plane": {"switch": True}}, True),
                )
                for settings, enabled in states:
                    with self.subTest(settings=settings):
                        config_path = source / "_config.yml"
                        config_path.write_text(json.dumps({
                            "plugins": ["jekyll-octicons"],
                            "baseurl": "/project",
                            "title": "Library <&> Portfolio",
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
                        self.assertEqual((destination / PLANE_ASSET).is_file(), enabled)
                        self.assertEqual('src="/project/assets/js/title_flight.js"' in html, enabled)
                        self.assertEqual("data-title-flight" in html, enabled)
                        self.assertEqual("data-title-flight-launch" in html, enabled)
                        self.assertEqual("octicon-paper-airplane" in html, enabled)
                        self.assertEqual(html.count('<h1 class="post-title">'), 1)
                        self.assertEqual(html.count("Library &lt;&amp;&gt; Portfolio"), 1)
                        self.assertTrue((destination / "assets/js/theme_toggle.js").is_file())
                        self.assertFalse((destination / "ignored.txt").exists())
                        self.assertEqual((source / PLANE_ASSET).read_bytes(), original_asset)


if __name__ == "__main__":
    unittest.main()
