from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = REPO_ROOT / "_includes" / "recent_commits.html"
ACTIVITY_TEMPLATE_PATH = REPO_ROOT / "_includes" / "github_activity.html"
INDEX_PATH = REPO_ROOT / "index.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"


class RecentCommitsTemplateTests(unittest.TestCase):
    def test_template_reads_recent_commits_configuration(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("site.recent_commits", template)
        self.assertIn("recent_commits.switch", template)
        self.assertIn("recent_commits.commits", template)

    def test_homepage_dispatches_to_an_initially_hidden_section(self) -> None:
        index = INDEX_PATH.read_text(encoding="utf-8")

        self.assertIn('{%- when "recent_commits" -%}', index)
        self.assertIn('{%- include recent_commits.html -%}', index)
        self.assertIn('data-home-section="{{ section_key | escape }}"', index)
        self.assertIn('section_key == "recent_commits" %} hidden', index)

    def test_visibility_aware_dividers_ignore_hidden_sections(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".home-section-wrapper[hidden]", styles)
        self.assertIn(
            ".home-section-wrapper:not([hidden]) ~ .home-section-wrapper:not([hidden]) > .section-divider",
            styles,
        )

    def test_template_excludes_forks_and_archived_repositories(self) -> None:
        template = ACTIVITY_TEMPLATE_PATH.read_text(encoding="utf-8")

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
        self.assertIn(
            '<ul class="commit-history-content" aria-label="Commit details">',
            template,
        )
        self.assertIn("data-commit-history-marker", template)
        self.assertIn("{% octicon git-commit %}", template)
        context_icons = {
            "repo": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon repo %}</span>',
            "message": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon comment %}</span>',
            "calendar": '<span class="commit-history-context-icon" aria-hidden="true">{% octicon calendar %}</span>',
        }
        for icon_markup in context_icons.values():
            self.assertIn(icon_markup, template)
        self.assertIn("data-commit-history-repo", template)
        self.assertIn("data-commit-history-message", template)
        self.assertIn("<time", template)
        item_markup = template.split(
            '<li class="commit-history-item"', 1
        )[1].split("\n    </li>", 1)[0]
        self.assertEqual(item_markup.count('class="commit-history-detail'), 3)
        self.assertIn(
            'class="commit-history-detail commit-history-date-detail"',
            item_markup,
        )
        self.assertIn(
            'class="commit-history-detail commit-history-message-detail"',
            item_markup,
        )
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
            item_markup.index(context_icons["message"]),
        )
        self.assertLess(
            item_markup.index(context_icons["message"]),
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
        self.assertNotIn("commit-history-separator", item_markup)
        self.assertNotIn("·", item_markup)
        self.assertEqual(item_markup.count("<wbr>"), 2)
        self.assertEqual(item_markup.count("</li><!--\n        --><li"), 2)
        self.assertNotIn(".commit-history-separator", styles)
        list_rule = styles.split(".commit-history-list", 1)[1].split("}", 1)[0]
        self.assertIn("list-style: none", list_rule)
        row_rule = styles.split(".commit-history-content {", 1)[1].split(
            "\n}", 1
        )[0]
        self.assertIn("margin: 0", row_rule)
        self.assertIn("padding: 0", row_rule)
        self.assertIn("list-style: none", row_rule)
        self.assertNotIn("font-size: 0.875em", row_rule)
        content_rule = (
            ".commit-history-content {\n"
            "  min-width: 0;\n"
            "  font-size: 1em;\n"
            "  display: block;\n"
            "}"
        )
        self.assertIn(content_rule, styles)
        self.assertIn(
            ".commit-history-content > li {\n  display: inline;\n}",
            styles,
        )
        self.assertIn(
            ".commit-history-detail:not(:last-child) {\n"
            "  margin-inline-end: 0.75rem;\n"
            "}",
            styles,
        )
        self.assertIn(
            ".recent-milestone-latest-issue > li,\n"
            ".commit-history-content > li {\n"
            "  min-width: 0;",
            styles,
        )
        icon_rule = styles.split(
            ".commit-history-context-icon > .octicon", 1
        )[1].split("}", 1)[0]
        self.assertIn("width: 1em", icon_rule)
        self.assertIn("height: 1em", icon_rule)
        self.assertIn(
            ".commit-history-context-icon {\n"
            "  margin-inline-end: 0.35em;\n"
            "  vertical-align: middle;\n"
            "}",
            styles,
        )
        date_rule = styles.split(".commit-history-date-detail", 1)[1].split(
            "}", 1
        )[0]
        self.assertIn("opacity: 0.8", date_rule)
        self.assertIn("white-space: nowrap", date_rule)

    def test_commit_details_stack_at_mobile_breakpoint(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")
        mobile_styles = styles.rsplit(
            "@media screen and (max-width: 32rem) {", 1
        )[1].split("@media", 1)[0]
        commit_rule = mobile_styles.split(
            ".commit-history-content {", 1
        )[1].split("}", 1)[0]
        detail_rule = mobile_styles.split(
            ".commit-history-content > li {", 1
        )[1].split("}", 1)[0]
        message_icon_rule = mobile_styles.split(
            ".commit-history-message-detail > .commit-history-context-icon {", 1
        )[1].split("}", 1)[0]
        mobile_icon_rule = mobile_styles.split(
            ".commit-history-content > li > .commit-history-context-icon {", 1
        )[1].split("}", 1)[0]
        word_break_rule = mobile_styles.split(
            ".commit-history-content wbr {", 1
        )[1].split("}", 1)[0]

        self.assertIn("display: flex", commit_rule)
        self.assertIn("flex-direction: column", commit_rule)
        self.assertIn("flex-wrap: nowrap", commit_rule)
        self.assertIn("gap: 0.5rem", commit_rule)
        self.assertIn("display: inline-flex", detail_rule)
        self.assertIn("align-items: center", detail_rule)
        self.assertIn("gap: 0.35em", detail_rule)
        self.assertIn("margin-inline-end: 0", mobile_icon_rule)
        self.assertIn("display: none", word_break_rule)
        self.assertIn("align-self: flex-start", message_icon_rule)
        self.assertIn("margin-block-start: 0.25em", message_icon_rule)

    def test_styles_connect_timeline_markers_except_after_the_last_item(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".commit-history-marker", styles)
        self.assertIn(
            ".commit-history-item:not([data-commit-history-last])", styles
        )
        connector_rule = styles.split(
            ".commit-history-item:not([data-commit-history-last])", 1
        )[1].split("}", 1)[0]
        self.assertIn("::after", connector_rule)
        self.assertRegex(connector_rule, r"width:\s*2px")
        self.assertRegex(connector_rule, r"opacity:\s*0\.5")
        self.assertIn("position: absolute", connector_rule)

    def test_all_client_states_can_be_hidden(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".commit-history-status[hidden]", styles)

    def test_template_loads_the_client_script_deferred(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        activity_template = ACTIVITY_TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertNotIn("<script", template)
        self.assertRegex(activity_template, r"github_activity\.js[^>]*defer")
        self.assertNotIn("recent_commits.js", activity_template)


if __name__ == "__main__":
    unittest.main()
