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
        self.assertEqual(config.external_blog.feed_url, "https://example.com/feed")
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
        self.assertFalse(config.external_blog.enabled)

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
