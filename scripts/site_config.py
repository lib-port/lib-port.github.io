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


class ConfigValidationError(ValueError):
    """Raised when site configuration is invalid."""


@dataclass(frozen=True)
class IntroConfig:
    enabled: bool
    text: str


@dataclass(frozen=True)
class RepoGridConfig:
    enabled: bool
    repo_list: list[str]


@dataclass(frozen=True)
class ExternalBlogConfig:
    enabled: bool
    feed_url: str
    archive_url: str
    post_limit: int


@dataclass(frozen=True)
class SiteConfig:
    intro: IntroConfig
    repo_grid: RepoGridConfig
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
        intro=validate_intro(raw),
        repo_grid=validate_repo_grid(raw),
        external_blog=validate_external_blog(raw),
        raw=raw,
    )


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


def validate_external_blog(raw_config: dict[str, Any]) -> ExternalBlogConfig:
    section = _get_section_mapping(raw_config, "external_blog")
    enabled = _get_switch(section, "external_blog")
    if not enabled:
        return ExternalBlogConfig(enabled=False, feed_url="", archive_url="", post_limit=0)

    feed_url = _require_non_blank_string(section, "external_blog", "feed_url")
    archive_url = _optional_string(section.get("archive_url"), "external_blog", "archive_url")

    raw_post_limit = section.get("post_limit")
    if not isinstance(raw_post_limit, int) or isinstance(raw_post_limit, bool) or raw_post_limit <= 0:
        raise ConfigValidationError(
            f"{CONFIG_PATH}: external_blog.switch is true, but external_blog.post_limit must be a positive integer"
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


def _optional_string(value: Any, section_name: str, key: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ConfigValidationError(f"{CONFIG_PATH}: {section_name}.{key} must be a string")
    return value.strip()
