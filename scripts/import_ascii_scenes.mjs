#!/usr/bin/env node
// Manual, authenticated import. Normal site builds use the committed JavaScript.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, rm, cp, readdir } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = join(root, "assets/js/ascii-rest");
const repository = "bas3line/ascii";
const pinnedRevision = "f0eee43fe5ea40d0070c936c5c402627c6ff970a";

function replaceRequired(source, before, after) {
  if (!source.includes(before)) throw new Error(`Upstream integration changed: ${before}`);
  return source.replace(before, after);
}

function adaptElement(source) {
  source = replaceRequired(source,
    "url(https://ascii.rest/fonts/ascii-rest-mono.woff2)",
    'url(\' + new URL("./fonts/ascii-rest-mono.woff2", import.meta.url).href + \')');
  source = replaceRequired(source, "  async #start() {", `  async #start() {
    this.removeAttribute("data-ascii-ready");
    try {
      await this.#render();
    } catch (error) {
      this.dispatchEvent(new CustomEvent("ascii-art-error", { bubbles: true }));
      console.warn("<ascii-art> could not render its local scene:", error);
    }
  }

  async #render() {`);
  source = replaceRequired(source, "      else return;", `      else {
        this.dispatchEvent(new CustomEvent("ascii-art-error", { bubbles: true }));
        return;
      }`);
  source = replaceRequired(source, "    } catch (error) {\n      console.warn(`<ascii-art> could not load", `    } catch (error) {
      if (run === this.#run) this.dispatchEvent(new CustomEvent("ascii-art-error", { bubbles: true }));
      console.warn(\`<ascii-art> could not load`);
  source = replaceRequired(source, "    this.#stop = mount(el, piece, options);", `    this.#stop = mount(el, piece, options);
    this.setAttribute("data-ascii-ready", "true");
    this.dispatchEvent(new CustomEvent("ascii-art-ready", { bubbles: true }));`);
  return source;
}

export async function importScenes(revision = pinnedRevision) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Supply a full upstream commit SHA.");
  const temporary = await mkdtemp(join(tmpdir(), "lib-port-ascii-"));
  try {
    // gh reads an environment credential or its authenticated local keyring.
    const archive = execFileSync("gh", ["api", `repos/${repository}/tarball/${revision}`], {
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const archivePath = join(temporary, "upstream.tar.gz");
    await writeFile(archivePath, archive);
    const sourceRoot = join(temporary, "upstream");
    await mkdir(sourceRoot);
    execFileSync("tar", ["-xzf", archivePath, "--strip-components=1", "-C", sourceRoot]);
    const output = join(temporary, "output");
    await mkdir(join(output, "pieces"), { recursive: true });
    await mkdir(join(output, "fonts"));
    await writeFile(join(output, "package.json"), '{"type":"module"}\n');
    const sourceHashes = {};
    const licenceHeader = "/*! ascii.rest © 2026 bas3line (https://github.com/bas3line). MIT licence; see LICENSE. */\n";
    const compile = async (sourcePath, outputPath, adapt = source => source) => {
      const original = await readFile(join(sourceRoot, sourcePath), "utf8");
      sourceHashes[sourcePath] = createHash("sha256").update(original).digest("hex");
      const js = stripTypeScriptTypes(adapt(original), { mode: "transform" })
        .replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
      await writeFile(join(output, outputPath), licenceHeader + js);
    };
    const scenes = [];
    for (const filename of (await readdir(join(sourceRoot, "src/pieces"))).sort()) {
      if (!filename.endsWith(".ts")) continue;
      const source = await readFile(join(sourceRoot, "src/pieces", filename), "utf8");
      if (!/category:\s*["']scenes["']/.test(source)) continue;
      const name = filename.slice(0, -3);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Invalid scene name: ${name}`);
      const relativePath = `pieces/${name}.js`;
      await compile(`src/pieces/${filename}`, relativePath);
      // Detect any new runtime dependencies before replacing the local catalogue.
      const piece = await import(pathToFileURL(join(output, relativePath)));
      if (piece.meta.category !== "scenes" || typeof piece.default !== "function") {
        throw new Error(`Invalid scene module: ${name}`);
      }
      scenes.push(name);
    }
    if (!scenes.length) throw new Error("The upstream revision contains no scenes.");
    await compile("src/mount.ts", "mount.js");
    await compile("src/ascii.ts", "ascii.js", adaptElement);
    const entries = scenes.map(name => `  ${JSON.stringify(name)}: () => import("./pieces/${name}.js"),`).join("\n");
    await writeFile(join(output, "library.js"), `${licenceHeader}// Scene-only registry generated by scripts/import_ascii_scenes.mjs.
export const load = {
${entries}
};
export const names = Object.keys(load);
export const isPiece = name => Object.hasOwn(load, name);
`);
    for (const [source, target] of [
      ["LICENSE", "LICENSE"],
      ["site/public/fonts/OFL.txt", "fonts/OFL.txt"],
      ["site/public/fonts/ascii-rest-mono.woff2", "fonts/ascii-rest-mono.woff2"],
    ]) await cp(join(sourceRoot, source), join(output, target));
    await writeFile(join(output, "manifest.json"), JSON.stringify({ repository, revision, scenes, sourceHashes }, null, 2) + "\n");
    await writeFile(join(output, "README.md"), `# Local ASCII scenes

Imported from https://github.com/${repository}/tree/${revision}.
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
`);
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    await cp(output, destination, { recursive: true });
    console.log(`Imported ${scenes.length} scenes from ${repository}@${revision}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await importScenes(process.argv[2]);
}
