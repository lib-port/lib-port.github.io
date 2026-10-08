import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { minify } from "terser";

const siteDirectory = resolve(process.argv[2] || "_site");
if (siteDirectory === resolve(fileURLToPath(new URL("..", import.meta.url)))) {
  throw new Error("Optimise generated assets in a build directory; keep source files readable.");
}
const scripts = ["github_activity.js", "theme_toggle.js", "external_blog.js"];
const gzipSize = (content) => gzipSync(content, { level: 9 }).length;
let totalJavaScript = 0;

for (const name of scripts) {
  const path = join(siteDirectory, "assets", "js", name);
  const source = await readFile(path, "utf8");
  const result = await minify(source, {
    ecma: 2020,
    compress: { unsafe: false },
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

if (totalJavaScript > 20 * 1024) {
  throw new Error(`JavaScript exceeds the 20 KiB combined gzip budget: ${totalJavaScript} bytes`);
}
const asciiDirectory = join(siteDirectory, "assets", "js", "ascii-rest");
const asciiPaths = [join(siteDirectory, "assets", "js", "ascii_banner.mjs")];
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
const cssSize = gzipSize(await readFile(join(siteDirectory, "assets", "css", "style.css")));
if (cssSize > 8 * 1024) {
  throw new Error(`Stylesheet exceeds the 8 KiB gzip budget: ${cssSize} bytes`);
}
console.log(`JavaScript total: ${totalJavaScript} bytes; stylesheet: ${cssSize} bytes gzipped`);
