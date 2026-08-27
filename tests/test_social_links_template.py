from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "_config.yml"
TEMPLATE_PATH = REPO_ROOT / "_includes" / "social.html"
LIQUID_RENDERER = """
require "json"
require "liquid"

context = JSON.parse(STDIN.read)
template = Liquid::Template.parse(File.read(ARGV.fetch(0), encoding: "UTF-8"))
print template.render!(context)
"""


class SocialLinksTemplateTests(unittest.TestCase):
    def render_social_links(
        self,
        entries: list[dict[str, str | None]],
        repository_url: str | None,
    ) -> str:
        context = {
            "site": {
                "minima": {
                    "social_links": entries,
                    "hide_site_feed_link": True,
                },
                "github": {"repository_url": repository_url},
            }
        }
        result = subprocess.run(
            ["bundle", "exec", "ruby", "-e", LIQUID_RENDERER, str(TEMPLATE_PATH)],
            cwd=REPO_ROOT,
            input=json.dumps(context),
            capture_output=True,
            check=True,
            text=True,
        )
        return result.stdout

    def test_github_entry_uses_current_minima_keys_without_a_fixed_url(self) -> None:
        config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))
        github_entry = config["minima"]["social_links"][0]

        self.assertEqual(github_entry["title"], "GitHub repository")
        self.assertEqual(github_entry["icon"], "github")
        self.assertIn("url", github_entry)
        self.assertIsNone(github_entry["url"])
        self.assertNotIn("platform", github_entry)
        self.assertNotIn("user_url", github_entry)

    def test_github_entry_falls_back_to_repository_metadata(self) -> None:
        repository_url = "https://github.com/example/example.github.io"
        rendered = self.render_social_links(
            [{"title": "GitHub repository", "icon": "github", "url": None}],
            repository_url,
        )

        self.assertIn(f'href="{repository_url}"', rendered)
        self.assertIn("fa-brands fa-github fa-lg", rendered)

    def test_explicit_github_url_takes_precedence_over_repository_metadata(self) -> None:
        explicit_url = "https://github.com/example/profile"
        repository_url = "https://github.com/example/example.github.io"
        rendered = self.render_social_links(
            [
                {
                    "title": "GitHub profile",
                    "icon": "github",
                    "url": explicit_url,
                }
            ],
            repository_url,
        )

        self.assertIn(f'href="{explicit_url}"', rendered)
        self.assertNotIn(f'href="{repository_url}"', rendered)

    def test_unresolved_social_links_are_not_rendered(self) -> None:
        rendered = self.render_social_links(
            [{"title": "GitHub repository", "icon": "github", "url": None}],
            None,
        )

        self.assertNotIn("<li>", rendered)
        self.assertNotIn('href=""', rendered)

    def test_feed_link_behaviour_is_preserved(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("unless site.minima.hide_site_feed_link", template)
        self.assertIn("site.feed.path | default: 'feed.xml' | absolute_url", template)


if __name__ == "__main__":
    unittest.main()
