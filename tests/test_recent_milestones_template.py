from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "_config.yml"
INDEX_PATH = REPO_ROOT / "index.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"
TEMPLATE_PATH = REPO_ROOT / "_includes" / "recent_milestones.html"


class RecentMilestonesTemplateTests(unittest.TestCase):
    def test_homepage_dispatches_to_hidden_recent_milestones_before_activity(self) -> None:
        index = INDEX_PATH.read_text(encoding="utf-8")
        config = CONFIG_PATH.read_text(encoding="utf-8")

        self.assertIn('{%- when "recent_milestones" -%}', index)
        self.assertIn('{%- include recent_milestones.html -%}', index)
        self.assertIn('section_key == "recent_milestones" %} hidden', index)
        self.assertLess(
            config.index("recent_milestones:"),
            config.index("recent_commits:"),
        )

    def test_template_exposes_configuration_and_deferred_loader(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("site.github.owner_name", template)
        self.assertIn("recent_milestones.milestones", template)
        self.assertIn("recent_milestones.repo_list | jsonify", template)
        self.assertIn("data-recent-milestones", template)
        self.assertIn("data-milestone-limit", template)
        self.assertRegex(template, r"recent_milestones\.js[^>]*defer")

    def test_template_contains_semantic_milestone_rows_and_progress(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn(
            '<h2>Recent Tasks <span class="section-heading-meta">(GitHub issues)</span></h2>',
            template,
        )
        self.assertIn('<ul class="recent-milestones-list"', template)
        self.assertIn('<li class="recent-milestone-item"', template)
        self.assertIn("data-recent-milestone-title", template)
        self.assertIn("data-recent-milestone-repo", template)
        self.assertIn("data-recent-milestone-due-detail", template)
        self.assertIn("{% octicon repo %}", template)
        self.assertIn("{% octicon calendar %}", template)
        self.assertIn("{% octicon issue-closed %}", template)
        self.assertIn('role="progressbar"', template)
        self.assertIn('aria-valuemin="0"', template)
        self.assertIn('aria-valuemax="100"', template)
        self.assertNotIn("data-recent-milestone-open-link", template)
        self.assertNotIn("data-recent-milestone-closed-link", template)
        self.assertNotIn("data-recent-milestone-open", template)
        self.assertNotIn("data-recent-milestone-closed></strong>", template)
        self.assertIn(
            '<span class="recent-milestone-percentage" '
            "data-recent-milestone-percentage></span>",
            template,
        )
        self.assertNotIn('<strong class="recent-milestone-percentage"', template)
        self.assertIn(
            "<span data-recent-milestone-latest-closed-issue></span>",
            template,
        )
        self.assertNotIn("<a data-recent-milestone-latest-closed-issue", template)

        repo_icon = template.index("{% octicon repo %}")
        repo_link = template.index("<a data-recent-milestone-repo>")
        self.assertLess(repo_icon, repo_link)

        closed_total = template.index("data-recent-milestone-closed-total")
        percentage = template.index("data-recent-milestone-percentage")
        progress = template.index("data-recent-milestone-progress\n")
        latest_issue_icon = template.index("{% octicon issue-closed %}")
        latest_issue_title = template.index("data-recent-milestone-latest-closed-issue")
        self.assertLess(closed_total, percentage)
        self.assertLess(percentage, progress)
        self.assertLess(progress, latest_issue_icon)
        self.assertLess(latest_issue_icon, latest_issue_title)

    def test_template_contains_loading_error_and_empty_states(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn('aria-live="polite"', template)
        self.assertIn("data-recent-milestones-loading", template)
        self.assertIn("loading recent milestones", template)
        self.assertIn("data-recent-milestones-error", template)
        self.assertIn("unable to load recent milestones", template)
        self.assertIn("data-recent-milestones-empty", template)
        self.assertIn("No open milestones with completed issues found", template)

    def test_styles_hide_client_states_and_use_responsive_milestone_layout(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn(".recent-milestones-list", styles)
        self.assertIn(".recent-milestone-item", styles)
        self.assertIn(".recent-milestones-status[hidden]", styles)
        self.assertIn(".recent-milestone-detail[hidden]", styles)
        self.assertIn("> .recent-milestone-separator", styles)
        self.assertIn(".recent-milestone-progress", styles)
        self.assertIn(".recent-milestone-progress-value", styles)
        self.assertIn("--milestone-progress-spacing: 0.8rem", styles)
        self.assertEqual(
            styles.count("var(--milestone-progress-spacing)"),
            2,
        )
        self.assertIn(".recent-milestone-percentage", styles)
        self.assertIn(".recent-milestone-latest-issue", styles)
        self.assertIn("gap: 0.3rem 0.35em", styles)
        self.assertIn(
            "> [data-recent-milestone-latest-closed-issue]",
            styles,
        )
        self.assertIn("overflow-wrap: anywhere", styles)
        self.assertIn("@media screen and (max-width: 32rem)", styles)
        self.assertIn("var(--minima-background-color)", styles)
        self.assertIn("var(--minima-link-base-color)", styles)


if __name__ == "__main__":
    unittest.main()
