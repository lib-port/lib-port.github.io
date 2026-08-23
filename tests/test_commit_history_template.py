from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = REPO_ROOT / "_includes" / "commit_history.html"
INDEX_PATH = REPO_ROOT / "index.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"


class CommitHistoryTemplateTests(unittest.TestCase):
    def test_homepage_dispatches_to_an_initially_hidden_section(self) -> None:
        index = INDEX_PATH.read_text(encoding="utf-8")

        self.assertIn('{%- when "commit_history" -%}', index)
        self.assertIn('{%- include commit_history.html -%}', index)
        self.assertIn('data-home-section="{{ section_key | escape }}"', index)
        self.assertIn('section_key == "commit_history" %} hidden', index)

    def test_visibility_aware_dividers_ignore_hidden_sections(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".home-section-wrapper[hidden]", styles)
        self.assertIn(
            ".home-section-wrapper:not([hidden]) ~ .home-section-wrapper:not([hidden]) > .section-divider",
            styles,
        )

    def test_template_excludes_forks_and_archived_repositories(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("site.github.owner_name", template)
        self.assertIn("site.github.public_repositories", template)
        self.assertIn("unless repo.fork or repo.archived", template)
        self.assertIn('{"name":{{ repo.name | jsonify }}', template)

    def test_template_contains_loading_error_and_empty_states(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn(
            '<h2>Recent Activity <span class="section-heading-meta">(GitHub commits)</span></h2>',
            template,
        )
        self.assertIn("data-commit-history-loading", template)
        self.assertIn("{% octicon gear %}", template)
        self.assertIn("loading recent commits", template)
        self.assertIn("data-commit-history-error", template)
        self.assertIn("{% octicon alert %}", template)
        self.assertIn("unable to load recent commits", template)
        self.assertIn("data-commit-history-empty", template)
        self.assertIn("No recent commits found", template)
        self.assertNotIn("View GitHub activity", template)
        self.assertNotIn("data-commit-history-fallback", template)

    def test_template_contains_semantic_commit_timeline(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn('<ul class="commit-history-list"', template)
        self.assertIn('<li class="commit-history-item"', template)
        self.assertIn("data-commit-history-marker", template)
        self.assertIn("{% octicon git-commit %}", template)
        context_icons = {
            "repo": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon repo %}</span>',
            "log": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon log %}</span>',
            "calendar": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon calendar %}</span>',
        }
        for icon_markup in context_icons.values():
            self.assertIn(icon_markup, template)
        self.assertIn("data-commit-history-repo", template)
        self.assertIn("data-commit-history-message", template)
        self.assertIn("<time", template)
        item_markup = template.split(
            '<li class="commit-history-item"', 1
        )[1].split("</li>", 1)[0]
        self.assertLess(
            item_markup.index("data-commit-history-marker"),
            item_markup.index(context_icons["repo"]),
        )
        self.assertLess(
            item_markup.index(context_icons["repo"]),
            item_markup.index("data-commit-history-repo"),
        )
        self.assertLess(
            item_markup.index("data-commit-history-repo"),
            item_markup.index(context_icons["log"]),
        )
        self.assertLess(
            item_markup.index(context_icons["log"]),
            item_markup.index("data-commit-history-message"),
        )
        self.assertLess(
            item_markup.index("data-commit-history-message"),
            item_markup.index(context_icons["calendar"]),
        )
        self.assertLess(
            item_markup.index(context_icons["calendar"]),
            item_markup.index("data-commit-history-date"),
        )
        self.assertEqual(item_markup.count(">·</span>"), 2)
        list_rule = styles.split(".commit-history-list", 1)[1].split("}", 1)[0]
        self.assertIn("list-style: none", list_rule)
        self.assertIn(".commit-history-context-icon", styles)

    def test_styles_connect_timeline_markers_except_after_the_last_item(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".commit-history-marker", styles)
        self.assertIn(
            ".commit-history-item:not([data-commit-history-last])", styles
        )
        self.assertIn("::after", styles)
        self.assertRegex(styles, r"width:\s*2px")
        self.assertRegex(styles, r"opacity:\s*0\.5")
        self.assertIn("position: relative", styles)

    def test_all_client_states_can_be_hidden(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".commit-history-status[hidden]", styles)

    def test_template_loads_the_client_script_deferred(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertRegex(template, r"commit_history\.js[^>]*defer")


if __name__ == "__main__":
    unittest.main()
