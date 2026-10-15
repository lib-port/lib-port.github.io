import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { minify } from "terser";

const siteDirectory = resolve(process.argv[2] || "_site");
if (siteDirectory === resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  throw new Error("Optimise generated assets in a build directory; keep source files readable.");
}
const scripts = ["github_activity.js", "theme_toggle.js", "external_blog.js"];
const homepage = await readFile(join(siteDirectory, "index.html"), "utf8");
const scriptReference = name => new RegExp(`<script\\b[^>]*\\bsrc="[^"]*/assets/js/${name.replace(".", "\\.")}"`);
const optionalScripts = [
  ["title_flight.js", "Paper plane", "Paper plane"],
  ["drag_surface.js", "Drag controller", "Drag controller"],
  ["light_dark_ball.js", "Light/dark ball", "Light/dark ball"],
  ["drag_reveal.js", "Find the bug game", "Game"],
];
const optionalAssets = await Promise.all(optionalScripts.map(async ([name, label, errorLabel]) => {
  const asset = await stat(join(siteDirectory, "assets", "js", name)).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const enabled = scriptReference(name).test(homepage);
  if (enabled !== Boolean(asset) || (asset && !asset.isFile())) {
    throw new Error(`${errorLabel} asset inclusion mismatch: ${name} must match the generated homepage script reference.`);
  }
  return { name, label, enabled };
}));
const enabled = name => optionalAssets.find(asset => asset.name === name).enabled;
if (enabled("drag_surface.js") !== (enabled("drag_reveal.js") || enabled("light_dark_ball.js"))) {
  throw new Error("Drag controller dependency mismatch: include drag_surface.js exactly when a drag feature is enabled.");
}
for (const { name, label, enabled } of optionalAssets) {
  if (enabled) {
    if (["drag_reveal.js", "light_dark_ball.js"].includes(name) &&
        homepage.search(scriptReference("drag_surface.js")) > homepage.search(scriptReference(name))) {
      throw new Error(`Drag controller must load before ${name}.`);
    }
    scripts.push(name);
  } else {
    console.log(`${label}: skipped (asset excluded)`);
  }
}
const gzipSize = (content) => gzipSync(content, { level: 9 }).length;
let totalJavaScript = 0;

for (const name of scripts) {
  const path = join(siteDirectory, "assets", "js", name);
  const source = await readFile(path, "utf8");
  const result = await minify(source, {
    ecma: 2020,
    compress: { unsafe: false, passes: 2 },
    mangle: true,
    format: { comments: "some" },
  });
  const output = `${result.code}\n`;
  const size = gzipSize(output);
  if (name === "github_activity.js" && size > 16 * 1024) {
    throw new Error(`Activity script exceeds the 16 KiB gzip budget: ${size} bytes`);
  }
  await writeFile(path, output);
  totalJavaScript += size;
  console.log(`${name}: ${size} bytes gzipped`);
}

if (totalJavaScript > 27 * 1024) {
  throw new Error(`JavaScript exceeds the 27 KiB combined gzip budget: ${totalJavaScript} bytes`);
}
const asciiDirectory = join(siteDirectory, "assets", "js", "ascii-rest");
const asciiLoaderPath = join(siteDirectory, "assets", "js", "ascii_banner.mjs");
const [asciiLoader, asciiCatalogue] = await Promise.all(
  [asciiLoaderPath, asciiDirectory].map(path => stat(path).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  }))
);
if (asciiLoader || asciiCatalogue) {
  if (!asciiLoader?.isFile() || !asciiCatalogue?.isDirectory()) {
    throw new Error("Incomplete ASCII assets: expected both ascii_banner.mjs and the ascii-rest directory.");
  }
  const asciiPaths = [asciiLoaderPath];
  for (const entry of await readdir(asciiDirectory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) {
      asciiPaths.push(join(entry.parentPath, entry.name));
    }
  }
  let asciiJavaScript = 0;
  for (const path of asciiPaths) {
    const result = await minify(await readFile(path, "utf8"), {
      module: true,
      ecma: 2022,
      compress: { unsafe: false },
      mangle: true,
      format: { comments: "some" },
    });
    const output = `${result.code}\n`;
    asciiJavaScript += gzipSize(output);
    await writeFile(path, output);
  }
  if (asciiJavaScript > 100 * 1024) {
    throw new Error(`ASCII JavaScript exceeds the 100 KiB catalogue gzip budget: ${asciiJavaScript} bytes`);
  }
  console.log(`ASCII JavaScript catalogue: ${asciiJavaScript} bytes gzipped (only the selected scene is loaded)`);
} else {
  console.log("ASCII JavaScript catalogue: skipped (banner assets excluded)");
}
const cssSize = gzipSize(await readFile(join(siteDirectory, "assets", "css", "style.css")));
if (cssSize > 8 * 1024) {
  throw new Error(`Stylesheet exceeds the 8 KiB gzip budget: ${cssSize} bytes`);
}
console.log(`JavaScript total: ${totalJavaScript} bytes; stylesheet: ${cssSize} bytes gzipped`);
