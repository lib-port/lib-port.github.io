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
        wrong_source_size = [
            f"{path.relative_to(REPO_ROOT)}: expected {expected}px: {tag}"
            for path, tag in octicon_tags
            for expected in (24 if path.name == "header.html" else 16,)
            if not re.search(rf"\bheight\s*:\s*{expected}\b", tag)
        ]
        self.assertEqual([], wrong_source_size)


if __name__ == "__main__":
    unittest.main()
