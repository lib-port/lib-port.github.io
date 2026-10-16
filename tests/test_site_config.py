from __future__ import annotations

import tempfile
import textwrap
import unittest
from pathlib import Path


from helpers.ruby_site_config import (
    ConfigValidationError, close_validator, validate_site_config,
)

unittest.addModuleCleanup(close_validator)



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
            github_icon:
              switch: true
              link: repos
              style: icon

            intro:
              switch: true
              text: Hello world

            repo_grid:
              switch: true
              repo_list:
                - alpha
                - beta

            recent_milestones:
              switch: true
              milestones: 3
              repo_list:
                - " gamma "
                - delta

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

        self.assertTrue(config.github_icon.enabled)
        self.assertEqual(config.github_icon.link, "repos")
        self.assertEqual(config.github_icon.style, "icon")
        self.assertTrue(config.intro.enabled)
        self.assertEqual(config.intro.text, "Hello world")
        self.assertEqual(config.repo_grid.repo_list, ["alpha", "beta"])
        self.assertTrue(config.recent_milestones.enabled)
        self.assertEqual(config.recent_milestones.milestones, 3)
        self.assertEqual(config.recent_milestones.repo_list, ["gamma", "delta"])
        self.assertTrue(config.recent_commits.enabled)
        self.assertEqual(config.recent_commits.commits, 10)
        self.assertEqual(config.external_blog.feed_url, "https://example.com/feed")
        self.assertEqual(config.external_blog.archive_url, "https://example.com/archive")
        self.assertEqual(config.external_blog.post_limit, 5)

    def test_validation_errors_report_the_supplied_config_path(self) -> None:
        config_path = self.write_config(
            """
            intro:
              switch: true
            """
        )

        with self.assertRaises(ConfigValidationError) as raised:
            validate_site_config(config_path)

        self.assertIn(str(config_path), str(raised.exception))

    def test_old_hyphenated_names_do_not_enable_features(self) -> None:
        for name in ("find_the_bug_game", "light_dark_ball", "github_icon", "paper_plane", "ascii_banner"):
            old_name = name.replace("_", "-")
            for new_section in ("", f"{name}: {{switch: false}}"):
                with self.subTest(name=name, new_section=new_section):
                    config_path = self.write_config(
                        f"{old_name}: {{switch: true, link: repos, module: random}}\n{new_section}"
                    )
                    self.assertFalse(getattr(validate_site_config(config_path), name).enabled)

    def test_paper_plane_switch_controls_the_effect(self) -> None:
        for text, enabled in (
            ("", False),
            ("paper_plane: {}", False),
            ("paper_plane: {switch: false}", False),
            ("paper_plane: {switch: true}", True),
        ):
            with self.subTest(text=text):
                config = validate_site_config(self.write_config(text))
                self.assertEqual(config.paper_plane.enabled, enabled)

    def test_find_the_bug_game_switch_controls_the_effect(self) -> None:
        for text, enabled in (
            ("", False),
            ("find_the_bug_game:", False),
            ("find_the_bug_game: {}", False),
            ("find_the_bug_game: {switch: null}", False),
            ("find_the_bug_game: {switch: false}", False),
            ("find_the_bug_game: {switch: true}", True),
            ("finid_the_bug_game: {switch: true}", False),
        ):
            with self.subTest(text=text):
                config = validate_site_config(self.write_config(text))
                self.assertEqual(config.find_the_bug_game.enabled, enabled)

    def test_find_the_bug_game_rejects_invalid_configuration(self) -> None:
        for value in ('"true"', '"false"', "1", "0", "[]", "{}"):
            with self.subTest(switch=value):
                config_path = self.write_config(f"find_the_bug_game: {{switch: {value}}}")
                with self.assertRaisesRegex(ConfigValidationError, "find_the_bug_game.switch must be a YAML boolean"):
                    validate_site_config(config_path)
        for value in ("true", '"false"', "1", "[]"):
            with self.subTest(section=value):
                config_path = self.write_config(f"find_the_bug_game: {value}")
                with self.assertRaisesRegex(ConfigValidationError, "find_the_bug_game must be a mapping"):
                    validate_site_config(config_path)

    def test_light_dark_ball_switch_controls_the_effect_independently(self) -> None:
        for text, enabled in (
            ("", False),
            ("light_dark_ball:", False),
            ("light_dark_ball: {}", False),
            ("light_dark_ball: {switch: null}", False),
            ("light_dark_ball: {switch: false}", False),
            ("light_dark_ball: {switch: true}", True),
        ):
            for game in ("false", "true"):
                with self.subTest(text=text, game=game):
                    config = validate_site_config(self.write_config(
                        f"find_the_bug_game: {{switch: {game}}}\n{text}"
                    ))
                    self.assertEqual(config.light_dark_ball.enabled, enabled)

    def test_light_dark_ball_rejects_invalid_configuration(self) -> None:
        for value in ('"true"', '"false"', "1", "0", "[]", "{}"):
            with self.subTest(switch=value):
                config_path = self.write_config(f"light_dark_ball: {{switch: {value}}}")
                with self.assertRaisesRegex(ConfigValidationError, "light_dark_ball.switch must be a YAML boolean"):
                    validate_site_config(config_path)
        for value in ("true", '"false"', "1", "[]"):
            with self.subTest(section=value):
                config_path = self.write_config(f"light_dark_ball: {value}")
                with self.assertRaisesRegex(ConfigValidationError, "light_dark_ball must be a mapping"):
                    validate_site_config(config_path)

    def test_paper_plane_switch_rejects_non_boolean_values(self) -> None:
        for value in ('"true"', '"false"', "1", "[]", "{}"):
            with self.subTest(value=value):
                config_path = self.write_config(f"paper_plane: {{switch: {value}}}")
                with self.assertRaisesRegex(ConfigValidationError, "paper_plane.switch"):
                    validate_site_config(config_path)

    def test_github_icon_accepts_profile_and_repos_destinations(self) -> None:
        for link in ("profile", "repos"):
            with self.subTest(link=link):
                config_path = self.write_config(
                    f"""
                    github_icon:
                      switch: true
                      link: {link}
                    """
                )

                config = validate_site_config(config_path)

                self.assertTrue(config.github_icon.enabled)
                self.assertEqual(config.github_icon.link, link)
                self.assertEqual(config.github_icon.style, "text")

    def test_github_icon_accepts_supported_styles(self) -> None:
        for style in ("auto", "text", "icon"):
            with self.subTest(style=style):
                config_path = self.write_config(
                    f"""
                    github_icon:
                      switch: true
                      link: profile
                      style: {style}
                    """
                )

                config = validate_site_config(config_path)

                self.assertEqual(config.github_icon.style, style)

    def test_github_icon_is_disabled_for_false_or_missing_switches(self) -> None:
        configurations = (
            "",
            """
            github_icon:
              link:
                - ignored
              style:
                - ignored
            """,
            """
            github_icon:
              switch: false
              link:
                - ignored
              style:
                - ignored
            """,
        )
        for raw_config in configurations:
            with self.subTest(raw_config=raw_config):
                config_path = self.write_config(raw_config)

                config = validate_site_config(config_path)

                self.assertFalse(config.github_icon.enabled)
                self.assertEqual(config.github_icon.link, "")
                self.assertEqual(config.github_icon.style, "")

    def test_github_icon_switch_requires_a_yaml_boolean(self) -> None:
        for raw_switch in ('"true"', '"false"', "1", "0", "[]", "{}"):
            with self.subTest(raw_switch=raw_switch):
                config_path = self.write_config(
                    f"""
                    github_icon:
                      switch: {raw_switch}
                      link: repos
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"github_icon\.switch must be a YAML boolean",
                ):
                    validate_site_config(config_path)

    def test_enabled_github_icon_requires_an_exact_destination(self) -> None:
        invalid_links = (
            "",
            "link:",
            'link: ""',
            "link: PROFILE",
            "link: projects",
            "link: issues",
            'link: " repos "',
            "link: [repos]",
        )
        for link_config in invalid_links:
            with self.subTest(link_config=link_config):
                config_path = self.write_config(
                    f"""
                    github_icon:
                      switch: true
                      {link_config}
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"github_icon\.link must be exactly 'profile' or 'repos'",
                ):
                    validate_site_config(config_path)

    def test_enabled_github_icon_rejects_invalid_styles(self) -> None:
        invalid_styles = (
            "style:",
            'style: ""',
            "style: TEXT",
            "style: logo",
            'style: " text "',
            "style: [text]",
        )
        for style_config in invalid_styles:
            with self.subTest(style_config=style_config):
                config_path = self.write_config(
                    f"""
                    github_icon:
                      switch: true
                      link: repos
                      {style_config}
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"github_icon\.style must be exactly "
                    r"'auto', 'text', or 'icon'",
                ):
                    validate_site_config(config_path)

    def test_github_icon_must_be_a_mapping(self) -> None:
        config_path = self.write_config(
            """
            github_icon:
              - repos
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"github_icon must be a mapping",
        ):
            validate_site_config(config_path)

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

            recent_milestones:
              switch: false
              milestones:
                - not
                - an
                - integer
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

    def test_repo_grid_duplicates_are_case_insensitive(self) -> None:
        config_path = self.write_config(
            """
            repo_grid:
              switch: true
              repo_list:
                - Example
                - example
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError, "duplicate repository names: example"
        ):
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

    def test_missing_recent_milestones_switch_is_disabled(self) -> None:
        config_path = self.write_config(
            """
            recent_milestones:
              milestones: 3
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
                      switch: true
                      milestones: {milestones!r}
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
                    repo_grid:
                      switch: false
                      repo_list: definitely-not-a-list

                    recent_milestones:
                      switch: true
                      milestones: {milestones}
                      repo_list:
                        - tech-lib
                    """
                )

                config = validate_site_config(config_path)
                self.assertEqual(config.recent_milestones.milestones, milestones)
                self.assertFalse(config.repo_grid.enabled)
                self.assertEqual(config.repo_grid.repo_list, [])
                self.assertEqual(config.recent_milestones.repo_list, ["tech-lib"])

    def test_recent_milestones_does_not_require_repo_grid(self) -> None:
        config_path = self.write_config(
            """
            recent_milestones:
              switch: true
              milestones: 1
              repo_list:
                - tech-lib
            """
        )

        config = validate_site_config(config_path)

        self.assertFalse(config.repo_grid.enabled)
        self.assertEqual(config.repo_grid.repo_list, [])
        self.assertEqual(config.recent_milestones.repo_list, ["tech-lib"])

    def test_disabled_recent_milestones_ignores_repo_list_with_grid_enabled(self) -> None:
        config_path = self.write_config(
            """
            repo_grid:
              switch: true
              repo_list:
                - alpha

            recent_milestones:
              switch: false
              repo_list: definitely-not-a-list
            """
        )

        config = validate_site_config(config_path)

        self.assertEqual(config.repo_grid.repo_list, ["alpha"])
        self.assertFalse(config.recent_milestones.enabled)
        self.assertEqual(config.recent_milestones.repo_list, [])

    def test_recent_milestones_requires_its_own_nonempty_repo_list(self) -> None:
        for repo_list in (
            "", "repo_list: []", "repo_list: tech-lib", "repo_list: null", "repo_list: {}"
        ):
            with self.subTest(repo_list=repo_list):
                config_path = self.write_config(
                    f"""
                    repo_grid:
                      switch: true
                      repo_list:
                        - tech-lib

                    recent_milestones:
                      switch: true
                      milestones: 1
                      {repo_list}
                    """
                )

                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_milestones\.switch is true, but "
                    r"recent_milestones\.repo_list must be a non-empty list",
                ):
                    validate_site_config(config_path)

    def test_recent_milestones_validates_its_repository_names(self) -> None:
        for invalid_name in ('"  "', '""', "3", "true", "null"):
            with self.subTest(invalid_name=invalid_name):
                config_path = self.write_config(
                    f"""
                    recent_milestones:
                      switch: true
                      milestones: 1
                      repo_list:
                        - tech-lib
                        - {invalid_name}
                    """
                )
                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_milestones\.repo_list\[1\] must be a non-blank string",
                ):
                    validate_site_config(config_path)

    def test_recent_milestones_rejects_duplicate_repository_names(self) -> None:
        for first_name in ("tech-lib", "Tech-Lib", '" tech-lib "'):
            with self.subTest(first_name=first_name):
                config_path = self.write_config(
                    f"""
                    recent_milestones:
                      switch: true
                      milestones: 1
                      repo_list:
                        - {first_name}
                        - tech-lib
                    """
                )
                with self.assertRaisesRegex(
                    ConfigValidationError,
                    r"recent_milestones\.repo_list contains duplicate repository names: tech-lib",
                ):
                    validate_site_config(config_path)

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

    def test_recent_milestones_switch_must_be_a_yaml_boolean(self) -> None:
        config_path = self.write_config(
            """
            recent_milestones:
              switch: "true"
              milestones: 1
            """
        )

        with self.assertRaisesRegex(
            ConfigValidationError,
            r"recent_milestones\.switch must be a YAML boolean",
        ):
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

    def test_external_blog_urls_must_be_absolute_http_urls(self) -> None:
        invalid_urls = (
            "not-a-url",
            "/feed.xml",
            "ftp://example.com/feed.xml",
            "javascript:alert(1)",
            "https:///missing-host",
        )
        for field in ("feed_url", "archive_url"):
            for invalid_url in invalid_urls:
                with self.subTest(field=field, invalid_url=invalid_url):
                    feed_url = (
                        invalid_url
                        if field == "feed_url"
                        else "https://example.com/feed.xml"
                    )
                    archive_url = (
                        invalid_url
                        if field == "archive_url"
                        else "https://example.com/archive"
                    )
                    config_path = self.write_config(
                        f"""
                        external_blog:
                          switch: true
                          feed_url: {feed_url}
                          archive_url: {archive_url}
                          post_limit: 3
                        """
                    )

                    with self.assertRaisesRegex(
                        ConfigValidationError,
                        rf"external_blog\.{field} must be an absolute HTTP\(S\) URL",
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
