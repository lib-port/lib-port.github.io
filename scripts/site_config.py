#!/usr/bin/env python3
"""Shared loading and validation helpers for site configuration."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = REPO_ROOT / "_config.yml"
TRUTHY_SWITCH_VALUES = {True}
FALSY_SWITCH_VALUES = {False, None}
MAX_EXTERNAL_BLOG_POST_LIMIT = 10
MAX_RECENT_COMMITS = 10
MAX_RECENT_MILESTONES = 10


class ConfigValidationError(ValueError):
    """Raised when site configuration is invalid."""


@dataclass(frozen=True)
class SocialLinkConfig:
    title: str
    icon: str
    url: str


@dataclass(frozen=True)
class MinimaConfig:
    social_links: list[SocialLinkConfig]


@dataclass(frozen=True)
class IntroConfig:
    enabled: bool
    text: str


@dataclass(frozen=True)
class RepoGridConfig:
    enabled: bool
    repo_list: list[str]


@dataclass(frozen=True)
class RecentMilestonesConfig:
    enabled: bool
    milestones: int
    repo_list: list[str]


@dataclass(frozen=True)
class RecentCommitsConfig:
    enabled: bool
    commits: int


@dataclass(frozen=True)
class ExternalBlogConfig:
    enabled: bool
    feed_url: str
    archive_url: str
    post_limit: int


@dataclass(frozen=True)
class SiteConfig:
    minima: MinimaConfig
    intro: IntroConfig
    repo_grid: RepoGridConfig
    recent_milestones: RecentMilestonesConfig
    recent_commits: RecentCommitsConfig
    external_blog: ExternalBlogConfig
    raw: dict[str, Any]


def load_site_config(config_path: Path = CONFIG_PATH) -> dict[str, Any]:
    try:
        with config_path.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle)
    except yaml.YAMLError as exc:
        raise ConfigValidationError(f"Malformed YAML in {config_path}: {exc}") from exc
    except OSError as exc:
        raise ConfigValidationError(f"Failed to read {config_path}: {exc}") from exc

    if loaded is None:
        return {}
    if not isinstance(loaded, dict):
        raise ConfigValidationError(f"{config_path} must contain a top-level mapping")

    return loaded


def validate_site_config(config_path: Path = CONFIG_PATH) -> SiteConfig:
    raw = load_site_config(config_path)
    return SiteConfig(
        minima=validate_minima(raw),
        intro=validate_intro(raw),
        repo_grid=validate_repo_grid(raw),
        recent_milestones=validate_recent_milestones(raw),
        recent_commits=validate_recent_commits(raw),
        external_blog=validate_external_blog(raw),
        raw=raw,
    )


def validate_minima(raw_config: dict[str, Any]) -> MinimaConfig:
    section = _get_section_mapping(raw_config, "minima")
    raw_social_links = section.get("social_links")
    if raw_social_links is None:
        return MinimaConfig(social_links=[])
    if not isinstance(raw_social_links, list):
        raise ConfigValidationError(
            f"{CONFIG_PATH}: minima.social_links must be a list"
        )

    social_links: list[SocialLinkConfig] = []
    for index, raw_link in enumerate(raw_social_links):
        link_path = f"minima.social_links[{index}]"
        if not isinstance(raw_link, dict):
            raise ConfigValidationError(
                f"{CONFIG_PATH}: {link_path} must be a mapping"
            )

        title = _require_config_string(raw_link, link_path, "title")
        icon = _require_config_string(raw_link, link_path, "icon")
        url = _optional_string(raw_link.get("url"), link_path, "url")
        if not url and icon != "github":
            raise ConfigValidationError(
                f"{CONFIG_PATH}: {link_path}.url must be non-blank unless "
                f"{link_path}.icon is github"
            )

        social_links.append(SocialLinkConfig(title=title, icon=icon, url=url))

    return MinimaConfig(social_links=social_links)


def validate_intro(raw_config: dict[str, Any]) -> IntroConfig:
    section = _get_section_mapping(raw_config, "intro")
    enabled = _get_switch(section, "intro")
    if not enabled:
        return IntroConfig(enabled=False, text="")

    text = _require_non_blank_string(section, "intro", "text")
    return IntroConfig(enabled=True, text=text)


def validate_repo_grid(raw_config: dict[str, Any]) -> RepoGridConfig:
    section = _get_section_mapping(raw_config, "repo_grid")
    enabled = _get_switch(section, "repo_grid")
    if not enabled:
        return RepoGridConfig(enabled=False, repo_list=[])

    repo_list = section.get("repo_list")
    if not isinstance(repo_list, list):
        raise ConfigValidationError(
            f"{CONFIG_PATH}: repo_grid.switch is true, but repo_grid.repo_list must be a non-empty list of repository names"
        )
    if not repo_list:
        raise ConfigValidationError(
            f"{CONFIG_PATH}: repo_grid.switch is true, but repo_grid.repo_list must be a non-empty list of repository names"
        )

    normalized: list[str] = []
    seen: set[str] = set()
    duplicates: list[str] = []

    for index, item in enumerate(repo_list):
        if not isinstance(item, str) or not item.strip():
            raise ConfigValidationError(
                f"{CONFIG_PATH}: repo_grid.repo_list[{index}] must be a non-blank string"
            )
        repo_name = item.strip()
        normalized.append(repo_name)
        if repo_name in seen and repo_name not in duplicates:
            duplicates.append(repo_name)
        seen.add(repo_name)

    if duplicates:
        duplicate_list = ", ".join(duplicates)
        raise ConfigValidationError(
            f"{CONFIG_PATH}: repo_grid.repo_list contains duplicate repository names: {duplicate_list}"
        )

    return RepoGridConfig(enabled=True, repo_list=normalized)


def validate_recent_milestones(
    raw_config: dict[str, Any],
) -> RecentMilestonesConfig:
    section = _get_section_mapping(raw_config, "recent_milestones")
    enabled = _get_switch(section, "recent_milestones")
    if not enabled:
        return RecentMilestonesConfig(enabled=False, milestones=0, repo_list=[])

    raw_milestones = section.get("milestones")
    if (
        not isinstance(raw_milestones, int)
        or isinstance(raw_milestones, bool)
        or not 1 <= raw_milestones <= MAX_RECENT_MILESTONES
    ):
        raise ConfigValidationError(
            f"{CONFIG_PATH}: recent_milestones.switch is true, but "
            "recent_milestones.milestones must be an integer "
            f"between 1 and {MAX_RECENT_MILESTONES}"
        )

    repo_list = section.get("repo_list")
    if not isinstance(repo_list, list) or not repo_list:
        raise ConfigValidationError(
            f"{CONFIG_PATH}: recent_milestones.switch is true, but "
            "recent_milestones.repo_list must be a non-empty list of "
            "repository names"
        )

    normalized: list[str] = []
    seen: set[str] = set()
    duplicates: list[str] = []

    for index, item in enumerate(repo_list):
        if not isinstance(item, str) or not item.strip():
            raise ConfigValidationError(
                f"{CONFIG_PATH}: recent_milestones.repo_list[{index}] must be "
                "a non-blank string"
            )
        repo_name = item.strip()
        normalized.append(repo_name)
        if repo_name in seen and repo_name not in duplicates:
            duplicates.append(repo_name)
        seen.add(repo_name)

    if duplicates:
        duplicate_list = ", ".join(duplicates)
        raise ConfigValidationError(
            f"{CONFIG_PATH}: recent_milestones.repo_list contains duplicate "
            f"repository names: {duplicate_list}"
        )

    return RecentMilestonesConfig(
        enabled=True,
        milestones=raw_milestones,
        repo_list=normalized,
    )


def validate_recent_commits(raw_config: dict[str, Any]) -> RecentCommitsConfig:
    section = _get_section_mapping(raw_config, "recent_commits")
    enabled = _get_switch(section, "recent_commits")
    if not enabled:
        return RecentCommitsConfig(enabled=False, commits=0)

    raw_commits = section.get("commits")
    if (
        not isinstance(raw_commits, int)
        or isinstance(raw_commits, bool)
        or not 1 <= raw_commits <= MAX_RECENT_COMMITS
    ):
        raise ConfigValidationError(
            f"{CONFIG_PATH}: recent_commits.switch is true, but recent_commits.commits "
            f"must be an integer between 1 and {MAX_RECENT_COMMITS}"
        )

    return RecentCommitsConfig(enabled=True, commits=raw_commits)


def validate_external_blog(raw_config: dict[str, Any]) -> ExternalBlogConfig:
    section = _get_section_mapping(raw_config, "external_blog")
    enabled = _get_switch(section, "external_blog")
    if not enabled:
        return ExternalBlogConfig(enabled=False, feed_url="", archive_url="", post_limit=0)

    feed_url = _require_non_blank_string(section, "external_blog", "feed_url")
    archive_url = _require_non_blank_string(section, "external_blog", "archive_url")

    raw_post_limit = section.get("post_limit")
    if (
        not isinstance(raw_post_limit, int)
        or isinstance(raw_post_limit, bool)
        or not 1 <= raw_post_limit <= MAX_EXTERNAL_BLOG_POST_LIMIT
    ):
        raise ConfigValidationError(
            f"{CONFIG_PATH}: external_blog.switch is true, but external_blog.post_limit "
            f"must be an integer between 1 and {MAX_EXTERNAL_BLOG_POST_LIMIT}"
        )

    return ExternalBlogConfig(
        enabled=True,
        feed_url=feed_url,
        archive_url=archive_url,
        post_limit=raw_post_limit,
    )


def _get_section_mapping(raw_config: dict[str, Any], section_name: str) -> dict[str, Any]:
    section = raw_config.get(section_name)
    if section is None:
        return {}
    if not isinstance(section, dict):
        raise ConfigValidationError(f"{CONFIG_PATH}: {section_name} must be a mapping")
    return section


def _get_switch(section: dict[str, Any], section_name: str) -> bool:
    raw_switch = section.get("switch")
    if raw_switch in FALSY_SWITCH_VALUES:
        return False
    if raw_switch in TRUTHY_SWITCH_VALUES:
        return True
    raise ConfigValidationError(
        f"{CONFIG_PATH}: {section_name}.switch must be a YAML boolean"
    )


def _require_non_blank_string(section: dict[str, Any], section_name: str, key: str) -> str:
    raw_value = section.get(key)
    value = _optional_string(raw_value, section_name, key)
    if not value:
        raise ConfigValidationError(
            f"{CONFIG_PATH}: {section_name}.switch is true, but {section_name}.{key} is missing or blank"
        )
    return value


def _require_config_string(section: dict[str, Any], path: str, key: str) -> str:
    value = _optional_string(section.get(key), path, key)
    if not value:
        raise ConfigValidationError(
            f"{CONFIG_PATH}: {path}.{key} is missing or blank"
        )
    return value


def _optional_string(value: Any, section_name: str, key: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ConfigValidationError(f"{CONFIG_PATH}: {section_name}.{key} must be a string")
    return value.strip()
