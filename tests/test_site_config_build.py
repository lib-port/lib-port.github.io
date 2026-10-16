"""Exercise Ruby validation and direct Jekyll builds without network access."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from helpers.ruby_site_config import (
    ConfigValidationError, close_validator, request_validation, validate_site_config,
)

ROOT = Path(__file__).resolve().parent.parent
unittest.addModuleCleanup(close_validator)


class RubyConfigTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.source = Path(directory.name)
        self.config = self.source / "_config.yml"

    def test_file_loading_diagnostics_and_empty_documents(self):
        for contents in ("", "null", "# empty configuration\n"):
            self.config.write_text(contents)
            self.assertFalse(validate_site_config(self.config).intro.enabled)
        for contents, message in (("[]", "top-level mapping"), ("false", "top-level mapping"),
                                  ("intro: [", "Malformed YAML")):
            self.config.write_text(contents)
            with self.subTest(contents=contents), self.assertRaisesRegex(ConfigValidationError, message):
                validate_site_config(self.config)
        with self.assertRaisesRegex(ConfigValidationError, "Failed to read"):
            validate_site_config(self.source / "missing.yml")

    def test_yaml_aliases_and_dates_are_allowed(self):
        self.config.write_text("date: 2026-10-15\nintro: &intro {switch: true, text: Hello}\ncopy: *intro\n")
        self.assertEqual(validate_site_config(self.config).intro.text, "Hello")

    def test_unicode_casefold_duplicates_and_whitespace(self):
        raw = {"repo_grid": {"switch": True, "repo_list": ["Straße", " STRASSE "]}}
        with self.assertRaisesRegex(ConfigValidationError, "duplicate repository names: STRASSE"):
            request_validation(raw=raw)
        raw["repo_grid"]["repo_list"] = ["\u00a0alpha\u00a0", " beta "]
        self.assertEqual(request_validation(raw=raw)["result"]["repo_grid"]["repo_list"], ["alpha", "beta"])

    def test_http_url_casing_unicode_and_invalid_authorities(self):
        raw = {"external_blog": {"switch": True, "feed_url": " HTTPS://例え.test/a b ",
                                 "archive_url": "http://example.test/archive", "post_limit": 1}}
        self.assertEqual(request_validation(raw=raw)["result"]["external_blog"]["feed_url"], "HTTPS://例え.test/a b")
        for url in ("/feed", "ftp://example.test", "https://", "https://[invalid"):
            raw["external_blog"]["feed_url"] = url
            with self.subTest(url=url), self.assertRaisesRegex(ConfigValidationError, "absolute HTTP"):
                request_validation(raw=raw)

    def test_hash_validation_preserves_raw_values_and_order(self):
        raw = {"intro": {"switch": True, "text": " Hello "}, "title": "Fixture",
               "repo_grid": {"switch": True, "repo_list": [" alpha "]}}
        result = request_validation(raw=raw)
        self.assertEqual(result["raw"], raw)
        self.assertEqual(list(result["raw"]), list(raw))
        self.assertEqual(result["result"]["intro"]["text"], "Hello")

    def test_missing_catalogue_uses_the_supplied_source_root_and_label(self):
        with self.assertRaisesRegex(ConfigValidationError, "custom.yml: cannot read the local ASCII scene catalogue"):
            request_validation(raw={"ascii_banner": {"switch": True, "module": "random"}},
                               config_path="custom.yml", source_root=str(self.source))

    def test_malformed_catalogues_report_configuration_errors(self):
        catalogue = self.source / "assets/js/ascii-rest/manifest.json"
        catalogue.parent.mkdir(parents=True)
        for contents in ("null", "[]", "{", "{}", '{"scenes": null}', '{"scenes": [1]}'):
            catalogue.write_text(contents)
            with self.subTest(contents=contents), self.assertRaisesRegex(
                ConfigValidationError, "cannot read the local ASCII scene catalogue"
            ):
                request_validation(raw={"ascii_banner": {"switch": True, "module": "random"}},
                                   source_root=str(self.source))

    def test_cli_exit_status_and_supplied_path(self):
        for contents, expected in (("intro: {switch: true}\n", 1), ("intro: {switch: false}\n", 0)):
            self.config.write_text(contents)
            result = subprocess.run(["bundle", "exec", "ruby", "scripts/validate_site_config.rb", str(self.config)],
                                    cwd=ROOT, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, expected, result.stderr)
            if expected:
                self.assertIn("Failed to validate site configuration:", result.stderr)
                self.assertIn(str(self.config), result.stderr)
            else:
                self.assertIn("Validated site configuration", result.stdout)


class JekyllConfigValidationTests(unittest.TestCase):
    def test_direct_build_and_rebuild_validate_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            source.mkdir()
            for filename in ("scripts/site_config.rb", "_plugins/site_config_validation.rb", "_plugins/ascii_banner_assets.rb"):
                target = source / filename
                target.parent.mkdir(exist_ok=True)
                shutil.copyfile(ROOT / filename, target)
            (source / "index.html").write_text("---\n---\nFresh build")
            destination = Path(directory) / "output"
            runner = r'''
require "jekyll"
require "json"
settings = JSON.parse(STDIN.read)
config = Jekyll.configuration("source" => settings.fetch("source"), "destination" => settings.fetch("destination"),
                              "quiet" => true, "exclude" => ["scripts"])
begin
  config["ascii_banner"] = [] if settings["invalid_init"]
  site = Jekyll::Site.new(config)
  site.process
  if settings["invalid_reset"]
    site.config["recent_commits"] = {"switch" => true, "commits" => false}
    site.process
  end
rescue Jekyll::Errors::FatalException => error
  warn error.message
  exit 1
end
'''
            def run(**settings):
                return subprocess.run(["bundle", "exec", "ruby", "-e", runner], cwd=ROOT,
                                      input=json.dumps({"source": str(source), "destination": str(destination), **settings}),
                                      capture_output=True, text=True, timeout=20)
            invalid = run(invalid_init=True)
            self.assertEqual(invalid.returncode, 1, invalid.stderr)
            self.assertIn("ascii_banner must be a mapping", invalid.stderr)
            self.assertFalse(destination.exists())
            valid = run()
            self.assertEqual(valid.returncode, 0, valid.stderr)
            index = destination / "index.html"
            previous = index.read_text()
            (source / "index.html").write_text("---\n---\nChanged build")
            invalid = run(invalid_reset=True)
            self.assertEqual(invalid.returncode, 1, invalid.stderr)
            self.assertIn("recent_commits.commits must be an integer", invalid.stderr)
            # The first valid build in this process writes, but the invalid rebuild does not.
            self.assertEqual(index.read_text(), "Changed build")
            self.assertEqual(previous, "Fresh build")
            self.assertFalse((destination / "scripts").exists())
