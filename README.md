# Developer Landing Page

[![Jekyll 4.4.1](https://img.shields.io/badge/Jekyll-4.4.1-CC0000?logo=jekyll&logoColor=white)](https://jekyllrb.com/)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-hosting-222222)](https://pages.github.com/)
[![Ruby 3.3](https://img.shields.io/badge/Ruby-3.3-CC342D?logo=ruby&logoColor=white)](https://www.ruby-lang.org/)
[![Liquid templates](https://img.shields.io/badge/Templates-Liquid-7AB55C)](https://shopify.github.io/liquid/)
[![Sass/SCSS](https://img.shields.io/badge/Sass-SCSS-CC6699?logo=sass&logoColor=white)](https://sass-lang.com/)
[![Vanilla JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)

A configurable Jekyll landing page for presenting selected GitHub repositories, recent milestones and commits, and posts from a blog feed. It is designed for GitHub Pages and follows the latest version of the [Minima theme](https://github.com/jekyll/minima).

[View the live demo](https://lib-port.github.io/)

## Features

- Configurable introduction, repository grid, recent-milestone, recent-commit, and blog-post sections
- Server-rendered repository metadata with client-side update labels
- One switch-aware GitHub activity controller with shared requests and caching
- Viewport-loaded milestone feed merged across configured repositories
- GitHub-style recent-commit timeline that refreshes only pushed repositories
- Client-side blog posts with seven-day local caching
- Configurable owner-aware GitHub profile or repositories link in the header
- Responsive light and dark themes with a persistent visitor-controlled switcher
- Explicit loading and failure states for client-side GitHub activity
- SEO metadata, a sitemap, and GitHub-flavored Markdown extensions
- Automated deployment to GitHub Pages

## Quick start

1. Fork this repository, then rename the fork to `YOUR_USERNAME.github.io`.
2. In the fork's **Settings → Pages**, select **GitHub Actions** as the deployment source.
3. Clone the renamed repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/YOUR_USERNAME.github.io.git
   cd YOUR_USERNAME.github.io
   ```

4. Edit the site metadata and homepage sections in [`_config.yml`](./_config.yml). See [Configuration](#configuration) for all supported settings.
5. Commit the configuration, then push to `main`.
6. After the deployment workflow finishes, visit `https://YOUR_USERNAME.github.io`.

## Configuration

[`_config.yml`](./_config.yml) is the source of truth for site metadata, enabled sections, section order, and blog settings.

```yaml
title: Your Name
lang: en-GB

github-icon:
  switch: true
  link: repos
  style: auto

intro:
  switch: true
  text: Course notes, projects, and essays.

repo_grid:
  switch: true
  repo_list:
    - first-repository
    - second-repository

recent_milestones:
  switch: true
  milestones: 3
  repo_list:
    - first-repository
    - second-repository

recent_commits:
  switch: true
  commits: 10

external_blog:
  switch: true
  feed_url: https://example.com/feed.xml
  archive_url: https://example.com/archive
  post_limit: 7

description: A short description shown in site metadata and the footer.
```

Replace the example feed and archive URLs with the URLs for your blog.

The top-level order of `intro`, `repo_grid`, `recent_milestones`, `recent_commits`, and `external_blog` determines their order on the homepage.

| Setting | Requirement |
| --- | --- |
| `title` | Site title used by the theme and metadata. |
| `lang` | Site language used by page metadata. Use `en-GB` for the provided UK-English interface. |
| `description` | Site description used by metadata and the footer. |
| `github-icon.switch` | YAML boolean controlling whether the rightmost header icon is shown. The default is `false` when the switch or section is missing. |
| `github-icon.link` | Required when enabled and must be exactly `profile` or `repos`. `profile` uses the owner profile URL; `repos` adds `?tab=repositories` to it. There is no enabled default. |
| `github-icon.style` | Optional when enabled and must be exactly `auto`, `text`, or `icon`. `auto` shows the GitHub mark without JavaScript and on detected desktop Linux systems, otherwise it shows the GitHub wordmark. `text` always shows the wordmark and is the default; `icon` always shows the mark. |
| `intro.switch` | YAML boolean controlling whether the introduction is shown. |
| `intro.text` | Required, non-blank text when the introduction is enabled. |
| `repo_grid.switch` | YAML boolean controlling whether repository cards are shown. |
| `repo_grid.repo_list` | Required, non-empty list of case-insensitively unique repository names when enabled. Repositories must belong to the account hosting the site. |
| `recent_milestones.switch` | YAML boolean controlling whether recent GitHub milestones are loaded. |
| `recent_milestones.milestones` | Required integer from 1 through 10 controlling how many globally recent milestones are shown when enabled. |
| `recent_milestones.repo_list` | Required, non-empty list of case-insensitively unique public repository names to poll under the account hosting the site when enabled. |
| `recent_commits.switch` | YAML boolean controlling whether recent GitHub commits are loaded. |
| `recent_commits.commits` | Required integer from 1 through 10 when enabled. |
| `external_blog.switch` | YAML boolean controlling whether external posts are shown. |
| `external_blog.feed_url` | Required absolute HTTP(S) blog RSS URL when external posts are enabled. |
| `external_blog.archive_url` | Required absolute HTTP(S) blog archive URL used by the fallback and “View all posts” links. |
| `external_blog.post_limit` | Required integer from 1 through 10 when external posts are enabled. |

Use unquoted `true` and `false` values for switches. Disabled sections ignore their inner settings, including `github-icon.link` and `github-icon.style`. When all three GitHub activity sections are disabled, the generated page contains neither GitHub activity configuration nor its client script. Individually disabled milestone and commit sections add no controller work.

The GitHub link opens in the current tab and remains the rightmost header action. In `auto` mode, the mark is the progressive fallback when JavaScript is unavailable; an early platform check retains it for desktop Linux and selects the wordmark elsewhere. Its destination comes from the account that owns the Pages repository: `jekyll-github-metadata` resolves that owner during deployment or from the Git `origin` during local development, which keeps forks portable. The link is omitted if owner metadata is unavailable. Add future header links before it in [`_includes/header.html`](./_includes/header.html) to retain this ordering.

### GitHub activity controller

Repository updates, recent milestones, and recent commits share [`assets/js/github_activity.js`](./assets/js/github_activity.js), one page-level configuration block, and one request coordinator. The coordinator deduplicates identical in-flight requests, limits GitHub traffic to four concurrent requests, and ends requests that have not finished reading their response after 15 seconds. Timeouts follow the same cached fallback, failure message, and six-hour pause as other network failures. Browser locks and storage events avoid duplicate work between open tabs where those APIs are available.

Repository-card updates start immediately. Milestone and commit collection starts only when the corresponding section is within 800 pixels of the viewport; browsers without `IntersectionObserver` load those sections immediately. This changes when the work occurs, without changing the visible content or status states.

### Repository updates

Repository cards are generated from GitHub metadata during the site build. In the browser, the shared activity controller groups the cards by owner and refreshes their “Updated” labels with one GitHub API request per owner. The resulting repository catalogue is also reused by the commit loader.

Successful responses are cached in the visitor's `localStorage`. For seven days after a successful fetch or validation, the page uses the cached repository timestamps without a network request. After seven days, it continues to display the cached timestamps while conditionally revalidating them with GitHub using the stored ETag. An unchanged response renews the cache for another seven days without downloading the response body; a changed response replaces the cached data.

If revalidation fails, the stale timestamps remain available and another request is not attempted for six hours. Cached repository data has no age-based expiration, but malformed and future-dated cache entries are removed.

### Recent GitHub milestones

When `recent_milestones.switch` is enabled and the section approaches the viewport, the activity controller requests closed, milestone-bearing issues from each repository in `recent_milestones.repo_list`. Pull requests and closed milestones are excluded; all closed issues are eligible regardless of whether GitHub marks them as completed or not planned. All collection and processing occurs in the browser through GitHub's unauthenticated public REST API; no milestone data is scraped from GitHub HTML or collected during the site build.

The loader groups issues by milestone and ranks each milestone by its most recently closed issue (`issue.closed_at`), not by changes to the milestone metadata itself. It requests pages in descending issue-activity order until the configured number of results is definitive, then merges and globally ranks the candidates. Each row links to its repository and milestone and shows the description, due date when one is set, closed/total issue count, completion percentage and bar, and the plain-text title and labels of its latest closed issue. The label group is omitted when that issue has no labels. The ranking timestamp is intentionally not displayed. A successful search with no results displays `No open milestones with closed issues found`.

Results use the same cache policy as the other GitHub sections. Compacted closed-issue page summaries remain fresh in `localStorage` for seven days, with duplicate appearances of a milestone reduced to its newest closed issue within each page. After that, every cached API page is conditionally revalidated with its ETag; stale data is retained indefinitely, malformed or future-dated entries are removed, and failures prevent another attempt for six hours. Successful and cached repository data is combined silently if only part of a refresh fails. The section is hidden unless JavaScript initialises. The v4 cache format adds latest-issue labels and replaces incompatible v3 milestone entries.

### Recent GitHub commits

When `recent_commits.switch` is enabled and the section approaches the viewport, the activity controller loads commits from the default branches of public repositories owned by the account hosting the site. Forks and archived repositories are excluded at build time and rechecked against the current repository catalogue before polling. The section is hidden unless JavaScript initialises.

The browser requests at most the configured number of author-filtered commits from each eligible repository, combines the responses, sorts them by committed time, and displays the newest entries. If GitHub temporarily returns no results for the username filter, the loader falls back to repository history and retains only commits linked to the owner account.

Commits are rendered as a semantic unordered list in the form `repository · commit message · date`. Decorative repository, comment, and calendar Octicons identify each detail, while GitHub commit Octicons replace the native bullets and a vertical connector turns the list into a GitHub-style commit timeline. A successful request with no qualifying commits displays `No recent commits found`.

The commit cache follows the repository-card policy: results remain fresh for seven days and are displayed without a network request. Once the cache expires, the loader first revalidates the shared repository catalogue, compares each repository's `pushed_at` value with the value stored alongside its commit result, and requests commits only for repositories that changed. If none changed, no commit endpoints are called. Changed repositories still use ETags, while unchanged cached entries are merged into the displayed timeline.

During revalidation, the section displays a gear Octicon with `loading recent commits`. If the refresh fails, the prior cached list or successful empty state is restored and another request is not attempted for six hours. When no displayable cached result is available, an alert Octicon with `unable to load recent commits` replaces the loading state; no GitHub profile fallback link is shown. Cached commits have no age-based expiration, while malformed and future-dated entries are removed.

### External posts

The page initially displays a normal “View Posts” archive link. When JavaScript is available, [`assets/js/external_blog.js`](./assets/js/external_blog.js) requests the configured feed through the keyless [RSS2JSON API](https://rss2json.com/docs) and replaces the fallback with recent posts.

Successful responses are cached in the visitor's `localStorage` for seven days, keyed by feed URL. During that period the page renders the cached posts without another proxy request. Invalid, unavailable, or expired cached data falls back to a new request. Requests that do not finish reading their response within 15 seconds are aborted; if any request fails, the archive link remains available.

### Theme preference

The page initially follows the visitor's operating-system light or dark preference. A fixed button in the bottom-right corner uses moon and sun GitHub Octicons to show the theme available on activation. Once selected, the explicit `light` or `dark` preference is stored in `localStorage` and reused across visits and open tabs.

The theme is selected before the main stylesheet loads to avoid a mismatched-colour flash. If JavaScript or browser storage is unavailable, Minima's automatic colour scheme remains the fallback; storage failures do not prevent switching for the current page.

## Local development

### Prerequisites

- Ruby 3.3 and Bundler
- Python 3.11 and `pip`
- Node.js 20 for client-side tests
- Network access to download the latest remote Minima theme

### Install dependencies

```bash
bundle install
python3 -m pip install -r requirements.txt
```

### Validate and build

```bash
python3 scripts/validate_site_config.py
./scripts/build_site.sh
```

The build script validates `_config.yml` before writing the generated site to `_site`.

### Run tests

```bash
python3 -m unittest discover -s tests
node --test tests/*.test.js
```

## How it works

| Area | Responsibility |
| --- | --- |
| Configuration | `_config.yml` defines site metadata, the header GitHub icon, homepage sections, and external-feed settings; Python validation rejects invalid enabled-section settings. |
| Page generation | Jekyll, Minima, Liquid includes, and custom Sass generate the static site. |
| GitHub activity | `assets/js/github_activity.js` coordinates repository updates, milestones, and commits through one switch-aware configuration, request queue, failure policy, and cross-tab cache integration. |
| Repository data | `jekyll-github-metadata` supplies repository cards during the build; the shared controller refreshes update labels and revalidates its local catalogue weekly using GitHub ETags. |
| Recent milestones | The controller polls closed milestone-bearing issues in configured public repositories near the viewport, globally ranks open milestones by their latest closed issue, renders progress and latest-issue metadata, and conditionally revalidates its weekly paginated cache. |
| Recent commits | Build metadata supplies eligible repository names; the controller loads author-linked commits near the viewport and, on weekly refresh, polls only repositories whose push timestamp changed. |
| External posts | Browser JavaScript loads the configured blog feed through RSS2JSON, renders it safely, and caches it locally for seven days. |
| Theme preference | Minima supplies the light and dark palettes; `assets/js/theme_toggle.js` applies and persists the visitor's explicit override. |
| Deployment | `.github/workflows/deploy-pages.yml` validates, builds, uploads, and deploys the site. |
| Repository mirror | `.github/workflows/gitlab-main-mirror.yml` keeps GitLab `main` aligned with GitHub `main`. |

Client-side features use progressive enhancement: the automatic GitHub header style falls back to the mark, repository cards remain available without GitHub API updates, the recent-milestone and recent-commit sections stay hidden without JavaScript, the blog archive link remains available without JavaScript or RSS2JSON, and the theme continues to follow the system colour preference without the switcher.

## Deployment

The GitHub Actions workflow deploys pushes to `main` that can affect the published site or its build, and it can also be started manually. Pushes that change only the README, `LICENSE`, `.gitignore`, tests, or GitLab mirror workflow are skipped.

During deployment, the workflow:

1. installs the locked Ruby dependencies and required Python package
2. validates `_config.yml`
3. builds the site with authenticated GitHub metadata
4. uploads and deploys `_site` to GitHub Pages

## GitLab mirror

GitHub `main` is the source of truth for the GitLab mirror. Every push to `main` starts the `Mirror main to GitLab` workflow, which also supports manual dispatch. The workflow verifies that both repositories finish on the same commit SHA and may force-update GitLab after a GitHub history rewrite.

Mirroring uses an SSH deploy-key pair. Store the private key in the GitHub repository secret `GITLAB_MIRROR_SSH_KEY`, and enable the corresponding public key as a read-write deploy key for the GitLab project at the same owner and repository path. Add that deploy key to the protected `main` branch's **Allowed to push and merge** setting. To synchronise rewritten GitHub history, also enable **Allowed to force push** for the branch. The cleanup workflow keeps the latest completed run for each workflow so the most recent mirror result remains available for troubleshooting.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Repository cards are missing locally | Confirm each configured repository belongs to the site owner's account. Set `JEKYLL_GITHUB_TOKEN` in the shell if unauthenticated GitHub metadata is incomplete. Never commit the token. |
| Recent milestones are stale | The browser cache lasts seven days. Clear the site's `recent-milestones:v4:` local-storage entry to force an immediate refresh. |
| “unable to load recent milestones” appears | Confirm every configured repository is public and belongs to the site owner, the browser can reach `api.github.com`, and the visitor has not exhausted GitHub's unauthenticated API limit. |
| The recent-milestone section is missing | Confirm `recent_milestones.switch` is `true` and JavaScript is enabled; the section intentionally remains hidden when JavaScript does not initialise. |
| Recent commits are stale | The browser cache lasts seven days. After that, the loading state appears during revalidation and the cached result is restored only if the refresh fails. Clear the site's `localStorage` to force a new request. |
| “unable to load recent commits” appears | Confirm the browser can reach `api.github.com` and has not exhausted GitHub's unauthenticated API limit. Forked and archived repositories are intentionally excluded. |
| The recent-commit section is missing | Confirm `recent_commits.switch` is enabled and JavaScript is available; the entire section intentionally remains hidden when JavaScript does not initialise. |
| External posts are stale | The browser cache lasts seven days. Clear the site's `localStorage` to force an immediate RSS2JSON refresh. |
| Only “View Posts (external site)” appears | Confirm JavaScript is enabled and the browser can reach `api.rss2json.com`; the link is the intentional fallback. |
| The theme no longer follows the system | Clear the site's `lib-port:theme:v1` local-storage entry to remove the explicit light or dark preference. |
| The header GitHub icon is missing | Confirm `github-icon.switch` is `true`, its `link` and `style` values are supported, and GitHub owner metadata is available during the build. |
| The GitLab mirror is stale | Check the latest `Mirror main to GitLab` run. Confirm `GITLAB_MIRROR_SSH_KEY` contains the private deploy key, its public counterpart remains enabled on the GitLab project with read-write access, and protected `main` allows that deploy key to push. If rewritten history must be mirrored, also confirm that the branch allows force pushes. Manually dispatch the workflow after correcting the problem. |
| The build cannot download Minima | Confirm the environment can reach GitHub and `codeload.github.com`, then rerun the build. |
| Configuration validation fails | Use YAML booleans for switches and provide every field required by an enabled section. |

## Customisation notes

Custom homepage markup lives in `_includes`, while component styling lives in [`_sass/minima/custom-styles.scss`](./_sass/minima/custom-styles.scss). Refer to the [Minima documentation](https://github.com/jekyll/minima) for broader theme customisation.

Minima's built-in feed configuration can conflict with this project's external-feed settings. The `jekyll-feed` dependency remains because Minima expects it, but the homepage intentionally links to the configured external feed instead of presenting the generated site feed.

The `remote_theme` setting intentionally omits a version or commit reference so each build uses the latest Minima revision.

## Licence

This project is available under the [MIT Licence](./LICENSE).
