from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from site_config import ConfigValidationError, validate_site_config

RENDERER = r'''
require "json"
require "liquid"
class TestInclude < Liquid::Tag
  def initialize(tag, args, tokens)
    super
    @filename = args.strip
  end
  def render(context)
    if @filename == "repo_grid.html"
      return context["site"]["repo_grid"]["switch"] ? "<p>Repository fixture</p>" : ""
    end
    return "" unless ["intro.html", "ascii_banner.html"].include?(@filename)
    Liquid::Template.parse(File.read(File.join("_includes", @filename))).render!(context)
  end
end
module Filters
  def relative_url(input)
    @context["site"]["baseurl"].to_s + input
  end
  def to_s(input)
    input.to_s
  end
end
Liquid::Template.register_tag("include", TestInclude)
context = JSON.parse(STDIN.read)
source = File.read("index.html").split("---", 3).last
print Liquid::Template.parse(source).render!(context, filters: [Filters])
'''


class AsciiBannerTests(unittest.TestCase):
    def validate(self, settings):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "_config.yml"
            filename.write_text(json.dumps(settings), encoding="utf-8")
            return validate_site_config(filename)

    def render(self, settings):
        site = {"title": "Test", "baseurl": "/project", **settings}
        site["keys"] = list(site)
        result = subprocess.run(
            ["bundle", "exec", "ruby", "-e", RENDERER], cwd=ROOT,
            input=json.dumps({"site": site}), capture_output=True, text=True, check=True,
        )
        return result.stdout

    def test_all_imported_scenes_are_valid_configuration(self):
        manifest = json.loads((ROOT / "assets/js/ascii-rest/manifest.json").read_text())
        for name in manifest["scenes"]:
            with self.subTest(name=name):
                config = self.validate({"ascii-banner": {"switch": True, "module": f" {name} "}})
                self.assertTrue(config.ascii_banner.enabled)
                self.assertEqual(config.ascii_banner.module, name)

    def test_disabled_or_missing_banner_ignores_inner_settings(self):
        for settings in ({}, {"ascii-banner": {"module": []}},
                         {"ascii-banner": {"switch": False, "module": "random"}},
                         {"ascii-banner": {"switch": False, "module": []}}):
            with self.subTest(settings=settings):
                self.assertFalse(self.validate(settings).ascii_banner.enabled)
                rendered = self.render(settings)
                self.assertNotIn("ascii-art", rendered)
                self.assertNotIn("ascii_banner.mjs", rendered)
                self.assertNotIn('data-home-section="ascii-banner"', rendered)

    def test_invalid_switch_and_scene_settings_are_rejected(self):
        for switch in ("true", 1, [], {}):
            with self.subTest(switch=switch), self.assertRaisesRegex(
                ConfigValidationError, r"ascii-banner.switch must be a YAML boolean"
            ):
                self.validate({"ascii-banner": {"switch": switch, "module": "misty-forest"}})
        for module in (None, "", " ", "donut", "../mount", "MISTY-FOREST", "RANDOM", "randomly", 12, []):
            with self.subTest(module=module), self.assertRaises(ConfigValidationError):
                self.validate({"ascii-banner": {"switch": True, "module": module}})

    def test_random_is_valid_and_remains_hidden_until_javascript_initialises(self):
        settings = {"ascii-banner": {"switch": True, "module": " random "}}
        config = self.validate(settings)
        self.assertTrue(config.ascii_banner.enabled)
        self.assertEqual(config.ascii_banner.module, "random")
        rendered = self.render(settings)
        self.assertIn('<ascii-art piece="random"></ascii-art>', rendered)
        self.assertRegex(rendered, r'data-home-section="ascii-banner"\s+hidden')
        self.assertIn('<hr class="section-divider">', rendered)

    def test_random_requires_a_non_empty_catalogue(self):
        with patch("site_config.json.loads", return_value={"scenes": []}):
            with self.assertRaisesRegex(ConfigValidationError, "non-empty"):
                self.validate({"ascii-banner": {"switch": True, "module": "random"}})

    def test_random_requires_locally_available_scene_files(self):
        with patch("site_config.Path.is_file", return_value=False):
            with self.assertRaisesRegex(ConfigValidationError, "locally available scenes"):
                self.validate({"ascii-banner": {"switch": True, "module": "random"}})

    def test_enabled_banner_is_hidden_and_uses_local_script_with_baseurl(self):
        rendered = self.render({"ascii-banner": {"switch": True, "module": "misty-forest"}})
        self.assertIn('<ascii-art piece="misty-forest"></ascii-art>', rendered)
        self.assertIn('type="module" src="/project/assets/js/ascii_banner.mjs"', rendered)
        self.assertRegex(rendered, r'data-home-section="ascii-banner"\s+hidden')
        self.assertIn('<hr class="section-divider">', rendered)
        self.assertNotIn("https://ascii.rest", rendered)

    def test_homepage_position_follows_configuration_order(self):
        intro = {"intro": {"switch": True, "text": "Introduction fixture"}}
        banner = {"ascii-banner": {"switch": True, "module": "misty-forest"}}
        repos = {"repo_grid": {"switch": True}}
        for settings, first, second in (
            ({**intro, **banner, **repos}, "Introduction fixture", "<ascii-art"),
            ({**banner, **intro, **repos}, "<ascii-art", "Introduction fixture"),
        ):
            with self.subTest(settings=settings):
                rendered = self.render(settings)
                self.assertLess(rendered.index(first), rendered.index(second))
                self.assertLess(rendered.index(second), rendered.index("Repository fixture"))


if __name__ == "__main__":
    unittest.main()
