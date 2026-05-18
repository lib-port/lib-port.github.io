# Dev Writer Landing Page

[![Deploy Jekyll with GitHub Pages](https://github.com/libport/libport.github.io/actions/workflows/jekyll-gh-pages.yml/badge.svg)](https://github.com/libport/libport.github.io/actions/workflows/jekyll-gh-pages.yml)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Flibport.github.io%2F&up_message=online&down_message=offline&label=site)](https://libport.github.io/)
![Last Commit](https://img.shields.io/github/last-commit/libport/libport.github.io)
![Jekyll](https://img.shields.io/badge/Jekyll-4.4.1-cc0000?logo=jekyll)
![Ruby](https://img.shields.io/badge/Ruby-3.3-cc342d?logo=ruby)
![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6%2B-F7DF1E?logo=javascript&logoColor=black)

Dev Writer Landing Page is an AI and recruiter friendly static site to showcase your code from GitHub and blog posts from a blogging platform (Blogger, Wordpress, Medium etc.). It features AI access and ingestion optimisations, responsive design, light and dark themes in response to browser settings, and optimised, graceful degradation client-side JS showing repo update status. GitHub style callouts and GFM is enabled to extend the landing page into a documentation site.

View the live demo at <https://libport.github.io/>.

This repo builds on the [Minima Jekyll theme](https://github.com/jekyll/minima) and also depends on [Jekyll](https://jekyllrb.com/docs/), [GitHub Pages](https://pages.github.com/) and [GitHub Actions](https://docs.github.com/en/actions).

## Quick Start Guide
- Fork the repo to a new repo owned by you named `[YOUR USERNAME].github.io`.
- Clone your fork to a local folder.
- Edit the following configuration options in the `_config.yml` file:

```yaml
title: #title of the landing page/site
```
and

```yaml
##################################
# Start of landing page settings
##################################

intro:
  switch: true 
  text: #introduction for the site, located below the "Home" page title.

repo_grid:
  switch: true
  repo_list:
  - #name of first repo
  - #name of second repo

external_blog:
  switch: true
  feed_url: #URL of the RSS feed of your blog
  archive_url: #URL of the archive page of your blog that lists all the posts
  post_limit: #how many of the most recent items from the RSS feed you want to show on the landing page

################################
# End of landing page settings
################################
```
and

```yaml
description: #description that will be shown in the footer
```

- The order that the custom section settings (`intro`, `repo_grid`, and `external_blog`) appear in the `landing page settings` block in `_config.yml` determines the order the sections appear on the home page.
- The `switch` variable controls whether or not the section appears
- You can include as many repos as you want, but they must be repos owned by you. To follow good UI design the maximum should be 6 and number even. E.g. 2, 4 or 6.
- Run `python3 scripts/fetch_external_posts.py` when you want to refresh the blog data file committed at `_data/external_posts.json`.
- Build the site with `scripts/build_site.sh`.

> [!NOTE]
> The external blog data file is no longer generated during the build. Update `_data/external_posts.json` manually with `python3 scripts/fetch_external_posts.py` and commit the result before deploying if you want newer feed content on the site.

- Commit and push to `main`.
- Your landing page should be available at `https://[YOUR USERNAME].github.io`.
- Please check the [Minima README](https://github.com/jekyll/minima/blob/master/README.md) for further site customisation options. Minima RSS configurations will conflict with Dev Writer Landing Page configurations, please do not use them. The plugin and gem references to `jekyll-feed` remain as Minima will not build without them, and on-site RSS generation functionality remains, but hooks and UI artefacts for the on-site RSS have been removed.

# README
This repository powers <https://libport.github.io/>, a GitHub Pages site built with Jekyll and the remote `jekyll/minima` theme. The homepage combines two configurable sections:

- a grid of selected GitHub repositories
- recent posts pulled from an external RSS or Atom feed into a Jekyll data file

## How It Works

The site is assembled from a small set of Jekyll templates plus a small Python build layer:

- [`index.html`](./index.html) renders the homepage and inserts enabled sections in config order
- [`_includes/intro.html`](./_includes/intro.html) renders the configured intro copy
- [`_includes/repo_grid.html`](./_includes/repo_grid.html) builds the repository grid from `site.github.public_repositories`
- [`_includes/external_blog.html`](./_includes/external_blog.html) renders external posts from the repository copy of [`_data/external_posts.json`](./_data/external_posts.json)
- [`_includes/home_section_error.html`](./_includes/home_section_error.html) renders fail-soft messages when an enabled homepage section cannot be populated
- [`_includes/head.html`](./_includes/head.html) exposes the configured external feed as an RSS `<link>`
- [`assets/js/repo_updates.js`](./assets/js/repo_updates.js) fetches repo push dates from the GitHub API and caches them in `localStorage`
- [`scripts/site_config.py`](./scripts/site_config.py) loads [`_config.yml`](./_config.yml) with `PyYAML` and performs shared validation for `intro`, `repo_grid`, and `external_blog`
- [`scripts/validate_site_config.py`](./scripts/validate_site_config.py) fails the build early if enabled section settings are invalid
- [`scripts/fetch_external_posts.py`](./scripts/fetch_external_posts.py) consumes validated `external_blog` settings and fetches the external feed directly with `curl` when you run it manually
- [`scripts/build_site.sh`](./scripts/build_site.sh) validates config and then builds the site using the checked-in data files

## Repository Layout

```text
.
├── .github/workflows/jekyll-gh-pages.yml
├── _config.yml
├── _includes/
│   ├── external_blog.html
│   ├── head.html
│   ├── home_section_error.html
│   ├── intro.html
│   └── repo_grid.html
├── _data/external_posts.json
├── _sass/minima/custom-styles.scss
├── assets/js/repo_updates.js
├── scripts/build_site.sh
├── scripts/fetch_external_posts.py
├── scripts/site_config.py
├── scripts/validate_site_config.py
├── requirements.txt
├── tests/
├── Gemfile
├── index.html
└── README.md
```

## Configuration

The main settings live in [`_config.yml`](./_config.yml).

### Site metadata

```yml
title: libport.github.io
intro:
  switch: true
  text: Course notes, projects, and essays.
description: A blog and portfolio site focusing on the intersection of technology, social sciences, and humanities.
```

### Homepage sections

The homepage renders sections by iterating over top-level config keys. Each section can be enabled or disabled with a YAML boolean `switch`.

```yml
intro:
  switch: true
  text: Course notes, projects, and essays.

repo_grid:
  switch: true
  repo_list:
    - linux-cyber
    - data-AI-eng
    - BA-PO-econ
    - open-banking-lakehouse
    - backtest
    - libport.github.io

external_blog:
  switch: true
  feed_url: https://example.com/feed.xml
  archive_url: https://example.com/archive
  post_limit: 5
```

Notes:

- `_config.yml` is the single source of truth for section settings
- homepage section order follows the top-level key order in `_config.yml`
- enabled sections are validated in Python before Jekyll runs
- `switch` must be a YAML boolean such as `true` or `false`
- `intro.text` must be present and non-blank when `intro.switch` is `true`
- `repo_grid.repo_list` must be a non-empty list of unique repository names when `repo_grid.switch` is `true`
- `external_blog.post_limit` must be a positive integer when `external_blog.switch` is `true`
- if a section `switch` is `false`, malformed inner fields for that section are ignored
- `external_blog.archive_url` is optional and only renders when present

## Local Development

### Prerequisites

- Ruby 3.3
- Bundler
- Python 3
- `PyYAML` for config loading and validation

### Install dependencies

```bash
bundle install
python3 -m pip install -r requirements.txt
```

### Validate site configuration

```bash
python3 scripts/validate_site_config.py
```

### Generate external blog data

```bash
python3 scripts/fetch_external_posts.py
```

Run this manually whenever you want to refresh [`_data/external_posts.json`](./_data/external_posts.json). The generated JSON should be committed to the repository so builds and deployments use the repo copy directly.

By default the script loads validated settings from [`_config.yml`](./_config.yml) via [`scripts/site_config.py`](./scripts/site_config.py). If `external_blog.switch` is `false`, it skips feed generation and exits successfully. If `external_blog.switch` is `true`, config validation must already pass before feed generation continues.

The fetcher performs a direct `curl` request for the configured RSS or Atom feed.

Useful overrides:

```bash
python3 scripts/fetch_external_posts.py --feed-url https://example.com/feed --limit 3
python3 scripts/fetch_external_posts.py --output _data/external_posts.json
```

### Build the site locally

```bash
./scripts/build_site.sh
```

`scripts/build_site.sh` does not fetch the external feed. It validates config and builds the site using the committed `_data/external_posts.json`.

### Run Python tests

```bash
python3 -m unittest discover -s tests
```

## Deployment

Deployment is handled by [`.github/workflows/jekyll-gh-pages.yml`](./.github/workflows/jekyll-gh-pages.yml).

On pushes to `main` except when only [`README.md`](./README.md) changes, GitHub Actions:

1. checks out the repository
2. configures GitHub Pages
3. sets up Ruby 3.3 and restores the Bundler cache
4. sets up Python 3.11 and installs [`requirements.txt`](./requirements.txt)
5. restores `.jekyll-cache`
6. validates enabled homepage section settings from [`_config.yml`](./_config.yml)
7. builds the site with `bundle exec jekyll build -d ./_site`
8. uploads `_site` as the Pages artifact
9. deploys the artifact to GitHub Pages

The workflow does not fetch or parse the external RSS feed. Deployments use the checked-in [`_data/external_posts.json`](./_data/external_posts.json) from the repository.

The build job sets `JEKYLL_GITHUB_TOKEN` so `jekyll-github-metadata` can read repository metadata during the Jekyll build.

The workflow also includes a cleanup job that trims older workflow runs and keeps the three most recent runs.

## Editing Guide

Common changes map to these files:

- update homepage copy: [`_config.yml`](./_config.yml) and [`index.html`](./index.html)
- update the intro section markup: [`_includes/intro.html`](./_includes/intro.html)
- change which repositories appear: [`_config.yml`](./_config.yml)
- change how repository cards render: [`_includes/repo_grid.html`](./_includes/repo_grid.html)
- change blog post markup: [`_includes/external_blog.html`](./_includes/external_blog.html)
- change section-level fallback messages: [`_includes/home_section_error.html`](./_includes/home_section_error.html)
- change styling: [`_sass/minima/custom-styles.scss`](./_sass/minima/custom-styles.scss)
- change config parsing or validation rules: [`scripts/site_config.py`](./scripts/site_config.py) and [`scripts/validate_site_config.py`](./scripts/validate_site_config.py)
- change feed fetching, parsing, or JSON output: [`scripts/fetch_external_posts.py`](./scripts/fetch_external_posts.py)
- change the local build entrypoint: [`scripts/build_site.sh`](./scripts/build_site.sh)
- refresh checked-in blog data: run [`scripts/fetch_external_posts.py`](./scripts/fetch_external_posts.py) then commit [`_data/external_posts.json`](./_data/external_posts.json)
- change automated checks: [`tests/`](./tests/)

## Notes

- [`README.md`](./README.md) and `scripts/` are excluded from the Jekyll build
- [`_data/external_posts.json`](./_data/external_posts.json) is a committed data file used directly by local builds and GitHub Pages deployments
- repository "last updated" labels are enhanced client-side and fail gracefully if the GitHub API is unavailable
