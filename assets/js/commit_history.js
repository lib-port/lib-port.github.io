(() => {
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_COMMITS = 10;
  const API_BASE_URL = "https://api.github.com";
  const AUTHOR_MODE = "author";
  const LINKED_AUTHOR_MODE = "linked-author";

  function start() {
    const containers = document.querySelectorAll("[data-commit-history]");

    for (const container of containers) {
      const section = container.closest?.('[data-home-section="commit_history"]');
      section?.removeAttribute("hidden");
      void loadCommitHistory(container);
    }
  }

  async function loadCommitHistory(
    container,
    {
      fetchImpl = getFetch(),
      storage = getStorage(),
      now = Date.now(),
      logger = console,
    } = {}
  ) {
    const config = readConfiguration(container);
    if (!config) {
      renderStatus(container, "error");
      logger.error("Failed to load recent GitHub commits: invalid configuration");
      return false;
    }

    const storageKey = getStorageKey(config.owner, config.limit);
    const failureKey = getFailureKey(config.owner, config.limit);
    const cached = readCache(storageKey, config.repositories, storage, now);
    const cachedCommits = cached
      ? mergeCommits(cached.repositories, config.limit)
      : [];
    const hasCachedResult = Boolean(
      cached?.complete || cachedCommits.length > 0
    );

    if (cached?.isFresh) {
      return renderCommits(container, cachedCommits, config.limit);
    }

    if (hasRecentFailure(failureKey, storage, now)) {
      if (hasCachedResult) {
        return renderCommits(container, cachedCommits, config.limit);
      }
      renderStatus(container, "error");
      return false;
    }

    if (typeof fetchImpl !== "function") {
      writeFailure(failureKey, storage, now);
      logger.error("Failed to load recent GitHub commits: Fetch API unavailable");
      if (hasCachedResult) {
        return renderCommits(container, cachedCommits, config.limit);
      }
      renderStatus(container, "error");
      return false;
    }

    if (!renderStatus(container, "loading")) {
      renderStatus(container, "error");
      logger.error("Failed to load recent GitHub commits: invalid page markup");
      return false;
    }

    container.setAttribute("aria-busy", "true");

    try {
      let mode = cached?.mode || AUTHOR_MODE;
      let result = await loadRepositories(
        config,
        mode,
        cached?.mode === mode ? cached.repositories : {},
        fetchImpl
      );

      if (
        mode === AUTHOR_MODE &&
        result.allSuccessful &&
        mergeCommits(result.repositories, config.limit).length === 0
      ) {
        mode = LINKED_AUTHOR_MODE;
        result = await loadRepositories(config, mode, {}, fetchImpl);
      }

      const commits = mergeCommits(result.repositories, config.limit);
      const shouldPreserveCachedResult =
        !result.allSuccessful && commits.length === 0 && hasCachedResult;

      if (!shouldPreserveCachedResult) {
        const fetchedAt = result.allSuccessful ? now : cached?.fetchedAt || 0;
        writeCache(
          storageKey,
          {
            fetchedAt,
            mode,
            repoNames: config.repositories.map(({ name }) => name),
            repositories: result.repositories,
          },
          storage
        );
      }

      if (result.allSuccessful) {
        removeStorageItem(storage, failureKey);
      } else {
        writeFailure(failureKey, storage, now);
        for (const error of result.errors) {
          logger.error("Failed to load recent GitHub commits", error);
        }
      }

      if (result.allSuccessful || commits.length > 0) {
        return renderCommits(container, commits, config.limit);
      }

      if (hasCachedResult) {
        return renderCommits(container, cachedCommits, config.limit);
      }

      renderStatus(container, "error");
      return false;
    } catch (error) {
      writeFailure(failureKey, storage, now);
      logger.error("Failed to load recent GitHub commits", error);
      if (hasCachedResult) {
        return renderCommits(container, cachedCommits, config.limit);
      }
      renderStatus(container, "error");
      return false;
    } finally {
      container.removeAttribute("aria-busy");
    }
  }

  function readConfiguration(container) {
    const owner = container?.dataset?.owner?.trim();
    const limit = Number(container?.dataset?.commitLimit);
    const repositoryData = container?.querySelector?.(
      "[data-commit-history-repositories]"
    );

    if (!owner || !Number.isInteger(limit) || limit < 1 || limit > MAX_COMMITS) {
      return null;
    }

    try {
      const repositories = normalizeRepositories(JSON.parse(repositoryData?.textContent));
      if (!repositories) return null;
      return { owner, limit, repositories };
    } catch {
      return null;
    }
  }

  function normalizeRepositories(value) {
    if (!Array.isArray(value)) return null;

    const repositories = [];
    const names = new Set();

    for (const item of value) {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const url = normalizeHttpsUrl(item?.url);
      if (!name || !url || names.has(name)) return null;
      names.add(name);
      repositories.push({ name, url });
    }

    return repositories;
  }

  async function loadRepositories(config, mode, cachedRepositories, fetchImpl) {
    const results = await Promise.all(
      config.repositories.map(async (repository) => {
        try {
          const entry = await fetchRepositoryCommits(
            repository,
            config.owner,
            config.limit,
            mode,
            cachedRepositories[repository.name],
            fetchImpl
          );
          return { name: repository.name, entry };
        } catch (error) {
          return { name: repository.name, error };
        }
      })
    );

    const repositories = { ...cachedRepositories };
    const errors = [];

    for (const result of results) {
      if (result.entry) {
        repositories[result.name] = result.entry;
      } else {
        errors.push(result.error);
      }
    }

    return {
      allSuccessful: errors.length === 0,
      errors,
      repositories,
    };
  }

  async function fetchRepositoryCommits(
    repository,
    owner,
    limit,
    mode,
    cachedEntry,
    fetchImpl
  ) {
    if (mode === LINKED_AUTHOR_MODE) {
      return fetchLinkedAuthorCommits(
        repository,
        owner,
        limit,
        cachedEntry,
        fetchImpl
      );
    }

    const headers = buildHeaders(cachedEntry?.etag);
    const response = await fetchImpl(
      buildCommitListUrl(repository.name, owner, limit, AUTHOR_MODE),
      { headers }
    );

    if (response.status === 304 && cachedEntry) {
      return cachedEntry;
    }
    if (!response.ok) {
      throw new Error(
        `GitHub API returned ${response.status} for ${repository.name}`
      );
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error(
        `GitHub API returned malformed commit data for ${repository.name}`
      );
    }

    return {
      etag: getHeader(response, "etag"),
      commits: normalizeApiCommits(payload, repository, owner, limit),
    };
  }

  async function fetchLinkedAuthorCommits(
    repository,
    owner,
    limit,
    cachedEntry,
    fetchImpl
  ) {
    const commits = [];
    const seen = new Set();
    let etag = "";
    let page = 1;

    while (commits.length < limit) {
      const headers = buildHeaders(page === 1 ? cachedEntry?.etag : "");
      const response = await fetchImpl(
        buildCommitListUrl(repository.name, owner, limit, LINKED_AUTHOR_MODE, page),
        { headers }
      );

      if (page === 1 && response.status === 304 && cachedEntry) {
        return cachedEntry;
      }
      if (!response.ok) {
        throw new Error(
          `GitHub API returned ${response.status} for ${repository.name}`
        );
      }

      if (page === 1) {
        etag = getHeader(response, "etag");
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error(
          `GitHub API returned malformed commit data for ${repository.name}`
        );
      }

      const pageCommits = normalizeApiCommits(
        payload,
        repository,
        owner,
        limit
      );
      for (const commit of pageCommits) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        commits.push(commit);
        if (commits.length === limit) break;
      }

      if (commits.length === limit || !hasNextPage(getHeader(response, "link"))) {
        break;
      }
      page += 1;
    }

    commits.sort(compareCommits);
    return { etag, commits: commits.slice(0, limit) };
  }

  function normalizeApiCommits(payload, repository, owner, limit) {
    if (!Array.isArray(payload)) return [];

    const commits = [];
    const normalizedOwner = owner.toLowerCase();

    for (const item of payload) {
      if (item?.author?.login?.toLowerCase() !== normalizedOwner) continue;

      const sha = typeof item.sha === "string" ? item.sha.trim() : "";
      const commitUrl = normalizeHttpsUrl(item.html_url);
      const message = getMessageSubject(item?.commit?.message);
      const committedAt = normalizeDate(item?.commit?.committer?.date);

      if (!sha || !commitUrl || !message || !committedAt) continue;
      commits.push({
        sha,
        repoName: repository.name,
        repoUrl: repository.url,
        commitUrl,
        message,
        committedAt,
      });
    }

    commits.sort(compareCommits);
    return commits.slice(0, limit);
  }

  function getMessageSubject(value) {
    if (typeof value !== "string") return "";
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "";
  }

  function normalizeDate(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function normalizeHttpsUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim());
      return url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function mergeCommits(repositories, limit) {
    const commits = [];
    const seen = new Set();

    for (const entry of Object.values(repositories || {})) {
      for (const commit of entry?.commits || []) {
        const key = `${commit.repoName}:${commit.sha}`;
        if (seen.has(key)) continue;
        seen.add(key);
        commits.push(commit);
      }
    }

    commits.sort(compareCommits);
    return commits.slice(0, limit);
  }

  function compareCommits(left, right) {
    const byDate = Date.parse(right.committedAt) - Date.parse(left.committedAt);
    if (byDate !== 0) return byDate;
    const byRepository = left.repoName.localeCompare(right.repoName);
    return byRepository || left.sha.localeCompare(right.sha);
  }

  function renderCommits(container, commits, limit) {
    const list = container.querySelector("[data-commit-history-list]");
    const items = Array.from(
      container.querySelectorAll("[data-commit-history-item]")
    ).slice(0, limit);

    if (!list || !Array.isArray(commits) || items.length < limit) {
      renderStatus(container, "error");
      return false;
    }

    for (const item of items) {
      item.setAttribute("hidden", "");
      item.removeAttribute("data-commit-history-last");
    }

    if (commits.length === 0) {
      if (renderStatus(container, "empty")) return true;
      renderStatus(container, "error");
      return false;
    }

    const visibleCommits = commits.slice(0, limit);
    const bindings = visibleCommits.map((commit, index) => {
      const item = items[index];
      const repoLink = item.querySelector("[data-commit-history-repo]");
      const messageLink = item.querySelector("[data-commit-history-message]");
      const time = item.querySelector("[data-commit-history-date]");
      return { commit, item, messageLink, repoLink, time };
    });

    if (
      bindings.some(
        ({ messageLink, repoLink, time }) => !repoLink || !messageLink || !time
      )
    ) {
      renderStatus(container, "error");
      return false;
    }

    for (const { commit, item, messageLink, repoLink, time } of bindings) {
      repoLink.href = commit.repoUrl;
      repoLink.textContent = commit.repoName;
      messageLink.href = commit.commitUrl;
      messageLink.textContent = commit.message;
      time.dateTime = commit.committedAt;
      time.textContent = formatUtcDate(commit.committedAt);
      item.removeAttribute("hidden");
    }

    bindings[bindings.length - 1].item.setAttribute(
      "data-commit-history-last",
      ""
    );
    hideStatuses(container);
    list.removeAttribute("hidden");
    return true;
  }

  function renderStatus(container, status) {
    const list = container.querySelector("[data-commit-history-list]");
    const statuses = {
      empty: container.querySelector("[data-commit-history-empty]"),
      error: container.querySelector("[data-commit-history-error]"),
      loading: container.querySelector("[data-commit-history-loading]"),
    };

    list?.setAttribute("hidden", "");
    for (const element of Object.values(statuses)) {
      element?.setAttribute("hidden", "");
    }

    const target = statuses[status];
    if (!target) return false;
    target.removeAttribute("hidden");
    return true;
  }

  function hideStatuses(container) {
    for (const selector of [
      "[data-commit-history-loading]",
      "[data-commit-history-error]",
      "[data-commit-history-empty]",
    ]) {
      container.querySelector(selector)?.setAttribute("hidden", "");
    }
  }

  function formatUtcDate(value) {
    const normalized = normalizeDate(value);
    return normalized ? normalized.slice(0, 10) : "";
  }

  function buildCommitListUrl(repoName, owner, limit, mode, page = 1) {
    const url = new URL(
      `${API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits`
    );
    if (mode === AUTHOR_MODE) {
      url.searchParams.set("author", owner);
    }
    url.searchParams.set("per_page", String(limit));
    if (page > 1) {
      url.searchParams.set("page", String(page));
    }
    return url.href;
  }

  function buildHeaders(etag) {
    const headers = { Accept: "application/vnd.github+json" };
    if (etag) headers["If-None-Match"] = etag;
    return headers;
  }

  function hasNextPage(linkHeader) {
    return typeof linkHeader === "string" && /;\s*rel="next"/.test(linkHeader);
  }

  function getHeader(response, name) {
    return response?.headers?.get?.(name) || "";
  }

  function getStorageKey(owner, limit) {
    return `commit-history:v1:${owner.toLowerCase()}:limit:${limit}`;
  }

  function getFailureKey(owner, limit) {
    return `commit-history:v1:failure:${owner.toLowerCase()}:limit:${limit}`;
  }

  function getStorage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  function getFetch() {
    if (
      typeof globalThis === "undefined" ||
      typeof globalThis.fetch !== "function"
    ) {
      return null;
    }
    return globalThis.fetch.bind(globalThis);
  }

  function readCache(storageKey, repositories, storage, now) {
    const cached = readStoredObject(storage, storageKey);
    if (!cached) return null;

    if (
      !isValidStoredTime(cached.fetchedAt, now) ||
      ![AUTHOR_MODE, LINKED_AUTHOR_MODE].includes(cached.mode) ||
      !Array.isArray(cached.repoNames) ||
      !cached.repositories ||
      typeof cached.repositories !== "object" ||
      Array.isArray(cached.repositories)
    ) {
      removeStorageItem(storage, storageKey);
      return null;
    }

    const currentByName = new Map(repositories.map((repo) => [repo.name, repo]));
    const normalizedRepositories = {};

    for (const [name, entry] of Object.entries(cached.repositories)) {
      const repository = currentByName.get(name);
      if (!repository) continue;
      const normalized = normalizeCachedEntry(entry, repository);
      if (!normalized) {
        removeStorageItem(storage, storageKey);
        return null;
      }
      normalizedRepositories[name] = normalized;
    }

    const currentNames = repositories.map(({ name }) => name).sort();
    const cachedNames = cached.repoNames
      .filter((name) => typeof name === "string")
      .slice()
      .sort();
    if (cachedNames.length !== cached.repoNames.length) {
      removeStorageItem(storage, storageKey);
      return null;
    }

    const sameRepositorySet =
      currentNames.length === cachedNames.length &&
      currentNames.every((name, index) => name === cachedNames[index]);
    const complete = currentNames.every((name) => normalizedRepositories[name]);

    return {
      complete,
      fetchedAt: cached.fetchedAt,
      isFresh:
        sameRepositorySet &&
        complete &&
        now - cached.fetchedAt < CACHE_TTL_MS,
      mode: cached.mode,
      repositories: normalizedRepositories,
    };
  }

  function normalizeCachedEntry(entry, repository) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.commits)) {
      return null;
    }

    const commits = [];
    for (const value of entry.commits.slice(0, MAX_COMMITS)) {
      const sha = typeof value?.sha === "string" ? value.sha.trim() : "";
      const message = getMessageSubject(value?.message);
      const committedAt = normalizeDate(value?.committedAt);
      const repoUrl = normalizeHttpsUrl(value?.repoUrl);
      const commitUrl = normalizeHttpsUrl(value?.commitUrl);
      if (
        !sha ||
        !message ||
        !committedAt ||
        !repoUrl ||
        !commitUrl ||
        value?.repoName !== repository.name
      ) {
        return null;
      }
      commits.push({
        sha,
        repoName: repository.name,
        repoUrl,
        commitUrl,
        message,
        committedAt,
      });
    }

    return {
      etag: typeof entry.etag === "string" ? entry.etag : "",
      commits,
    };
  }

  function writeCache(storageKey, cache, storage) {
    writeStoredJson(storage, storageKey, cache);
  }

  function hasRecentFailure(failureKey, storage, now) {
    const failure = readStoredObject(storage, failureKey);
    if (!failure) return false;

    if (
      !isValidStoredTime(failure.failedAt, now) ||
      now - failure.failedAt >= FAILURE_TTL_MS
    ) {
      removeStorageItem(storage, failureKey);
      return false;
    }
    return true;
  }

  function writeFailure(failureKey, storage, now) {
    writeStoredJson(storage, failureKey, { failedAt: now });
  }

  function isValidStoredTime(value, now) {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= now
    );
  }

  function readStoredObject(storage, key) {
    try {
      const raw = storage?.getItem(key);
      if (raw === null || raw === undefined) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        removeStorageItem(storage, key);
        return null;
      }
      return value;
    } catch {
      removeStorageItem(storage, key);
      return null;
    }
  }

  function writeStoredJson(storage, key, value) {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is an optional enhancement.
    }
  }

  function removeStorageItem(storage, key) {
    try {
      storage?.removeItem(key);
    } catch {
      // Storage is an optional enhancement.
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      AUTHOR_MODE,
      CACHE_TTL_MS,
      FAILURE_TTL_MS,
      LINKED_AUTHOR_MODE,
      buildCommitListUrl,
      formatUtcDate,
      getFailureKey,
      getMessageSubject,
      getStorageKey,
      hasRecentFailure,
      loadCommitHistory,
      mergeCommits,
      normalizeApiCommits,
      normalizeRepositories,
      readCache,
      renderCommits,
      renderStatus,
      writeCache,
      writeFailure,
    };
  } else {
    start();
  }
})();
