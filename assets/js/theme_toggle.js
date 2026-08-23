(() => {
  "use strict";

  const THEME_STORAGE_KEY = "lib-port:theme:v1";
  const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
  const LIGHT_THEME = "light";
  const DARK_THEME = "dark";

  function isTheme(value) {
    return value === LIGHT_THEME || value === DARK_THEME;
  }

  function readStoredTheme(storage) {
    try {
      const theme = storage?.getItem(THEME_STORAGE_KEY);
      if (isTheme(theme)) return theme;
      if (theme !== null && theme !== undefined) {
        storage?.removeItem(THEME_STORAGE_KEY);
      }
    } catch {
      // Storage is an optional enhancement.
    }

    return null;
  }

  function writeStoredTheme(storage, theme) {
    if (!isTheme(theme)) return false;

    try {
      storage?.setItem(THEME_STORAGE_KEY, theme);
      return Boolean(storage);
    } catch {
      return false;
    }
  }

  function getSystemTheme(mediaQuery) {
    return mediaQuery?.matches ? DARK_THEME : LIGHT_THEME;
  }

  function applyTheme(root, theme) {
    if (!root || !isTheme(theme)) return false;
    root.dataset.theme = theme;
    return true;
  }

  function renderToggle(button, theme) {
    if (!button || !isTheme(theme)) return false;

    const lightIcon = button.querySelector('[data-theme-icon="light"]');
    const darkIcon = button.querySelector('[data-theme-icon="dark"]');
    if (!lightIcon || !darkIcon) return false;

    const nextTheme = theme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
    const label = `Switch to ${nextTheme} mode`;
    lightIcon.hidden = nextTheme !== LIGHT_THEME;
    darkIcon.hidden = nextTheme !== DARK_THEME;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    return true;
  }

  function getStorage(windowRef) {
    try {
      return windowRef?.localStorage || null;
    } catch {
      return null;
    }
  }

  function getMediaQuery(windowRef) {
    try {
      return windowRef?.matchMedia?.(DARK_MODE_QUERY) || null;
    } catch {
      return null;
    }
  }

  function initThemeToggle({
    documentRef = typeof document === "undefined" ? null : document,
    windowRef = typeof window === "undefined" ? null : window,
    storage,
    mediaQuery,
  } = {}) {
    const root = documentRef?.documentElement;
    const button = documentRef?.querySelector?.("[data-theme-toggle]");
    if (!root || !button) return null;

    const resolvedStorage =
      storage === undefined ? getStorage(windowRef) : storage;
    const resolvedMediaQuery =
      mediaQuery === undefined ? getMediaQuery(windowRef) : mediaQuery;
    let explicitTheme = readStoredTheme(resolvedStorage);
    let currentTheme = explicitTheme || getSystemTheme(resolvedMediaQuery);

    if (!applyTheme(root, currentTheme) || !renderToggle(button, currentTheme)) {
      return null;
    }

    const setTheme = (theme) => {
      if (!applyTheme(root, theme) || !renderToggle(button, theme)) return false;
      currentTheme = theme;
      return true;
    };

    const handleClick = () => {
      explicitTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
      if (setTheme(explicitTheme)) {
        writeStoredTheme(resolvedStorage, explicitTheme);
      }
    };

    const handleSystemChange = (event) => {
      if (!explicitTheme) {
        setTheme(event?.matches ? DARK_THEME : LIGHT_THEME);
      }
    };

    const handleStorage = (event) => {
      if (event?.key !== THEME_STORAGE_KEY) return;
      explicitTheme = isTheme(event.newValue) ? event.newValue : null;
      setTheme(explicitTheme || getSystemTheme(resolvedMediaQuery));
    };

    button.addEventListener("click", handleClick);
    if (typeof resolvedMediaQuery?.addEventListener === "function") {
      resolvedMediaQuery.addEventListener("change", handleSystemChange);
    } else if (typeof resolvedMediaQuery?.addListener === "function") {
      resolvedMediaQuery.addListener(handleSystemChange);
    }
    windowRef?.addEventListener?.("storage", handleStorage);
    button.hidden = false;

    return {
      destroy() {
        button.removeEventListener("click", handleClick);
        if (typeof resolvedMediaQuery?.removeEventListener === "function") {
          resolvedMediaQuery.removeEventListener("change", handleSystemChange);
        } else if (typeof resolvedMediaQuery?.removeListener === "function") {
          resolvedMediaQuery.removeListener(handleSystemChange);
        }
        windowRef?.removeEventListener?.("storage", handleStorage);
      },
      getTheme() {
        return currentTheme;
      },
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      DARK_MODE_QUERY,
      DARK_THEME,
      LIGHT_THEME,
      THEME_STORAGE_KEY,
      applyTheme,
      getSystemTheme,
      initThemeToggle,
      isTheme,
      readStoredTheme,
      renderToggle,
      writeStoredTheme,
    };
  } else {
    initThemeToggle();
  }
})();
