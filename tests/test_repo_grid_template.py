from __future__ import annotations

import unittest
from pathlib import Path


TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "_includes" / "repo_grid.html"


class RepoGridTemplateTests(unittest.TestCase):
    def test_noassertion_license_is_not_rendered(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn('repo.license.spdx_id != "NOASSERTION"', template)


if __name__ == "__main__":
    unittest.main()
