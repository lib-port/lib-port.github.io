from __future__ import annotations

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from site_config import ConfigValidationError, validate_site_config


class SiteConfigValidationTests(unittest.TestCase):
    def write_config(self, text: str) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        config_path = Path(temp_dir.name) / "_config.yml"
        config_path.write_text(textwrap.dedent(text).lstrip(), encoding="utf-8")
        return config_path

    def test_valid_config(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: true
              text: Hello world

            repo_grid:
              switch: true
              repo_list:
                - alpha
                - beta

            recent_milestones:
              milestones: 3
              repo_list:
                - alpha
                - gamma

            recent_commits:
              switch: true
              commits: 10

            external_blog:
              switch: true
              feed_url: https://example.com/feed
              archive_url: https://example.com/archive
              post_limit: 5
            """
        )

        config = validate_site_config(config_path)

        self.assertTrue(config.intro.enabled)
        self.assertEqual(config.intro.text, "Hello world")
        self.assertEqual(config.repo_grid.repo_list, ["alpha", "beta"])
        self.assertTrue(config.recent_milestones.enabled)
        self.assertEqual(config.recent_milestones.milestones, 3)
        self.assertEqual(config.recent_milestones.repo_list, ["alpha", "gamma"])
        self.assertTrue(config.recent_commits.enabled)
        self.assertEqual(config.recent_commits.commits, 10)
        self.assertEqual(config.external_blog.feed_url, "https://example.com/feed")
        self.assertEqual(config.external_blog.archive_url, "https://example.com/archive")
        self.assertEqual(config.external_blog.post_limit, 5)

    def test_disabled_sections_ignore_malformed_inner_fields(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false
              text:
                - not
                - a
                - string

            repo_grid:
              switch: false
              repo_list: definitely-not-a-list

            recent_commits:
              switch: false
              commits:
                - not
                - an
                - integer

            external_blog:
              switch: false
              feed_url:
                nested: value
              post_limit: no
            """
        )

        config = validate_site_config(config_path)

        self.assertFalse(config.intro.enabled)
        self.assertFalse(config.repo_grid.enabled)
        self.assertFalse(config.recent_milestones.enabled)
        self.assertEqual(config.recent_milestones.milestones, 0)
        self.assertEqual(config.recent_milestones.repo_list, [])
        self.assertFalse(config.recent_commits.enabled)
        self.assertEqual(config.recent_commits.commits, 0)
        self.assertFalse(config.external_blog.enabled)

    def test_missing_recent_commits_is_disabled(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: false

            external_blog:
              switch: false
            """
        )

        config = validate_site_config(config_path)

        self.assertFalse(config.recent_commits.enabled)
        self.assertEqual(config.recent_commits.commits, 0)

    def test_repo_grid_duplicates_are_rejected(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: true
              repo_list:
                - alpha
                - beta
                - alpha

            external_blog:
              switch: false
            """
        )

        with self.assertRaisesRegex(ConfigValidationError, "duplicate repository names: alpha"):
            validate_site_config(config_path)

    def test_missing_recent_milestones_is_disabled(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: false

            external_blog:
              switch: false
            """
        )

        config = validate_site_config(config_path)

        self.assertFalse(config.recent_milestones.enabled)
        self.assertEqual(config.recent_milestones.milestones, 0)
        self.assertEqual(config.recent_milestones.repo_list, [])

    def test_recent_milestones_must_be_a_mapping(self) -> None:
        config_path = self.write_config(
            """
            recent_milestones:
              - tech-lib
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"recent_milestones must be a mapping",
        ):
            validate_site_config(config_path)

    def test_recent_milestone_limit_must_be_between_one_and_ten(self) -> None:
        for milestones in (0, 11, True, "5"):
            with self.subTest(milestones=milestones):
                config_path = self.write_config(
                    f"""
                    recent_milestones:
                      milestones: {milestones!r}
                      repo_list:
                        - tech-lib
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_milestones\.milestones must be an integer between 1 and 10",
                ):
                    validate_site_config(config_path)

    def test_recent_milestone_limit_accepts_boundaries(self) -> None:
        for milestones in (1, 10):
            with self.subTest(milestones=milestones):
                config_path = self.write_config(
                    f"""
                    recent_milestones:
                      milestones: {milestones}
                      repo_list:
                        - tech-lib
                    """
                )

                config = validate_site_config(config_path)
                self.assertEqual(config.recent_milestones.milestones, milestones)

    def test_recent_milestones_requires_a_nonempty_repo_list(self) -> None:
        for repo_list in ("", "repo_list: []", "repo_list: tech-lib"):
            with self.subTest(repo_list=repo_list):
                config_path = self.write_config(
                    f"""
                    recent_milestones:
                      milestones: 1
                      {repo_list}
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_milestones\.repo_list must be a non-empty list",
                ):
                    validate_site_config(config_path)

    def test_recent_milestones_rejects_blank_and_duplicate_repositories(self) -> None:
        blank_config = self.write_config(
            """
            recent_milestones:
              milestones: 1
              repo_list:
                - tech-lib
                - "  "
            """
        )
        with self.assertRaisesRegex(
            ConfigValidationError,
            r"recent_milestones\.repo_list\[1\] must be a non-blank string",
        ):
            validate_site_config(blank_config)

        duplicate_config = self.write_config(
            """
            recent_milestones:
              milestones: 1
              repo_list:
                - tech-lib
                - tech-lib
            """
        )
        with self.assertRaisesRegex(
            ConfigValidationError,
            r"duplicate repository names: tech-lib",
        ):
            validate_site_config(duplicate_config)

    def test_quoted_switch_value_is_rejected(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: "true"
              text: Hello

            repo_grid:
              switch: false

            external_blog:
              switch: false
            """
        )

        with self.assertRaisesRegex(ConfigValidationError, r"intro\.switch must be a YAML boolean"):
            validate_site_config(config_path)

    def test_missing_external_blog_feed_url_is_rejected(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: false

            external_blog:
              switch: true
              post_limit: 3
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"external_blog\.switch is true, but external_blog\.feed_url is missing or blank",
        ):
            validate_site_config(config_path)

    def test_missing_external_blog_archive_url_is_rejected(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: false

            external_blog:
              switch: true
              feed_url: https://example.com/feed
              post_limit: 3
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"external_blog\.switch is true, but external_blog\.archive_url is missing or blank",
        ):
            validate_site_config(config_path)

    def test_external_blog_post_limit_must_be_between_one_and_ten(self) -> None:
        for post_limit in (0, 11, True, "5"):
            with self.subTest(post_limit=post_limit):
                config_path = self.write_config(
                    f"""
                    intro:
                      switch: false

                    repo_grid:
                      switch: false

                    external_blog:
                      switch: true
                      feed_url: https://example.com/feed
                      archive_url: https://example.com/archive
                      post_limit: {post_limit!r}
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"external_blog\.post_limit must be an integer between 1 and 10",
                ):
                    validate_site_config(config_path)

    def test_external_blog_post_limit_accepts_boundaries(self) -> None:
        for post_limit in (1, 10):
            with self.subTest(post_limit=post_limit):
                config_path = self.write_config(
                    f"""
                    intro:
                      switch: false

                    repo_grid:
                      switch: false

                    external_blog:
                      switch: true
                      feed_url: https://example.com/feed
                      archive_url: https://example.com/archive
                      post_limit: {post_limit}
                    """
                )

                config = validate_site_config(config_path)
                self.assertEqual(config.external_blog.post_limit, post_limit)

    def test_recent_commits_must_be_between_one_and_ten(self) -> None:
        for commits in (0, 11, True, "5"):
            with self.subTest(commits=commits):
                config_path = self.write_config(
                    f"""
                    intro:
                      switch: false

                    repo_grid:
                      switch: false

                    recent_commits:
                      switch: true
                      commits: {commits!r}

                    external_blog:
                      switch: false
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_commits\.commits must be an integer between 1 and 10",
                ):
                    validate_site_config(config_path)

    def test_enabled_recent_commits_requires_commits(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: false

            repo_grid:
              switch: false

            recent_commits:
              switch: true

            external_blog:
              switch: false
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"recent_commits\.commits must be an integer between 1 and 10",
        ):
            validate_site_config(config_path)

    def test_recent_commits_accepts_boundaries(self) -> None:
        for commits in (1, 10):
            with self.subTest(commits=commits):
                config_path = self.write_config(
                    f"""
                    intro:
                      switch: false

                    repo_grid:
                      switch: false

                    recent_commits:
                      switch: true
                      commits: {commits}

                    external_blog:
                      switch: false
                    """
                )

                config = validate_site_config(config_path)
                self.assertTrue(config.recent_commits.enabled)
                self.assertEqual(config.recent_commits.commits, commits)

    def test_malformed_yaml_is_rejected(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: true
              text: Hello
            repo_grid: [
            """
        )

        with self.assertRaisesRegex(ConfigValidationError, r"Malformed YAML"):
            validate_site_config(config_path)


if __name__ == "__main__":
    unittest.main()
