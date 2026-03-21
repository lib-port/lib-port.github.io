#!/usr/bin/env python3
"""Fetch recent posts from a blog RSS feed into a Jekyll data file."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin
from xml.etree import ElementTree

from site_config import CONFIG_PATH, ConfigValidationError, validate_site_config


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_PATH = REPO_ROOT / "_data" / "external_posts.json"
REQUEST_TIMEOUT_SECONDS = 20
EXCERPT_MAX_LENGTH = 280
ATOM_NAMESPACE = "http://www.w3.org/2005/Atom"
CURL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
)
CURL_ACCEPT = "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, text/html;q=0.8"


class HTMLTextExtractor(HTMLParser):
    """Convert small HTML fragments into readable plain text."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def get_text(self) -> str:
        return "".join(self._parts)


@dataclass(frozen=True)
class FeedPost:
    published_at: str
    title: str
    excerpt: str
    url: str
    _sort_key: datetime

    def as_json(self) -> dict[str, str]:
        return {
            "published_at": self.published_at,
            "title": self.title,
            "excerpt": self.excerpt,
            "url": self.url,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download recent posts from an external feed and save them as JSON for Jekyll.",
    )
    parser.add_argument(
        "--feed-url",
        default=None,
        help="RSS feed URL to fetch (defaults to external_blog.feed_url from _config.yml)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Path to the JSON output file (default: {DEFAULT_OUTPUT_PATH})",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Number of posts to keep (defaults to external_blog.post_limit from _config.yml)",
    )
    return parser.parse_args()

def resolve_output_path(output_path: Path) -> Path:
    if output_path.is_absolute():
        return output_path
    return REPO_ROOT / output_path


def build_curl_command(feed_url: str) -> list[str]:
    command = [
        "curl",
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--compressed",
        "--max-time",
        str(REQUEST_TIMEOUT_SECONDS),
        "-H",
        f"User-Agent: {CURL_USER_AGENT}",
        "-H",
        f"Accept: {CURL_ACCEPT}",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        feed_url,
    ]
    return command


def run_curl_request(feed_url: str) -> bytes:
    completed = subprocess.run(
        build_curl_command(feed_url),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return completed.stdout


def fetch_feed_xml(feed_url: str) -> bytes:
    return run_curl_request(feed_url)


def local_name(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[1]
    return tag


def child_elements(parent: ElementTree.Element, *names: str) -> list[ElementTree.Element]:
    wanted = set(names)
    return [child for child in list(parent) if local_name(child.tag) in wanted]


def child_text(parent: ElementTree.Element, *names: str) -> str:
    for child in child_elements(parent, *names):
        text = "".join(child.itertext()).strip()
        if text:
            return text
    return ""


def entry_candidates(root: ElementTree.Element) -> list[ElementTree.Element]:
    root_name = local_name(root.tag)
    if root_name == "rss":
        channel = next(iter(child_elements(root, "channel")), None)
        if channel is None:
            return []
        return child_elements(channel, "item")

    if root_name == "feed":
        return child_elements(root, "entry")

    if root_name == "RDF":
        return child_elements(root, "item")

    channel = next(iter(child_elements(root, "channel")), None)
    if channel is not None:
        return child_elements(channel, "item")

    return child_elements(root, "item", "entry")


def strip_html(value: str) -> str:
    parser = HTMLTextExtractor()
    parser.feed(unescape(value))
    parser.close()
    return re.sub(r"\s+", " ", parser.get_text()).strip()


def truncate_text(value: str, max_length: int) -> str:
    if len(value) <= max_length:
        return value
    truncated = value[: max_length - 3].rsplit(" ", 1)[0].rstrip()
    if not truncated:
        truncated = value[: max_length - 3].rstrip()
    return f"{truncated}..."


def normalise_iso_datetime(raw_value: str) -> str:
    value = raw_value.strip()
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"

    date_only = re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)
    if date_only:
        value = f"{value}T00:00:00+00:00"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value):
        value = f"{value}:00+00:00"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", value):
        value = value.replace(" ", "T") + "+00:00"

    return value


def parse_pub_date(raw_value: str) -> datetime:
    value = raw_value.strip()
    if not value:
        raise ValueError("Empty publication date")

    try:
        parsed = datetime.fromisoformat(normalise_iso_datetime(value))
    except ValueError:
        parsed = parsedate_to_datetime(value)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def parse_optional_date(raw_value: str) -> datetime | None:
    if not raw_value.strip():
        return None

    try:
        return parse_pub_date(raw_value)
    except (TypeError, ValueError, IndexError):
        return None


