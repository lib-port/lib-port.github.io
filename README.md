# Dev Writer Landing Page

[![Deploy Jekyll with GitHub Pages](https://github.com/lib-port/lib-port.github.io/actions/workflows/jekyll-gh-pages.yml/badge.svg)](https://github.com/lib-port/lib-port.github.io/actions/workflows/jekyll-gh-pages.yml)
[![Live site](https://img.shields.io/website?url=https%3A%2F%2Flib-port.github.io%2F&up_message=online&down_message=offline&label=site)](https://lib-port.github.io/)
[![Jekyll 4.4.1](https://img.shields.io/badge/Jekyll-4.4.1-CC0000?logo=jekyll&logoColor=white)](https://jekyllrb.com/)
[![Ruby 3.3](https://img.shields.io/badge/Ruby-3.3-CC342D?logo=ruby&logoColor=white)](https://www.ruby-lang.org/)
[![Liquid templates](https://img.shields.io/badge/Templates-Liquid-7AB55C)](https://shopify.github.io/liquid/)
[![Sass/SCSS](https://img.shields.io/badge/Sass-SCSS-CC6699?logo=sass&logoColor=white)](https://sass-lang.com/)
[![Vanilla JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=000)](https://developer.mozilla.org/docs/Web/JavaScript)

A configurable Jekyll landing page for presenting selected GitHub repositories and recent posts from a blog feed. It is designed for GitHub Pages and builds on the [Minima theme](https://github.com/jekyll/minima).

[View the live demo](https://lib-port.github.io/)

## Features

- Configurable introduction, repository grid, recent-commit, and blog-post sections
- Server-rendered repository metadata with client-side update labels
- Client-side GitHub-style recent-commit timeline with conditional caching
- Client-side blog posts with seven-day local caching
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

intro:
  switch: true
  text: Course notes, projects, and essays.

repo_grid:
  switch: true
  repo_list:
    - first-repository
    - second-repository

commit_history:
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

The top-level order of `intro`, `repo_grid`, `commit_history`, and `external_blog` determines their order on the homepage.

| Setting | Requirement |
| --- | --- |
| `title` | Site title used by the theme and metadata. |
| `description` | Site description used by metadata and the footer. |
| `intro.switch` | YAML boolean controlling whether the introduction is shown. |
| `intro.text` | Required, non-blank text when the introduction is enabled. |
| `repo_grid.switch` | YAML boolean controlling whether repository cards are shown. |
| `repo_grid.repo_list` | Required, non-empty list of unique repository names when enabled. Repositories must belong to the account hosting the site. |
| `commit_history.switch` | YAML boolean controlling whether recent GitHub commits are loaded. |
| `commit_history.commits` | Required integer from 1 through 10 when enabled. |
| `external_blog.switch` | YAML boolean controlling whether external posts are shown. |
| `external_blog.feed_url` | Required blog RSS URL when external posts are enabled. |
| `external_blog.archive_url` | Required blog archive URL used by the fallback and “View all posts” links. |
| `external_blog.post_limit` | Required integer from 1 through 10 when external posts are enabled. |

Use unquoted `true` and `false` values for section switches. Disabled sections ignore their inner settings.

### Repository updates

Repository cards are generated from GitHub metadata during the site build. In the browser, [`assets/js/repo_updates.js`](./assets/js/repo_updates.js) groups the cards by owner and refreshes their “Updated” labels with one GitHub API request per owner.

Successful responses are cached in the visitor's `localStorage`. For seven days after a successful fetch or validation, the page uses the cached repository timestamps without a network request. After seven days, it continues to display the cached timestamps while conditionally revalidating them with GitHub using the stored ETag. An unchanged response renews the cache for another seven days without downloading the response body; a changed response replaces the cached data.

If revalidation fails, the stale timestamps remain available and another request is not attempted for six hours. Cached repository data has no age-based expiration, but malformed and future-dated cache entries are removed.

### Recent GitHub commits

When enabled, [`assets/js/commit_history.js`](./assets/js/commit_history.js) loads commits from the default branches of public repositories owned by the account hosting the site. Forks and archived repositories are excluded at build time and are never polled. The section is hidden unless JavaScript initializes.

The browser requests at most the configured number of author-filtered commits from each eligible repository, combines the responses, sorts them by committed time, and displays the newest entries. If GitHub temporarily returns no results for the username filter, the loader falls back to repository history and retains only commits linked to the owner account.

Commits are rendered as a semantic unordered list in the form `repository · commit message · date`. Decorative repository, comment, and calendar Octicons identify each detail, while GitHub commit Octicons replace the native bullets and a vertical connector turns the list into a GitHub-style commit timeline. A successful request with no qualifying commits displays `No recent commits found`.

The commit cache follows the repository-card policy: results remain fresh for seven days and are displayed without a network request. Once the cache expires, the section displays a gear Octicon with `loading recent commits` while each repository is conditionally revalidated with its ETag. If the refresh fails, the prior cached list or successful empty state is restored and another request is not attempted for six hours. When no displayable cached result is available, an alert Octicon with `unable to load recent commits` replaces the loading state; no GitHub profile fallback link is shown. Cached commits have no age-based expiration, while malformed and future-dated entries are removed.

### External posts

The page initially displays a normal “View Posts” archive link. When JavaScript is available, [`assets/js/external_blog.js`](./assets/js/external_blog.js) requests the configured feed through the keyless [RSS2JSON API](https://rss2json.com/docs) and replaces the fallback with recent posts.

Successful responses are cached in the visitor's `localStorage` for seven days, keyed by feed URL. During that period the page renders the cached posts without another proxy request. Invalid, unavailable, or expired cached data falls back to a new request; if that request fails, the archive link remains available.

### Theme preference

The page initially follows the visitor's operating-system light or dark preference. A fixed button in the bottom-right corner uses moon and sun GitHub Octicons to show the theme available on activation. Once selected, the explicit `light` or `dark` preference is stored in `localStorage` and reused across visits and open tabs.

The theme is selected before the main stylesheet loads to avoid a mismatched-color flash. If JavaScript or browser storage is unavailable, Minima's automatic color scheme remains the fallback; storage failures do not prevent switching for the current page.

## Local development

### Prerequisites

- Ruby 3.3 and Bundler
- Python 3 and `pip`
- Node.js 20 for client-side tests
- Network access to download the remote Minima theme

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
| Configuration | `_config.yml` defines site metadata, homepage sections, and external-feed settings; Python validation rejects invalid enabled-section settings. |
| Page generation | Jekyll, Minima, Liquid includes, and custom Sass generate the static site. |
| Repository data | `jekyll-github-metadata` supplies repository cards during the build; `assets/js/repo_updates.js` refreshes update labels in the browser and revalidates its local cache weekly using GitHub ETags. |
| Recent commits | Build metadata supplies eligible repository names; `assets/js/commit_history.js` loads author-linked commits, renders the timeline and status states, and conditionally revalidates its weekly local cache. |
| External posts | Browser JavaScript loads the configured blog feed through RSS2JSON, renders it safely, and caches it locally for seven days. |
| Theme preference | Minima supplies the light and dark palettes; `assets/js/theme_toggle.js` applies and persists the visitor's explicit override. |
| Deployment | `.github/workflows/jekyll-gh-pages.yml` validates, builds, uploads, and deploys the site. |
| Repository mirror | `.github/workflows/gitlab-main-mirror.yml` keeps GitLab `main` aligned with GitHub `main`. |

Client-side features use progressive enhancement: repository cards remain available without GitHub API updates, the recent-commit section stays hidden without JavaScript, the blog archive link remains available without JavaScript or RSS2JSON, and the theme continues to follow the system color preference without the switcher.

## Deployment

The GitHub Actions workflow deploys pushes to `main` that can affect the published site or its build, and it can also be started manually. Pushes that change only the README, license, `.gitignore`, tests, or GitLab mirror workflow are skipped.

During deployment, the workflow:

1. installs the locked Ruby dependencies and required Python package
2. validates `_config.yml`
3. builds the site with authenticated GitHub metadata
4. uploads and deploys `_site` to GitHub Pages

## GitLab mirror

GitHub `main` is the source of truth for the GitLab mirror. Every push to `main` starts the `Mirror main to GitLab` workflow, which also supports manual dispatch. The workflow verifies that both repositories finish on the same commit SHA and may force-update GitLab after a GitHub history rewrite.

Mirroring requires a `GITLAB_TOKEN` repository secret with `write_repository` access. The token owner must be allowed to push to GitLab's protected `main` branch, and Maintainers must be allowed to force-push so rewritten GitHub history can be synchronized. The cleanup workflow keeps the latest completed run for each workflow so the most recent mirror result remains available for troubleshooting.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Repository cards are missing locally | Confirm each configured repository belongs to the site owner's account. Set `JEKYLL_GITHUB_TOKEN` in the shell if unauthenticated GitHub metadata is incomplete. Never commit the token. |
| Recent commits are stale | The browser cache lasts seven days. After that, the loading state appears during revalidation and the cached result is restored only if the refresh fails. Clear the site's `localStorage` to force a new request. |
| “unable to load recent commits” appears | Confirm the browser can reach `api.github.com` and has not exhausted GitHub's unauthenticated API limit. Forked and archived repositories are intentionally excluded. |
| The recent-commit section is missing | Confirm JavaScript is enabled; the entire section intentionally remains hidden when JavaScript does not initialize. |
| External posts are stale | The browser cache lasts seven days. Clear the site's `localStorage` to force an immediate RSS2JSON refresh. |
| Only “View Posts (external site)” appears | Confirm JavaScript is enabled and the browser can reach `api.rss2json.com`; the link is the intentional fallback. |
| The theme no longer follows the system | Clear the site's `lib-port:theme:v1` local-storage entry to remove the explicit light or dark preference. |
| The GitLab mirror is stale | Check the latest `Mirror main to GitLab` run, confirm the token still has `write_repository` access, confirm protected `main` permits Maintainer force-pushes, and manually dispatch the workflow after correcting the problem. |
| The build cannot download Minima | Confirm the environment can reach GitHub and `codeload.github.com`, then rerun the build. |
| Configuration validation fails | Use YAML booleans for switches and provide every field required by an enabled section. |

## Customization notes

Custom homepage markup lives in `_includes`, while component styling lives in [`_sass/minima/custom-styles.scss`](./_sass/minima/custom-styles.scss). Refer to the [Minima documentation](https://github.com/jekyll/minima) for broader theme customization.

Minima's built-in feed configuration can conflict with this project's external-feed settings. The `jekyll-feed` dependency remains because Minima expects it, but the homepage intentionally links to the configured external feed instead of presenting the generated site feed.

## License

This project is available under the [MIT License](./LICENSE).
