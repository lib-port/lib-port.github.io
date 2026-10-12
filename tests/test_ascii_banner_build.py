from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BUILDER = '''
require "json"
require "jekyll"
Jekyll::Site.new(Jekyll.configuration(JSON.parse(STDIN.read))).process
'''


class AsciiBannerBuildTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.source = Path(directory.name) / "source"
        self.destination = Path(directory.name) / "_site"
        for filename in (
            "index.html",
            "_includes/ascii_banner.html",
            "_plugins/ascii_banner_assets.rb",
            "assets/js/ascii_banner.mjs",
            "assets/js/theme_toggle.js",
        ):
            target = self.source / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / filename, target)
        shutil.copytree(ROOT / "assets/js/ascii-rest", self.source / "assets/js/ascii-rest")
        (self.source / "_layouts").mkdir()
        (self.source / "_layouts/home.html").write_text("{{ content }}", encoding="utf-8")
        (self.source / "excluded.txt").write_text("Excluded fixture", encoding="utf-8")
        self.ascii_files = {
            path.relative_to(self.source): path.read_bytes()
            for path in (self.source / "assets/js").rglob("*")
            if path.is_file() and path.name != "theme_toggle.js"
        }

    def build(self, settings, environment):
        # A local fixture exercises Jekyll without remote themes or GitHub data.
        config = {
            "config": [],
            "source": str(self.source),
            "destination": str(self.destination),
            "plugins": [],
            "disable_disk_cache": True,
            "exclude": ["excluded.txt"],
            "baseurl": "/project",
            **settings,
        }
        result = subprocess.run(
            ["bundle", "exec", "ruby", "-e", BUILDER],
            cwd=ROOT,
            env={**os.environ, "JEKYLL_ENV": environment},
            input=json.dumps(config), capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.destination / "assets/js/theme_toggle.js").is_file())
        self.assertFalse((self.destination / "excluded.txt").exists())
        self.assertFalse((self.destination / "_plugins").exists())
        for filename, content in self.ascii_files.items():
            self.assertEqual((self.source / filename).read_bytes(), content)
        return (self.destination / "index.html").read_text(encoding="utf-8")

    def assert_assets(self, enabled):
        self.assertEqual((self.destination / "assets/js/ascii_banner.mjs").exists(), enabled)
        self.assertEqual((self.destination / "assets/js/ascii-rest").exists(), enabled)
        if enabled:
            for filename, content in self.ascii_files.items():
                self.assertEqual((self.destination / filename).read_bytes(), content)

    def test_disabled_or_missing_banner_excludes_all_assets(self):
        for environment in ("development", "production"):
            for settings in (
                {},
                {"ascii-banner": None},
                {"ascii-banner": {"module": []}},
                {"ascii-banner": {"switch": None}},
                {"ascii-banner": {"switch": False, "module": []}},
            ):
                with self.subTest(environment=environment, settings=settings):
                    homepage = self.build(settings, environment)
                    self.assert_assets(False)
                    self.assertNotIn("ascii-art", homepage)
                    self.assertNotIn("ascii_banner.mjs", homepage)
                    self.assertNotIn('data-home-section="ascii-banner"', homepage)

    def test_enabled_banner_keeps_the_complete_catalogue(self):
        for environment in ("development", "production"):
            for module in ("misty-forest", "random"):
                with self.subTest(environment=environment, module=module):
                    homepage = self.build({"ascii-banner": {"switch": True, "module": module}}, environment)
                    self.assert_assets(True)
                    self.assertIn(f'<ascii-art piece="{module}">', homepage)
                    self.assertIn('src="/project/assets/js/ascii_banner.mjs"', homepage)

    def test_rebuild_removes_and_restores_assets_in_the_same_destination(self):
        for environment in ("development", "production"):
            for enabled in (True, False, True):
                with self.subTest(environment=environment, enabled=enabled):
                    self.build({"ascii-banner": {"switch": enabled, "module": "random"}}, environment)
                    self.assert_assets(enabled)


if __name__ == "__main__":
    unittest.main()
