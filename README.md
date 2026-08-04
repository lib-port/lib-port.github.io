# Dev Writer Landing Page

[![Deploy Jekyll with GitHub Pages](https://github.com/libport/libport.github.io/actions/workflows/jekyll-gh-pages.yml/badge.svg)](https://github.com/libport/libport.github.io/actions/workflows/jekyll-gh-pages.yml)
[![Live site](https://img.shields.io/website?url=https%3A%2F%2Flibport.github.io%2F&up_message=online&down_message=offline&label=site)](https://libport.github.io/)

A configurable Jekyll landing page for presenting selected GitHub repositories and recent posts from an external RSS or Atom feed. It is designed for GitHub Pages and builds on the [Minima theme](https://github.com/jekyll/minima).

[View the live demo](https://libport.github.io/)

## Features

- Configurable introduction, repository grid, and external-post sections
- Server-rendered repository metadata with client-side update labels
- Committed RSS or Atom snapshots for deterministic builds
- Responsive light and dark themes based on browser preferences
- Graceful behavior when JavaScript or the GitHub API is unavailable
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
5. If the external-post section is enabled, generate its initial data snapshot:

   ```bash
   python3 -m pip install -r requirements.txt
   python3 scripts/fetch_external_posts.py
   ```

6. Commit the configuration and generated data, then push to `main`.
7. After the deployment workflow finishes, visit `https://YOUR_USERNAME.github.io`.

## Configuration

[`_config.yml`](./_config.yml) is the source of truth for site metadata, enabled sections, section order, and external data settings.

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

external_blog:
  switch: true
  feed_url: https://example.com/feed.xml
  archive_url: https://example.com/archive
  post_limit: 5

description: A short description shown in site metadata and the footer.
```

The top-level order of `intro`, `repo_grid`, and `external_blog` determines their order on the homepage.

| Setting | Requirement |
| --- | --- |
| `title` | Site title used by the theme and metadata. |
| `description` | Site description used by metadata and the footer. |
| `intro.switch` | YAML boolean controlling whether the introduction is shown. |
| `intro.text` | Required, non-blank text when the introduction is enabled. |
| `repo_grid.switch` | YAML boolean controlling whether repository cards are shown. |
| `repo_grid.repo_list` | Required, non-empty list of unique repository names when enabled. Repositories must belong to the account hosting the site. |
| `external_blog.switch` | YAML boolean controlling whether external posts are shown. |
| `external_blog.feed_url` | Required RSS or Atom URL when external posts are enabled. |
| `external_blog.archive_url` | Optional link to the external site's archive. |
| `external_blog.post_limit` | Required positive integer when external posts are enabled. |

Use unquoted `true` and `false` values for section switches. Disabled sections ignore their inner settings.

### Refresh external posts

External posts are generated separately from the site build:

```bash
python3 scripts/fetch_external_posts.py
```

The command reads `external_blog` from `_config.yml` and writes [`_data/external_posts.json`](./_data/external_posts.json). Commit the updated JSON so local and GitHub Pages builds use the same content.

Optional overrides are available for one-off refreshes:

```bash
python3 scripts/fetch_external_posts.py --feed-url https://example.com/feed.xml --limit 3
python3 scripts/fetch_external_posts.py --output _data/external_posts.json
```

The site build never fetches the feed automatically.

## Local development

### Prerequisites

- Ruby 3.3 and Bundler
- Python 3 and `pip`
- Node.js 20 for client-side tests
- `curl` for fetching external feeds
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
node --test tests/repo_updates.test.js
```

## How it works

| Area | Responsibility |
| --- | --- |
| Configuration | `_config.yml` defines site metadata, homepage sections, and external-feed settings; Python validation rejects invalid enabled-section settings. |
| Page generation | Jekyll, Minima, Liquid includes, and custom Sass generate the static site. |
| Repository data | `jekyll-github-metadata` supplies repository cards during the build; `assets/js/repo_updates.js` refreshes update labels in the browser and caches results in `localStorage`. |
| External posts | `scripts/fetch_external_posts.py` converts an RSS or Atom feed into committed Jekyll data. |
| Deployment | `.github/workflows/jekyll-gh-pages.yml` validates, builds, uploads, and deploys the site. |

Client-side repository updates are an enhancement: repository cards and links remain available when JavaScript or the GitHub API is unavailable.

## Deployment

The GitHub Actions workflow deploys pushes to `main` and can also be started manually. README-only changes do not trigger a deployment.

During deployment, the workflow:

1. installs the locked Ruby dependencies and required Python package
2. validates `_config.yml`
3. builds the committed site content with authenticated GitHub metadata
4. uploads and deploys `_site` to GitHub Pages

The workflow does not refresh `_data/external_posts.json`; run the feed command and commit its output whenever newer posts should be published.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Repository cards are missing locally | Confirm each configured repository belongs to the site owner's account. Set `JEKYLL_GITHUB_TOKEN` in the shell if unauthenticated GitHub metadata is incomplete. Never commit the token. |
| External posts are stale | Run `python3 scripts/fetch_external_posts.py`, review the generated JSON, and commit it. |
| The build cannot download Minima | Confirm the environment can reach GitHub and `codeload.github.com`, then rerun the build. |
| Configuration validation fails | Use YAML booleans for switches and provide every field required by an enabled section. |

## Customization notes

Custom homepage markup lives in `_includes`, while component styling lives in [`_sass/minima/custom-styles.scss`](./_sass/minima/custom-styles.scss). Refer to the [Minima documentation](https://github.com/jekyll/minima) for broader theme customization.

Minima's built-in feed configuration can conflict with this project's external-feed settings. The `jekyll-feed` dependency remains because Minima expects it, but the homepage intentionally links to the configured external feed instead of presenting the generated site feed.

## License

This project is available under the [MIT License](./LICENSE).
