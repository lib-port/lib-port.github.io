#!/usr/bin/env python3
"""Validate site configuration before running build steps."""

from __future__ import annotations

import sys

from site_config import ConfigValidationError, validate_site_config


def main() -> int:
    try:
        validate_site_config()
    except ConfigValidationError as exc:
        print(f"Failed to validate site configuration: {exc}", file=sys.stderr)
        return 1

    print("Validated site configuration")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
