(() => {
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const STALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FAILURE_TTL_MS = 30 * 60 * 1000;
  const FALLBACK_LOADING_TEXT = "Checking for updates...";
  const FALLBACK_UNAVAILABLE_TEXT = "Last updated unavailable";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
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

  const cards = Array.from(
    document.querySelectorAll(".repo-card[data-repo-owner][data-repo-name]")
  );
  if (cards.length === 0) return;

  const cardsByOwner = groupCardsByOwner(cards);

  for (const [owner, ownerCards] of cardsByOwner) {
    loadOwnerUpdates(owner, ownerCards);
  }

  async function loadOwnerUpdates(owner, ownerCards) {
    const storageKey = getStorageKey(owner);
    const failureKey = getFailureKey(owner);
    const cached = readCache(storageKey);

    renderOwnerCards(ownerCards, cached?.repos || null, {
      missingText: FALLBACK_LOADING_TEXT,
    });

    if (cached?.isFresh) {
      return;
    }

    if (hasRecentFailure(failureKey)) {
      if (!cached?.repos) {
        renderOwnerCards(ownerCards, null, {
          missingText: FALLBACK_UNAVAILABLE_TEXT,
        });
      }
      return;
    }

    try {
      const headers = {
        Accept: "application/vnd.github+json",
      };

      if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
      }

      const response = await fetch(getOwnerRepoListUrl(owner), { headers });

      if (response.status === 304 && cached?.repos) {
        touchCache(storageKey, cached);
        clearFailure(failureKey);
        return;
      }

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const repos = normalizeRepoTimestamps(await response.json());

      writeCache(storageKey, {
        etag: response.headers.get("etag") || "",
        repos,
      });
      clearFailure(failureKey);
      renderOwnerCards(ownerCards, repos, {
        missingText: FALLBACK_UNAVAILABLE_TEXT,
      });
    } catch (error) {
      writeFailure(failureKey);
      if (!cached?.repos) {
        renderOwnerCards(ownerCards, null, {
          missingText: FALLBACK_UNAVAILABLE_TEXT,
        });
      }
      console.error(`Failed to load updated dates for ${owner}`, error);
    }
  }

  function groupCardsByOwner(cards) {
    const groups = new Map();

    for (const card of cards) {
      const owner = card.dataset.repoOwner?.trim();
      const repoName = card.dataset.repoName?.trim();
      const wrapper = card.querySelector(".repo-updated");
      const textNode = card.querySelector(".repo-updated-text");

      if (!owner || !repoName || !wrapper || !textNode) {
        continue;
      }

      const group = groups.get(owner) || [];
      group.push({ card, repoName, wrapper, textNode });
      groups.set(owner, group);
    }

    return groups;
  }

  function renderOwnerCards(ownerCards, repos, { missingText }) {
    for (const { repoName, wrapper, textNode } of ownerCards) {
      wrapper.classList.add("is-visible");

      const pushedAt = repos?.[repoName];
      const formatted = pushedAt ? formatPushedAt(pushedAt) : "";
      textNode.textContent = formatted || missingText;
    }
  }

  function normalizeRepoTimestamps(repos) {
    if (!Array.isArray(repos)) {
      return {};
    }

    const normalized = {};

    for (const repo of repos) {
      if (!repo || typeof repo !== "object") continue;

      const name = typeof repo.name === "string" ? repo.name.trim() : "";
      const pushedAt = getRepoPushedAt(repo);

      if (!name || !pushedAt) continue;
      normalized[name] = pushedAt;
    }

    return normalized;
  }

  function getRepoPushedAt(repo) {
    if (typeof repo.pushed_at === "string" && repo.pushed_at) {
      return repo.pushed_at;
    }

    if (typeof repo.updated_at === "string" && repo.updated_at) {
      return repo.updated_at;
    }

    return "";
  }

  function getOwnerRepoListUrl(owner) {
    const params = new URLSearchParams({
      per_page: "100",
      sort: "pushed",
      direction: "desc",
      type: "public",
    });

    return `https://api.github.com/users/${encodeURIComponent(owner)}/repos?${params.toString()}`;
  }

  function getStorageKey(owner) {
    return `repo-updates:v2:owner:${owner}`;
  }

  function getFailureKey(owner) {
    return `repo-updates:v2:failure:owner:${owner}`;
  }

  function readCache(storageKey) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      const fetchedAt = Number(parsed?.fetchedAt);
      const etag = typeof parsed?.etag === "string" ? parsed.etag : "";
      const repos = isRepoMap(parsed?.repos) ? parsed.repos : null;

      if (!Number.isFinite(fetchedAt) || !repos) {
        return null;
      }

      const ageMs = Date.now() - fetchedAt;
      if (ageMs > STALE_CACHE_TTL_MS) {
        localStorage.removeItem(storageKey);
        return null;
      }

      return {
        etag,
        fetchedAt,
        repos,
        isFresh: ageMs <= CACHE_TTL_MS,
      };
    } catch {
      return null;
    }
  }

  function isRepoMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }

    return Object.values(value).every(
      (repoTimestamp) => typeof repoTimestamp === "string" && Boolean(repoTimestamp)
    );
  }

  function writeCache(storageKey, { etag, repos }) {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          etag,
          repos,
          fetchedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function touchCache(storageKey, cached) {
    writeCache(storageKey, {
      etag: cached.etag,
      repos: cached.repos,
    });
  }

  function hasRecentFailure(failureKey) {
    try {
      const raw = localStorage.getItem(failureKey);
      if (!raw) return false;

      const parsed = JSON.parse(raw);
      const failedAt = Number(parsed?.failedAt);
      if (!Number.isFinite(failedAt)) {
        localStorage.removeItem(failureKey);
        return false;
      }

      if (Date.now() - failedAt > FAILURE_TTL_MS) {
        localStorage.removeItem(failureKey);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  function writeFailure(failureKey) {
    try {
      localStorage.setItem(
        failureKey,
        JSON.stringify({
          failedAt: Date.now(),
        })
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function clearFailure(failureKey) {
    try {
      localStorage.removeItem(failureKey);
    } catch {
      // Ignore storage failures.
    }
  }

  function formatPushedAt(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const now = new Date();
    const nowMs = now.getTime();
    const isTodayUtc =
      date.getUTCFullYear() === now.getUTCFullYear() &&
      date.getUTCMonth() === now.getUTCMonth() &&
      date.getUTCDate() === now.getUTCDate();

    if (isTodayUtc) {
      return "Updated today";
    }

    const diffMs = nowMs - date.getTime();

    if (diffMs < 2 * DAY_MS) {
      return "Updated yesterday";
    }

    if (diffMs < WEEK_MS) {
      const days = Math.floor(diffMs / DAY_MS);
      return `Updated ${days} day${days === 1 ? "" : "s"} ago`;
    }

    if (diffMs < 2 * WEEK_MS) {
      return "Updated last week";
    }

    if (diffMs < 4 * WEEK_MS) {
      const weeks = Math.floor(diffMs / WEEK_MS);
      return `Updated ${weeks} weeks ago`;
    }

    const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
    const formatter = sameYear ? DATE_FORMATTERS.withoutYear : DATE_FORMATTERS.withYear;
    return `Updated on ${formatter.format(date)}`;
  }
})();
