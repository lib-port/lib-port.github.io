(() => {
  const RSS2JSON_ENDPOINT = "https://api.rss2json.com/v1/api.json";
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const CACHE_KEY_PREFIX = "external-blog:v1:";
  const MAX_POSTS = 10;
  const EXCERPT_MAX_LENGTH = 280;
  const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  function start() {
    const containers = document.querySelectorAll("[data-external-blog]");

    for (const container of containers) {
      void enhanceContainer(container);
    }
  }

  async function enhanceContainer(
    container,
    {
      fetchImpl = fetch,
      documentRef = document,
      storage = getDefaultStorage(),
      now = Date.now(),
      logger = console,
      htmlToText = parseHtmlToText,
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
      const response = await fetchImpl(buildProxyUrl(feedUrl), {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        throw new Error(`RSS2JSON returned ${response.status}`);
      }

      const posts = normalizeFeedItems(await response.json(), MAX_POSTS, htmlToText);
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

      const title = typeof item.title === "string" ? item.title.trim() : "";
      const url = normalizeHttpUrl(item.link);
      const publishedAt = parsePublishedAt(item.pubDate);
      const excerpt = truncateText(htmlToText(item.description || ""), EXCERPT_MAX_LENGTH);

      if (!title || !url || !publishedAt) continue;

      posts.push({
        publishedAt: publishedAt.toISOString(),
        title,
        excerpt,
        url,
      });
    }

    posts.sort(
      (left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
    );
    return posts.slice(0, parsePostLimit(limit) || MAX_POSTS);
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
    const fragment = documentRef.createDocumentFragment();
    const list = documentRef.createElement("ul");
    list.className = "post-list";

    for (const post of posts) {
      const item = documentRef.createElement("li");
      const meta = documentRef.createElement("span");
      const title = documentRef.createElement("h3");
      const link = documentRef.createElement("a");

      meta.className = "post-meta";
      meta.textContent = formatPublishedAt(post.publishedAt);
      link.className = "post-link";
      link.href = post.url;
      link.textContent = post.title;
      title.append(link);
      item.append(meta, title);

      if (post.excerpt) {
        const excerpt = documentRef.createElement("p");
        excerpt.textContent = post.excerpt;
        item.append(excerpt);
      }

      list.append(item);
    }

    const archiveParagraph = documentRef.createElement("p");
    const archiveLink = documentRef.createElement("a");
    archiveLink.className = "post-link";
    archiveLink.href = archiveUrl;
    archiveLink.textContent = "View all posts";
    archiveParagraph.append(archiveLink);

    fragment.append(list, archiveParagraph);
    container.replaceChildren(fragment);
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

  function readCache(feedUrl, storage, now = Date.now()) {
    if (!storage) return null;

    const cacheKey = getCacheKey(feedUrl);
    try {
      const cached = JSON.parse(storage.getItem(cacheKey));
      const fetchedAt = Number(cached?.fetchedAt);
      const age = now - fetchedAt;

      if (!Number.isFinite(fetchedAt) || age < 0 || age > CACHE_TTL_MS) {
        storage.removeItem(cacheKey);
        return null;
      }

      const posts = normalizeCachedPosts(cached?.posts);
      if (posts.length === 0) {
        storage.removeItem(cacheKey);
        return null;
      }

      return posts;
    } catch {
      try {
        storage.removeItem(cacheKey);
      } catch {
        // Storage is an optional enhancement.
      }
      return null;
    }
  }

  function normalizeCachedPosts(value) {
    if (!Array.isArray(value)) return [];

    const posts = [];
    for (const post of value.slice(0, MAX_POSTS)) {
      const publishedAt = parsePublishedAt(post?.publishedAt);
      const title = typeof post?.title === "string" ? post.title.trim() : "";
      const excerpt = typeof post?.excerpt === "string" ? post.excerpt : "";
      const url = normalizeHttpUrl(post?.url);

      if (!publishedAt || !title || !url) return [];
      posts.push({ publishedAt: publishedAt.toISOString(), title, excerpt, url });
    }
    return posts;
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
      buildProxyUrl,
      enhanceContainer,
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
