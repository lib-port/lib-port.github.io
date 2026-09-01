(() => {
  const RSS2JSON_ENDPOINT = "https://api.rss2json.com/v1/api.json";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const CACHE_KEY_PREFIX = "external-blog:v1:";
  const MAX_POSTS = 10;
  const EXCERPT_MAX_LENGTH = 280;
  const REQUEST_TIMEOUT_MS = 15_000;
  const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  function start() {
    const headings = document.querySelectorAll("[data-external-blog-heading]");
    for (const heading of headings) {
      heading.removeAttribute("hidden");
    }

    const containers = document.querySelectorAll("[data-external-blog]");

    for (const container of containers) {
      void enhanceContainer(container);
    }
  }

  async function enhanceContainer(
    container,
    {
      fetchImpl = getDefaultFetch(),
      documentRef = document,
      storage = getDefaultStorage(),
      now = Date.now(),
      logger = console,
      htmlToText = parseHtmlToText,
      requestTimeoutMs = REQUEST_TIMEOUT_MS,
    } = {}
  ) {
    const feedUrl = normalizeHttpUrl(container?.dataset?.feedUrl);
    const archiveUrl = normalizeHttpUrl(container?.dataset?.archiveUrl);
    const postLimit = parsePostLimit(container?.dataset?.postLimit);

    if (!feedUrl || !archiveUrl || !postLimit) {
      logger.error("Failed to load external blog posts: invalid configuration");
      return false;
    }

    const cachedPosts = readCache(feedUrl, storage, now);
    if (cachedPosts) {
      renderPosts(container, cachedPosts.slice(0, postLimit), archiveUrl, documentRef);
      return true;
    }

    container.setAttribute("aria-busy", "true");

    try {
      const payload = await fetchFeed(
        buildProxyUrl(feedUrl),
        fetchImpl,
        requestTimeoutMs
      );
      const posts = normalizeFeedItems(payload, MAX_POSTS, htmlToText);
      if (posts.length === 0) {
        throw new Error("RSS2JSON returned no valid posts");
      }

      writeCache(feedUrl, posts, storage, now);
      renderPosts(container, posts.slice(0, postLimit), archiveUrl, documentRef);
      return true;
    } catch (error) {
      logger.error("Failed to load external blog posts", error);
      return false;
    } finally {
      container.removeAttribute("aria-busy");
    }
  }

  function buildProxyUrl(feedUrl) {
    const params = new URLSearchParams({ rss_url: feedUrl });
    return `${RSS2JSON_ENDPOINT}?${params.toString()}`;
  }

  function getDefaultFetch() {
    try {
      return typeof fetch === "function" ? fetch.bind(globalThis) : null;
    } catch {
      return null;
    }
  }

  function createTimeoutError(timeoutMs) {
    const error = new Error(`External blog request timed out after ${timeoutMs} ms`);
    error.name = "TimeoutError";
    return error;
  }

  async function fetchFeed(url, fetchImpl, requestTimeoutMs = REQUEST_TIMEOUT_MS) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Fetch API unavailable");
    }

    const timeoutMs =
      typeof requestTimeoutMs === "number" &&
      Number.isFinite(requestTimeoutMs) &&
      requestTimeoutMs > 0
        ? requestTimeoutMs
        : REQUEST_TIMEOUT_MS;
    const controller =
      typeof AbortController === "function" ? new AbortController() : null;
    const requestOptions = {
      headers: { Accept: "application/json" },
    };
    if (controller) requestOptions.signal = controller.signal;

    let timeoutId = null;
    const operation = Promise.resolve().then(async () => {
      const response = await fetchImpl(url, requestOptions);
      if (!response?.ok) {
        throw new Error(
          `RSS2JSON returned ${response?.status ?? "an invalid response"}`
        );
      }
      if (typeof response.json !== "function") {
        throw new Error("RSS2JSON returned a response without a JSON body");
      }
      return response.json();
    });
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        const error = createTimeoutError(timeoutMs);
        reject(error);
        controller?.abort(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  function parsePostLimit(rawLimit) {
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POSTS) {
      return 0;
    }
    return limit;
  }

  function normalizeFeedItems(payload, limit = MAX_POSTS, htmlToText = parseHtmlToText) {
    if (payload?.status !== "ok" || !Array.isArray(payload.items)) {
      return [];
    }

    const posts = [];

    for (const item of payload.items) {
      if (!item || typeof item !== "object") continue;

      const post = normalizePost({
        publishedAt: item.pubDate,
        title: item.title,
        excerpt: truncateText(
          htmlToText(item.description || ""),
          EXCERPT_MAX_LENGTH
        ),
        url: item.link,
      });
      if (post) posts.push(post);
    }

    posts.sort(
      (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    );
    return posts.slice(0, parsePostLimit(limit) || MAX_POSTS);
  }

  function normalizePost(post) {
    const publishedAt = parsePublishedAt(post?.publishedAt);
    const title = typeof post?.title === "string" ? post.title.trim() : "";
    const excerpt = typeof post?.excerpt === "string" ? post.excerpt : "";
    const url = normalizeHttpUrl(post?.url);

    if (!publishedAt || !title || !url) return null;
    return { publishedAt: publishedAt.toISOString(), title, excerpt, url };
  }

  function normalizeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";

    try {
      const url = new URL(value.trim());
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function parsePublishedAt(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim())
      ? `${value.trim().replace(" ", "T")}Z`
      : value.trim();
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function parseHtmlToText(value) {
    if (typeof value !== "string" || !value) return "";
    const template = document.createElement("template");
    template.innerHTML = value;
    return normalizeWhitespace(template.content.textContent || "");
  }

  function normalizeWhitespace(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function truncateText(value, maxLength) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length <= maxLength) return normalized;

    let truncated = normalized.slice(0, maxLength - 3).replace(/\s+\S*$/, "").trim();
    if (!truncated) {
      truncated = normalized.slice(0, maxLength - 3).trim();
    }
    return `${truncated}...`;
  }

  function formatPublishedAt(value) {
    const date = value instanceof Date ? value : parsePublishedAt(value);
    return date ? DATE_FORMATTER.format(date) : "";
  }

  function renderPosts(container, posts, archiveUrl, documentRef = document) {
    const create = (tagName, properties = {}, children = []) => {
      const element = documentRef.createElement(tagName);
      Object.assign(element, properties);
      element.append(...children);
      return element;
    };

    const list = create("ul", { className: "post-list" });

    for (const post of posts) {
      const link = create("a", {
        className: "post-link",
        href: post.url,
        textContent: post.title,
      });
      const children = [
        create("span", {
          className: "post-meta",
          textContent: formatPublishedAt(post.publishedAt),
        }),
        create("h3", {}, [link]),
      ];

      if (post.excerpt) {
        children.push(create("p", { textContent: post.excerpt }));
      }

      list.append(create("li", {}, children));
    }

    const archiveLink = create("a", {
      className: "post-link",
      href: archiveUrl,
      textContent: "View all posts",
    });
    container.replaceChildren(list, create("p", {}, [archiveLink]));
  }

  function getCacheKey(feedUrl) {
    return `${CACHE_KEY_PREFIX}${feedUrl}`;
  }

  function getDefaultStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function discardCache(storage, cacheKey) {
    try {
      storage?.removeItem(cacheKey);
    } catch {
      // Storage is an optional enhancement.
    }
    return null;
  }

  function readCache(feedUrl, storage, now = Date.now()) {
    if (!storage) return null;

    const cacheKey = getCacheKey(feedUrl);
    try {
      const cached = JSON.parse(storage.getItem(cacheKey));
      const fetchedAt = Number(cached?.fetchedAt);
      const age = now - fetchedAt;

      if (!Number.isFinite(fetchedAt) || age < 0 || age > CACHE_TTL_MS) {
        return discardCache(storage, cacheKey);
      }

      const posts = normalizeCachedPosts(cached?.posts);
      if (posts.length === 0) {
        return discardCache(storage, cacheKey);
      }

      return posts;
    } catch {
      return discardCache(storage, cacheKey);
    }
  }

  function normalizeCachedPosts(value) {
    if (!Array.isArray(value)) return [];

    const posts = value.slice(0, MAX_POSTS).map(normalizePost);
    return posts.every(Boolean) ? posts : [];
  }

  function writeCache(feedUrl, posts, storage, now = Date.now()) {
    if (!storage) return;

    try {
      storage.setItem(
        getCacheKey(feedUrl),
        JSON.stringify({ fetchedAt: now, posts })
      );
    } catch {
      // Storage is an optional enhancement.
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      CACHE_TTL_MS,
      REQUEST_TIMEOUT_MS,
      buildProxyUrl,
      enhanceContainer,
      fetchFeed,
      formatPublishedAt,
      getCacheKey,
      normalizeFeedItems,
      normalizeHttpUrl,
      readCache,
      renderPosts,
      truncateText,
      writeCache,
    };
  } else {
    start();
  }
})();
