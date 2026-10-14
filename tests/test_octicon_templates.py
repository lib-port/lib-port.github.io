from __future__ import annotations

import re
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
OCTICON_TAG = re.compile(r"\{%\s*octicon\s+[^%]+%\}")


class OcticonTemplateTests(unittest.TestCase):
    def test_octicons_use_the_source_size_for_their_context(self) -> None:
        template_paths = [REPO_ROOT / "index.html"]
        template_paths.extend(sorted((REPO_ROOT / "_includes").rglob("*.html")))

        octicon_tags: list[tuple[Path, str]] = []
        for path in template_paths:
            template = path.read_text(encoding="utf-8")
            octicon_tags.extend(
                (path, match.group(0)) for match in OCTICON_TAG.finditer(template)
            )

        self.assertTrue(octicon_tags, "No Octicon tags were found")
        wrong_source_size = []
        for path, tag in octicon_tags:
            expected = 24 if path.name == "header.html" else 16
            if re.match(r"\{%\s*octicon\s+cpu\b", tag):
                expected = {
                    "repo_grid.html": 32,
                    "recent_milestones.html": 32,
                    "sub-footer.html": 24,
                }.get(path.name, expected)
            elif path.name == "repo_grid.html" and re.match(r"\{%\s*octicon\s+sync\b", tag):
                expected = 24
            if not re.search(rf"\bheight\s*:\s*{expected}\b", tag):
                wrong_source_size.append(
                    f"{path.relative_to(REPO_ROOT)}: expected {expected}px: {tag}"
                )
        self.assertEqual([], wrong_source_size)


if __name__ == "__main__":
    unittest.main()
