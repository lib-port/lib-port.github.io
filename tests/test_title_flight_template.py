from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
RENDERER = r"""
require "json"
require "liquid"
require "jekyll-octicons"
class TestInclude < Liquid::Tag
  def render(_context)
    ""
  end
end
module TestFilters
  def relative_url(input)
    "/project" + input
  end
end
Liquid::Template.register_tag("include", TestInclude)
source = File.read("index.html").sub(/\A---\s*\n.*?\n---\s*\n/m, "")
print Liquid::Template.parse(source).render!(JSON.parse(STDIN.read), filters: [TestFilters])
"""


class TitleFlightTemplateTests(unittest.TestCase):
    def render_title(self, configuration: dict | None) -> str:
        site = {"title": "Library <&> Portfolio"}
        if configuration is not None:
            site["paper_plane"] = configuration
        return subprocess.run(
            ["bundle", "exec", "ruby", "-e", RENDERER],
            cwd=REPO_ROOT,
            input=json.dumps({"site": site}),
            text=True,
            capture_output=True,
            check=True,
        ).stdout

    def test_enabled_plane_preserves_the_heading_and_escaped_title(self) -> None:
        rendered = self.render_title({"switch": True})
        self.assertEqual(rendered.count('<h1 class="post-title">'), 1)
        self.assertEqual(rendered.count("Library &lt;&amp;&gt; Portfolio"), 1)
        self.assertIn('data-title-flight-plane aria-hidden="true"', rendered)
        self.assertIn(
            'data-title-flight-launch type="button" aria-label="Fly paper plane" hidden', rendered
        )
        self.assertIn('class="octicon octicon-paper-airplane"', rendered)
        self.assertIn('src="/project/assets/js/title_flight.js" defer', rendered)
        self.assertNotIn("tabindex", rendered)

    def test_disabled_or_missing_switch_preserves_plain_title_without_loading_script(self) -> None:
        for configuration in (None, {}, {"switch": False}, {"switch": "true"}):
            with self.subTest(configuration=configuration):
                rendered = self.render_title(configuration)
                self.assertIn('<h1 class="post-title">', rendered)
                self.assertEqual(rendered.count("Library &lt;&amp;&gt; Portfolio"), 1)
                self.assertNotIn("data-title-flight", rendered)
                self.assertNotIn("title_flight.js", rendered)


if __name__ == "__main__":
    unittest.main()
