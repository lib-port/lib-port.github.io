# Local ASCII scenes

Imported from https://github.com/bas3line/ascii/tree/f0eee43fe5ea40d0070c936c5c402627c6ff970a.
Upstream code is MIT licensed; the fallback font is OFL licensed. The full
licence texts are in LICENSE and fonts/OFL.txt.

The scene-only registry is generated locally. The web component uses a
module-relative font URL and emits ascii-art-ready after mounting a scene,
or ascii-art-error if loading or mounting fails. These are the only local
runtime adaptations. TypeScript imports and types are converted to browser
JavaScript using Node's built-in type transformation.

Normal builds do not download or compile these files. To refresh them, run
node scripts/import_ascii_scenes.mjs <full-upstream-commit-sha> from the repo,
using an authenticated GitHub CLI, then review the diff and run the tests.
manifest.json records the imported source hashes and available scene names.
