from __future__ import annotations

import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
HEAD_PATH = REPO_ROOT / "_includes" / "head.html"
SUB_FOOTER_PATH = REPO_ROOT / "_includes" / "sub-footer.html"
STYLES_PATH = REPO_ROOT / "_sass" / "minima" / "custom-styles.scss"


class ThemeToggleTemplateTests(unittest.TestCase):
    def test_head_bootstraps_theme_before_loading_styles(self) -> None:
        head = HEAD_PATH.read_text(encoding="utf-8")

        self.assertIn('<meta name="color-scheme" content="light dark">', head)
        self.assertIn("include theme_bootstrap.html", head)
        self.assertLess(
            head.index("include theme_bootstrap.html"),
            head.index('id="main-stylesheet"'),
        )

    def test_sub_footer_contains_accessible_octicon_toggle(self) -> None:
        template = SUB_FOOTER_PATH.read_text(encoding="utf-8")

        self.assertIn("data-theme-toggle", template)
        self.assertIn('aria-label="Switch to dark mode"', template)
        self.assertIn('data-theme-icon="dark" aria-hidden="true"', template)
        self.assertIn("{% octicon moon height:16 %}", template)
        self.assertIn('data-theme-icon="light" aria-hidden="true" hidden', template)
        self.assertIn("{% octicon sun height:16 %}", template)
        self.assertRegex(template, r"theme_toggle\.js[^>]*defer")

    def test_styles_cover_forced_themes_and_switcher_states(self) -> None:
        styles = STYLES_PATH.read_text(encoding="utf-8")

        self.assertIn('html[data-theme="light"]', styles)
        self.assertIn('html[data-theme="dark"]', styles)
        self.assertIn("color-scheme: light", styles)
        self.assertIn("color-scheme: dark", styles)
        self.assertIn("@include lm-highlight", styles)
        self.assertIn("@include dm-highlight", styles)
        self.assertRegex(styles, r"\.theme-toggle\s*\{[^}]*width:\s*2\.75rem")
        self.assertRegex(styles, r"\.theme-toggle\s*\{[^}]*height:\s*2\.75rem")
        self.assertRegex(
            styles, r"\.theme-toggle\s*\{[^}]*border:\s*1px solid currentColor"
        )
        self.assertNotRegex(
            styles,
            r"\.theme-toggle(?::[a-z-]+)?\s*\{[^}]*box-shadow",
        )
        self.assertNotRegex(
            styles,
            r"\.theme-toggle(?::[a-z-]+)?\s*\{[^}]*\btransform\s*:",
        )
        self.assertNotRegex(
            styles,
            r"\.theme-toggle\s*\{[^}]*\btransition\s*:[^;]*\btransform\b",
        )
        self.assertIn("safe-area-inset-right", styles)
        self.assertIn("safe-area-inset-bottom", styles)
        self.assertIn(".theme-toggle:focus-visible", styles)
        self.assertIn("prefers-reduced-motion: reduce", styles)
        self.assertIn("@media print", styles)


if __name__ == "__main__":
    unittest.main()
