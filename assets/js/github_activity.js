(() => {
  const recentMilestones = (() => {
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_MILESTONES = 10;
  const PER_PAGE = 100;
  const MAX_PAGES = 2;
  const API_BASE_URL = "https://api.github.com";
  const API_VERSION = "2026-03-10";
  const DUE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  function start() {
    const containers = document.querySelectorAll("[data-recent-milestones]");

    for (const container of containers) {
      const section = container.closest?.(
        '[data-home-section="recent_milestones"]'
      );
      section?.removeAttribute("hidden");
      void loadRecentMilestones(container);
    }
  }

  async function loadRecentMilestones(
    container,
    {
      config: providedConfig = null,
      fetchImpl = getFetch(),
      storage = getStorage(),
      now = Date.now(),
      logger = console,
      refreshTimeoutMs = shared.SECTION_TIMEOUT_MS,
    } = {}
  ) {
    const config = providedConfig || readConfiguration(container);
    if (!config) {
      renderStatus(container, "error");
      logger.error("Failed to load recent GitHub milestones: invalid configuration");
      return false;
    }

    const storageKey = getStorageKey(config.owner, config.limit);
    const failureKey = getFailureKey(
      config.owner,
      config.repositories,
      config.limit
    );
    removeStorageItem(storage, getLegacyStorageKey(config.owner, config.limit));
    removeStorageItem(
      storage,
      getLegacyFailureKey(
        config.owner,
        config.repositories,
        config.limit
      )
    );
    const cached = readCache(
      storageKey,
      config.repositories,
      storage,
      now
    );
    removeStorageItem(storage, failureKey.replace(":v5:", ":v4:"));
    const cachedMilestones = cached
      ? mergeMilestones(cached.repositories, config.repositories, config.limit)
      : [];
    const hasCachedResult = Boolean(
      cached?.complete || cachedMilestones.length > 0
    );

    if (cached?.isFresh) {
      return renderMilestones(
        container,
        cachedMilestones,
        config.limit,
        config.owner
      );
    }

    if (
      hasCachedResult &&
      !renderMilestones(container, cachedMilestones, config.limit, config.owner)
    ) {
      logger.error("Failed to load recent GitHub milestones: invalid page markup");
      return false;
    }

    if (hasRecentFailure(failureKey, storage, now)) {
      if (hasCachedResult) {
        return renderMilestones(
          container,
          cachedMilestones,
          config.limit,
          config.owner
        );
      }
      renderStatus(container, "error");
      return false;
    }

    if (typeof fetchImpl !== "function") {
      writeFailure(failureKey, storage, now);
      logger.error("Failed to load recent GitHub milestones: Fetch API unavailable");
      if (hasCachedResult) {
        return renderMilestones(
          container,
          cachedMilestones,
          config.limit,
          config.owner
        );
      }
      renderStatus(container, "error");
      return false;
    }

    if (!hasCachedResult && !renderStatus(container, "loading")) {
      logger.error("Failed to load recent GitHub milestones: invalid page markup");
      return false;
    }

    container.setAttribute("aria-busy", "true");
    const refresh = shared.createRefresh(fetchImpl, { timeoutMs: refreshTimeoutMs });

    try {
      const result = await loadRepositories(
        config,
        cached?.repositories || {},
        refresh.fetch
      );
      const milestones = mergeMilestones(
        result.repositories,
        config.repositories,
        config.limit
      );

      writeCache(
        storageKey,
        {
          fetchedAt: result.allSuccessful ? now : cached?.fetchedAt || 0,
          repoNames: config.repositories,
          repositories: result.repositories,
        },
        storage
      );

      if (result.allSuccessful) {
        removeStorageItem(storage, failureKey);
      } else {
        shared.recordFailures(failureKey, storage, now, result.errors);
        for (const error of result.errors) {
          logger.error("Failed to load recent GitHub milestones", error);
        }
      }

      if (milestones.length > 0 || result.allSuccessful || cached?.complete) {
        return renderMilestones(
          container,
          milestones,
          config.limit,
          config.owner
        );
      }

      renderStatus(container, "error");
      return false;
    } catch (error) {
      shared.recordFailures(failureKey, storage, now, [error]);
      if (!shared.isDeferred(error)) logger.error("Failed to load recent GitHub milestones", error);
      if (hasCachedResult) {
        return renderMilestones(
          container,
          cachedMilestones,
          config.limit,
          config.owner
        );
      }
      renderStatus(container, "error");
      return false;
    } finally {
      refresh.close();
      container.removeAttribute("aria-busy");
    }
  }

  function readConfiguration(container) {
    const owner = container?.dataset?.owner?.trim();
    const limit = Number(container?.dataset?.milestoneLimit);
    const repositoryData = container?.querySelector?.(
      "[data-recent-milestones-repositories]"
    );

    if (!owner || !Number.isInteger(limit) || limit < 1 || limit > MAX_MILESTONES) {
      return null;
    }

    try {
      const repositories = normalizeRepositories(
        JSON.parse(repositoryData?.textContent)
      );
      if (!repositories) return null;
      return { owner, limit, repositories };
    } catch {
      return null;
    }
  }

  function normalizeRepositories(value) {
    if (!Array.isArray(value) || value.length === 0) return null;

    const repositories = [];
    const names = new Set();

    for (const item of value) {
      const name = typeof item === "string" ? item.trim() : "";
      if (!name || names.has(name)) return null;
      names.add(name);
      repositories.push(name);
    }

    return repositories;
  }

  async function loadRepositories(config, cachedRepositories, fetchImpl) {
    return shared.collectPagedRepositories(
      config.repositories, cachedRepositories,
      (repository, page, cachedPage) => fetchClosedIssuePage(
        config.owner, repository, page, cachedPage, fetchImpl
      ),
      (pages) => isIssueSearchComplete(pages, config.limit),
      (entry, name) => mergeMilestones({ [name]: entry }, [name], MAX_MILESTONES)
    );
  }

  function isIssueSearchComplete(pages, limit) {
    const latest = pages[pages.length - 1];
    const candidates = compactMilestones(pages.flatMap((page) => page.milestones));
    return !latest.hasNext || canStopClosedIssuePagination(
      new Map(candidates.map((milestone) => [milestone.number, milestone])),
      limit, latest.oldestUpdatedAt
    );
  }

  async function fetchRepositoryClosedIssueActivity(owner, repository, limit, cachedEntry, fetchImpl) {
    const result = await loadRepositories(
      { owner, repositories: [repository], limit },
      cachedEntry ? { [repository]: cachedEntry } : {}, fetchImpl
    );
    if (result.errors.length) throw result.errors[0];
    return result.repositories[repository];
  }

  async function fetchClosedIssuePage(owner, repository, pageNumber, cachedPage, fetchImpl) {
    const response = await fetchImpl(
      buildClosedIssueActivityUrl(owner, repository, pageNumber),
      { headers: buildHeaders(cachedPage?.etag) },
      { priority: pageNumber > 1 ? 1 : 0 }
    );
    if (response.status === 304 && cachedPage) {
      const link = getHeader(response, "link");
      return { ...cachedPage, hasNext: link ? hasNextPage(link) : cachedPage.hasNext };
    }
    if (!response.ok) throw shared.createHttpError(response, `${repository} issues page ${pageNumber}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error(`GitHub API returned malformed issue data for ${repository}`);
    }
    const oldestUpdatedAt = findOldestUpdatedAt(payload);
    if (payload.length > 0 && !oldestUpdatedAt) {
      throw new Error(`GitHub API returned malformed issue update data for ${repository}`);
    }
    return {
      page: pageNumber,
      etag: getHeader(response, "etag"),
      hasNext: hasNextPage(getHeader(response, "link")),
      itemCount: payload.length,
      oldestUpdatedAt,
      milestones: normalizeClosedIssueActivity(payload, repository),
    };
  }

  function buildClosedIssueActivityUrl(owner, repository, page = 1) {
    const pathOwner = encodeURIComponent(owner);
    const pathRepository = encodeURIComponent(repository);
    const query = new URLSearchParams({
      state: "closed",
      milestone: "*",
      sort: "updated",
      direction: "desc",
      per_page: String(PER_PAGE),
      page: String(page),
    });
    return `${API_BASE_URL}/repos/${pathOwner}/${pathRepository}/issues?${query}`;
  }

  function buildHeaders(etag = "") {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
    };
    if (etag) headers["If-None-Match"] = etag;
    return headers;
  }

  function normalizeClosedIssueActivity(payload, repository) {
    const milestones = [];

    for (const item of payload) {
      if (
        !item ||
        typeof item !== "object" ||
        Object.prototype.hasOwnProperty.call(item, "pull_request")
      ) {
        continue;
      }

      const milestone = item.milestone;
      const milestoneNumber = milestone?.number;
      const milestoneTitle =
        typeof milestone?.title === "string" ? milestone.title.trim() : "";
      const description =
        typeof milestone?.description === "string"
          ? milestone.description.trim()
          : "";
      const openIssues = milestone?.open_issues;
      const closedIssues = milestone?.closed_issues;
      const issueNumber = item.number;
      const issueTitle =
        typeof item.title === "string" ? item.title.trim() : "";
      const issueLabels = normalizeIssueLabels(item.labels);
      const issueUrl = normalizeGitHubUrl(item.html_url);
      const closedAt = normalizeDate(item.closed_at);
      const updatedAt = normalizeDate(item.updated_at);
      const dueOn =
        milestone?.due_on === null ? null : normalizeDate(milestone?.due_on);

      if (
        item.state !== "closed" ||
        milestone?.state !== "open" ||
        !Number.isInteger(milestoneNumber) ||
        milestoneNumber < 1 ||
        !milestoneTitle ||
        !isNonnegativeInteger(openIssues) ||
        !isNonnegativeInteger(closedIssues) ||
        !Number.isInteger(issueNumber) ||
        issueNumber < 1 ||
        !issueTitle ||
        !issueLabels ||
        !issueUrl ||
        !closedAt ||
        !updatedAt ||
        closedAt > updatedAt ||
        (milestone?.due_on !== null && !dueOn)
      ) {
        continue;
      }

      milestones.push({
        repository,
        number: milestoneNumber,
        title: milestoneTitle,
        description,
        openIssues,
        closedIssues,
        dueOn,
        latestClosedIssue: {
          number: issueNumber,
          title: issueTitle,
          labels: issueLabels,
          url: issueUrl,
          closedAt,
        },
      });
    }

    return compactMilestones(milestones);
  }

  function normalizeIssueLabels(value) {
    if (!Array.isArray(value)) return null;

    const labels = [];
    for (const label of value) {
      const name =
        typeof label?.name === "string" ? label.name.trim() : "";
      if (!name) return null;
      labels.push(name);
    }
    return labels;
  }

  function compactMilestones(milestones) {
    const milestonesByNumber = new Map();

    for (const candidate of milestones) {
      const current = milestonesByNumber.get(candidate.number);
      if (!current || isNewerMilestoneCandidate(candidate, current)) {
        milestonesByNumber.set(candidate.number, candidate);
      }
    }

    return Array.from(milestonesByNumber.values());
  }

  function mergeMilestones(repositories, repoNames, limit) {
    const repoOrder = new Map(repoNames.map((name, index) => [name, index]));
    const milestonesByKey = new Map();

    for (const repository of repoNames) {
      const entry = repositories?.[repository];
      if (!entry?.pages) continue;

      for (const page of [...entry.pages, { milestones: entry.retainedCandidates || [] }]) {
        for (const milestone of page.milestones) {
          const key = `${repository}:${milestone.number}`;
          const current = milestonesByKey.get(key);
          if (!current || isNewerMilestoneCandidate(milestone, current)) {
            milestonesByKey.set(key, milestone);
          }
        }
      }
    }

    return Array.from(milestonesByKey.values())
      .sort((left, right) => {
        const closedDifference =
          Date.parse(right.latestClosedIssue.closedAt) -
          Date.parse(left.latestClosedIssue.closedAt);
        if (closedDifference !== 0) return closedDifference;

        const repositoryDifference =
          repoOrder.get(left.repository) - repoOrder.get(right.repository);
        if (repositoryDifference !== 0) return repositoryDifference;
        return right.number - left.number;
      })
      .slice(0, limit);
  }

  function isNewerMilestoneCandidate(candidate, current) {
    const closedDifference =
      Date.parse(candidate.latestClosedIssue.closedAt) -
      Date.parse(current.latestClosedIssue.closedAt);
    if (closedDifference !== 0) return closedDifference > 0;
    return candidate.latestClosedIssue.number > current.latestClosedIssue.number;
  }

  function canStopClosedIssuePagination(
    milestonesByNumber,
    limit,
    oldestUpdatedAt
  ) {
    if (!oldestUpdatedAt || milestonesByNumber.size < limit) return false;

    const ranked = Array.from(milestonesByNumber.values()).sort(
      (left, right) => {
        const closedDifference =
          Date.parse(right.latestClosedIssue.closedAt) -
          Date.parse(left.latestClosedIssue.closedAt);
        if (closedDifference !== 0) return closedDifference;
        return right.number - left.number;
      }
    );
    return ranked[limit - 1].latestClosedIssue.closedAt > oldestUpdatedAt;
  }

  function findOldestUpdatedAt(payload) {
    if (payload.length === 0) return "";

    let oldestUpdatedAt = "";
    for (const item of payload) {
      const updatedAt = normalizeDate(item?.updated_at);
      if (!updatedAt) return "";
      if (!oldestUpdatedAt || updatedAt < oldestUpdatedAt) {
        oldestUpdatedAt = updatedAt;
      }
    }
    return oldestUpdatedAt;
  }

  function renderMilestones(container, milestones, limit, owner) {
    if (milestones.length === 0) {
      return renderStatus(container, "empty");
    }

    const list = container?.querySelector?.("[data-recent-milestones-list]");
    const items = Array.from(
      container?.querySelectorAll?.("[data-recent-milestone-item]") || []
    );
    const visibleCount = Math.min(limit, milestones.length);

    if (!list || items.length < visibleCount) {
      renderStatus(container, "error");
      return false;
    }

    for (const item of items) {
      item.setAttribute("hidden", "");
    }

    for (let index = 0; index < visibleCount; index += 1) {
      if (!renderMilestone(items[index], milestones[index], owner)) {
        renderStatus(container, "error");
        return false;
      }
      items[index].removeAttribute("hidden");
    }

    return renderStatus(container, "list");
  }

  function renderMilestone(item, milestone, owner) {
    const title = item.querySelector?.("[data-recent-milestone-title]");
    const repoLink = item.querySelector?.("[data-recent-milestone-repo]");
    const repoName = item.querySelector?.("[data-recent-milestone-repo-name]");
    const description = item.querySelector?.(
      "[data-recent-milestone-description]"
    );
    const dueDetail = item.querySelector?.(
      "[data-recent-milestone-due-detail]"
    );
    const due = item.querySelector?.("[data-recent-milestone-due]");
    const closedTotal = item.querySelector?.(
      "[data-recent-milestone-closed-total]"
    );
    const progress = item.querySelector?.("[data-recent-milestone-progress]");
    const progressValue = item.querySelector?.(
      "[data-recent-milestone-progress-value]"
    );
    const percentage = item.querySelector?.(
      "[data-recent-milestone-percentage]"
    );
    const latestClosedIssue = item.querySelector?.(
      "[data-recent-milestone-latest-closed-issue]"
    );
    const latestClosedIssueLabelDetail = item.querySelector?.(
      "[data-recent-milestone-latest-closed-issue-label-detail]"
    );
    const latestClosedIssueLabels = item.querySelector?.(
      "[data-recent-milestone-latest-closed-issue-labels]"
    );

    if (
      !title ||
      !repoLink ||
      !repoName ||
      !description ||
      !dueDetail ||
      !due ||
      !closedTotal ||
      !progress ||
      !progressValue ||
      !percentage ||
      !latestClosedIssue ||
      !latestClosedIssueLabelDetail ||
      !latestClosedIssueLabels ||
      !Array.isArray(milestone?.latestClosedIssue?.labels)
    ) {
      return false;
    }

    const totalIssues = milestone.openIssues + milestone.closedIssues;
    const percentComplete = calculatePercentage(
      milestone.closedIssues,
      totalIssues
    );

    title.textContent = milestone.title;
    title.href = buildMilestoneUrl(owner, milestone.repository, milestone.number);
    repoLink.href = buildRepositoryUrl(owner, milestone.repository);
    repoName.textContent = milestone.repository;
    description.textContent = milestone.description;
    description.toggleAttribute("hidden", !milestone.description);
    due.textContent = milestone.dueOn
      ? `Due by ${formatDueDate(milestone.dueOn)}`
      : "";
    dueDetail.toggleAttribute("hidden", !milestone.dueOn);
    closedTotal.textContent = `${milestone.closedIssues}/${totalIssues}`;
    progress.setAttribute("aria-valuenow", String(percentComplete));
    progress.setAttribute(
      "aria-label",
      `${milestone.title}: ${percentComplete}% complete`
    );
    progressValue.style.width = `${percentComplete}%`;
    percentage.textContent = `${percentComplete}%`;
    latestClosedIssue.textContent = milestone.latestClosedIssue.title;
    latestClosedIssueLabels.textContent =
      milestone.latestClosedIssue.labels.join(", ");
    latestClosedIssueLabelDetail.toggleAttribute(
      "hidden",
      milestone.latestClosedIssue.labels.length === 0
    );
    return true;
  }

  function renderStatus(container, visibleState) {
    const states = {
      list: container?.querySelector?.("[data-recent-milestones-list]"),
      loading: container?.querySelector?.("[data-recent-milestones-loading]"),
      error: container?.querySelector?.("[data-recent-milestones-error]"),
      empty: container?.querySelector?.("[data-recent-milestones-empty]"),
    };

    if (Object.values(states).some((element) => !element) || !states[visibleState]) {
      return false;
    }

    for (const [state, element] of Object.entries(states)) {
      element.toggleAttribute("hidden", state !== visibleState);
    }
    return true;
  }

  function buildRepositoryUrl(owner, repository) {
    return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  }

  function buildMilestoneUrl(owner, repository, milestoneNumber) {
    return `${buildRepositoryUrl(owner, repository)}/milestone/${milestoneNumber}`;
  }

  function calculatePercentage(closedIssues, totalIssues) {
    if (totalIssues <= 0) return 0;
    return Math.round((closedIssues / totalIssues) * 100);
  }

  function formatDueDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return DUE_DATE_FORMATTER.format(date);
  }

  function normalizeDate(value) {
    if (typeof value !== "string" || !value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function normalizeGitHubUrl(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    try {
      const url = new URL(value.trim());
      return url.origin === "https://github.com" ? url.href : "";
    } catch {
      return "";
    }
  }

  function isNonnegativeInteger(value) {
    return Number.isInteger(value) && value >= 0;
  }

  function hasNextPage(linkHeader) {
    return typeof linkHeader === "string" && /;\s*rel="next"/.test(linkHeader);
  }

  function getHeader(response, name) {
    return response?.headers?.get?.(name) || "";
  }

  function getStorageKey(owner, limit) {
    return `recent-milestones:v5:${owner.toLowerCase()}:limit:${limit}`;
  }

  function getFailureKey(owner, repositories, limit) {
    const repoKey = repositories
      .map((repository) => repository.toLowerCase())
      .slice()
      .sort()
      .join(",");
    return `recent-milestones:v5:failure:${owner.toLowerCase()}:limit:${limit}:${repoKey}`;
  }

  function getLegacyStorageKey(owner, limit) {
    return `recent-milestones:v3:${owner.toLowerCase()}:limit:${limit}`;
  }

  function getLegacyFailureKey(owner, repositories, limit) {
    const repoKey = repositories
      .map((repository) => repository.toLowerCase())
      .slice()
      .sort()
      .join(",");
    return `recent-milestones:v3:failure:${owner.toLowerCase()}:limit:${limit}:${repoKey}`;
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

  function readCache(storageKey, repositories, storage, now, legacy = false) {
    const cached = readStoredObject(storage, storageKey);
    if (!cached) return legacy ? null : shared.migratePagedCache(
      storageKey, storageKey.replace(":v5:", ":v4:"), repositories, readCache, storage, now,
      (entry, name) => mergeMilestones({ [name]: entry }, [name], MAX_MILESTONES)
    );

    if (
      !isValidStoredTime(cached.fetchedAt, now) ||
      !Array.isArray(cached.repoNames) ||
      !cached.repositories ||
      typeof cached.repositories !== "object" ||
      Array.isArray(cached.repositories)
    ) {
      removeStorageItem(storage, storageKey);
      return null;
    }

    const currentNames = new Set(repositories);
    const normalizedRepositories = {};
    let cacheWasCompacted = false;

    for (const [repository, entry] of Object.entries(cached.repositories)) {
      if (!currentNames.has(repository)) continue;
      const normalized = normalizeCachedEntry(entry, repository, legacy);
      if (!normalized) {
        removeStorageItem(storage, storageKey);
        return null;
      }
      normalizedRepositories[repository] = normalized;
      const storedMilestoneCount = entry.pages.reduce(
        (total, page) => total + page.milestones.length,
        0
      );
      const normalizedMilestoneCount = normalized.pages.reduce(
        (total, page) => total + page.milestones.length,
        0
      );
      if (normalizedMilestoneCount < storedMilestoneCount) {
        cacheWasCompacted = true;
      }
    }

    if (
      cached.repoNames.some((name) => typeof name !== "string") ||
      new Set(cached.repoNames).size !== cached.repoNames.length
    ) {
      removeStorageItem(storage, storageKey);
      return null;
    }

    const currentRepoNames = repositories.slice().sort();
    const cachedRepoNames = cached.repoNames.slice().sort();
    const sameRepositorySet =
      currentRepoNames.length === cachedRepoNames.length &&
      currentRepoNames.every(
        (name, index) => name === cachedRepoNames[index]
      );
    const complete = repositories.every(
      (repository) => normalizedRepositories[repository]
    );

    if (sameRepositorySet && complete && cacheWasCompacted) {
      writeCache(
        storageKey,
        {
          fetchedAt: cached.fetchedAt,
          repoNames: cached.repoNames,
          repositories: normalizedRepositories,
        },
        storage
      );
    }

    return {
      complete,
      fetchedAt: cached.fetchedAt,
      isFresh:
        sameRepositorySet &&
        complete &&
        cached.fetchedAt > 0 &&
        now - cached.fetchedAt < CACHE_TTL_MS,
      repositories: normalizedRepositories,
    };
  }

  function normalizeCachedEntry(entry, repository, legacy) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.pages)) {
      return null;
    }

    const pages = [];
    const pageNumbers = new Set();

    for (const page of entry.pages) {
      if (
        !page ||
        typeof page !== "object" ||
        !Number.isInteger(page.page) ||
        page.page < 1 ||
        page.page > (legacy ? 100 : MAX_PAGES) ||
        pageNumbers.has(page.page) ||
        typeof page.etag !== "string" ||
        typeof page.hasNext !== "boolean" ||
        !Number.isInteger(page.itemCount) ||
        page.itemCount < 0 ||
        page.itemCount > PER_PAGE ||
        typeof page.oldestUpdatedAt !== "string" ||
        !Array.isArray(page.milestones)
      ) {
        return null;
      }

      const oldestUpdatedAt = page.oldestUpdatedAt
        ? normalizeDate(page.oldestUpdatedAt)
        : "";
      if (
        (page.itemCount === 0 && page.oldestUpdatedAt) ||
        (page.itemCount > 0 && !oldestUpdatedAt)
      ) {
        return null;
      }

      const milestones = [];
      for (const value of page.milestones) {
        const normalized = normalizeCachedMilestone(value, repository);
        if (!normalized) return null;
        milestones.push(normalized);
      }

      pageNumbers.add(page.page);
      pages.push({
        page: page.page,
        etag: page.etag,
        hasNext: page.hasNext,
        itemCount: page.itemCount,
        oldestUpdatedAt,
        milestones: compactMilestones(milestones),
      });
    }

    if ([entry.limited, entry.deferred].some((flag) => flag !== undefined && typeof flag !== "boolean")) return null;
    if (pages.length === 0 && entry.deferred !== true) return null;
    pages.sort((left, right) => left.page - right.page);
    if (pages.some((page, index) => page.page !== index + 1)) return null;
    const retained = entry.retainedCandidates ?? [];
    if (!Array.isArray(retained)) return null;
    const retainedCandidates = retained.map((value) => normalizeCachedMilestone(value, repository));
    if (retainedCandidates.some((value) => !value)) return null;
    return {
      pages, retainedCandidates: compactMilestones(retainedCandidates),
      limited: entry.limited === true, deferred: entry.deferred === true,
    };
  }

  function normalizeCachedMilestone(value, repository) {
    const number = value?.number;
    const title = typeof value?.title === "string" ? value.title.trim() : "";
    const description =
      typeof value?.description === "string" ? value.description : "";
    const openIssues = value?.openIssues;
    const closedIssues = value?.closedIssues;
    const dueOn = value?.dueOn === null ? null : normalizeDate(value?.dueOn);
    const latestClosedIssue = normalizeCachedClosedIssue(
      value?.latestClosedIssue
    );

    if (
      value?.repository !== repository ||
      !Number.isInteger(number) ||
      number < 1 ||
      !title ||
      !isNonnegativeInteger(openIssues) ||
      !isNonnegativeInteger(closedIssues) ||
      !latestClosedIssue ||
      (value?.dueOn !== null && !dueOn)
    ) {
      return null;
    }

    return {
      repository,
      number,
      title,
      description,
      openIssues,
      closedIssues,
      dueOn,
      latestClosedIssue,
    };
  }

  function normalizeCachedClosedIssue(value) {
    const number = value?.number;
    const title = typeof value?.title === "string" ? value.title.trim() : "";
    const labels = normalizeCachedIssueLabels(value?.labels);
    const url = normalizeGitHubUrl(value?.url);
    const closedAt = normalizeDate(value?.closedAt);

    if (
      !Number.isInteger(number) ||
      number < 1 ||
      !title ||
      !labels ||
      !url ||
      !closedAt
    ) {
      return null;
    }
    return { number, title, labels, url, closedAt };
  }

  function normalizeCachedIssueLabels(value) {
    if (!Array.isArray(value)) return null;

    const labels = [];
    for (const label of value) {
      const name = typeof label === "string" ? label.trim() : "";
      if (!name) return null;
      labels.push(name);
    }
    return labels;
  }

  function writeCache(storageKey, cache, storage) {
    writeStoredJson(storage, storageKey, cache);
  }

  function hasRecentFailure(failureKey, storage, now) {
    return shared.hasRecentFailure(failureKey, storage, now);
  }

  function writeFailure(failureKey, storage, now) {
    shared.writeFailure(failureKey, storage, now);
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

  return {
    API_VERSION,
    CACHE_TTL_MS,
    FAILURE_TTL_MS,
    buildHeaders,
    buildClosedIssueActivityUrl,
    buildMilestoneUrl,
    calculatePercentage,
    fetchRepositoryClosedIssueActivity,
    formatDueDate,
    getFailureKey,
    getStorageKey,
    hasRecentFailure,
    loadRecentMilestones,
    mergeMilestones,
    normalizeClosedIssueActivity,
    normalizeRepositories,
    readCache,
    renderMilestones,
    renderStatus,
    start,
    writeCache,
    writeFailure,
  };
  })();

  const shared = (() => {
    const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
    const TRANSIENT_FAILURE_TTL_MS = 5 * 60 * 1000;
    const REQUEST_TIMEOUT_MS = 15 * 1000;
    const SECTION_TIMEOUT_MS = 30 * 1000;
    const MAX_REQUESTS = 40;
    const MAX_MILESTONE_PAGES = 2;
    const MAX_MILESTONE_REQUESTS = 12;
    const API_VERSION = "2026-03-10";

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

    function removeStorageItem(storage, key) {
      try {
        storage?.removeItem(key);
      } catch {
        // Browser storage is optional.
      }
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
        return true;
      } catch {
        return false;
      }
    }

    function isValidStoredTime(value, now) {
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= now
      );
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

    function getHeader(response, name) {
      return response?.headers?.get?.(name) || "";
    }

    function buildHeaders(etag = "") {
      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      };
      if (etag) headers["If-None-Match"] = etag;
      return headers;
    }

    function hasRecentFailure(key, storage, now) {
      const failure = readStoredObject(storage, key);
      if (!failure) return false;
      if (
        !isValidStoredTime(failure.failedAt, now) ||
        (failure.retryAt !== undefined && (
          !Number.isFinite(failure.retryAt) || failure.retryAt < failure.failedAt
        )) ||
        now >= (failure.retryAt ?? failure.failedAt + FAILURE_TTL_MS)
      ) {
        removeStorageItem(storage, key);
        return false;
      }
      return true;
    }

    function writeFailure(key, storage, now, kind = "resource", retryAt) {
      writeStoredJson(storage, key, {
        failedAt: now, kind, ...(retryAt === undefined ? {} : { retryAt }),
      });
    }

    function isDeferred(error) {
      return error?.name === "ActivityDeferredError";
    }

    function createDeferredError(reason) {
      const error = new Error(`GitHub activity deferred: ${reason}`);
      error.name = "ActivityDeferredError";
      error.reason = reason;
      return error;
    }

    function isRateLimitResponse(response, payload) {
      return response?.status === 429 || (response?.status === 403 && (
        response.rateLimited === true ||
        getHeader(response, "x-ratelimit-remaining") === "0" ||
        Boolean(getHeader(response, "retry-after")) ||
        /rate limit|abuse detection/i.test(payload?.message || "")
      ));
    }

    function getRetryAt(response, now) {
      const candidates = [];
      const retryAfter = getHeader(response, "retry-after");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const time = Number.isFinite(seconds) && seconds >= 0
          ? now + seconds * 1000 : Date.parse(retryAfter);
        if (Number.isFinite(time) && time > now) candidates.push(time);
      }
      if (getHeader(response, "x-ratelimit-remaining") === "0") {
        const reset = Number(getHeader(response, "x-ratelimit-reset")) * 1000;
        if (Number.isFinite(reset) && reset > now) candidates.push(reset);
      }
      return candidates.length ? Math.max(...candidates) : now + 60 * 1000;
    }

    function createHttpError(response, context, now = Date.now()) {
      const error = new Error(`GitHub API returned ${response.status}${context ? ` for ${context}` : ""}`);
      error.kind = isRateLimitResponse(response)
        ? "rate-limit" : response.status >= 500 ? "transient" : "resource";
      if (error.kind === "rate-limit") error.retryAt = response.retryAt ?? getRetryAt(response, now);
      return error;
    }

    function recordFailures(key, storage, now, errors) {
      const failures = errors.filter((error) => !isDeferred(error));
      if (failures.length === 0) return;
      const periods = failures.map((error) => ({
        kind: error?.kind || "resource",
        retryAt: error?.kind === "rate-limit"
          ? error.retryAt ?? now + 60 * 1000
          : now + (error?.kind === "transient" ? TRANSIENT_FAILURE_TTL_MS : FAILURE_TTL_MS),
      }));
      const longest = periods.reduce((left, right) => left.retryAt >= right.retryAt ? left : right);
      writeFailure(key, storage, now, longest.kind, longest.retryAt);
    }

    function createRefresh(fetchImpl, { timeoutMs = SECTION_TIMEOUT_MS } = {}) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const listeners = new Set();
      let expired = false;
      const reason = createDeferredError("deadline");
      const timer = setTimeout(() => {
        expired = true;
        controller?.abort(reason);
        for (const listener of listeners) listener();
      }, timeoutMs);
      async function wait(operation) {
        if (expired) throw reason;
        let cancel;
        const deadline = new Promise((_resolve, reject) => {
          cancel = () => reject(reason);
          listeners.add(cancel);
        });
        try {
          return await Promise.race([operation, deadline]);
        } finally {
          listeners.delete(cancel);
        }
      }
      return {
        fetch: (url, options = {}, metadata) => {
          if (expired) return Promise.reject(reason);
          const operation = (async () => {
            let signal = controller?.signal;
            const removeListeners = [];
            if (controller && options.signal) {
              const combined = new AbortController();
              for (const input of [controller.signal, options.signal]) {
                const abort = () => combined.abort(input.reason);
                if (input.aborted) abort();
                else input.addEventListener("abort", abort, { once: true });
                removeListeners.push(() => input.removeEventListener("abort", abort));
              }
              signal = combined.signal;
            } else if (options.signal) signal = options.signal;
            try {
              return await fetchImpl(url, { ...options, ...(signal ? { signal } : {}) }, metadata);
            } catch (error) {
              if (!error?.kind && !isDeferred(error) && error?.name !== "AbortError") error.kind = "transient";
              throw error;
            } finally {
              for (const remove of removeListeners) remove();
            }
          })();
          return wait(operation);
        },
        wait,
        close() { clearTimeout(timer); },
      };
    }

    function getGlobalFailureKey(owner) {
      return `github-activity:v1:failure:global:${owner.toLowerCase()}`;
    }

    function createTimeoutError(timeoutMs) {
      const error = new Error(`GitHub request timed out after ${timeoutMs} ms`);
      error.name = "TimeoutError";
      error.kind = "transient";
      return error;
    }

    function createBufferedResponse(response, payload, rateLimited = response.rateLimited) {
      const buffered = {
        headers: response.headers,
        ok: response.ok,
        redirected: response.redirected,
        status: response.status,
        statusText: response.statusText,
        type: response.type,
        url: response.url,
        rateLimited,
        retryAt: response.retryAt,
        async json() {
          return payload;
        },
      };
      buffered.clone = () => createBufferedResponse(buffered, payload);
      return buffered;
    }

    function createRequestCoordinator({
      owner,
      fetchImpl = getFetch(),
      storage = getStorage(),
      now = () => Date.now(),
      maxConcurrent = 4,
      requestTimeoutMs = REQUEST_TIMEOUT_MS,
      maxRequests = MAX_REQUESTS,
    }) {
      const inFlight = new Map();
      const queue = [];
      const effectiveRequestTimeoutMs =
        typeof requestTimeoutMs === "number" &&
        Number.isFinite(requestTimeoutMs) &&
        requestTimeoutMs > 0
          ? requestTimeoutMs
          : REQUEST_TIMEOUT_MS;
      let active = 0;
      let issued = 0;
      let reserved = 0;
      let sequence = 0;
      const failureKey = getGlobalFailureKey(owner);
      const previousFailure = readStoredObject(storage, failureKey);
      if (["network", "timeout", "unavailable"].includes(previousFailure?.kind)) {
        removeStorageItem(storage, failureKey);
      }

      function pausedError() {
        const error = new Error("GitHub requests are temporarily paused");
        const failure = readStoredObject(storage, failureKey);
        error.kind = "rate-limit";
        error.retryAt = failure?.retryAt ?? (failure?.failedAt || now()) + FAILURE_TTL_MS;
        return error;
      }

      function requestKey(url, options) {
        const headers = options?.headers || {};
        const etag = headers["If-None-Match"] || headers["if-none-match"] || "";
        return `${url}\n${etag}`;
      }

      function drain() {
        while (active < maxConcurrent && queue.length > 0) {
          const item = queue.shift();
          active += 1;
          void run(item);
        }
      }

      async function fetchWithTimeout(item) {
        const { url, options, controller } = item;
        const requestOptions = { ...options, ...(controller ? { signal: controller.signal } : {}) };
        let timeoutId = null;
        const cancelled = new Promise((_resolve, reject) => {
          item.cancel = (reason) => {
            reject(reason);
            controller?.abort(reason);
          };
        });
        const operation = Promise.resolve().then(async () => {
          let response;
          try {
            response = await fetchImpl(url, requestOptions);
          } catch (error) {
            if (!isDeferred(error) && error?.name !== "AbortError") error.kind = "transient";
            throw error;
          }
          if (response?.status === 304) return response;
          if (typeof response.json !== "function") {
            if (!response.ok) return response;
            throw new Error("GitHub API returned a response without a JSON body");
          }
          let payload;
          try {
            payload = await response.json();
          } catch (error) {
            if (response.ok) throw error;
          }
          return createBufferedResponse(response, payload, isRateLimitResponse(response, payload));
        });
        const timeout = new Promise((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            const error = createTimeoutError(effectiveRequestTimeoutMs);
            reject(error);
            controller?.abort(error);
          }, effectiveRequestTimeoutMs);
        });

        try {
          return await Promise.race([operation, timeout, cancelled]);
        } finally {
          if (timeoutId !== null) clearTimeout(timeoutId);
          item.cancel = null;
        }
      }

      async function run(item) {
        let started = false;
        try {
          if (hasRecentFailure(failureKey, storage, now())) throw pausedError();
          if (typeof fetchImpl !== "function") {
            throw new Error("Fetch API unavailable");
          }
          reserved -= 1;
          issued += 1;
          started = true;
          item.status = "running";
          const response = await fetchWithTimeout(item);
          if (isRateLimitResponse(response)) {
            const retryAt = getRetryAt(response, now());
            response.retryAt = retryAt;
            const previous = readStoredObject(storage, failureKey);
            writeFailure(failureKey, storage, now(), "rate-limit", Math.max(
              retryAt, previous?.retryAt ?? (previous ? previous.failedAt + FAILURE_TTL_MS : 0)
            ));
          }
          item.resolve(response);
        } catch (error) {
          item.reject(error);
        } finally {
          if (!started) reserved -= 1;
          item.status = "settled";
          active -= 1;
          drain();
        }
      }

      async function fetchCoordinated(url, options = {}, { priority = 0 } = {}) {
        if (options.signal?.aborted) throw options.signal.reason;
        const key = requestKey(url, options);
        let item = inFlight.get(key);
        if (!item) {
          if (hasRecentFailure(failureKey, storage, now())) throw pausedError();
          if (issued + reserved >= maxRequests) throw createDeferredError("budget");
          reserved += 1;
          item = {
            url, options: { ...options }, priority, sequence: sequence++, status: "queued",
            controller: typeof AbortController === "function" ? new AbortController() : null,
            consumers: new Set(),
          };
          delete item.options.signal;
          item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
          inFlight.set(key, item);
          queue.push(item);
          queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
          void item.promise.finally(() => {
            if (inFlight.get(key) === item) inFlight.delete(key);
          }).catch(() => {});
        }
        const response = await new Promise((resolve, reject) => {
          const consumer = {};
          const cleanup = () => {
            options.signal?.removeEventListener?.("abort", cancel);
            item.consumers.delete(consumer);
          };
          const cancel = () => {
            cleanup();
            reject(options.signal.reason);
            if (item.consumers.size > 0 || item.status === "settled") return;
            if (inFlight.get(key) === item) inFlight.delete(key);
            if (item.status === "queued") {
              queue.splice(queue.indexOf(item), 1);
              reserved -= 1;
              item.status = "settled";
              item.reject(options.signal.reason);
            } else {
              item.cancel?.(options.signal.reason);
            }
          };
          item.consumers.add(consumer);
          options.signal?.addEventListener?.("abort", cancel, { once: true });
          item.promise.then(
            (value) => { cleanup(); resolve(value); },
            (error) => { cleanup(); reject(error); }
          );
          drain();
        });
        return typeof response?.clone === "function" ? response.clone() : response;
      }

      return {
        fetch: fetchCoordinated,
        get activeCount() {
          return active;
        },
        get queuedCount() {
          return queue.length;
        },
        get issuedCount() { return issued; },
        get reservedCount() { return reserved; },
      };
    }

    async function collectPagedRepositories(repoNames, cachedRepositories, fetchPage, isComplete, selectCandidates) {
      const repositories = {};
      const errors = [];
      const jobs = repoNames.map((name) => {
        const cached = cachedRepositories[name];
        if (cached) repositories[name] = cached;
        return { name, cached, pages: [], done: false, deferred: false };
      });
      let remaining = MAX_MILESTONE_REQUESTS;
      for (let page = 1; page <= MAX_MILESTONE_PAGES && remaining > 0; page += 1) {
        const selected = jobs.filter((job) => !job.done && !job.error && !job.deferred).slice(0, remaining);
        remaining -= selected.length;
        await Promise.all(selected.map(async (job) => {
          try {
            const result = await fetchPage(job.name, page, job.cached?.pages?.find((value) => value.page === page));
            job.pages.push(result);
            job.done = isComplete(job.pages);
          } catch (error) {
            if (isDeferred(error)) job.deferred = true;
            else { job.error = error; errors.push(error); }
          }
        }));
      }
      for (const job of jobs) {
        if (job.error && job.pages.length === 0) continue;
        const deferred = !job.done && (job.deferred || Boolean(job.error) || job.pages.length < MAX_MILESTONE_PAGES);
        repositories[job.name] = {
          pages: deferred
            ? job.pages.concat(job.cached?.pages?.slice(job.pages.length, MAX_MILESTONE_PAGES) || [])
            : job.pages,
          retainedCandidates: deferred && job.cached ? selectCandidates(job.cached, job.name) : [],
          limited: !job.done,
          deferred,
        };
      }
      return { repositories, errors, allSuccessful: errors.length === 0 };
    }

    function migratePagedCache(storageKey, legacyKey, repoNames, readCache, storage, now, selectCandidates) {
      const cached = readCache(legacyKey, repoNames, storage, now, true);
      if (!cached) return null;
      const repositories = Object.fromEntries(Object.entries(cached.repositories).map(([name, entry]) => [
        name, {
          pages: entry.pages.slice(0, MAX_MILESTONE_PAGES),
          retainedCandidates: selectCandidates(entry, name),
          limited: true,
          deferred: true,
        },
      ]));
      const replacement = { fetchedAt: 0, repoNames, repositories };
      if (writeStoredJson(storage, storageKey, replacement)) removeStorageItem(storage, legacyKey);
      return {
        ...replacement, isFresh: false,
        complete: repoNames.every((name) => repositories[name]),
      };
    }

    async function withResourceLock(lockName, task, locks = null) {
      if (!locks || typeof locks.request !== "function") {
        return task();
      }
      return locks.request(lockName, task);
    }

    return {
      API_VERSION,
      CACHE_TTL_MS,
      FAILURE_TTL_MS,
      TRANSIENT_FAILURE_TTL_MS,
      SECTION_TIMEOUT_MS,
      MAX_REQUESTS,
      REQUEST_TIMEOUT_MS,
      buildHeaders,
      createRequestCoordinator,
      collectPagedRepositories,
      migratePagedCache,
      createDeferredError,
      createHttpError,
      createRefresh,
      isDeferred,
      recordFailures,
      getFetch,
      getGlobalFailureKey,
      getHeader,
      getStorage,
      hasRecentFailure,
      isValidStoredTime,
      normalizeDate,
      normalizeHttpsUrl,
      readStoredObject,
      removeStorageItem,
      withResourceLock,
      writeFailure,
      writeStoredJson,
    };
  })();

  const completedMilestones = (() => {
    const LIMIT = 2;
    const PER_PAGE = 100;
    const MAX_PAGES = 2;
    const API_BASE_URL = "https://api.github.com";

    async function loadCompletedMilestones(
      container,
      {
        config,
        fetchImpl = shared.getFetch(),
        storage = shared.getStorage(),
        now = Date.now(),
        logger = console,
        refreshTimeoutMs = shared.SECTION_TIMEOUT_MS,
      } = {}
    ) {
      const owner =
        typeof config?.owner === "string" ? config.owner.trim() : "";
      const repositories = recentMilestones.normalizeRepositories(
        config?.repositories
      );
      if (!owner || !repositories) {
        renderCompletedMilestones(container, [], owner);
        logger.error(
          "Failed to load recently completed GitHub milestones: invalid configuration"
        );
        return false;
      }

      const storageKey = getStorageKey(owner);
      const failureKey = getFailureKey(owner, repositories);
      const cached = readCache(storageKey, repositories, storage, now);
      shared.removeStorageItem(storage, failureKey.replace(":v2:", ":v1:"));
      const cachedMilestones = cached
        ? mergeCompletedMilestones(cached.repositories, repositories, LIMIT)
        : [];
      const hasCachedResult = Boolean(
        cached?.complete || cachedMilestones.length > 0
      );

      if (cached?.isFresh) {
        return renderCompletedMilestones(
          container,
          cachedMilestones,
          owner
        );
      }

      if (
        hasCachedResult &&
        !renderCompletedMilestones(container, cachedMilestones, owner)
      ) {
        logger.error(
          "Failed to load recently completed GitHub milestones: invalid page markup"
        );
        return false;
      }

      if (hasRecentFailure(failureKey, storage, now)) {
        if (hasCachedResult) {
          return renderCompletedMilestones(
            container,
            cachedMilestones,
            owner
          );
        }
        renderCompletedMilestones(container, [], owner);
        return false;
      }

      if (typeof fetchImpl !== "function") {
        if (hasCachedResult) {
          return renderCompletedMilestones(
            container,
            cachedMilestones,
            owner
          );
        }
        renderCompletedMilestones(container, [], owner);
        return false;
      }

      const refresh = shared.createRefresh(fetchImpl, { timeoutMs: refreshTimeoutMs });
      try {
        const result = await loadRepositories(
          { owner, repositories },
          cached?.repositories || {},
          refresh.fetch
        );
        const milestones = mergeCompletedMilestones(
          result.repositories,
          repositories,
          LIMIT
        );

        writeCache(
          storageKey,
          {
            fetchedAt: result.allSuccessful ? now : cached?.fetchedAt || 0,
            repoNames: repositories,
            repositories: result.repositories,
          },
          storage
        );

        if (result.allSuccessful) {
          shared.removeStorageItem(storage, failureKey);
        } else {
          shared.recordFailures(failureKey, storage, now, result.errors);
          for (const error of result.errors) {
            logger.error(
              "Failed to load recently completed GitHub milestones",
              error
            );
          }
        }

        if (milestones.length > 0 || result.allSuccessful || cached?.complete) {
          return renderCompletedMilestones(
            container,
            milestones,
            owner
          );
        }

        renderCompletedMilestones(container, [], owner);
        return false;
      } catch (error) {
        shared.recordFailures(failureKey, storage, now, [error]);
        logger.error(
          "Failed to load recently completed GitHub milestones",
          error
        );
        if (hasCachedResult) {
          return renderCompletedMilestones(
            container,
            cachedMilestones,
            owner
          );
        }
        renderCompletedMilestones(container, [], owner);
        return false;
      } finally {
        refresh.close();
      }
    }

    async function loadRepositories(config, cachedRepositories, fetchImpl) {
      return shared.collectPagedRepositories(
        config.repositories, cachedRepositories,
        (repository, page, cachedPage) => fetchCompletedMilestonePage(
          config.owner, repository, page, cachedPage, fetchImpl
        ),
        (pages) => !pages[pages.length - 1].hasNext,
        (entry, name) => mergeCompletedMilestones({ [name]: entry }, [name])
      );
    }

    async function fetchRepositoryCompletedMilestones(owner, repository, cachedEntry, fetchImpl) {
      const result = await loadRepositories(
        { owner, repositories: [repository] },
        cachedEntry ? { [repository]: cachedEntry } : {}, fetchImpl
      );
      if (result.errors.length) throw result.errors[0];
      return result.repositories[repository];
    }

    async function fetchCompletedMilestonePage(owner, repository, pageNumber, cachedPage, fetchImpl) {
      const response = await fetchImpl(
        buildCompletedMilestonesUrl(owner, repository, pageNumber),
        { headers: shared.buildHeaders(cachedPage?.etag) },
        { priority: pageNumber > 1 ? 1 : 0 }
      );
      if (response.status === 304 && cachedPage) {
        const link = shared.getHeader(response, "link");
        return { ...cachedPage, hasNext: link ? hasNextPage(link) : cachedPage.hasNext };
      }
      if (!response.ok) throw shared.createHttpError(response, `${repository} milestones page ${pageNumber}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error(`GitHub API returned malformed milestone data for ${repository}`);
      }
      return {
        page: pageNumber,
        etag: shared.getHeader(response, "etag"),
        hasNext: hasNextPage(shared.getHeader(response, "link")),
        itemCount: payload.length,
        milestones: normalizeCompletedMilestones(payload, repository),
      };
    }

    function buildCompletedMilestonesUrl(owner, repository, page = 1) {
      const pathOwner = encodeURIComponent(owner);
      const pathRepository = encodeURIComponent(repository);
      const query = new URLSearchParams({
        state: "closed",
        per_page: String(PER_PAGE),
        page: String(page),
      });
      return `${API_BASE_URL}/repos/${pathOwner}/${pathRepository}/milestones?${query}`;
    }

    function normalizeCompletedMilestones(payload, repository) {
      const milestones = [];

      for (const value of payload) {
        const number = value?.number;
        const title =
          typeof value?.title === "string" ? value.title.trim() : "";
        const closedAt = shared.normalizeDate(value?.closed_at);

        if (
          value?.state !== "closed" ||
          !Number.isInteger(number) ||
          number < 1 ||
          !title ||
          !closedAt
        ) {
          continue;
        }

        milestones.push({ repository, number, title, closedAt });
      }

      return compactCompletedMilestones(milestones);
    }

    function compactCompletedMilestones(milestones) {
      const milestonesByNumber = new Map();
      for (const candidate of milestones) {
        const current = milestonesByNumber.get(candidate.number);
        if (
          !current ||
          Date.parse(candidate.closedAt) > Date.parse(current.closedAt)
        ) {
          milestonesByNumber.set(candidate.number, candidate);
        }
      }
      return Array.from(milestonesByNumber.values());
    }

    function mergeCompletedMilestones(repositories, repoNames, limit = LIMIT) {
      const repoOrder = new Map(repoNames.map((name, index) => [name, index]));
      const milestonesByKey = new Map();

      for (const repository of repoNames) {
        const entry = repositories?.[repository];
        if (!entry?.pages) continue;

        for (const page of [...entry.pages, { milestones: entry.retainedCandidates || [] }]) {
          for (const milestone of page.milestones) {
            const key = `${repository}:${milestone.number}`;
            const current = milestonesByKey.get(key);
            if (
              !current ||
              Date.parse(milestone.closedAt) > Date.parse(current.closedAt)
            ) {
              milestonesByKey.set(key, milestone);
            }
          }
        }
      }

      return Array.from(milestonesByKey.values())
        .sort((left, right) => {
          const closedDifference =
            Date.parse(right.closedAt) - Date.parse(left.closedAt);
          if (closedDifference !== 0) return closedDifference;

          const repositoryDifference =
            repoOrder.get(left.repository) - repoOrder.get(right.repository);
          if (repositoryDifference !== 0) return repositoryDifference;
          return right.number - left.number;
        })
        .slice(0, limit);
    }

    function renderCompletedMilestones(container, milestones, owner) {
      const list = container?.querySelector?.(
        "[data-recent-completed-milestones]"
      );
      const items = Array.from(
        container?.querySelectorAll?.(
          "[data-recent-completed-milestone]"
        ) || []
      );
      const visibleMilestones = milestones.slice(0, LIMIT);

      if (!list || items.length < visibleMilestones.length) return false;

      for (const item of items) item.setAttribute("hidden", "");
      if (visibleMilestones.length === 0) {
        list.setAttribute("hidden", "");
        return true;
      }

      const bindings = visibleMilestones.map((milestone, index) => ({
        item: items[index],
        link: items[index].querySelector?.(
          "[data-recent-completed-milestone-link]"
        ),
        milestone,
      }));
      if (bindings.some(({ link }) => !link)) {
        list.setAttribute("hidden", "");
        return false;
      }

      for (const { item, link, milestone } of bindings) {
        link.textContent = milestone.title;
        link.href = buildClosedMilestoneUrl(
          owner,
          milestone.repository,
          milestone.number
        );
        link.setAttribute(
          "aria-label",
          `View closed issues for milestone ${milestone.title} in ${milestone.repository}`
        );
        item.removeAttribute("hidden");
      }
      list.removeAttribute("hidden");
      return true;
    }

    function buildClosedMilestoneUrl(owner, repository, milestoneNumber) {
      const repositoryUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
      return `${repositoryUrl}/milestone/${milestoneNumber}?closed=1`;
    }

    function hasNextPage(linkHeader) {
      return typeof linkHeader === "string" && /;\s*rel="next"/.test(linkHeader);
    }

    function getStorageKey(owner) {
      return `recent-completed-milestones:v2:${owner.toLowerCase()}:limit:${LIMIT}`;
    }

    function getFailureKey(owner, repositories) {
      const repoKey = repositories
        .map((repository) => repository.toLowerCase())
        .slice()
        .sort()
        .join(",");
      return `recent-completed-milestones:v2:failure:${owner.toLowerCase()}:limit:${LIMIT}:${repoKey}`;
    }

    function readCache(storageKey, repositories, storage, now, legacy = false) {
      const cached = shared.readStoredObject(storage, storageKey);
      if (!cached && !legacy) return shared.migratePagedCache(
        storageKey, storageKey.replace(":v2:", ":v1:"), repositories, readCache, storage, now,
        (entry, name) => mergeCompletedMilestones({ [name]: entry }, [name])
      );
      if (
        !cached ||
        !shared.isValidStoredTime(cached.fetchedAt, now) ||
        !Array.isArray(cached.repoNames) ||
        !cached.repositories ||
        typeof cached.repositories !== "object" ||
        Array.isArray(cached.repositories) ||
        cached.repoNames.some((name) => typeof name !== "string" || !name) ||
        new Set(cached.repoNames).size !== cached.repoNames.length
      ) {
        if (cached) shared.removeStorageItem(storage, storageKey);
        return null;
      }

      const currentNames = new Set(repositories);
      const normalizedRepositories = {};
      for (const [repository, entry] of Object.entries(cached.repositories)) {
        if (!currentNames.has(repository)) continue;
        const normalized = normalizeCachedEntry(entry, repository, legacy);
        if (!normalized) {
          shared.removeStorageItem(storage, storageKey);
          return null;
        }
        normalizedRepositories[repository] = normalized;
      }

      const currentRepoNames = repositories.slice().sort();
      const cachedRepoNames = cached.repoNames.slice().sort();
      const sameRepositorySet =
        currentRepoNames.length === cachedRepoNames.length &&
        currentRepoNames.every(
          (name, index) => name === cachedRepoNames[index]
        );
      const complete = repositories.every(
        (repository) => normalizedRepositories[repository]
      );

      return {
        complete,
        fetchedAt: cached.fetchedAt,
        isFresh:
          sameRepositorySet &&
          complete &&
          cached.fetchedAt > 0 &&
          now - cached.fetchedAt < shared.CACHE_TTL_MS,
        repositories: normalizedRepositories,
      };
    }

    function normalizeCachedEntry(entry, repository, legacy) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.pages)) {
        return null;
      }

      const pages = [];
      const pageNumbers = new Set();
      for (const page of entry.pages) {
        if (
          !page ||
          typeof page !== "object" ||
          !Number.isInteger(page.page) ||
          page.page < 1 ||
          page.page > (legacy ? 100 : MAX_PAGES) ||
          pageNumbers.has(page.page) ||
          typeof page.etag !== "string" ||
          typeof page.hasNext !== "boolean" ||
          !Number.isInteger(page.itemCount) ||
          page.itemCount < 0 ||
          page.itemCount > PER_PAGE ||
          !Array.isArray(page.milestones)
        ) {
          return null;
        }

        const milestones = [];
        for (const value of page.milestones) {
          const normalized = normalizeCachedMilestone(value, repository);
          if (!normalized) return null;
          milestones.push(normalized);
        }
        pageNumbers.add(page.page);
        pages.push({
          page: page.page,
          etag: page.etag,
          hasNext: page.hasNext,
          itemCount: page.itemCount,
          milestones: compactCompletedMilestones(milestones),
        });
      }

      if ([entry.limited, entry.deferred].some((flag) => flag !== undefined && typeof flag !== "boolean")) return null;
      if (pages.length === 0 && entry.deferred !== true) return null;
      pages.sort((left, right) => left.page - right.page);
      if (pages.some((page, index) => page.page !== index + 1)) return null;
      if (pages.length && pages[pages.length - 1].hasNext && !entry.limited && !entry.deferred) return null;
      const retained = entry.retainedCandidates ?? [];
      if (!Array.isArray(retained)) return null;
      const retainedCandidates = retained.map((value) => normalizeCachedMilestone(value, repository));
      if (retainedCandidates.some((value) => !value)) return null;
      return {
        pages, retainedCandidates: compactCompletedMilestones(retainedCandidates),
        limited: entry.limited === true, deferred: entry.deferred === true,
      };
    }

    function normalizeCachedMilestone(value, repository) {
      const number = value?.number;
      const title = typeof value?.title === "string" ? value.title.trim() : "";
      const closedAt = shared.normalizeDate(value?.closedAt);
      if (
        value?.repository !== repository ||
        !Number.isInteger(number) ||
        number < 1 ||
        !title ||
        !closedAt
      ) {
        return null;
      }
      return { repository, number, title, closedAt };
    }

    function writeCache(storageKey, cache, storage) {
      return shared.writeStoredJson(storage, storageKey, cache);
    }

    function hasRecentFailure(failureKey, storage, now) {
      return shared.hasRecentFailure(failureKey, storage, now);
    }

    function writeFailure(failureKey, storage, now) {
      shared.writeFailure(failureKey, storage, now);
    }

    return {
      LIMIT,
      buildClosedMilestoneUrl,
      buildCompletedMilestonesUrl,
      fetchRepositoryCompletedMilestones,
      getFailureKey,
      getStorageKey,
      loadCompletedMilestones,
      mergeCompletedMilestones,
      normalizeCompletedMilestones,
      readCache,
      renderCompletedMilestones,
      writeCache,
    };
  })();

  const repositoryUpdates = (() => {
    const FALLBACK_LOADING_TEXT = "Checking for updates...";
    const FALLBACK_UNAVAILABLE_TEXT = "Last updated unavailable";
    const DAY_MS = 24 * 60 * 60 * 1000;
    const REPO_QUERY = "per_page=100&sort=pushed&direction=desc&type=public";
    const DATE_FORMATTERS = {
      withYear: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      withoutYear: new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
      }),
    };

    function groupCardsByOwner(cards) {
      const groups = new Map();
      for (const card of cards) {
        const owner = card.dataset.repoOwner?.trim();
        const repoName = card.dataset.repoName?.trim();
        const wrapper = card.querySelector(".repo-updated");
        const textNode = card.querySelector(".repo-updated-text");
        if (!owner || !repoName || !wrapper || !textNode) continue;
        const group = groups.get(owner) || [];
        group.push({ repoName, wrapper, textNode });
        groups.set(owner, group);
      }
      return groups;
    }

    function renderOwnerCards(ownerCards, repositories, missingText) {
      for (const { repoName, wrapper, textNode } of ownerCards) {
        wrapper.classList.add("is-visible");
        const pushedAt = repositories?.[repoName]?.pushedAt;
        const formatted = pushedAt ? formatPushedAt(pushedAt) : "";
        textNode.textContent = formatted || missingText;
      }
    }

    function normalizeRepositoryCatalogue(repositories) {
      if (!Array.isArray(repositories)) return null;
      const normalized = {};
      for (const repository of repositories) {
        if (!repository || typeof repository !== "object") continue;
        const name = typeof repository.name === "string" ? repository.name.trim() : "";
        const pushedAt = shared.normalizeDate(repository.pushed_at);
        const url = shared.normalizeHttpsUrl(repository.html_url);
        if (!name || !pushedAt || !url) continue;
        normalized[name] = {
          archived: repository.archived === true,
          fork: repository.fork === true,
          pushedAt,
          url,
        };
      }
      return normalized;
    }

    function normalizeCachedRepositories(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const normalized = {};
      for (const [name, repository] of Object.entries(value)) {
        if (!name || !repository || typeof repository !== "object") return null;
        const pushedAt = shared.normalizeDate(repository.pushedAt);
        const url = repository.url ? shared.normalizeHttpsUrl(repository.url) : "";
        if (!pushedAt || (repository.url && !url)) return null;
        normalized[name] = {
          archived: repository.archived === true,
          fork: repository.fork === true,
          pushedAt,
          url,
        };
      }
      return normalized;
    }

    function getOwnerRepoListUrl(owner) {
      return `https://api.github.com/users/${encodeURIComponent(owner)}/repos?${REPO_QUERY}`;
    }

    function getStorageKey(owner) {
      return `github-activity:v1:${owner.toLowerCase()}:repositories`;
    }

    function getFailureKey(owner) {
      return `github-activity:v1:failure:${owner.toLowerCase()}:repositories`;
    }

    function getLegacyStorageKey(owner) {
      return `repo-updates:v3:owner:${owner}`;
    }

    function getLegacyFailureKey(owner) {
      return `repo-updates:v3:failure:owner:${owner}`;
    }

    function readLegacyCache(owner, storage, now) {
      const key = getLegacyStorageKey(owner);
      const cached = shared.readStoredObject(storage, key);
      if (!cached) return null;
      if (
        !shared.isValidStoredTime(cached.fetchedAt, now) ||
        !cached.repos ||
        typeof cached.repos !== "object" ||
        Array.isArray(cached.repos)
      ) {
        shared.removeStorageItem(storage, key);
        return null;
      }
      const repositories = {};
      for (const [name, value] of Object.entries(cached.repos)) {
        const pushedAt = shared.normalizeDate(value);
        if (!name || !pushedAt) {
          shared.removeStorageItem(storage, key);
          return null;
        }
        repositories[name] = {
          archived: false,
          fork: false,
          pushedAt,
          url: "",
        };
      }
      return {
        etag: typeof cached.etag === "string" ? cached.etag : "",
        fetchedAt: cached.fetchedAt,
        isFresh: now - cached.fetchedAt < shared.CACHE_TTL_MS,
        legacy: true,
        complete: false,
        repositories,
      };
    }

    function readCache(storageKey, storage, now, owner = "") {
      const cached = shared.readStoredObject(storage, storageKey);
      if (!cached) return owner ? readLegacyCache(owner, storage, now) : null;
      const repositories = normalizeCachedRepositories(cached.repositories);
      if (!shared.isValidStoredTime(cached.fetchedAt, now) || !repositories) {
        shared.removeStorageItem(storage, storageKey);
        return null;
      }
      return {
        etag: typeof cached.etag === "string" ? cached.etag : "",
        fetchedAt: cached.fetchedAt,
        isFresh: now - cached.fetchedAt < shared.CACHE_TTL_MS,
        legacy: false,
        complete: cached.complete === true,
        repositories,
      };
    }

    function writeCache(storageKey, { etag, repositories, complete = false }, storage, now) {
      return shared.writeStoredJson(storage, storageKey, {
        etag,
        fetchedAt: now,
        complete,
        repositories,
      });
    }

    async function loadRepositoryCatalogue(
      owner,
      {
        fetchImpl = shared.getFetch(),
        storage = shared.getStorage(),
        now = Date.now(),
        logger = console,
        force = false,
        refreshTimeoutMs = shared.SECTION_TIMEOUT_MS,
      } = {}
    ) {
      const storageKey = getStorageKey(owner);
      const failureKey = getFailureKey(owner);
      const cached = readCache(storageKey, storage, now, owner);

      if (cached?.isFresh && !force) {
        return { ...cached, successful: true, validated: false };
      }
      if (shared.hasRecentFailure(failureKey, storage, now)) {
        return cached
          ? { ...cached, successful: false, validated: false }
          : { repositories: null, successful: false, validated: false };
      }
      if (typeof fetchImpl !== "function") {
        shared.writeFailure(failureKey, storage, now, "unavailable");
        return cached
          ? { ...cached, successful: false, validated: false }
          : { repositories: null, successful: false, validated: false };
      }

      const refresh = shared.createRefresh(fetchImpl, { timeoutMs: refreshTimeoutMs });
      try {
        const response = await refresh.fetch(getOwnerRepoListUrl(owner), {
          headers: shared.buildHeaders(cached?.etag),
        });
        if (response.status === 304 && cached) {
          writeCache(storageKey, cached, storage, now);
          shared.removeStorageItem(storage, failureKey);
          shared.removeStorageItem(storage, getLegacyStorageKey(owner));
          shared.removeStorageItem(storage, getLegacyFailureKey(owner));
          return {
            ...cached,
            fetchedAt: now,
            isFresh: true,
            legacy: false,
            successful: true,
            validated: true,
          };
        }
        if (!response.ok) {
          throw shared.createHttpError(response, "repository catalogue", now);
        }
        const payload = await response.json();
        const repositories = normalizeRepositoryCatalogue(payload);
        if (!repositories) {
          throw new Error("GitHub API returned malformed repository data");
        }
        const result = {
          etag: shared.getHeader(response, "etag"),
          fetchedAt: now,
          isFresh: true,
          legacy: false,
          complete:
            !/;\s*rel="next"/.test(shared.getHeader(response, "link")) &&
            Object.keys(repositories).length === payload.length,
          repositories,
          successful: true,
          validated: true,
        };
        writeCache(storageKey, result, storage, now);
        shared.removeStorageItem(storage, failureKey);
        shared.removeStorageItem(storage, getLegacyStorageKey(owner));
        shared.removeStorageItem(storage, getLegacyFailureKey(owner));
        return result;
      } catch (error) {
        shared.recordFailures(failureKey, storage, now, [error]);
        if (!shared.isDeferred(error)) logger.error(`Failed to load repository data for ${owner}`, error);
        return cached
          ? { ...cached, successful: false, validated: false }
          : { repositories: null, successful: false, validated: false };
      } finally {
        refresh.close();
      }
    }

    async function loadOwnerUpdates(
      owner,
      ownerCards,
      {
        fetchImpl = shared.getFetch(),
        storage = shared.getStorage(),
        now = Date.now(),
        logger = console,
        loadCatalogueImpl = null,
      } = {}
    ) {
      const cached = readCache(getStorageKey(owner), storage, now, owner);
      renderOwnerCards(
        ownerCards,
        cached?.repositories,
        cached ? FALLBACK_UNAVAILABLE_TEXT : FALLBACK_LOADING_TEXT
      );
      const result = loadCatalogueImpl
        ? await loadCatalogueImpl(false)
        : await loadRepositoryCatalogue(owner, { fetchImpl, storage, now, logger });
      renderOwnerCards(ownerCards, result.repositories, FALLBACK_UNAVAILABLE_TEXT);
      return result;
    }

    function formatPushedAt(isoString, now = new Date()) {
      const date = new Date(isoString);
      if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "";
      const dayDifference = localCalendarDay(now) - localCalendarDay(date);
      if (dayDifference === 0) return "updated today";
      if (dayDifference === 1) return "updated yesterday";
      if (dayDifference > 1 && dayDifference < 7) {
        return `updated ${dayDifference} days ago`;
      }
      if (dayDifference >= 7 && dayDifference < 14) return "updated last week";
      if (dayDifference >= 14 && dayDifference < 28) {
        return `updated ${Math.floor(dayDifference / 7)} weeks ago`;
      }
      const formatter =
        date.getFullYear() === now.getFullYear()
          ? DATE_FORMATTERS.withoutYear
          : DATE_FORMATTERS.withYear;
      return `updated on ${formatter.format(date)}`;
    }

    function localCalendarDay(date) {
      return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
    }

    return {
      CACHE_TTL_MS: shared.CACHE_TTL_MS,
      FAILURE_TTL_MS: shared.FAILURE_TTL_MS,
      formatPushedAt,
      getFailureKey,
      getOwnerRepoListUrl,
      getStorageKey,
      groupCardsByOwner,
      loadOwnerUpdates,
      loadRepositoryCatalogue,
      normalizeRepositoryCatalogue,
      readCache,
      renderOwnerCards,
      writeCache,
    };
  })();

  const recentCommits = (() => {
    const MAX_RECENT_COMMITS = 10;
    const FALLBACK_PAGE_SIZE = 100;
    const MAX_FALLBACK_PAGES = 2;
    const MAX_FALLBACK_REQUESTS = 12;
    const API_BASE_URL = "https://api.github.com";
    const AUTHOR_MODE = "author";
    const LINKED_AUTHOR_MODE = "linked-author";

    async function loadCommitHistory(
      container,
      {
        config: providedConfig = null,
        fetchImpl = shared.getFetch(),
        storage = shared.getStorage(),
        now = Date.now(),
        logger = console,
        refreshTimeoutMs = shared.SECTION_TIMEOUT_MS,
        getCatalogueImpl = null,
      } = {}
    ) {
      const config = providedConfig || readConfiguration(container);
      if (!config) {
        renderStatus(container, "error");
        logger.error("Failed to load recent GitHub commits: invalid configuration");
        return false;
      }

      const storageKey = getStorageKey(config.owner, config.limit);
      const failureKey = getFailureKey(config.owner, config.limit);
      for (const key of getLegacyFailureKeys(config.owner, config.limit)) {
        shared.removeStorageItem(storage, key);
      }
      const cached = readCachedHistory(config, storage, now);
      let cachedCommits = cached
        ? mergeCommits(cached.repositories, config.limit)
        : [];
      let hasCachedResult = Boolean(cached?.complete || cachedCommits.length > 0);

      if (cached?.isFresh) {
        return renderCommits(container, cachedCommits, config.limit);
      }
      if (hasRecentFailure(failureKey, storage, now)) {
        if (hasCachedResult) return renderCommits(container, cachedCommits, config.limit);
        renderStatus(container, "error");
        return false;
      }
      if (typeof fetchImpl !== "function") {
        writeFailure(failureKey, storage, now);
        logger.error("Failed to load recent GitHub commits: Fetch API unavailable");
        if (hasCachedResult) return renderCommits(container, cachedCommits, config.limit);
        renderStatus(container, "error");
        return false;
      }
      if (hasCachedResult) {
        if (!renderCommits(container, cachedCommits, config.limit)) return false;
      } else if (!renderStatus(container, "loading")) {
        renderStatus(container, "error");
        logger.error("Failed to load recent GitHub commits: invalid page markup");
        return false;
      }

      container.setAttribute("aria-busy", "true");
      const refresh = shared.createRefresh(fetchImpl, { timeoutMs: refreshTimeoutMs });
      try {
        let catalogue = null;
        if (typeof getCatalogueImpl === "function") {
          try {
            catalogue = await refresh.wait(getCatalogueImpl(Boolean(cached)));
          } catch (error) {
            if (!shared.isDeferred(error)) logger.error("Failed to validate the GitHub repository catalogue", error);
          }
        }

        const repositories = filterEligibleRepositories(
          config.repositories,
          catalogue
        );
        const activeConfig = { ...config, repositories };
        const cachedRepositories = selectCachedRepositories(
          cached?.repositories,
          repositories
        );
        cachedCommits = mergeCommits(cachedRepositories, config.limit);
        hasCachedResult = Boolean(cached && (
          repositories.every(({ name }) => cachedRepositories[name]) ||
          cachedCommits.length > 0
        ));
        const repositoriesToFetch = selectRepositoriesToFetch(
          repositories,
          cachedRepositories,
          catalogue
        );

        const result = await loadRepositories(
          activeConfig,
          cachedRepositories,
          refresh.fetch,
          repositoriesToFetch,
          catalogue?.repositories || {}
        );

        const commits = mergeCommits(result.repositories, config.limit);
        const activeNames = new Set(repositories.map(({ name }) => name));
        writeCache(storageKey, {
          fetchedAt: result.allSuccessful ? now : 0,
          items: commits,
          repoNames: config.repositories.map(({ name }) => name),
          excludedRepoNames: config.repositories
            .filter(({ name }) => !activeNames.has(name))
            .map(({ name }) => name),
          repositories: result.repositories,
        }, storage);

        if (result.allSuccessful) {
          shared.removeStorageItem(storage, failureKey);
        } else {
          shared.recordFailures(failureKey, storage, now, result.errors);
          for (const error of result.errors) {
            logger.error("Failed to load recent GitHub commits", error);
          }
        }

        if (result.allSuccessful || commits.length > 0 || hasCachedResult) {
          return renderCommits(container, commits, config.limit);
        }
        renderStatus(container, "error");
        return false;
      } catch (error) {
        shared.recordFailures(failureKey, storage, now, [error]);
        if (!shared.isDeferred(error)) logger.error("Failed to load recent GitHub commits", error);
        if (hasCachedResult) return renderCommits(container, cachedCommits, config.limit);
        renderStatus(container, "error");
        return false;
      } finally {
        refresh.close();
        container.removeAttribute("aria-busy");
      }
    }

    function readConfiguration(container) {
      const owner = container?.dataset?.owner?.trim();
      const limit = Number(container?.dataset?.commitLimit);
      const repositoryData = container?.querySelector?.(
        "[data-commit-history-repositories]"
      );
      if (!owner || !Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_COMMITS) {
        return null;
      }
      try {
        const repositories = normalizeRepositories(JSON.parse(repositoryData?.textContent));
        return repositories ? { owner, limit, repositories } : null;
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
        const url = shared.normalizeHttpsUrl(item?.url);
        if (!name || !url || names.has(name)) return null;
        names.add(name);
        repositories.push({ name, url });
      }
      return repositories;
    }

    function filterEligibleRepositories(repositories, catalogue) {
      if (!catalogue?.validated || !catalogue.repositories) return repositories;
      return repositories.filter((repository) => {
        const current = catalogue.repositories[repository.name];
        return current
          ? !current.archived && !current.fork
          : catalogue.complete !== true;
      });
    }

    function selectCachedRepositories(cachedRepositories, repositories) {
      const selected = {};
      for (const repository of repositories) {
        if (cachedRepositories?.[repository.name]) {
          selected[repository.name] = cachedRepositories[repository.name];
        }
      }
      return selected;
    }

    function selectRepositoriesToFetch(repositories, cachedRepositories, catalogue) {
      if (!catalogue?.validated) return repositories;
      return repositories.filter((repository) => {
        const cached = cachedRepositories[repository.name];
        const current = catalogue.repositories?.[repository.name];
        return (
          !cached ||
          !current ||
          !cached.pushedAt ||
          cached.deferred ||
          (cached.mode === AUTHOR_MODE && cached.commits?.length === 0) ||
          cached.pushedAt !== current.pushedAt
        );
      });
    }

    async function loadRepositories(
      config,
      cachedRepositories,
      fetchImpl,
      repositoriesToFetch = config.repositories,
      catalogue = {}
    ) {
      const repositories = { ...cachedRepositories };
      const errors = [];
      const results = await Promise.all(
        repositoriesToFetch.map(async (repository) => {
          try {
            const cachedEntry = cachedRepositories[repository.name];
            const entry = cachedEntry?.mode === LINKED_AUTHOR_MODE
              ? null
              : await fetchAuthorCommits(
                repository, config.owner, config.limit, cachedEntry, fetchImpl
              );
            return { repository, cachedEntry, entry };
          } catch (error) {
            return { error, repository };
          }
        })
      );

      const fallbackJobs = [];
      for (const result of results) {
        const { repository, cachedEntry, entry, error } = result;
        if (shared.isDeferred(error)) {
          repositories[repository.name] = {
            ...(cachedEntry || cachedRepositories[repository.name] || {
              mode: AUTHOR_MODE, etag: "", commits: [], pushedAt: "",
            }),
            limited: true, deferred: true,
          };
        } else if (error) {
          errors.push(error);
        } else if (entry) {
          repositories[repository.name] = {
            ...entry,
            limited: false,
            deferred: false,
            pushedAt: catalogue[repository.name]?.pushedAt || cachedEntry?.pushedAt || "",
          };
        } else {
          fallbackJobs.push({ repository, cachedEntry, pages: [], commits: [], done: false });
        }
      }

      const repositoryOrder = new Map(config.repositories.map(({ name }, index) => [name, index]));
      const pushedTime = (name) => Date.parse(catalogue[name]?.pushedAt) || 0;
      fallbackJobs.sort((left, right) =>
        pushedTime(right.repository.name) - pushedTime(left.repository.name) ||
        repositoryOrder.get(left.repository.name) - repositoryOrder.get(right.repository.name)
      );

      let remainingRequests = MAX_FALLBACK_REQUESTS;
      for (let page = 1; page <= MAX_FALLBACK_PAGES && remainingRequests > 0; page += 1) {
        const selected = fallbackJobs
          .filter((job) => !job.done && !job.error && !job.deferred)
          .slice(0, remainingRequests);
        // Reserve the whole round before any request reaches the shared queue.
        remainingRequests -= selected.length;
        await Promise.all(selected.map(async (job) => {
          try {
            const cachedPage = job.cachedEntry?.pages?.find((value) => value.page === page);
            const result = await fetchLinkedAuthorPage(
              job.repository, config.owner, config.limit, page, cachedPage, fetchImpl
            );
            job.pages.push(result);
            job.commits = mergeCommits({
              collected: { commits: job.commits },
              page: result,
            }, config.limit);
            job.done = job.commits.length >= config.limit || !result.hasNext;
          } catch (error) {
            if (shared.isDeferred(error)) job.deferred = true;
            else { job.error = error; errors.push(error); }
          }
        }));
      }

      for (const job of fallbackJobs) {
        if (job.error) continue;
        const { repository, cachedEntry, pages, commits, done } = job;
        const deferred = !done && pages.length < MAX_FALLBACK_PAGES;
        if (pages.length === 0) {
          repositories[repository.name] = {
            ...(cachedEntry || { mode: LINKED_AUTHOR_MODE, pages: [], commits: [], pushedAt: "" }),
            limited: true,
            deferred: true,
          };
          continue;
        }
        repositories[repository.name] = {
          mode: LINKED_AUTHOR_MODE,
          pages: deferred ? pages.concat(cachedEntry?.pages?.slice(pages.length) || []) : pages,
          commits: deferred
            ? mergeCommits({ collected: { commits }, cached: cachedEntry }, config.limit)
            : commits,
          limited: !done,
          deferred,
          pushedAt: deferred
            ? cachedEntry?.pushedAt || ""
            : catalogue[repository.name]?.pushedAt || cachedEntry?.pushedAt || "",
        };
      }
      return { allSuccessful: errors.length === 0, errors, repositories };
    }

    async function fetchAuthorCommits(
      repository,
      owner,
      limit,
      cachedEntry,
      fetchImpl
    ) {
      const response = await fetchImpl(
        buildCommitListUrl(repository.name, owner, limit, AUTHOR_MODE),
        { headers: shared.buildHeaders(cachedEntry?.etag) }
      );
      let entry;
      if (response.status === 304 && cachedEntry) {
        entry = cachedEntry;
      } else {
        if (!response.ok) {
          throw shared.createHttpError(response, repository.name);
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new Error(`GitHub API returned malformed commit data for ${repository.name}`);
        }
        entry = {
          mode: AUTHOR_MODE,
          etag: shared.getHeader(response, "etag"),
          commits: normalizeApiCommits(payload, repository, owner, limit),
        };
      }
      return entry.commits.length > 0 ? entry : null;
    }

    async function fetchLinkedAuthorPage(
      repository,
      owner,
      limit,
      page,
      cachedPage,
      fetchImpl
    ) {
      const response = await fetchImpl(
        buildCommitListUrl(repository.name, owner, limit, LINKED_AUTHOR_MODE, page),
        { headers: shared.buildHeaders(cachedPage?.etag) },
        { priority: page > 1 ? 1 : 0 }
      );
      const link = shared.getHeader(response, "link");
      if (response.status === 304 && cachedPage) {
        return { ...cachedPage, hasNext: link ? hasNextPage(link) : cachedPage.hasNext };
      }
      if (!response.ok) {
        throw shared.createHttpError(response, repository.name);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error(`GitHub API returned malformed commit data for ${repository.name}`);
      }
      return {
        page,
        etag: shared.getHeader(response, "etag"),
        hasNext: hasNextPage(link),
        commits: normalizeApiCommits(payload, repository, owner, limit),
      };
    }

    function hasLimitedHistory(repositories) {
      return Object.values(repositories || {}).some((entry) => entry.limited || entry.deferred);
    }

    function normalizeApiCommits(payload, repository, owner, limit) {
      if (!Array.isArray(payload)) return [];
      const commits = [];
      const normalizedOwner = owner.toLowerCase();
      for (const item of payload) {
        if (item?.author?.login?.toLowerCase() !== normalizedOwner) continue;
        const sha = typeof item.sha === "string" ? item.sha.trim() : "";
        const commitUrl = shared.normalizeHttpsUrl(item.html_url);
        const message = getMessageSubject(item?.commit?.message);
        const committedAt = shared.normalizeDate(item?.commit?.committer?.date);
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
      return (
        value
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean) || ""
      );
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
        const empty = container.querySelector("[data-commit-history-empty]");
        if (empty) {
          empty.textContent = "No recent commits found";
        }
        if (renderStatus(container, "empty")) return true;
        renderStatus(container, "error");
        return false;
      }
      const bindings = commits.slice(0, limit).map((commit, index) => {
        const item = items[index];
        return {
          commit,
          item,
          messageLink: item.querySelector("[data-commit-history-message]"),
          repoLink: item.querySelector("[data-commit-history-repo]"),
          time: item.querySelector("[data-commit-history-date]"),
        };
      });
      if (bindings.some(({ messageLink, repoLink, time }) => !messageLink || !repoLink || !time)) {
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
      bindings[bindings.length - 1].item.setAttribute("data-commit-history-last", "");
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
      hideStatuses(container);
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
      const normalized = shared.normalizeDate(value);
      return normalized ? normalized.slice(0, 10) : "";
    }

    function buildCommitListUrl(repoName, owner, limit, mode, page = 1) {
      const url = new URL(
        `${API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits`
      );
      if (mode === AUTHOR_MODE) url.searchParams.set("author", owner);
      url.searchParams.set("per_page", String(mode === LINKED_AUTHOR_MODE ? FALLBACK_PAGE_SIZE : limit));
      if (page > 1) url.searchParams.set("page", String(page));
      return url.href;
    }

    function hasNextPage(linkHeader) {
      return typeof linkHeader === "string" && /;\s*rel="next"/.test(linkHeader);
    }

    function getStorageKey(owner, limit) {
      return `github-activity:v3:${owner.toLowerCase()}:commits:limit:${limit}`;
    }

    function getFailureKey(owner, limit) {
      return `github-activity:v3:failure:${owner.toLowerCase()}:commits:limit:${limit}`;
    }

    function getLegacyStorageKeys(owner, limit) {
      return [
        `github-activity:v2:${owner.toLowerCase()}:commits:limit:${limit}`,
        `github-activity:v1:${owner.toLowerCase()}:commits:limit:${limit}`,
        `commit-history:v1:${owner.toLowerCase()}:limit:${limit}`,
      ];
    }

    function getLegacyFailureKeys(owner, limit) {
      return [
        `github-activity:v2:failure:${owner.toLowerCase()}:commits:limit:${limit}`,
        `github-activity:v1:failure:${owner.toLowerCase()}:commits:limit:${limit}`,
        `commit-history:v1:failure:${owner.toLowerCase()}:limit:${limit}`,
      ];
    }

    function readCachedHistory(config, storage, now) {
      const storageKey = getStorageKey(config.owner, config.limit);
      return readCache(storageKey, config.repositories, storage, now) ||
        migrateLegacyCache(config, storageKey, storage, now);
    }

    function readCache(storageKey, repositories, storage, now, legacy = false) {
      const cached = shared.readStoredObject(storage, storageKey);
      if (!cached) return null;
      if (
        !shared.isValidStoredTime(cached.fetchedAt, now) ||
        (cached.mode !== undefined && ![AUTHOR_MODE, LINKED_AUTHOR_MODE].includes(cached.mode)) ||
        !Array.isArray(cached.repoNames) ||
        !cached.repositories ||
        typeof cached.repositories !== "object" ||
        Array.isArray(cached.repositories)
      ) {
        shared.removeStorageItem(storage, storageKey);
        return null;
      }
      const excludedRepoNames = cached.excludedRepoNames ?? [];
      if (
        cached.repoNames.some((name) => typeof name !== "string" || !name) ||
        new Set(cached.repoNames).size !== cached.repoNames.length ||
        !Array.isArray(excludedRepoNames) ||
        new Set(excludedRepoNames).size !== excludedRepoNames.length ||
        excludedRepoNames.some((name) =>
          !cached.repoNames.includes(name) ||
          Object.prototype.hasOwnProperty.call(cached.repositories, name)
        )
      ) {
        shared.removeStorageItem(storage, storageKey);
        return null;
      }
      const currentByName = new Map(repositories.map((repo) => [repo.name, repo]));
      const normalizedRepositories = {};
      for (const [name, entry] of Object.entries(cached.repositories)) {
        const repository = currentByName.get(name);
        if (!repository) continue;
        const normalized = normalizeCachedEntry(entry, repository, cached.mode, legacy);
        if (!normalized) {
          shared.removeStorageItem(storage, storageKey);
          return null;
        }
        normalizedRepositories[name] = normalized;
      }
      const currentNames = repositories.map(({ name }) => name).sort();
      const cachedNames = cached.repoNames.slice().sort();
      const sameRepositorySet =
        currentNames.length === cachedNames.length &&
        currentNames.every((name, index) => name === cachedNames[index]);
      const complete = currentNames.every((name) =>
        normalizedRepositories[name] || excludedRepoNames.includes(name)
      );
      return {
        complete,
        fetchedAt: cached.fetchedAt,
        isFresh:
          sameRepositorySet &&
          complete &&
          cached.fetchedAt > 0 &&
          now - cached.fetchedAt < shared.CACHE_TTL_MS,
        repoNames: cached.repoNames.slice(),
        excludedRepoNames: excludedRepoNames.filter((name) => currentByName.has(name)),
        repositories: normalizedRepositories,
        limited: hasLimitedHistory(normalizedRepositories),
      };
    }

    function normalizeCachedCommits(values, repository) {
      if (!Array.isArray(values)) return null;
      const commits = [];
      for (const value of values.slice(0, MAX_RECENT_COMMITS)) {
        const sha = typeof value?.sha === "string" ? value.sha.trim() : "";
        const message = getMessageSubject(value?.message);
        const committedAt = shared.normalizeDate(value?.committedAt);
        const repoUrl = shared.normalizeHttpsUrl(value?.repoUrl);
        const commitUrl = shared.normalizeHttpsUrl(value?.commitUrl);
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
        commits.push({ sha, repoName: repository.name, repoUrl, commitUrl, message, committedAt });
      }
      return commits;
    }

    function normalizeCachedEntry(entry, repository, legacyMode, legacy) {
      if (!entry || typeof entry !== "object") return null;
      const mode = entry.mode ?? legacyMode;
      if (![AUTHOR_MODE, LINKED_AUTHOR_MODE].includes(mode)) return null;
      const commits = normalizeCachedCommits(entry.commits, repository);
      if (!commits) return null;
      if ([entry.limited, entry.deferred].some((flag) => flag !== undefined && typeof flag !== "boolean")) {
        return null;
      }
      const pushedAt = entry.pushedAt ? shared.normalizeDate(entry.pushedAt) : "";
      if (entry.pushedAt && !pushedAt) return null;
      const normalized = {
        mode,
        commits,
        pushedAt,
        limited: entry.limited === true || entry.deferred === true,
        deferred: entry.deferred === true,
      };
      if (mode === AUTHOR_MODE || legacy) {
        return { ...normalized, etag: typeof entry.etag === "string" ? entry.etag : "" };
      }
      if (
        !Array.isArray(entry.pages) ||
        entry.pages.length > MAX_FALLBACK_PAGES ||
        (entry.pages.length === 0 && !normalized.deferred)
      ) {
        return null;
      }
      const pages = [];
      for (const [index, page] of entry.pages.entries()) {
        const pageCommits = normalizeCachedCommits(page?.commits, repository);
        if (page?.page !== index + 1 || typeof page.hasNext !== "boolean" || !pageCommits) {
          return null;
        }
        pages.push({
          page: page.page,
          etag: typeof page.etag === "string" ? page.etag : "",
          hasNext: page.hasNext,
          commits: pageCommits,
        });
      }
      return { ...normalized, pages };
    }

    function migrateLegacyCache(config, storageKey, storage, now) {
      const legacyKeys = getLegacyStorageKeys(config.owner, config.limit);
      for (const key of legacyKeys) {
        const cached = readCache(key, config.repositories, storage, now, true);
        if (!cached) continue;
        // Preserve displayable data, but verify every migrated request once.
        const repositories = Object.fromEntries(
          Object.entries(cached.repositories).map(([name, entry]) => [
            name, {
              ...entry,
              etag: "",
              pushedAt: "",
              ...(entry.mode === LINKED_AUTHOR_MODE
                ? { pages: [], limited: true, deferred: true }
                : {}),
            },
          ])
        );
        const replacement = {
          fetchedAt: 0,
          items: mergeCommits(repositories, config.limit),
          repoNames: cached.repoNames,
          excludedRepoNames: [],
          repositories,
        };
        if (writeCache(storageKey, replacement, storage)) {
          for (const legacyKey of legacyKeys) shared.removeStorageItem(storage, legacyKey);
        }
        return {
          ...cached, ...replacement, isFresh: false,
          complete: config.repositories.every(({ name }) => repositories[name]),
        };
      }
      return null;
    }

    function writeCache(storageKey, cache, storage) {
      return shared.writeStoredJson(storage, storageKey, cache);
    }

    function hasRecentFailure(failureKey, storage, now) {
      return shared.hasRecentFailure(failureKey, storage, now);
    }

    function writeFailure(failureKey, storage, now) {
      shared.writeFailure(failureKey, storage, now);
    }

    return {
      AUTHOR_MODE,
      CACHE_TTL_MS: shared.CACHE_TTL_MS,
      FAILURE_TTL_MS: shared.FAILURE_TTL_MS,
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
      readCachedHistory,
      renderCommits,
      renderStatus,
      selectRepositoriesToFetch,
      writeCache,
      writeFailure,
    };
  })();

  const controller = (() => {
    const OBSERVER_MARGIN = "800px 0px";

    function readPageConfiguration(documentImpl) {
      const element = documentImpl?.querySelector?.("[data-github-activity-config]");
      if (!element) return null;
      try {
        const value = JSON.parse(element.textContent);
        const owner = typeof value?.owner === "string" ? value.owner.trim() : "";
        const repositories = recentCommits.normalizeRepositories(value?.repositories);
        const repositoryUpdates = value?.repositoryUpdates;
        const commitLimit = value?.commitLimit;
        const milestoneLimit = value?.milestones?.limit;
        const milestoneRepositories = value?.milestones
          ? recentMilestones.normalizeRepositories(value.milestones.repositories)
          : null;
        const commitsEnabled = commitLimit !== null && commitLimit !== undefined;
        const milestonesEnabled = value?.milestones !== null && value?.milestones !== undefined;

        if (!owner || !repositories || typeof repositoryUpdates !== "boolean") {
          return null;
        }
        if (
          commitsEnabled &&
          (!Number.isInteger(commitLimit) || commitLimit < 1 || commitLimit > 10)
        ) {
          return null;
        }
        if (
          milestonesEnabled &&
          (!Number.isInteger(milestoneLimit) ||
            milestoneLimit < 1 ||
            milestoneLimit > 10 ||
            !milestoneRepositories)
        ) {
          return null;
        }
        return {
          commits: commitsEnabled
            ? { limit: commitLimit, owner, repositories }
            : null,
          milestones: milestonesEnabled
            ? { limit: milestoneLimit, owner, repositories: milestoneRepositories }
            : null,
          owner,
          repositoryUpdates,
          repositories,
        };
      } catch {
        return null;
      }
    }

    function scheduleNearViewport(target, task, observerFactory = null) {
      let started = false;
      const startOnce = () => {
        if (started) return;
        started = true;
        void task();
      };

      if (!target || typeof observerFactory !== "function") {
        startOnce();
        return { disconnect() {}, start: startOnce };
      }

      let observer;
      try {
        observer = observerFactory((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect?.();
          startOnce();
        }, { rootMargin: OBSERVER_MARGIN });
        observer.observe(target);
      } catch {
        startOnce();
      }
      return {
        disconnect() {
          observer?.disconnect?.();
        },
        start: startOnce,
      };
    }

    function createController({
      documentImpl = typeof document === "undefined" ? null : document,
      windowImpl = typeof window === "undefined" ? null : window,
      fetchImpl = shared.getFetch(),
      storage = shared.getStorage(),
      logger = console,
      now = () => Date.now(),
      observerFactory = null,
      locks = null,
      refreshTimeoutMs = shared.SECTION_TIMEOUT_MS,
    } = {}) {
      const config = readPageConfiguration(documentImpl);
      if (!config) {
        return { destroy() {}, start() { return false; } };
      }

      const effectiveObserverFactory = observerFactory ||
        (typeof windowImpl?.IntersectionObserver === "function"
          ? (callback, options) => new windowImpl.IntersectionObserver(callback, options)
          : null);
      const effectiveLocks = locks || windowImpl?.navigator?.locks || null;
      const coordinator = shared.createRequestCoordinator({
        fetchImpl,
        owner: config.owner,
        storage,
        now,
      });
      const schedules = [];
      const storageCallbacks = new Map();
      let cataloguePromise = null;
      let catalogueResult = null;
      let started = false;

      async function getCatalogue(force = false) {
        if (catalogueResult && (!force || catalogueResult.validated)) {
          return catalogueResult;
        }
        if (cataloguePromise) return cataloguePromise;
        cataloguePromise = repositoryUpdates.loadRepositoryCatalogue(config.owner, {
          fetchImpl: coordinator.fetch,
          force,
          logger,
          now: now(),
          storage,
          refreshTimeoutMs,
        });
        try {
          catalogueResult = await cataloguePromise;
          return catalogueResult;
        } finally {
          cataloguePromise = null;
        }
      }

      function lockName(resource) {
        return `github-activity:${config.owner.toLowerCase()}:${resource}`;
      }

      function runLocked(resource, task) {
        return shared.withResourceLock(lockName(resource), task, effectiveLocks);
      }

      function registerStorageRefresh(key, callback) {
        storageCallbacks.set(key, callback);
      }

      function onStorage(event) {
        const callback = storageCallbacks.get(event?.key);
        if (callback && event.newValue !== null) void callback();
      }

      function startRepositoryUpdates() {
        const cards = Array.from(
          documentImpl.querySelectorAll(".repo-card[data-repo-owner][data-repo-name]")
        );
        const groups = repositoryUpdates.groupCardsByOwner(cards);
        const ownerCards = groups.get(config.owner) || [];
        if (ownerCards.length === 0) return;
        const renderCached = () => {
          const cached = repositoryUpdates.readCache(
            repositoryUpdates.getStorageKey(config.owner), storage, now(), config.owner
          );
          if (!cached) return false;
          repositoryUpdates.renderOwnerCards(ownerCards, cached.repositories, "Last updated unavailable");
          return true;
        };
        renderCached();
        const load = () =>
          runLocked("repositories", () =>
            repositoryUpdates.loadOwnerUpdates(config.owner, ownerCards, {
              fetchImpl: coordinator.fetch,
              loadCatalogueImpl: getCatalogue,
              logger,
              now: now(),
              storage,
            })
          );
        void load();
        registerStorageRefresh(repositoryUpdates.getStorageKey(config.owner), renderCached);
      }

      function startCommits() {
        if (!config.commits) return;
        const containers = Array.from(
          documentImpl.querySelectorAll("[data-commit-history]")
        );
        for (const container of containers) {
          const section = container.closest?.('[data-home-section="recent_commits"]');
          section?.removeAttribute("hidden");
          let hasLoaded = false;
          const renderCached = () => {
            const cached = recentCommits.readCachedHistory(config.commits, storage, now());
            if (!cached) return false;
            const commits = recentCommits.mergeCommits(cached.repositories, config.commits.limit);
            if (!cached.complete && commits.length === 0) return false;
            return recentCommits.renderCommits(container, commits, config.commits.limit);
          };
          const load = () => {
            hasLoaded = true;
            renderCached();
            return runLocked("commits", () =>
              recentCommits.loadCommitHistory(container, {
                config: config.commits,
                fetchImpl: coordinator.fetch,
                getCatalogueImpl: getCatalogue,
                logger,
                now: now(),
                storage,
                refreshTimeoutMs,
              })
            );
          };
          schedules.push(scheduleNearViewport(container, load, effectiveObserverFactory));
          registerStorageRefresh(
            recentCommits.getStorageKey(config.owner, config.commits.limit),
            () => hasLoaded && renderCached()
          );
        }
      }

      function startMilestones() {
        if (!config.milestones) return;
        const containers = Array.from(
          documentImpl.querySelectorAll("[data-recent-milestones]")
        );
        for (const container of containers) {
          const section = container.closest?.('[data-home-section="recent_milestones"]');
          section?.removeAttribute("hidden");
          let hasLoaded = false;
          const renderCachedOpenMilestones = () => {
            const cached = recentMilestones.readCache(
              recentMilestones.getStorageKey(config.owner, config.milestones.limit),
              config.milestones.repositories,
              storage,
              now()
            );
            if (!cached) return false;
            const milestones = recentMilestones.mergeMilestones(
              cached.repositories,
              config.milestones.repositories,
              config.milestones.limit
            );
            if (!cached.complete && milestones.length === 0) return false;
            return recentMilestones.renderMilestones(
              container,
              milestones,
              config.milestones.limit,
              config.owner
            );
          };
          const renderCachedCompletedMilestones = () => {
            const cached = completedMilestones.readCache(
              completedMilestones.getStorageKey(config.owner),
              config.milestones.repositories,
              storage,
              now()
            );
            if (!cached) return false;
            const milestones = completedMilestones.mergeCompletedMilestones(
              cached.repositories,
              config.milestones.repositories
            );
            if (!cached.complete && milestones.length === 0) return false;
            return completedMilestones.renderCompletedMilestones(
              container,
              milestones,
              config.owner
            );
          };
          const loadOpenMilestones = () =>
            recentMilestones.loadRecentMilestones(container, {
              config: config.milestones,
              fetchImpl: coordinator.fetch,
              logger,
              now: now(),
              storage,
              refreshTimeoutMs,
            });
          const loadCompletedMilestones = () =>
            completedMilestones.loadCompletedMilestones(container, {
              config: config.milestones,
              fetchImpl: coordinator.fetch,
              logger,
              now: now(),
              storage,
              refreshTimeoutMs,
            });
          const load = () => {
            hasLoaded = true;
            // Cached content must not wait for another tab's network refresh.
            renderCachedOpenMilestones();
            renderCachedCompletedMilestones();
            return runLocked("milestones", async () => {
              const [openResult] = await Promise.all([
                loadOpenMilestones(),
                loadCompletedMilestones(),
              ]);
              return openResult;
            });
          };
          const refresh = (renderer) => hasLoaded && renderer();
          schedules.push(
            scheduleNearViewport(
              container,
              load,
              effectiveObserverFactory
            )
          );
          registerStorageRefresh(
            recentMilestones.getStorageKey(config.owner, config.milestones.limit),
            () => refresh(renderCachedOpenMilestones)
          );
          registerStorageRefresh(
            completedMilestones.getStorageKey(config.owner),
            () => refresh(renderCachedCompletedMilestones)
          );
        }
      }

      function start() {
        if (started) return true;
        started = true;
        if (config.repositoryUpdates) startRepositoryUpdates();
        startMilestones();
        startCommits();
        windowImpl?.addEventListener?.("storage", onStorage);
        return true;
      }

      function destroy() {
        for (const schedule of schedules) schedule.disconnect();
        schedules.length = 0;
        windowImpl?.removeEventListener?.("storage", onStorage);
      }

      return { destroy, getCatalogue, start };
    }

    function start() {
      return createController().start();
    }

    return {
      OBSERVER_MARGIN,
      createController,
      readPageConfiguration,
      scheduleNearViewport,
      start,
    };
  })();

  const exports = {
    completedMilestones,
    controller,
    recentCommits,
    recentMilestones,
    repositoryUpdates,
    shared,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exports;
  } else {
    controller.start();
  }
})();
