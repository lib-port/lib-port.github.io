(() => {
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
      fetchImpl = getFetch(),
      storage = getStorage(),
      now = Date.now(),
      logger = console,
    } = {}
  ) {
    const config = readConfiguration(container);
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

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
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
      writeCache,
      writeFailure,
    };
  } else {
    start();
  }
})();
