from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
ACTIVITY_TEMPLATE_PATH = REPO_ROOT / "_includes" / "github_activity.html"
INDEX_PATH = REPO_ROOT / "index.html"


class GitHubActivityTemplateTests(unittest.TestCase):
    def test_homepage_emits_the_controller_only_for_enabled_sections(self) -> None:
        index = INDEX_PATH.read_text(encoding="utf-8")

        self.assertIn("assign github_activity_enabled = false", index)
        self.assertIn(
            "site.repo_grid.switch or site.recent_milestones.switch "
            "or site.recent_commits.switch",
            index,
        )
        self.assertIn("if github_activity_enabled", index)
        self.assertIn("include github_activity.html", index)

    def test_unified_template_emits_one_configuration_and_one_script(self) -> None:
        template = ACTIVITY_TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertEqual(template.count("data-github-activity-config"), 1)
        self.assertEqual(template.count("<script src="), 1)
        self.assertIn("github_activity.js", template)
        for legacy_script in (
            "repo_updates.js",
            "recent_commits.js",
            "recent_milestones.js",
        ):
            self.assertNotIn(legacy_script, template)

    def test_disabled_features_have_null_or_empty_controller_configuration(self) -> None:
        template = ACTIVITY_TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn("if recent_commits and recent_commits.switch", template)
        self.assertIn("else %}null{% endif %}", template)
        self.assertIn("if recent_milestones and recent_milestones.switch", template)
        self.assertIn("if site.repo_grid and site.repo_grid.switch", template)
        self.assertIn('"repositoryUpdates":', template)
        self.assertIn('"repositories": [', template)
        self.assertIn("unless repo.fork or repo.archived", template)


if __name__ == "__main__":
    unittest.main()
