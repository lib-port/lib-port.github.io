(() => {
  const recentMilestones = (() => {
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
  const MAX_MILESTONES = 10;
  const PER_PAGE = 100;
  const MAX_PAGES = 100;
  const API_BASE_URL = "https://api.github.com";
  const API_VERSION = "2026-03-10";
  const DUE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
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

    if (!renderStatus(container, "loading")) {
      logger.error("Failed to load recent GitHub milestones: invalid page markup");
      return false;
    }

    container.setAttribute("aria-busy", "true");

    try {
      const result = await loadRepositories(
        config,
        cached?.repositories || {},
        fetchImpl
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
        writeFailure(failureKey, storage, now);
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
      writeFailure(failureKey, storage, now);
      logger.error("Failed to load recent GitHub milestones", error);
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
    const repositories = {};
    const errors = [];

    for (const repository of config.repositories) {
      if (cachedRepositories[repository]) {
        repositories[repository] = cachedRepositories[repository];
      }
    }

    for (const repository of config.repositories) {
      try {
        repositories[repository] = await fetchRepositoryClosedIssueActivity(
          config.owner,
          repository,
          config.limit,
          cachedRepositories[repository],
          fetchImpl
        );
      } catch (error) {
        errors.push(error);
      }
    }

    return {
      allSuccessful: errors.length === 0,
      errors,
      repositories,
    };
  }

  async function fetchRepositoryClosedIssueActivity(
    owner,
    repository,
    limit,
    cachedEntry,
    fetchImpl
  ) {
    const cachedPages = new Map(
      (cachedEntry?.pages || []).map((page) => [page.page, page])
    );
    const pages = [];
    const milestonesByNumber = new Map();

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const cachedPage = cachedPages.get(pageNumber);
      const headers = buildHeaders(cachedPage?.etag);
      const response = await fetchImpl(
        buildClosedIssueActivityUrl(owner, repository, pageNumber),
        { headers }
      );

      let etag;
      let hasNext;
      let itemCount;
      let milestones;
      let oldestUpdatedAt;

      if (response.status === 304 && cachedPage) {
        etag = cachedPage.etag;
        itemCount = cachedPage.itemCount;
        milestones = cachedPage.milestones;
        oldestUpdatedAt = cachedPage.oldestUpdatedAt;
        const linkHeader = getHeader(response, "link");
        hasNext = linkHeader
          ? hasNextPage(linkHeader)
          : cachedPage.hasNext;
      } else {
        if (!response.ok) {
          throw new Error(
            `GitHub API returned ${response.status} for ${repository} issues page ${pageNumber}`
          );
        }

        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new Error(
            `GitHub API returned malformed issue data for ${repository}`
          );
        }

        etag = getHeader(response, "etag");
        itemCount = payload.length;
        milestones = normalizeClosedIssueActivity(payload, repository);
        oldestUpdatedAt = findOldestUpdatedAt(payload);
        if (itemCount > 0 && !oldestUpdatedAt) {
          throw new Error(
            `GitHub API returned malformed issue update data for ${repository}`
          );
        }
        hasNext = hasNextPage(getHeader(response, "link"));
      }

      pages.push({
        page: pageNumber,
        etag,
        hasNext,
        itemCount,
        oldestUpdatedAt,
        milestones,
      });

      for (const milestone of milestones) {
        const current = milestonesByNumber.get(milestone.number);
        if (!current || isNewerMilestoneCandidate(milestone, current)) {
          milestonesByNumber.set(milestone.number, milestone);
        }
      }

      if (
        !hasNext ||
        canStopClosedIssuePagination(
          milestonesByNumber,
          limit,
          oldestUpdatedAt
        )
      ) {
        return { pages };
      }
    }

    throw new Error(`GitHub issue pagination exceeded ${MAX_PAGES} pages`);
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

      for (const page of entry.pages) {
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
    return `recent-milestones:v4:${owner.toLowerCase()}:limit:${limit}`;
  }

  function getFailureKey(owner, repositories, limit) {
    const repoKey = repositories
      .map((repository) => repository.toLowerCase())
      .slice()
      .sort()
      .join(",");
    return `recent-milestones:v4:failure:${owner.toLowerCase()}:limit:${limit}:${repoKey}`;
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

  function readCache(storageKey, repositories, storage, now) {
    const cached = readStoredObject(storage, storageKey);
    if (!cached) return null;

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
      const normalized = normalizeCachedEntry(entry, repository);
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
        now - cached.fetchedAt < CACHE_TTL_MS,
      repositories: normalizedRepositories,
    };
  }

  function normalizeCachedEntry(entry, repository) {
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
        page.page > MAX_PAGES ||
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

    if (pages.length === 0) return null;
    pages.sort((left, right) => left.page - right.page);
    return { pages };
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
    const REQUEST_TIMEOUT_MS = 15 * 1000;
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
        now - failure.failedAt >= FAILURE_TTL_MS
      ) {
        removeStorageItem(storage, key);
        return false;
      }
      return true;
    }

    function writeFailure(key, storage, now, kind = "resource") {
      writeStoredJson(storage, key, { failedAt: now, kind });
    }

    function getGlobalFailureKey(owner) {
      return `github-activity:v1:failure:global:${owner.toLowerCase()}`;
    }

    function createTimeoutError(timeoutMs) {
      const error = new Error(`GitHub request timed out after ${timeoutMs} ms`);
      error.name = "TimeoutError";
      return error;
    }

    function createBufferedResponse(response, payload) {
      const buffered = {
        headers: response.headers,
        ok: response.ok,
        redirected: response.redirected,
        status: response.status,
        statusText: response.statusText,
        type: response.type,
        url: response.url,
        async json() {
          return payload;
        },
      };
      buffered.clone = () => createBufferedResponse(response, payload);
      return buffered;
    }

    function createRequestCoordinator({
      owner,
      fetchImpl = getFetch(),
      storage = getStorage(),
      now = () => Date.now(),
      maxConcurrent = 4,
      requestTimeoutMs = REQUEST_TIMEOUT_MS,
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

      async function fetchWithTimeout(url, options) {
        const callerSignal = options?.signal;
        const controller =
          typeof AbortController === "function" ? new AbortController() : null;
        const requestOptions = { ...options };
        let callerAbortHandler = null;
        let timeoutId = null;

        if (controller) {
          callerAbortHandler = () => controller.abort(callerSignal?.reason);
          if (callerSignal?.aborted) {
            callerAbortHandler();
          } else {
            callerSignal?.addEventListener?.("abort", callerAbortHandler, {
              once: true,
            });
          }
          requestOptions.signal = controller.signal;
        }

        const operation = Promise.resolve().then(async () => {
          const response = await fetchImpl(url, requestOptions);
          if (!response?.ok) return response;
          if (typeof response.json !== "function") {
            throw new Error("GitHub API returned a response without a JSON body");
          }
          const payload = await response.json();
          return createBufferedResponse(response, payload);
        });
        const timeout = new Promise((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            const error = createTimeoutError(effectiveRequestTimeoutMs);
            reject(error);
            controller?.abort(error);
          }, effectiveRequestTimeoutMs);
        });

        try {
          return await Promise.race([operation, timeout]);
        } finally {
          if (timeoutId !== null) clearTimeout(timeoutId);
          if (callerAbortHandler) {
            callerSignal?.removeEventListener?.("abort", callerAbortHandler);
          }
        }
      }

      async function run({ url, options, resolve, reject }) {
        const failureKey = getGlobalFailureKey(owner);
        try {
          if (hasRecentFailure(failureKey, storage, now())) {
            throw new Error("GitHub requests are temporarily paused");
          }
          if (typeof fetchImpl !== "function") {
            writeFailure(failureKey, storage, now(), "unavailable");
            throw new Error("Fetch API unavailable");
          }

          const response = await fetchWithTimeout(url, options);
          if (response?.status === 403 || response?.status === 429) {
            writeFailure(failureKey, storage, now(), "rate-limit");
          } else if (response?.ok || response?.status === 304) {
            removeStorageItem(storage, failureKey);
          }
          resolve(response);
        } catch (error) {
          if (!hasRecentFailure(failureKey, storage, now())) {
            writeFailure(
              failureKey,
              storage,
              now(),
              error?.name === "TimeoutError" ? "timeout" : "network"
            );
          }
          reject(error);
        } finally {
          active -= 1;
          drain();
        }
      }

      function enqueue(url, options) {
        return new Promise((resolve, reject) => {
          queue.push({ url, options, resolve, reject });
          drain();
        });
      }

      async function fetchCoordinated(url, options = {}) {
        const key = requestKey(url, options);
        let request = inFlight.get(key);
        if (!request) {
          request = enqueue(url, options);
          inFlight.set(key, request);
          void request.finally(() => inFlight.delete(key)).catch(() => {});
        }
        const response = await request;
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
      REQUEST_TIMEOUT_MS,
      buildHeaders,
      createRequestCoordinator,
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

  const repositoryUpdates = (() => {
    const FALLBACK_LOADING_TEXT = "Checking for updates...";
    const FALLBACK_UNAVAILABLE_TEXT = "Last updated unavailable";
    const DAY_MS = 24 * 60 * 60 * 1000;
    const REPO_QUERY = "per_page=100&sort=pushed&direction=desc&type=public";
    const DATE_FORMATTERS = {
      withYear: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      withoutYear: new Intl.DateTimeFormat("en-US", {
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
        repositories,
      };
    }

    function writeCache(storageKey, { etag, repositories }, storage, now) {
      return shared.writeStoredJson(storage, storageKey, {
        etag,
        fetchedAt: now,
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

      try {
        const response = await fetchImpl(getOwnerRepoListUrl(owner), {
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
          throw new Error(`GitHub API returned ${response.status}`);
        }
        const repositories = normalizeRepositoryCatalogue(await response.json());
        if (!repositories) {
          throw new Error("GitHub API returned malformed repository data");
        }
        const result = {
          etag: shared.getHeader(response, "etag"),
          fetchedAt: now,
          isFresh: true,
          legacy: false,
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
        shared.writeFailure(failureKey, storage, now);
        logger.error(`Failed to load repository data for ${owner}`, error);
        return cached
          ? { ...cached, successful: false, validated: false }
          : { repositories: null, successful: false, validated: false };
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
      let cached = readCache(storageKey, config.repositories, storage, now);
      if (!cached) {
        cached = migrateLegacyCache(config, storageKey, storage, now);
      }
      const cachedCommits = cached
        ? mergeCommits(cached.repositories, config.limit)
        : [];
      const hasCachedResult = Boolean(cached?.complete || cachedCommits.length > 0);

      if (cached?.isFresh) {
        return renderCommits(container, cachedCommits, config.limit);
      }
      if (
        hasRecentFailure(failureKey, storage, now) ||
        hasRecentFailure(getLegacyFailureKey(config.owner, config.limit), storage, now)
      ) {
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
      if (!renderStatus(container, "loading")) {
        renderStatus(container, "error");
        logger.error("Failed to load recent GitHub commits: invalid page markup");
        return false;
      }

      container.setAttribute("aria-busy", "true");
      try {
        let catalogue = null;
        if (typeof getCatalogueImpl === "function") {
          try {
            catalogue = await getCatalogueImpl(Boolean(cached));
          } catch (error) {
            logger.error("Failed to validate the GitHub repository catalogue", error);
          }
        }

        const repositories = filterEligibleRepositories(
          config.repositories,
          catalogue?.validated ? catalogue.repositories : null
        );
        const activeConfig = { ...config, repositories };
        let mode = cached?.mode || AUTHOR_MODE;
        const cachedRepositories = selectCachedRepositories(
          cached?.mode === mode ? cached.repositories : {},
          repositories
        );
        const repositoriesToFetch = selectRepositoriesToFetch(
          repositories,
          cachedRepositories,
          catalogue
        );

        let result = await loadRepositories(
          activeConfig,
          mode,
          cachedRepositories,
          fetchImpl,
          repositoriesToFetch,
          catalogue?.repositories || {}
        );

        if (
          mode === AUTHOR_MODE &&
          result.allSuccessful &&
          mergeCommits(result.repositories, config.limit).length === 0
        ) {
          mode = LINKED_AUTHOR_MODE;
          result = await loadRepositories(
            activeConfig,
            mode,
            {},
            fetchImpl,
            repositories,
            catalogue?.repositories || {}
          );
        }

        const commits = mergeCommits(result.repositories, config.limit);
        const shouldPreserveCachedResult =
          !result.allSuccessful && commits.length === 0 && hasCachedResult;

        if (!shouldPreserveCachedResult) {
          const cache = {
            fetchedAt: result.allSuccessful ? now : cached?.fetchedAt || 0,
            items: commits,
            mode,
            repoNames: repositories.map(({ name }) => name),
            repositories: result.repositories,
          };
          writeCache(storageKey, cache, storage);
          shared.removeStorageItem(storage, getLegacyStorageKey(config.owner, config.limit));
        }

        if (result.allSuccessful) {
          shared.removeStorageItem(storage, failureKey);
          shared.removeStorageItem(storage, getLegacyFailureKey(config.owner, config.limit));
        } else {
          writeFailure(failureKey, storage, now);
          for (const error of result.errors) {
            logger.error("Failed to load recent GitHub commits", error);
          }
        }

        if (result.allSuccessful || commits.length > 0) {
          return renderCommits(container, commits, config.limit);
        }
        if (hasCachedResult) return renderCommits(container, cachedCommits, config.limit);
        renderStatus(container, "error");
        return false;
      } catch (error) {
        writeFailure(failureKey, storage, now);
        logger.error("Failed to load recent GitHub commits", error);
        if (hasCachedResult) return renderCommits(container, cachedCommits, config.limit);
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
      if (!catalogue) return repositories;
      return repositories.filter((repository) => {
        const current = catalogue[repository.name];
        return !current || (!current.archived && !current.fork);
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
          cached.pushedAt !== current.pushedAt
        );
      });
    }

    async function loadRepositories(
      config,
      mode,
      cachedRepositories,
      fetchImpl,
      repositoriesToFetch = config.repositories,
      catalogue = {}
    ) {
      const results = await Promise.all(
        repositoriesToFetch.map(async (repository) => {
          try {
            const cachedEntry = cachedRepositories[repository.name];
            const entry = await fetchRepositoryCommits(
              repository,
              config.owner,
              config.limit,
              mode,
              cachedEntry,
              fetchImpl
            );
            return {
              entry: {
                ...entry,
                pushedAt:
                  catalogue[repository.name]?.pushedAt ||
                  cachedEntry?.pushedAt ||
                  "",
              },
              name: repository.name,
            };
          } catch (error) {
            return { error, name: repository.name };
          }
        })
      );

      const repositories = { ...cachedRepositories };
      const errors = [];
      for (const result of results) {
        if (result.entry) repositories[result.name] = result.entry;
        else errors.push(result.error);
      }
      return { allSuccessful: errors.length === 0, errors, repositories };
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
      const response = await fetchImpl(
        buildCommitListUrl(repository.name, owner, limit, AUTHOR_MODE),
        { headers: shared.buildHeaders(cachedEntry?.etag) }
      );
      if (response.status === 304 && cachedEntry) return cachedEntry;
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status} for ${repository.name}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error(`GitHub API returned malformed commit data for ${repository.name}`);
      }
      return {
        etag: shared.getHeader(response, "etag"),
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
        const response = await fetchImpl(
          buildCommitListUrl(repository.name, owner, limit, LINKED_AUTHOR_MODE, page),
          { headers: shared.buildHeaders(page === 1 ? cachedEntry?.etag : "") }
        );
        if (page === 1 && response.status === 304 && cachedEntry) return cachedEntry;
        if (!response.ok) {
          throw new Error(`GitHub API returned ${response.status} for ${repository.name}`);
        }
        if (page === 1) etag = shared.getHeader(response, "etag");
        const payload = await response.json();
        if (!Array.isArray(payload)) {
          throw new Error(`GitHub API returned malformed commit data for ${repository.name}`);
        }
        for (const commit of normalizeApiCommits(payload, repository, owner, limit)) {
          if (seen.has(commit.sha)) continue;
          seen.add(commit.sha);
          commits.push(commit);
          if (commits.length === limit) break;
        }
        if (
          commits.length === limit ||
          !hasNextPage(shared.getHeader(response, "link"))
        ) {
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
      for (const element of Object.values(statuses)) element?.setAttribute("hidden", "");
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
      url.searchParams.set("per_page", String(limit));
      if (page > 1) url.searchParams.set("page", String(page));
      return url.href;
    }

    function hasNextPage(linkHeader) {
      return typeof linkHeader === "string" && /;\s*rel="next"/.test(linkHeader);
    }

    function getStorageKey(owner, limit) {
      return `github-activity:v1:${owner.toLowerCase()}:commits:limit:${limit}`;
    }

    function getFailureKey(owner, limit) {
      return `github-activity:v1:failure:${owner.toLowerCase()}:commits:limit:${limit}`;
    }

    function getLegacyStorageKey(owner, limit) {
      return `commit-history:v1:${owner.toLowerCase()}:limit:${limit}`;
    }

    function getLegacyFailureKey(owner, limit) {
      return `commit-history:v1:failure:${owner.toLowerCase()}:limit:${limit}`;
    }

    function readCache(storageKey, repositories, storage, now) {
      const cached = shared.readStoredObject(storage, storageKey);
      if (!cached) return null;
      if (
        !shared.isValidStoredTime(cached.fetchedAt, now) ||
        ![AUTHOR_MODE, LINKED_AUTHOR_MODE].includes(cached.mode) ||
        !Array.isArray(cached.repoNames) ||
        !cached.repositories ||
        typeof cached.repositories !== "object" ||
        Array.isArray(cached.repositories)
      ) {
        shared.removeStorageItem(storage, storageKey);
        return null;
      }
      const currentByName = new Map(repositories.map((repo) => [repo.name, repo]));
      const normalizedRepositories = {};
      for (const [name, entry] of Object.entries(cached.repositories)) {
        const repository = currentByName.get(name);
        if (!repository) continue;
        const normalized = normalizeCachedEntry(entry, repository);
        if (!normalized) {
          shared.removeStorageItem(storage, storageKey);
          return null;
        }
        normalizedRepositories[name] = normalized;
      }
      if (cached.repoNames.some((name) => typeof name !== "string")) {
        shared.removeStorageItem(storage, storageKey);
        return null;
      }
      const currentNames = repositories.map(({ name }) => name).sort();
      const cachedNames = cached.repoNames.slice().sort();
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
          now - cached.fetchedAt < shared.CACHE_TTL_MS,
        mode: cached.mode,
        repoNames: cached.repoNames.slice(),
        repositories: normalizedRepositories,
      };
    }

    function normalizeCachedEntry(entry, repository) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.commits)) return null;
      const commits = [];
      for (const value of entry.commits.slice(0, MAX_RECENT_COMMITS)) {
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
      const pushedAt = entry.pushedAt ? shared.normalizeDate(entry.pushedAt) : "";
      if (entry.pushedAt && !pushedAt) return null;
      return {
        etag: typeof entry.etag === "string" ? entry.etag : "",
        commits,
        pushedAt,
      };
    }

    function migrateLegacyCache(config, storageKey, storage, now) {
      const legacyKey = getLegacyStorageKey(config.owner, config.limit);
      const cached = readCache(legacyKey, config.repositories, storage, now);
      if (!cached) return null;
      const replacement = {
        fetchedAt: cached.fetchedAt,
        items: mergeCommits(cached.repositories, config.limit),
        mode: cached.mode,
        repoNames: cached.repoNames,
        repositories: cached.repositories,
      };
      if (writeCache(storageKey, replacement, storage)) {
        shared.removeStorageItem(storage, legacyKey);
      }
      return cached;
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
        const load = (cacheOnly = false) =>
          runLocked("repositories", () =>
            repositoryUpdates.loadOwnerUpdates(config.owner, ownerCards, {
              fetchImpl: cacheOnly ? null : coordinator.fetch,
              loadCatalogueImpl: cacheOnly ? null : getCatalogue,
              logger,
              now: now(),
              storage,
            })
          );
        void load(false);
        registerStorageRefresh(repositoryUpdates.getStorageKey(config.owner), () => load(true));
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
          const load = (cacheOnly = false) => {
            hasLoaded = true;
            return runLocked("commits", () =>
              recentCommits.loadCommitHistory(container, {
                config: config.commits,
                fetchImpl: cacheOnly ? null : coordinator.fetch,
                getCatalogueImpl: cacheOnly ? null : getCatalogue,
                logger,
                now: now(),
                storage,
              })
            );
          };
          schedules.push(scheduleNearViewport(container, () => load(false), effectiveObserverFactory));
          registerStorageRefresh(
            recentCommits.getStorageKey(config.owner, config.commits.limit),
            () => (hasLoaded ? load(true) : Promise.resolve())
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
          const load = (cacheOnly = false) => {
            hasLoaded = true;
            return runLocked("milestones", () =>
              recentMilestones.loadRecentMilestones(container, {
                config: config.milestones,
                fetchImpl: cacheOnly ? null : coordinator.fetch,
                logger,
                now: now(),
                storage,
              })
            );
          };
          schedules.push(scheduleNearViewport(container, () => load(false), effectiveObserverFactory));
          registerStorageRefresh(
            recentMilestones.getStorageKey(config.owner, config.milestones.limit),
            () => (hasLoaded ? load(true) : Promise.resolve())
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
