"use strict";

const fs = require("node:fs");
const vm = require("node:vm");

function loadWithLocale(scriptPath, locale) {
  const sandbox = {
    module: { exports: {} },
    Date,
    Intl: {
      // Simulate a browser default while honouring explicit locale requests.
      DateTimeFormat: function (locales = locale, options) {
        return new Intl.DateTimeFormat(locales, options);
      },
    },
  };
  vm.runInNewContext(fs.readFileSync(scriptPath, "utf8"), sandbox, {
    filename: scriptPath,
  });
  return sandbox.module.exports;
}

module.exports = { loadWithLocale };
