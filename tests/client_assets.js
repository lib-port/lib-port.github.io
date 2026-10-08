"use strict";

const path = require("node:path");

function clientAssetPath(sourcePath) {
  return process.env.CLIENT_ASSET_DIRECTORY
    ? path.resolve(process.env.CLIENT_ASSET_DIRECTORY,
        path.relative(path.join(__dirname, "..", "assets", "js"), sourcePath))
    : sourcePath;
}

module.exports = { clientAssetPath };