def feed_base_url(root: ElementTree.Element) -> str:
    if local_name(root.tag) == "feed" and root.tag.startswith("{"):
        namespace, _ = root.tag[1:].split("}", 1)
        if namespace == ATOM_NAMESPACE:
            for child in child_elements(root, "link"):
                href = (child.get("href") or "").strip()
                rel = (child.get("rel") or "alternate").strip()
                if href and rel in {"alternate", "self"}:
                    return href

    base_url = child_text(root, "link")
    if base_url:
        return base_url

    channel = next(iter(child_elements(root, "channel")), None)
    if channel is not None:
        return child_text(channel, "link")

    return ""


def feed_title(root: ElementTree.Element) -> str:
    title = child_text(root, "title")
    if title:
        return title

    channel = next(iter(child_elements(root, "channel")), None)
    if channel is not None:
        return child_text(channel, "title")

    return ""


def entry_title(entry: ElementTree.Element) -> str:
    return child_text(entry, "title")


def entry_url(entry: ElementTree.Element, base_url: str) -> str:
    link_text = child_text(entry, "link")
    if link_text:
        return urljoin(base_url, link_text)

    for link in child_elements(entry, "link"):
        href = (link.get("href") or "").strip()
        rel = (link.get("rel") or "alternate").strip()
        if href and rel in {"alternate", ""}:
            return urljoin(base_url, href)

    for link in child_elements(entry, "link"):
        href = (link.get("href") or "").strip()
        if href:
            return urljoin(base_url, href)

    guid = child_text(entry, "guid", "id")
    if guid.startswith(("http://", "https://")):
        return guid

    return ""


def entry_excerpt(entry: ElementTree.Element) -> str:
    for name in ("description", "summary", "encoded", "content"):
        excerpt = child_text(entry, name)
        if excerpt:
            return truncate_text(strip_html(excerpt), EXCERPT_MAX_LENGTH)
    return ""


def entry_published_at(entry: ElementTree.Element) -> datetime | None:
    for name in ("pubDate", "published", "updated", "date", "dc:date", "created"):
        published_at = parse_optional_date(child_text(entry, name))
        if published_at is not None:
            return published_at
    return None


def parse_feed(feed_xml: bytes) -> tuple[str, list[FeedPost]]:
    root = ElementTree.fromstring(feed_xml)
    items = entry_candidates(root)
    base_url = feed_base_url(root)
    feed_title_value = feed_title(root)

    posts: list[FeedPost] = []
    for item in items:
        entry_title_value = entry_title(item)
        url = entry_url(item, base_url)
        published_at = entry_published_at(item)
        excerpt = entry_excerpt(item)

        if not entry_title_value or not url or published_at is None:
            continue

        posts.append(
            FeedPost(
                published_at=published_at.isoformat(),
                title=entry_title_value,
                excerpt=excerpt,
                url=url,
                _sort_key=published_at,
            )
        )

    posts.sort(key=lambda post: post._sort_key, reverse=True)
    return feed_title_value, posts


def build_payload(
    feed_title: str,
    posts: Iterable[FeedPost],
    limit: int,
) -> dict[str, object]:
    selected_posts = [post.as_json() for post in list(posts)[:limit]]
    return {
        "feed_title": feed_title,
        "posts": selected_posts,
    }


def write_json(output_path: Path, payload: dict[str, object]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    try:
        args = parse_args()
        output_path = resolve_output_path(args.output)
        config = validate_site_config()
        external_blog = config.external_blog
        if not external_blog.enabled:
            print(f"Skipped {output_path}: external_blog.switch is false")
            return 0

        feed_url = (args.feed_url or external_blog.feed_url).strip()
        limit = args.limit if args.limit is not None else external_blog.post_limit
        if not feed_url:
            raise ConfigValidationError(f"{CONFIG_PATH}: external_blog.feed_url override is missing or blank")
        if limit <= 0:
            raise ConfigValidationError(f"{CONFIG_PATH}: external_blog.post_limit override must be a positive integer")
        feed_xml = fetch_feed_xml(feed_url)
        feed_title_value, posts = parse_feed(feed_xml)
        payload = build_payload(feed_title_value, posts, limit)
        write_json(output_path, payload)
    except ConfigValidationError as exc:
        print(f"Failed to load feed configuration: {exc}", file=sys.stderr)
        return 1
    except FileNotFoundError as exc:
        print(f"Failed to fetch feed: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="replace").strip() or f"curl exited with status {exc.returncode}"
        print(f"Failed to fetch feed: {message}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Failed to read or write feed data: {exc}", file=sys.stderr)
        return 1
    except ElementTree.ParseError as exc:
        print(f"Failed to parse feed XML: {exc}", file=sys.stderr)
        return 1

    print(f"Wrote {len(payload['posts'])} posts to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
