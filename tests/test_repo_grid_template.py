from __future__ import annotations

import json
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = REPO_ROOT / "_includes" / "repo_grid.html"
INTRO_TEMPLATE_PATH = REPO_ROOT / "_includes" / "intro.html"
MILESTONE_TEMPLATE_PATH = REPO_ROOT / "_includes" / "recent_milestones.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"
LIQUID_RENDERER = """
require "json"
require "jekyll"
require "jekyll-octicons"

class TestIncludeTag < Liquid::Tag
  def render(_context)
    '<p data-repo-grid-error>Repository metadata unavailable</p>'
  end
end

Liquid::Template.register_tag("include", TestIncludeTag)
context = JSON.parse(STDIN.read)
template = Liquid::Template.parse(File.read(ARGV.fetch(0), encoding: "UTF-8"))
print template.render!(context, filters: [Jekyll::Filters])
"""


class RenderedRepoGrid(HTMLParser):
    def __init__(self, html: str) -> None:
        super().__init__()
        self.repo_names: list[str] = []
        self.download_urls: list[str] = []
        self.has_error = False
        self.feed(html)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "li" and "data-repo-name" in attributes:
            self.repo_names.append(attributes["data-repo-name"])
        if tag == "a" and attributes.get("class") == "repo-download":
            self.download_urls.append(attributes["href"])
        if "data-repo-grid-error" in attributes:
            self.has_error = True


