from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = REPO_ROOT / "_includes" / "repo_grid.html"
MILESTONE_TEMPLATE_PATH = REPO_ROOT / "_includes" / "recent_milestones.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"


class RepoGridTemplateTests(unittest.TestCase):
    def test_repo_title_has_decorative_repo_icon_before_link(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        repo_icon = (
            '<span class="repo-icon" aria-hidden="true">{% octicon repo %}</span>'
        )
        repo_link = (
            '<a class="repo-link linked-card-primary-link" '
            'href="{{ repo.html_url }}">{{ repo.name }}</a>'
        )

        self.assertIn(repo_icon, template)
        self.assertIn(repo_link, template)
        self.assertLess(template.index(repo_icon), template.index(repo_link))

    def test_repo_and_milestone_title_icons_are_muted(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")
        selector = (
            ".repo-title > .repo-icon,\n"
            ".recent-milestone-title > .recent-milestone-icon"
        )
        start = styles.index(f"{selector} {{")
        rule = styles[start : styles.index("\n}", start)]

        self.assertIn("opacity: 0.8;", rule)
        self.assertNotIn(".repo-meta", rule)
        self.assertNotIn(".recent-milestone-details", rule)

    def test_repo_and_milestone_cards_share_linked_card_behaviour(self) -> None:
        repo_template = TEMPLATE_PATH.read_text(encoding="utf-8")
        milestone_template = MILESTONE_TEMPLATE_PATH.read_text(encoding="utf-8")
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn('class="repo-card linked-card"', repo_template)
        self.assertIn(
            'class="repo-link linked-card-primary-link"',
            repo_template,
        )
        self.assertIn(
            'class="recent-milestone-item linked-card"',
            milestone_template,
        )
        self.assertIn(
            'class="linked-card-primary-link" data-recent-milestone-title',
            milestone_template,
        )

        def rule(selector: str) -> str:
            start = styles.index(f"{selector} {{")
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
        self.assertIn('if homepage != ""', template)
        self.assertIn('{% octicon link %}', template)
        self.assertIn(
            '<a href="{{ homepage | escape }}" rel="nofollow">site</a>', template
        )
        self.assertLess(
            template.index('{% octicon file-zip %}'),
            template.index('{% octicon link %}'),
        )


if __name__ == "__main__":
    unittest.main()
