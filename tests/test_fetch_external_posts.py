from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock


SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import fetch_external_posts
from site_config import ExternalBlogConfig, IntroConfig, RepoGridConfig, SiteConfig


class FetchExternalBlogPostsTests(unittest.TestCase):
    def make_config(self, *, enabled: bool = True) -> SiteConfig:
        return SiteConfig(
            intro=IntroConfig(enabled=False, text=""),
            repo_grid=RepoGridConfig(enabled=False, repo_list=[]),
            external_blog=ExternalBlogConfig(
                enabled=enabled,
                feed_url="https://example.com/feed",
                archive_url="https://example.com/archive",
                post_limit=5,
            ),
            raw={},
        )

    def test_cli_overrides_take_precedence(self) -> None:
        with mock.patch.object(sys, "argv", ["fetch_external_posts.py", "--feed-url", "https://override.example/feed", "--limit", "2"]), \
             mock.patch.object(fetch_external_posts, "validate_site_config", return_value=self.make_config()), \
             mock.patch.object(fetch_external_posts, "fetch_feed_xml", return_value=b"<rss/>") as fetch_feed_xml, \
             mock.patch.object(fetch_external_posts, "parse_feed", return_value=("Feed", [])), \
             mock.patch.object(fetch_external_posts, "write_json") as write_json:
            exit_code = fetch_external_posts.main()

        self.assertEqual(exit_code, 0)
        fetch_feed_xml.assert_called_once_with("https://override.example/feed")
        payload = write_json.call_args.args[1]
        self.assertEqual(payload["posts"], [])

    def test_disabled_external_blog_skips_generation(self) -> None:
        with mock.patch.object(sys, "argv", ["fetch_external_posts.py"]), \
             mock.patch.object(fetch_external_posts, "validate_site_config", return_value=self.make_config(enabled=False)), \
             mock.patch.object(fetch_external_posts, "fetch_feed_xml") as fetch_feed_xml:
            exit_code = fetch_external_posts.main()

        self.assertEqual(exit_code, 0)
        fetch_feed_xml.assert_not_called()

    def test_fetch_feed_xml_sets_explicit_headers(self) -> None:
        completed_process = mock.Mock(stdout=b"<rss/>")

        with mock.patch.object(fetch_external_posts.subprocess, "run", return_value=completed_process) as run:
            result = fetch_external_posts.fetch_feed_xml("https://example.com/feed")

        self.assertEqual(result, b"<rss/>")
        run.assert_called_once_with(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--compressed",
                "--max-time",
                str(fetch_external_posts.REQUEST_TIMEOUT_SECONDS),
                "-H",
                f"User-Agent: {fetch_external_posts.CURL_USER_AGENT}",
                "-H",
                f"Accept: {fetch_external_posts.CURL_ACCEPT}",
                "-H",
                "Accept-Language: en-US,en;q=0.9",
                "https://example.com/feed",
            ],
            check=True,
            stdout=fetch_external_posts.subprocess.PIPE,
            stderr=fetch_external_posts.subprocess.PIPE,
        )


if __name__ == "__main__":
    unittest.main()
