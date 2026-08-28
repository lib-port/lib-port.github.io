from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
HEADER_PATH = REPO_ROOT / "_includes" / "header.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"
LIQUID_RENDERER = """
require "json"
require "liquid"
require "jekyll-octicons"

class TestIncludeTag < Liquid::Tag
  def render(_context)
    '<a class="nav-item" href="/page/">Page</a>'
  end
end

module TestFilters
  def relative_url(input)
    input
  end
end

Liquid::Template.register_tag("include", TestIncludeTag)
context = JSON.parse(STDIN.read)
template = Liquid::Template.parse(File.read(ARGV.fetch(0), encoding: "UTF-8"))
print template.render!(context, filters: [TestFilters])
"""


class HeaderTemplateTests(unittest.TestCase):
    def render_header(
        self,
        *,
        owner_url: str | None,
        owner_name: str | None,
        github_icon: dict[str, Any] | None = None,
        pages: list[dict[str, str]] | None = None,
    ) -> str:
        site: dict[str, Any] = {
            "title": "Test site",
            "pages": pages or [],
            "minima": {"nav_pages": None},
            "github": {
                "owner_url": owner_url,
                "owner_name": owner_name,
            },
        }
        if github_icon is not None:
            site["github-icon"] = github_icon

        result = subprocess.run(
            ["bundle", "exec", "ruby", "-e", LIQUID_RENDERER, str(HEADER_PATH)],
            cwd=REPO_ROOT,
            input=json.dumps({"site": site, "page": {}}),
            capture_output=True,
            check=True,
            text=True,
        )
        return result.stdout

    def test_profile_destination_uses_owner_url_and_default_text_style(self) -> None:
        rendered = self.render_header(
            owner_url="https://github.com/example",
            owner_name="example",
            github_icon={"switch": True, "link": "profile"},
        )

        self.assertIn('href="https://github.com/example"', rendered)
        self.assertNotIn("?tab=repositories", rendered)
        self.assertIn('aria-label="View profile on GitHub for example"', rendered)
        self.assertIn("github-icon-link--text", rendered)
        self.assertIn('class="octicon octicon-logo-github"', rendered)
        self.assertNotIn('class="octicon octicon-mark-github"', rendered)
        self.assertNotIn("target=", rendered)

    def test_repos_destination_uses_owner_repositories_tab(self) -> None:
        rendered = self.render_header(
            owner_url="https://github.com/example",
            owner_name="example",
            github_icon={"switch": True, "link": "repos", "style": "text"},
        )

        self.assertIn('href="https://github.com/example?tab=repositories"', rendered)
        self.assertIn('aria-label="View repositories on GitHub for example"', rendered)
        self.assertIn('class="octicon octicon-logo-github"', rendered)

    def test_icon_style_uses_github_mark(self) -> None:
        rendered = self.render_header(
            owner_url="https://github.com/example",
            owner_name="example",
            github_icon={"switch": True, "link": "profile", "style": "icon"},
        )

        self.assertIn("github-icon-link--icon", rendered)
        self.assertIn('class="octicon octicon-mark-github"', rendered)
        self.assertNotIn('class="octicon octicon-logo-github"', rendered)

    def test_false_or_missing_switch_omits_icon(self) -> None:
        configurations = (
            {"switch": False, "link": ["invalid"], "style": ["invalid"]},
            {"link": "repos", "style": "text"},
            None,
        )
        for github_icon in configurations:
            with self.subTest(github_icon=github_icon):
                rendered = self.render_header(
                    owner_url="https://github.com/example",
                    owner_name="example",
                    github_icon=github_icon,
                )

                self.assertNotIn("github-icon-link", rendered)
                self.assertNotIn("octicon-logo-github", rendered)
                self.assertNotIn("octicon-mark-github", rendered)
                self.assertNotIn("site-header-actions--with-github-icon", rendered)

    def test_invalid_enabled_link_is_safely_omitted(self) -> None:
        for link in (None, "", "PROFILE", "projects", "issues", ["repos"]):
            with self.subTest(link=link):
                rendered = self.render_header(
                    owner_url="https://github.com/example",
                    owner_name="example",
                    github_icon={"switch": True, "link": link, "style": "text"},
                )

                self.assertNotIn("github-icon-link", rendered)
                self.assertNotIn('href="?tab=repositories"', rendered)

    def test_invalid_enabled_style_is_safely_omitted(self) -> None:
        rendered = self.render_header(
            owner_url="https://github.com/example",
            owner_name="example",
            github_icon={"switch": True, "link": "repos", "style": "wordmark"},
        )

        self.assertNotIn("github-icon-link", rendered)
        self.assertNotIn("octicon-logo-github", rendered)
        self.assertNotIn("octicon-mark-github", rendered)

    def test_enabled_icon_is_omitted_without_owner_metadata(self) -> None:
        rendered = self.render_header(
            owner_url=None,
            owner_name=None,
            github_icon={"switch": True, "link": "repos", "style": "text"},
        )

        self.assertNotIn("github-icon-link", rendered)
        self.assertNotIn("octicon-logo-github", rendered)
        self.assertNotIn('href="?tab=repositories"', rendered)

    def test_page_navigation_precedes_the_github_icon(self) -> None:
        rendered = self.render_header(
            owner_url="https://github.com/example",
            owner_name="example",
            github_icon={"switch": True, "link": "repos", "style": "text"},
            pages=[{"path": "page.md", "title": "Page"}],
        )

        self.assertLess(
            rendered.index('class="nav-item"'),
            rendered.index('class="github-icon-link'),
        )

    def test_template_reads_the_hyphenated_configuration_key(self) -> None:
        template = HEADER_PATH.read_text(encoding="utf-8")

        self.assertIn('site["github-icon"]', template)

    def test_styles_keep_header_actions_right_aligned_and_responsive(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        def rule(selector: str) -> str:
            start = styles.index(f"{selector} {{")
            end = styles.index("\n}", start)
            return styles[start:end]

        self.assertRegex(
            styles,
            r"\.site-header > \.wrapper\s*\{[^}]*display:\s*flex",
        )
        self.assertRegex(
            styles,
            r"\.site-header-actions\s*\{[^}]*margin-inline-start:\s*auto",
        )
        self.assertRegex(
            styles,
            r"\.github-icon-link\s*\{[^}]*width:\s*3\.5625rem",
        )
        link_rule = rule(".github-icon-link")
        self.assertIn("box-sizing: border-box;", link_rule)
        self.assertNotIn("border:", link_rule)

        hover_rule = rule(".github-icon-link:hover")
        self.assertIn(
            "border: 1px solid var(--minima-link-base-color);",
            hover_rule,
        )
        self.assertIn("color: var(--minima-text-color);", hover_rule)
        self.assertIn("text-decoration: none;", hover_rule)
        self.assertRegex(
            styles,
            r"\.github-icon-link--text > \.octicon\s*\{[^}]*width:\s*2\.8125rem",
        )
        self.assertRegex(
            styles,
            r"\.github-icon-link--icon > \.octicon\s*\{[^}]*width:\s*1rem",
        )
        self.assertIn(".github-icon-link:focus-visible", styles)
        self.assertNotIn(".github-projects-link", styles)
        self.assertRegex(
            styles,
            r"@media screen and \(max-width: 600px\)\s*\{\s*\.site-header-actions--with-github-icon > \.site-nav\s*\{[^}]*right:",
        )


if __name__ == "__main__":
    unittest.main()
