from __future__ import annotations

import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parent.parent
PREVIEW_PATH = REPO_ROOT / "preview.sh"
CONFIG_PATH = REPO_ROOT / "_config.yml"


class PreviewScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.temp_path = Path(temp_dir.name)
        self.bin_dir = self.temp_path / "bin"
        self.bin_dir.mkdir()
        self.capture_path = self.temp_path / "bundle-arguments"
        self.cwd_capture_path = self.temp_path / "bundle-cwd"
        self.gh_capture_path = self.temp_path / "gh-arguments"

        self.write_executable(
            "bundle",
            r"""
            #!/usr/bin/env bash
            set -euo pipefail

            if [[ "${1:-}" == "check" ]]; then
              exit "${FAKE_BUNDLE_CHECK_EXIT:-0}"
            fi

            if [[ "${1:-}" == "exec" ]]; then
              if [[ "${JEKYLL_GITHUB_TOKEN:-}" != "${EXPECTED_GITHUB_TOKEN:-}" ]]; then
                printf 'The preview passed an unexpected GitHub credential.\n' >&2
                exit 41
              fi
              printf '%s\n' "$@" > "$PREVIEW_CAPTURE"
              pwd > "$PREVIEW_CWD_CAPTURE"
              exit 0
            fi

            printf 'Unexpected bundle invocation.\n' >&2
            exit 42
            """,
        )
        self.write_executable(
            "gh",
            r"""
            #!/usr/bin/env bash
            set -euo pipefail

            printf '%s\n' "$@" > "$GH_CAPTURE"
            if [[ "${FAKE_GH_EXIT:-0}" != "0" ]]; then
              exit "$FAKE_GH_EXIT"
            fi
            printf '%s\n' "${FAKE_GH_TOKEN:-}"
            """,
        )

    def write_executable(self, name: str, contents: str) -> None:
        path = self.bin_dir / name
        path.write_text(textwrap.dedent(contents).lstrip(), encoding="utf-8")
        path.chmod(0o755)

    def environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment["PATH"] = f"{self.bin_dir}{os.pathsep}{environment['PATH']}"
        environment["PREVIEW_CAPTURE"] = str(self.capture_path)
        environment["PREVIEW_CWD_CAPTURE"] = str(self.cwd_capture_path)
        environment["GH_CAPTURE"] = str(self.gh_capture_path)
        environment.pop("JEKYLL_GITHUB_TOKEN", None)
        return environment

    def run_preview(
        self,
        *arguments: str,
        environment: dict[str, str],
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(PREVIEW_PATH), *arguments],
            cwd=self.temp_path,
            env=environment,
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )

    def test_environment_token_takes_precedence_and_options_pass_through(
        self,
    ) -> None:
        environment = self.environment()
        environment["JEKYLL_GITHUB_TOKEN"] = "environment-token"
        environment["EXPECTED_GITHUB_TOKEN"] = "environment-token"
        environment["FAKE_GH_EXIT"] = "1"

        result = self.run_preview("--port", "4001", environment=environment)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.capture_path.read_text(encoding="utf-8").splitlines(),
            [
                "exec",
                "jekyll",
                "serve",
                "--livereload",
                "--open-url",
                "--port",
                "4001",
            ],
        )
        self.assertEqual(
            self.cwd_capture_path.read_text(encoding="utf-8").strip(),
            str(REPO_ROOT),
        )
        self.assertFalse(self.gh_capture_path.exists())

    def test_authenticated_github_cli_supplies_the_fallback_token(self) -> None:
        environment = self.environment()
        environment["FAKE_GH_TOKEN"] = "cli-token"
        environment["EXPECTED_GITHUB_TOKEN"] = "cli-token"

        result = self.run_preview(environment=environment)

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.gh_capture_path.read_text(encoding="utf-8").splitlines(),
            ["auth", "token", "--hostname", "github.com"],
        )
        self.assertNotIn("cli-token", result.stdout)
        self.assertNotIn("cli-token", result.stderr)

    def test_missing_github_authentication_stops_before_serving(self) -> None:
        environment = self.environment()
        environment["FAKE_GH_EXIT"] = "1"

        result = self.run_preview(environment=environment)

        self.assertEqual(result.returncode, 1)
        self.assertIn("GitHub authentication is required", result.stderr)
        self.assertFalse(self.capture_path.exists())

    def test_missing_ruby_dependencies_reports_the_install_command(self) -> None:
        environment = self.environment()
        environment["FAKE_BUNDLE_CHECK_EXIT"] = "1"

        result = self.run_preview(environment=environment)

        self.assertEqual(result.returncode, 1)
        self.assertIn('Run "bundle install"', result.stderr)
        self.assertFalse(self.capture_path.exists())

    def test_preview_script_is_excluded_from_the_generated_site(self) -> None:
        config = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))

        self.assertIn("preview.sh", config["exclude"])

    def test_preview_script_is_executable(self) -> None:
        self.assertTrue(os.access(PREVIEW_PATH, os.X_OK))


if __name__ == "__main__":
    unittest.main()
