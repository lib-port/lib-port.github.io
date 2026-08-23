from __future__ import annotations

import unittest
from pathlib import Path


TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "_includes" / "repo_grid.html"


class RepoGridTemplateTests(unittest.TestCase):
    def test_repo_title_has_decorative_repo_icon_before_link(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")
        repo_icon = (
            '<span class="repo-icon" aria-hidden="true">{% octicon repo %}</span>'
        )
        repo_link = (
            '<a class="repo-link" href="{{ repo.html_url }}">{{ repo.name }}</a>'
        )

        self.assertIn(repo_icon, template)
        self.assertIn(repo_link, template)
        self.assertLess(template.index(repo_icon), template.index(repo_link))

    def test_noassertion_license_is_not_rendered(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn('repo.license.spdx_id != "NOASSERTION"', template)

    def test_homepage_site_link_is_optional_and_follows_download(self) -> None:
        template = TEMPLATE_PATH.read_text(encoding="utf-8")

        self.assertIn(
            'assign homepage = repo.homepage | default: "" | strip', template
        )
        self.assertIn('if homepage != ""', template)
        self.assertIn('{% octicon link %}', template)
        self.assertIn(
            '<a href="{{ homepage | escape }}" rel="nofollow">site</a>', template
        )
        self.assertLess(
            template.index('{% octicon file-zip %}'),
            template.index('{% octicon link %}'),
        )


if __name__ == "__main__":
    unittest.main()
