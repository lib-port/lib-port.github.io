"""Test-only bridge to the sole Ruby validator; reuse one process per test module."""

import atexit
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
_process = None


class ConfigValidationError(ValueError):
    pass


def close_validator():
    global _process
    if _process is not None:
        _process.stdin.close()
        try:
            _process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _process.kill()
            _process.wait()
        _process.stdout.close()
        _process.stderr.close()
        _process = None


atexit.register(close_validator)


def request_validation(**request):
    global _process
    if _process is None:
        _process = subprocess.Popen(
            ["bundle", "exec", "ruby", "tests/helpers/ruby_site_config.rb"],
            cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
        )
    _process.stdin.write(json.dumps(request) + "\n")
    _process.stdin.flush()
    line = _process.stdout.readline()
    if not line:
        raise RuntimeError("Ruby validator failed: " + _process.stderr.read())
    result = json.loads(line)
    if "error" in result:
        raise ConfigValidationError(result["error"])
    return result


def validate_site_config(config_path, *, source_root=ROOT):
    result = request_validation(config_path=str(config_path), source_root=str(source_root))["result"]
    return SimpleNamespace(**{name: SimpleNamespace(**settings) for name, settings in result.items()})