class RepoGridTemplateTests(unittest.TestCase):
    @staticmethod
    def repository(name: str = "tech-lib", branch: str | None = "main") -> dict:
        return {
            "name": name,
            "html_url": f"https://github.com/example/{name}",
            "owner": {"login": "example"},
            "description": "Local fixture metadata",
            "default_branch": branch,
        }

    def render_grid(self, repo_list: list[str], repositories: list[dict]) -> RenderedRepoGrid:
        # Render seeded metadata locally; no GitHub requests are needed.
        result = subprocess.run(
            ["bundle", "exec", "ruby", "-e", LIQUID_RENDERER, str(TEMPLATE_PATH)],
            cwd=REPO_ROOT,
            input=json.dumps({"site": {
                "repo_grid": {"switch": True, "repo_list": repo_list},
                "github": {"public_repositories": repositories},
            }}),
            capture_output=True, text=True, check=True, timeout=20,
        )
        return RenderedRepoGrid(result.stdout)

    def test_repository_names_ignore_case_and_surrounding_whitespace(self) -> None:
        for configured_name in ("Tech-Lib", "tech-lib", "TECH-LIB", " \t tEcH-LiB \n"):
            with self.subTest(configured_name=configured_name):
                rendered = self.render_grid([configured_name], [self.repository("Tech-Lib")])
                self.assertEqual(rendered.repo_names, ["Tech-Lib"])
                self.assertFalse(rendered.has_error)

    def test_repository_selection_preserves_order_and_skips_unmatched_names(self) -> None:
        rendered = self.render_grid(
            [" Beta ", "missing", " ALPHA ", "another-missing"],
            [self.repository(name) for name in ("Alpha", "Beta", "Unselected")],
        )
        self.assertEqual(rendered.repo_names, ["Beta", "Alpha"])
        self.assertFalse(rendered.has_error)

    def test_unknown_repositories_keep_the_error_fallback(self) -> None:
        rendered = self.render_grid(["missing"], [self.repository()])
        self.assertEqual(rendered.repo_names, [])
        self.assertTrue(rendered.has_error)

    def test_archive_urls_encode_default_branch_names(self) -> None:
        for branch in ("main", "feature/branch", "trunk#v2", "release%2Fv1", "feature+preview", None, ""):
            with self.subTest(branch=branch):
                rendered = self.render_grid(["tech-lib"], [self.repository(branch=branch)])
                self.assertEqual(len(rendered.download_urls), 1)
                url = urlsplit(rendered.download_urls[0])
                self.assertEqual(url.fragment, "")
                self.assertEqual(url.query, "")
                self.assertEqual(
                    unquote(url.path),
                    f"/example/tech-lib/archive/refs/heads/{branch or 'main'}.zip",
                )

    def test_repo_title_keeps_its_decorative_drag_handle_inside_the_link(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        repo_icon = (
            '<span class="repo-icon" data-drag-handle aria-hidden="true">{% octicon repo height:16 %}</span>'
        )
        repo_link = (
            '<a class="repo-link linked-card-primary-link" '
            'href="{{ repo.html_url | escape }}">'
        )

        self.assertIn(repo_icon, template)
        self.assertIn(repo_link, template)
        self.assertLess(template.index(repo_link), template.index(repo_icon))
        self.assertLess(template.index(repo_icon), template.index('<span>{{ repo.name | escape }}</span>'))

    def test_repo_and_milestone_title_icons_are_muted(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")
        selector = (
            ".repo-title .repo-icon,\n"
            ".recent-milestone-title .recent-milestone-icon"
        )
        start = styles.index(f"\n{selector} {{") + 1
        rule = styles[start : styles.index("\n}", start)]

        self.assertIn("opacity: 0.8;", rule)
        self.assertNotIn(".repo-meta", rule)
        self.assertNotIn(".recent-milestone-details", rule)

    def test_repo_and_milestone_cards_share_linked_card_behaviour(self) -> None:
        repo_template = TEMPLATE_PATH.read_text(encoding="utf-8")
        milestone_template = MILESTONE_TEMPLATE_PATH.read_text(encoding="utf-8")
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn('class="repo-card draggable-card"', repo_template)
        self.assertIn(
            'class="repo-link linked-card-primary-link"',
            repo_template,
        )
        self.assertIn(
            'class="recent-milestone-item draggable-card"',
            milestone_template,
        )
        self.assertIn(
            'class="linked-card-primary-link" data-recent-milestone-title',
            milestone_template,
        )
        for template in (repo_template, milestone_template):
            self.assertIn('data-drag-reveal', template)
            self.assertIn('<div class="linked-card" data-drag-surface>', template)
            self.assertRegex(template, r'<span class="card-cpu" aria-hidden="true"(?: data-drag-surprise)?>\{% octicon cpu height:32 %\}</span>')
        self.assertEqual(repo_template.count("data-drag-surprise"), 1)
        self.assertEqual(milestone_template.count("data-drag-surprise"), 1)

        def rule(selector: str) -> str:
            start = styles.index(f"\n{selector} {{") + 1
            end = styles.index("\n}", start)
            return styles[start:end]

        card_rule = rule(".linked-card")
        self.assertIn(
            "--linked-card-accent: var(--minima-link-base-color);",
            card_rule,
        )
        self.assertIn("position: relative;", card_rule)
        self.assertIn("isolation: isolate;", card_rule)
        self.assertIn("gap: 0.5rem;", card_rule)
        self.assertIn("border-color 120ms ease", card_rule)
        self.assertIn("background-color 120ms ease", card_rule)

        hover_rule = rule(".linked-card:hover")
        self.assertIn("border-color: var(--linked-card-accent);", hover_rule)
        self.assertIn("var(--linked-card-background) 92%", hover_rule)
        self.assertIn("cursor: pointer;", hover_rule)

        focus_rule = rule(".linked-card:focus-within")
        self.assertIn("border-color: var(--linked-card-accent);", focus_rule)
        self.assertIn(".linked-card { transition: none; }", styles)
        self.assertIn(
            ".linked-card:hover .linked-card-primary-link {",
            styles,
        )
        self.assertIn(".linked-card-primary-link::after {", styles)
        self.assertIn(
            ".linked-card-foreground {\n"
            "  position: relative;\n"
            "  z-index: 2;",
            styles,
        )
        self.assertIn(
            'class="repo-meta linked-card-foreground"',
            repo_template,
        )
        self.assertIn(
            'class="recent-milestone-repo linked-card-foreground"',
            milestone_template,
        )
        self.assertIn("background: var(--linked-card-accent);", styles)
        self.assertNotIn("--repo-accent", styles)
        self.assertNotIn("--milestone-accent", styles)

    def test_noassertion_license_is_not_rendered(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn('repo.license.spdx_id != "NOASSERTION"', template)

    def test_homepage_site_link_is_optional_and_follows_download(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn(
            'assign homepage = repo.homepage | default: "" | strip', template
        )
        self.assertIn('homepage_https_prefix == "https://"', template)
        self.assertIn('homepage_http_prefix == "http://"', template)
        self.assertIn('{% octicon link height:16 %}', template)
        self.assertIn(
            '<a href="{{ homepage | escape }}" rel="nofollow">site</a>', template
        )
        self.assertLess(
            template.index('{% octicon file-zip height:16 %}'),
            template.index('{% octicon link height:16 %}'),
        )

    def test_plain_text_configuration_and_repository_metadata_are_escaped(self) -> None:
        intro_template = INTRO_TEMPLATE_PATH.read_text(encoding="utf-8")
        repo_template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("{{ intro_text | escape }}", intro_template)
        for expression in (
            "{{ repo.name | escape }}",
            "{{ repo.description | escape }}",
            "{{ repo.license.spdx_id | escape }}",
        ):
            with self.subTest(expression=expression):
                self.assertIn(expression, repo_template)


if __name__ == "__main__":
    unittest.main()
