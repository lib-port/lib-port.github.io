# Developer Landing Page

[![Jekyll 4.4.1](https://img.shields.io/badge/Jekyll-4.4.1-CC0000?logo=jekyll&logoColor=white)](https://jekyllrb.com/)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-hosting-222222)](https://pages.github.com/)
[![Ruby 3.3](https://img.shields.io/badge/Ruby-3.3-CC342D?logo=ruby&logoColor=white)](https://www.ruby-lang.org/)
[![Liquid templates](https://img.shields.io/badge/Templates-Liquid-7AB55C)](https://shopify.github.io/liquid/)
[![Sass/SCSS](https://img.shields.io/badge/Sass-SCSS-CC6699?logo=sass&logoColor=white)](https://sass-lang.com/)
[![Vanilla JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=white)](https://developer.mozilla.org/docs/Web/JavaScript)

A configurable Jekyll landing page for presenting selected GitHub repositories, recent milestones and commits, and posts from a blog feed. It is designed for GitHub Pages and follows the latest version of the [Minima theme](https://github.com/jekyll/minima).

[View the live demo](https://lib-port.github.io/)

## Features

- Configurable introduction, ASCII banner, repository grid, recent-milestone, recent-commit, and blog-post sections
- Fifteen locally hosted animated scenes, with responsive sizing and reduced-motion support
- Server-rendered repository metadata with client-side update labels
- One switch-aware GitHub activity controller with shared requests and caching
- Viewport-loaded open and recently completed milestones merged across configured repositories
- GitHub-style recent-commit timeline that refreshes only pushed repositories
- Client-side blog posts with seven-day local caching
- Configurable owner-aware GitHub profile or repositories link in the header
- Responsive light and dark themes with a persistent visitor-controlled switcher
- A tiny paper plane that weaves around the homepage title after an explicit click, tap or keyboard activation
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

find_the_bug_game:
  switch: true

light_dark_ball:
  switch: true

github_icon:
  switch: true
  link: repos
  style: auto

paper_plane:
  switch: true

intro:
  switch: true
  text: Course notes, projects, and essays.

ascii_banner:
  switch: true
  module: misty-forest

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

The top-level order of `intro`, `ascii_banner`, `repo_grid`, `recent_milestones`, `recent_commits`, and `external_blog` determines their order on the homepage. Setting names use underscores; older hyphenated names are not recognised.

| Setting | Requirement |
| --- | --- |
| `title` | Site title used by the theme and metadata. |
| `description` | Site description used by metadata and the footer. |
| `find_the_bug_game.switch` | YAML boolean enabling dragging and the hidden bug/squirrel game. A false, null or missing switch excludes the game script from previews and production builds. |
| `light_dark_ball.switch` | YAML boolean enabling theme-switcher dragging and tennis-ball physics independently of the bug game. A false, null or missing switch excludes the physics script from previews and production builds. |
| `github_icon.switch` | YAML boolean controlling whether the rightmost header icon is shown. The default is `false` when the switch or section is missing. |
| `github_icon.link` | Required when enabled and must be exactly `profile` or `repos`. `profile` uses the owner profile URL; `repos` adds `?tab=repositories` to it. There is no enabled default. |
| `github_icon.style` | Optional when enabled and must be exactly `auto`, `text`, or `icon`. `auto` shows the GitHub mark without JavaScript and on detected desktop Linux systems, otherwise it shows the GitHub wordmark. `text` always shows the wordmark and is the default; `icon` always shows the mark. |
| `paper_plane.switch` | YAML boolean enabling the decorative homepage title animation. A false, null or missing switch omits the plane and excludes its script from previews and production builds. |
| `intro.switch` | YAML boolean controlling whether the introduction is shown. |
| `intro.text` | Required, non-blank text when the introduction is enabled. |
| `ascii_banner.switch` | YAML boolean controlling whether the ASCII banner is enabled. A missing or disabled switch or section omits banner markup and all ASCII assets from local previews and production builds. |
| `ascii_banner.module` | Required when enabled; must name one of the locally available scenes listed below, or be exactly `random` to choose a scene on each page load. |
| `repo_grid.switch` | YAML boolean controlling whether repository cards are shown. |
| `repo_grid.repo_list` | Required, non-empty list of case-insensitively unique repository names when the repository grid is enabled. Repositories must belong to the account hosting the site. The list supplies repository cards. |
| `recent_milestones.switch` | YAML boolean controlling whether recent GitHub milestones are loaded. |
| `recent_milestones.milestones` | Required integer from 1 through 10 controlling how many detailed open milestones are shown when enabled. |
| `recent_milestones.repo_list` | Required, non-empty list of case-insensitively unique repository names when recent milestones are enabled. Repositories must belong to the account hosting the site. The list supplies both open and recently completed milestones in Recent Tasks. |
| `recent_commits.switch` | YAML boolean controlling whether recent GitHub commits are loaded. |
| `recent_commits.commits` | Required integer from 1 through 10 when enabled. |
| `external_blog.switch` | YAML boolean controlling whether external posts are shown. |
| `external_blog.feed_url` | Required absolute HTTP(S) blog RSS URL when external posts are enabled. |
| `external_blog.archive_url` | Required absolute HTTP(S) blog archive URL used by the fallback and “View all posts” links. |
| `external_blog.post_limit` | Required integer from 1 through 10 when external posts are enabled. |

Use unquoted `true` and `false` values for switches. Disabled sections ignore their inner settings, including `github_icon.link` and `github_icon.style`. When all three GitHub activity sections are disabled, the generated page contains neither GitHub activity configuration nor its client script. Individually disabled milestone and commit sections add no controller work.

`recent_milestones.repo_list` selects milestone repositories independently of `repo_grid.repo_list`. Repository cards can be hidden with `repo_grid.switch: false` while milestone activity remains enabled. There is no fallback to the repository grid list.

Blog publication dates, milestone due dates, and absolute repository update dates follow the visitor’s browser locale. Blog and milestone dates use UTC; repository update dates use the visitor’s local time zone.

The GitHub link opens in the current tab and remains the rightmost header action. In `auto` mode, the mark is the progressive fallback when JavaScript is unavailable; an early platform check retains it for desktop Linux and selects the wordmark elsewhere. Its destination comes from the account that owns the Pages repository: `jekyll-github-metadata` resolves that owner during deployment or from the Git `origin` during local development, which keeps forks portable. The link is omitted if owner metadata is unavailable. Add future header links before it in [`_includes/header.html`](./_includes/header.html) to retain this ordering.

### Find the bug game

With `find_the_bug_game.switch: true`, the GitHub icon can be dragged with a
mouse, pen or touch to reveal a CPU beneath it. Releasing it returns it to its
original position with a short spring bounce;
grabbing it during the return continues the drag. Ordinary clicks, taps and
keyboard activation still open GitHub. Escape cancels a drag, and reduced-motion
preferences make the return immediate. Without JavaScript, it remains an ordinary
link.

Repository and milestone cards can also be dragged with a mouse or pen. On touch
screens, drag their title icon; the rest of the card remains available for
scrolling. Moving a card reveals a CPU in its original space, at twice the
rendered size of the title icon. Cards spring back on release, with the same
Escape and reduced-motion behaviour as the GitHub icon. Their primary and
metadata links still support ordinary clicks, taps and keyboard activation.

On each full page load, one CPU beneath the GitHub icon, a repository card,
the theme switcher or a loaded milestone card is chosen at random. Each available
underlay has an equal chance of being chosen: it becomes a bug 90% of the time
and a squirrel 10% of the time. It keeps the same size and colour, and stays
hidden until dragged.
The choice stays fixed across partial reveals and theme changes until shuffled
or the page reloads. All other underlays remain CPUs. Unloaded milestone cards
stay outside the pool. Without JavaScript or drag support, the CPU fallback remains.

Fully uncover the bug or squirrel, release the item covering it, and let that
item finish landing in its original position. The creature stays in place while
the item is held, returning or shaking. Once every shake finishes and all items
are at rest, the game automatically restores the old CPU and chooses a different
available underlay with equal probability.
Each shuffle independently chooses a bug 90% of the time or a squirrel 10% of
the time; its new location stays hidden until dragged. There is no manual reset
control. Partial reveals and revealing a CPU do not trigger a shuffle.

Re-grabbing a returning item delays the shuffle until its next release and
completed return. Scrolling ends the drag and returns the item immediately to
its original position while preserving a fully revealed creature's shuffle.
The usual shake sequence starts once all items are at rest; scrolling during
shaking lets the existing sequence finish without restarting it. Other drag
cancellations, pressing Escape or forcing a layout reset discard the pending
shuffle. If another item is moving, the shuffle waits until all items are at
rest. The repository cards, GitHub icon, theme switcher and
loaded milestone cards then shake with independent horizontal movements of 1.5–6 px
over 640–880 ms. Dragging during this feedback stops only that item's shake;
the shuffle waits for the remaining shakes and for all items to return. The next
hiding place is chosen from the underlays available when the shuffle completes.
Milestone cards join the pool when they load and leave it when hidden. With only
one available hiding place, the creature stays put until a later find and return
can choose an alternative. The game also works without a repository section.
Reduced-motion preferences and unavailable animation support return the released
item immediately and reshuffle without shaking. Enabling reduced motion during
feedback stops the shakes and completes the shuffle once all items are at rest.

Full reveals share a counter for bugs and squirrels until the page reloads.
A find counts as soon as the creature is completely uncovered, before release,
landing or shaking. Each hiding place counts once until a shuffle chooses a
new one; repeated reveals, partial reveals and CPUs add nothing. Cancelling
after a full reveal keeps that discovery's credit. On the fifth find, a
bronze trophy Octicon fades in over 300 ms at the right of the repository cards
heading, alongside the title. Its height is 2rem, and its space is reserved
before it appears. A thin progress bar fades in beneath it at the same time,
matching the icon's width and the active light/dark palette. It starts empty
at each five-find stage and advances on every credited find towards silver,
gold, then game completion at twenty finds. Hovering over the trophy or bar
shows the total completed, progress within the current stage and finds remaining;
screen readers receive the same counts. On the tenth and fifteenth finds,
the icon makes one clockwise, coin-like turn over 600 ms, then changes to
silver and gold respectively.
Reduced motion or unavailable animation support applies these changes immediately.
Interrupted trophy animations settle to the earned tier. Progress survives
controller reinitialisation without replaying the effects, but resets on reload.
The twentieth full reveal ends the game and redirects the current tab to
https://www.khanacademy.org/. Counting and the redirect also work when the
repository cards section is absent; the trophy is omitted in that case.

When the switch is `false`, null or missing, the game and dragging of the GitHub
icon, repository cards and Recent Tasks cards are disabled. The theme button
remains draggable when `light_dark_ball.switch` is `true`. Links and theme
switching continue to work.
Jekyll excludes `assets/js/drag_reveal.js` from its output and omits the game's
script reference, bug/squirrel SVG template and trophy. The script is neither
optimised nor deployed, and rebuilding removes a copy left by an earlier
enabled build. Its source remains in the repository; shared styles and layout
wrappers remain part of the site. Re-enabling the game includes the script
again. Restart the preview after changing `_config.yml`.

### Title animation

With `paper_plane.switch: true`, a 16px paper plane rests to the right of the
homepage title at the rightmost point of its four-second figure-of-eight.
Pause the mouse or pen over any part of the title for 62.5 ms to launch it.
Moving within the title restarts that wait; passing across it without pausing
leaves the plane parked. Touch users tap the resting plane; keyboard users focus
its 44px control and press Enter or Space. The plane keeps the normal arrow
cursor on hover. Keyboard focus alone and an existing hover state during
initialisation do not start it.

Leaving the title, cancelling the pointer, scrolling, resizing the viewport,
losing window focus, hiding the tab or changing reduced-motion preferences
cancels a pending launch. A fresh title entry is needed to try again.

It turns with the flight path and alternates between passing in front of and
behind the lettering. Once launched, mouse and pen users keep it flying while
over the title; moving away starts the return. Keyboard users move focus away
from the control to return. Touch users touch elsewhere or scroll the page;
those interactions continue normally. There is no stop indicator.

The return completes the remaining figure-of-eight at 2× normal speed, taking
up to approximately two seconds, then parks the plane. Repeated activation
while flying or returning is ignored. Hovering back cannot restart a return;
a fresh title entry, tap or keyboard activation is needed after the plane parks.

Launching while the spinning icon is active makes the plane struggle to fly
away from it for two seconds, slowing and bobbing towards and away from the icon
along their connecting line before it is sucked in.
The plane keeps its escape heading throughout suction. Returning the icon home
before the plane disappears lets it turn and fly back to its resting point.

The plane follows the active theme's link colour and adapts to wrapped titles.
On wrapped titles, its resting point stays centred vertically on the whole
title block, at the rightmost point of the same path.
Without JavaScript, the plane and its launch control stay hidden. With JavaScript
enabled, reduced-motion preferences keep the plane stationary and hide its launch
control. Switching away from the browser tab suspends the animation.

When the switch is `false`, null or missing, the homepage keeps its plain title.
Jekyll excludes `assets/js/title_flight.js` from its output and omits the plane,
launch control and script reference. The script is neither optimised nor
deployed, and rebuilding removes a copy left by an earlier enabled build.
Its source remains in the repository, and its styles remain in the shared
stylesheet. Re-enabling the feature includes the script again. Restart the
preview after changing `_config.yml`.

### ASCII banner

When `ascii_banner.switch` is `false`, or the switch or section is missing,
Jekyll excludes `assets/js/ascii_banner.mjs` and the entire
`assets/js/ascii-rest/` directory from its output. The loader, scenes, renderer,
font and supporting files are neither optimised nor deployed. Rebuilding also
removes these files from an earlier enabled build. The sources remain in the
repository, and enabling the banner includes the complete catalogue again.
This applies to local previews as well as production builds; restart the
preview after changing `_config.yml`.

The banner uses locally hosted scene modules, a renderer and a fallback font from
[ascii.rest by Shubham (@bas3line)](https://github.com/bas3line/ascii). It loads
only the scene selected by `ascii_banner.module`; it makes no requests to
ascii.rest. The banner and its section divider stay hidden without JavaScript
or if its local component or scene cannot load. They appear after successful
scene initialisation. Animations pause off-screen and while the tab is hidden;
reduced-motion preferences show a still frame. The canvas scales to the content
width and retains the scene's aspect ratio.

Set `ascii_banner.module` to `random` to choose one of the local scenes with
equal probability when the page initialises. The selection lasts for that page;
opening or reloading the page makes a fresh choice, which may repeat the previous
scene. Only the chosen scene is loaded, and the banner and divider retain the
same JavaScript-dependent visibility behaviour.

Available scenes: `alpine-dawn`, `aurora-fjord`, `deep-reef`, `desert-night`,
`earthrise`, `kyoto-dusk`, `lantern-lake`, `marine-drive`, `misty-forest`,
`night-coast`, `ocean-sunset`, `storm-plains`, `taj-dawn`, `tokyo-rain`, and
`varanasi-ghats`.

The ready-to-use browser JavaScript is committed under
[`assets/js/ascii-rest/`](./assets/js/ascii-rest/). Its manifest records the pinned
upstream revision and source hashes. The upstream MIT licence and fallback
font's OFL licence are retained in that directory. Normal builds need no
upstream download or TypeScript compilation. To import a reviewed upstream
revision manually, use an authenticated GitHub CLI and Node 24:

```bash
node scripts/import_ascii_scenes.mjs <full-upstream-commit-sha>
```

Review the generated diff, run the tests and production build, and update this
scene list if the upstream catalogue changes.

### GitHub activity controller

Repository updates, recent milestones, and recent commits share [`assets/js/github_activity.js`](./assets/js/github_activity.js), one page-level configuration block, and one request coordinator. Each page visit permits at most 40 GitHub requests, with four running concurrently. The coordinator reserves budget before queueing, deduplicates identical in-flight requests, prioritises queued first pages over extra pages, and ends requests that have not finished reading their response after 15 seconds. Each section refresh has a 30-second deadline. Budget and deadline deferrals preserve collected and cached results without recording failures; queued work is cancelled and active requests are aborted only when no consumer still needs them. Browser locks and storage events avoid duplicate work between open tabs where those APIs are available.

Only genuine rate-limit responses pause all GitHub sections. The retry time follows `Retry-After` or `X-RateLimit-Reset`, with a one-minute fallback when neither supplies a future time. Network errors, request timeouts and server errors pause the affected section for five minutes; other resource errors retain the six-hour backoff. Old global transport-failure records are retired, while existing rate-limit records remain effective. Storage events render updated caches directly without starting requests, renewing freshness or recording failures.

Repository-card updates start immediately. Milestone and commit collection starts only when the corresponding section is within 800 pixels of the viewport; browsers without `IntersectionObserver` load those sections immediately. This changes when the work occurs, without changing the visible content or status states.

### Repository updates

Repository cards are generated from GitHub metadata during the site build. In the browser, the shared activity controller groups the cards by owner and refreshes their “Updated” labels with one GitHub API request per owner. The resulting repository catalogue is also reused by the commit loader.

Successful responses are cached in the visitor's `localStorage`. For seven days after a successful fetch or validation, the page uses the cached repository timestamps without a network request. After seven days, it continues to display the cached timestamps while conditionally revalidating them with GitHub using the stored ETag. An unchanged response renews the cache for another seven days without downloading the response body; a changed response replaces the cached data.

If revalidation fails or is deferred, the stale timestamps remain available. Genuine failures use the section retry periods described above. Cached repository data has no age-based expiration, but malformed and future-dated cache entries are removed. Cached labels appear before waiting for a browser refresh lock.

### Recent GitHub milestones

When `recent_milestones.switch` is enabled and the section approaches the viewport, the activity controller loads milestone activity from repositories in `recent_milestones.repo_list`. Each loader fetches 100 items per page, at most two pages per repository, and at most 12 pages per refresh, subject to the shared page-visit budget. First-page rounds precede second-page rounds, in configured repository order. On a first visit without cached data, each loader displays its global ranking once its bounded repository requests settle. All collection and processing occurs in the browser through GitHub's unauthenticated public REST API; no milestone data is scraped from GitHub HTML or collected during the site build.

The two milestones most recently closed on GitHub are displayed after the `Recent Tasks (GitHub issues)` heading. They are ranked globally by `milestone.closed_at`; the newest is shown at 75% opacity and the second at 50%. Each entry uses the milestone Octicon and the same link treatment as repository names in Recent Activity, and opens the milestone page filtered to closed issues. A milestone counts as completed when GitHub reports its state as closed, even if it still contains open issues. If fewer than two completed milestones exist, only the available entries are shown.

For the detailed cards, the controller requests closed, milestone-bearing issues. Pull requests and closed milestones are excluded; all closed issues are eligible regardless of whether GitHub marks them as completed or not planned. The loader groups issues by milestone and ranks each milestone by its most recently closed issue (`issue.closed_at`), not by changes to the milestone metadata itself. It requests pages in descending issue-activity order until the configured number of results is definitive or a limit is reached, then merges and globally ranks the candidates. Each row links to its repository and milestone and shows the description, due date when one is set, closed/total issue count, completion percentage and bar, and the plain-text title and labels of its latest closed issue. The label group is omitted when that issue has no labels. The ranking timestamp is intentionally not displayed. A successful search with no results displays `No open milestones with closed issues found`.

Results use the same seven-day cache policy as the other GitHub sections, including successful partial snapshots. Valid cached results appear immediately when the section approaches the viewport, including while waiting for another tab's refresh lock, and remain visible during revalidation. Each requested API page uses its own ETag; a 304 validates only that page. Detailed cards use the v5 cache format, while completed heading entries use an independent v2 cache. Earlier v4/v1 snapshots migrate as stale fallback data, retaining their ranked candidates even when they came from pages beyond the new limit. Limited and deferred states are recorded internally; partial results are displayed silently. Stale data is retained indefinitely, malformed or future-dated entries are removed, and genuine failures use the section retry periods described above. The section is hidden unless JavaScript initialises.

### Recent GitHub commits

When `recent_commits.switch` is enabled and the section approaches the viewport, the activity controller loads commits from the default branches of public repositories owned by the account hosting the site. Forks and archived repositories are excluded at build time and rechecked against the current repository catalogue before polling. Repositories confirmed missing from a complete, revalidated catalogue are also excluded. A partial or unavailable catalogue does not establish that a repository is missing. The section is hidden unless JavaScript initialises.

The browser requests at most the configured number of author-filtered commits from each eligible repository, combines the responses, sorts them by committed time, and displays the newest entries. If GitHub returns no qualifying results for a repository's username filter, the loader falls back to that repository's history and retains only commits linked to the owner account. Fallback requests fetch 100 commits per page, search at most two pages per repository, and share a limit of 12 requests per refresh. First pages are searched before second pages, with repositories prioritised by their latest push time and ties resolved in configured order. Searching stops once enough qualifying commits are found or no further page exists. An unavailable repository cannot prevent healthy repositories from displaying their commits.

Commits are rendered as a semantic unordered list in the form `repository · commit message · date`. Decorative repository, comment, and calendar Octicons identify each detail, while GitHub commit Octicons replace the native bullets and a vertical connector turns the list into a GitHub-style commit timeline. A successful request with no qualifying commits displays `No recent commits found`. When a search reaches a limit, collected commits and cached results from deferred searches remain available silently. Older owner-authored commits can be missed by this bounded search; reaching a limit is a successful partial result and does not trigger failure backoff.

The commit cache follows the repository-card policy: results remain fresh for seven days and are displayed without a network request. The cache records exclusions, each repository's request mode, and whether its search was limited or deferred. Author-filtered results have a repository ETag; fallback results cache data and ETags for each page separately. A 304 response validates only the page requested. Once the cache expires, the loader revalidates the shared repository catalogue, reconsiders exclusions, compares each repository's `pushed_at` value with the value stored alongside its commit result, and requests commits for new, changed, deferred or previously unverified repositories. Deferred searches retain their previous verified push time, or remain unverified if no previous result exists. Unchanged cached entries are merged into the displayed timeline. ETags are reused only for the same repository, request mode and page.

The v3 commit cache migrates v2 and earlier results as stale fallback data, clears their ETags and verified push times, and revalidates them once. Older commit-specific failure records are retired so the corrected loader can retry immediately; shared rate-limit protection remains in effect. With eight eligible repositories, one refresh makes at most eight author-filtered and 12 fallback commit requests, subject to the shared 40-request page-visit budget.

Cached commits or a successful cached empty state appear before waiting for a browser refresh lock and remain visible throughout revalidation. The gear Octicon with `loading recent commits` appears when no displayable cache exists. Genuine failures use the section retry periods described above; when no displayable cached result is available, an alert Octicon with `unable to load recent commits` replaces the loading state. Cached commits have no age-based expiration, while malformed and future-dated entries are removed.

### External posts

The page initially displays a normal “View Posts” archive link. When JavaScript is available, [`assets/js/external_blog.js`](./assets/js/external_blog.js) requests the configured feed through the keyless [RSS2JSON API](https://rss2json.com/docs) and replaces the fallback with recent posts.

Successful responses are cached in the visitor's `localStorage` for seven days, keyed by feed URL. During that period the page renders the cached posts without another proxy request. Invalid, unavailable, or expired cached data falls back to a new request. Requests that do not finish reading their response within 15 seconds are aborted; if any request fails, the archive link remains available.

### Theme preference

The page initially follows the visitor's operating-system light or dark preference. A fixed button in the bottom-right corner uses moon and sun GitHub Octicons to show the theme available on activation. Once selected, the explicit `light` or `dark` preference is stored in `localStorage` and reused across visits and open tabs.

With either `find_the_bug_game.switch` or `light_dark_ball.switch` enabled,
drag the theme button with a mouse, pen or touch to reveal a stationary CPU
Octicon at 1.5rem, matching the icon beneath
the GitHub link. Gentle releases near home spring back without changing the theme.
With `light_dark_ball.switch: true`, flicks launch the circular button with the
drag's release velocity. A slow drop also starts physics when the ball's centre
is more than two rendered diameters from its original position: 88 px for the
standard 44 px button, scaling with its size. Drops at or within that distance
keep the spring return unless their release speed reaches 300 px/s. Distant
drops preserve measured slow movement; releasing after a pause starts the ball
at rest. The simulation treats its rendered diameter as 6.7 cm:
ordinary gravity pulls down at 1G (9.80665 m/s²), and collisions with the viewport
edges lose energy like a tennis ball. From release, its original position
becomes a point of attraction. This adds 0G at release, 0.25G after one second,
0.5G after two seconds and 1G after four seconds. It continues growing smoothly
at 0.25G per second without a cap. Its strength is independent of distance and
adds to downward gravity. Within three ball diameters of home, gradual braking
grows with the current attraction. Home also acts as a magnet: a returning ball
snaps straight into place when its centre comes within one rendered ball
diameter of home, including the boundary, regardless of speed or attraction
strength. The radius is 44 px for the standard button and scales with its size.
This also catches a ball returning along the viewport floor just below home,
without waiting for the attraction to exceed downward gravity.
Throws released inside the magnetic zone can still move outwards. Capture
becomes active after they leave the zone, turn towards home or stop moving
within it. Holding and dragging the button remains under the visitor's control.
Delayed frames retain the real elapsed time for attraction, while limiting
physics catch-up to 100 ms per frame. Snapping into home resets the attraction to
0G. Catching the button starts another drag
from its current position; another flick or distant drop restarts the attraction
at 0G.
Ordinary clicks, taps, Enter and Space still switch themes. Escape parks a
thrown button immediately; scrolling, resizing, hiding the tab or losing focus
cancels the motion. Reduced-motion preferences skip the throw and park on
release. A completed discovery waits for the button to return home, all other
items to land and the shake feedback to finish before reshuffling.

The sun/moon icon rotates with the moving ball's angular momentum. The model
uses thin-shell inertia, with the same physical radius and time steps as its
linear motion. Grabbing away from the centre gives a throw spin according to
the grab offset and release velocity; a centred or radial throw starts without
spin. Contact friction at viewport boundaries transfers momentum between
travel and rotation, allowing spin to slow down or reverse and sliding on the
floor to become rolling without slipping. Overspin can accelerate floor travel,
while backspin brakes it. Gravity and home attraction act through the centre;
the existing braking near home also damps spin.

Catching freezes the icon at its current angle. Holding and dragging preserve
that angle, and another throw calculates fresh spin from its new grab and
release. After docking, the icon turns upright along the shortest route over
300 ms, easing to a stop without overshoot; an exact half turn goes clockwise.
Picking it up during this correction freezes the displayed angle for dragging
and subsequent throws. An ordinary click pauses correction while held and
resumes it on release. The correction is cosmetic and does not delay the
discovery game. Cancellation, reduced motion or unavailable animation support
restores the icon upright immediately. The button stays circular, and the
spinning vortex at home keeps its independent animation.

Each viewport rebound adds a pulse of the active palette's link/accent colour
to the ball's border. The fill and sun/moon icon keep their normal colours,
including on hover. Pulse strength follows the incoming momentum towards the
boundary: an impact at 1 m/s contributes 50% border colour, with harder hits
proportionally brighter and glancing hits fainter. Each pulse fades in linearly
over 80 ms and out over 800 ms. Overlapping pulses add together, with
the displayed border colour capped at 100%; a corner impact contributes two pulses.
Dragging into an edge or resting against it adds no pulses. The remaining
highlight finishes fading when the ball is caught or returns home, and another
throw can add to it. This cosmetic fade does not delay the discovery game.
Cancellation or a reduced-motion preference clears the highlight.

Throwing the ball or dropping it beyond two diameters from home also turns its
exposed CPU, bug or squirrel icon into a spinning vortex at home. The vortex
starts on release. A 36 px central disc uses the active palette's heading
colour, with the icon in the contrasting background colour. The icon rotates
clockwise, accelerating from rest by 0.5 turns per second each second,
up to 1.5 turns per second after three seconds. Catching, holding and releasing
again keep the same vortex clock running until the ball returns home. Returning
home or cancelling restores the stationary icon immediately. Reduced-motion
preferences disable the vortex. Its cosmetic animation does not delay the
discovery game or change the ball's physics.

A broad, soft halo around the spinning icon uses the active palette's link/accent
colour. Its opacity builds while the icon spins, reaching a 70% maximum after
three seconds. Two diffuse layers use a 12 px blur with 4 px spread and a
28 px blur with 8 px spread; the outer layer uses 55% colour strength. When the ball
returns home, rotation stops immediately and the halo fades from its current
strength over 150 ms, remaining briefly visible around the returned ball.
Cancellation or reduced motion clears the halo immediately. A new throw or
distant drop during the fade starts a fresh glow build from zero.


The spinning icon also attracts the paper plane when both features are enabled.
Two seconds after the first throw, a resting plane is tugged 12 px towards the
icon over 300 ms; after five seconds it detaches. A plane already flying before
the throw is pulled in at two seconds. Catches, holds, releases and rethrows
preserve these deadlines until the ball returns home.

Launching the plane while the icon spins starts a two-second struggle away from
the icon, with declining escape speed and bobbing along the radial line from
the icon through the plane. It always gets the full two seconds, even across
the original five-second deadline. Leaving the activation area or releasing
the ball does not interrupt the struggle. Holding a previously thrown ball
still allows mouse or pen activation in the usual title-and-plane area: the
same 62.5 ms stationary pause applies, even while the ball has pointer capture.

Suction accelerates the plane directly into the icon over 1,200 ms. The plane
stays 16 px throughout and disappears behind the icon when their centres meet.
If the ball returns home during the attached tug, the plane settles back over
250 ms. If it returns during struggle or suction, the detached plane turns
around and flies home over one second. Each return chooses a different smooth,
slightly wavy route, with varied wave spacing, direction and strength up to
12 px. Its destination follows the current title layout.

A swallowed plane and its launch control stay absent until the page reloads;
this state is not saved in browser storage. Cancellation or reduced motion
immediately restores any unswallowed plane and clears its pending effects.
The animation does not delay discovery-game completion.

When `light_dark_ball.switch` is `false`, null or missing, tennis-ball physics
are disabled. If the game is enabled, all theme-button releases use the normal
400 ms spring return. If both switches are disabled, the theme button stays
fixed and remains available for ordinary theme switching.

Jekyll excludes `assets/js/light_dark_ball.js` from disabled builds and removes
copies left by earlier enabled builds. The script is neither optimised nor
deployed. `assets/js/drag_surface.js` provides shared dragging and is included
only when either feature is enabled; game-specific code remains in
`assets/js/drag_reveal.js`, included only for the game. Enabled feature scripts
register with a single controller before dragging starts. Restart the preview
after changing either switch in `_config.yml`.

The controller routes pointer events through one set of global listeners, batches pointer transforms once per animation frame, and caches pickup geometry. One body observer watches displaced cards until they return home. Every pointer sample still reaches the ball physics and discovery game.

The theme is selected before the main stylesheet loads to avoid a mismatched-colour flash. If JavaScript or browser storage is unavailable, Minima's automatic colour scheme remains the fallback; storage failures do not prevent switching for the current page.

## Local development

### Prerequisites

- Ruby 3.3 and Bundler
- Python 3.11 and `pip` for local Python tests only
- Node.js 24 and npm for client-side tests and production asset optimisation
- Network access to download the latest remote Minima theme

### Install dependencies

```bash
bundle install
npm ci
```

### Preview locally

Set `JEKYLL_GITHUB_TOKEN` in the environment or authenticate the GitHub CLI with
`gh auth login --hostname github.com`, then run:

```bash
./preview.sh
```

The script validates the site configuration, starts Jekyll with LiveReload, and
opens <http://127.0.0.1:4000> in the default browser. Press Ctrl+C to stop it.
Jekyll serve options pass through to the preview, for example
`./preview.sh --port 4001`. The script uses installed dependencies without
installing or updating them; it prefers `JEKYLL_GITHUB_TOKEN` and otherwise
reads the active `github.com` credential from the GitHub CLI without printing
the token.

If GitHub returns a server error during the initial build, the preview retries
up to twice. If all three attempts fail and the selected destination contains
an existing build, it starts the preview from that build and warns that recent
edits may be missing. Without an existing build, it reports the failure and exits.
Restart `./preview.sh` to attempt a fresh build after GitHub recovers.

### Validate and build

```bash
bundle exec ruby scripts/validate_site_config.rb
JEKYLL_ENV=production ./scripts/build_site.sh
```

The Ruby validator is shared by the command above and Jekyll, which also validates merged configuration and overrides before rendering and on rebuilds. Python is needed only for local tests.

The build script validates `_config.yml` before writing the generated site to `_site`. Supply `JEKYLL_GITHUB_TOKEN` through the environment for authenticated build metadata. Production builds compress Sass and minify generated JavaScript with the locked Terser version, preserving licence comments and asset URLs. Repository sources stay readable; development previews retain CSS source maps. Gzip budgets are 16 KiB for the activity script, 28 KiB for the activity, theme, blog, title animation, shared drag controller and enabled game/ball scripts combined, 100 KiB for the complete ASCII JavaScript catalogue including its banner loader when enabled, and 8 KiB for the stylesheet. The browser loads only the selected scene from the catalogue. Disabled features exclude their optional assets and skip their optimisation and size checks. Exceeding a budget fails the build. npm dependencies and build tooling are excluded from the published site.

### Run tests

```bash
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests
npm test
npm run test:built
```

The built-asset tests require the production build above. They check that ASCII
assets match the generated banner markup, running banner behaviour tests when
enabled and checking asset absence when disabled. The optimiser tests also run
the banner suite against an enabled, minified fixture so it remains covered
regardless of the repository's banner setting. The paper plane tests follow
the same pattern: disabled builds verify that the script and markup are absent,
while source tests and an enabled, minified fixture exercise the animation.

Local regression tests cover readable sources, minified assets, configuration validation and Jekyll integration. Development CSS source maps remain available, and production output excludes maps, npm dependencies and build tooling.

| Gzipped asset | Before | After | Budget |
| --- | ---: | ---: | ---: |
| Activity JavaScript | 18,433 bytes | 14,527 bytes | 16 KiB |
| All client JavaScript | 22,792 bytes | 17,679 bytes | 28 KiB |
| Stylesheet | 7,141 bytes | 6,302 bytes | 8 KiB |

Local Chromium checks used eight repository fixtures, six linked pages per history and 20 ms simulated API latency. Older owner-authored commits were placed on page six, so the bounded search intentionally returned fewer commits. The following figures record one run with automatic page scrolling; timings and layout shifts are fixture measurements rather than field performance scores. Cold visits used at most four concurrent calls, while warm `localStorage` visits made no GitHub requests.

| Visit | GitHub calls before → after | Activity rendered before → after | CLS before → after |
| --- | ---: | ---: | ---: |
| Desktop cold, 1280 × 900 | 153 → 40 | 3,036 → 319 ms | 0.034 → 0.034 |
| Desktop warm | 0 → 0 | 40 → 56 ms | 0.018 → 0.028 |
| Mobile cold, 390 × 844 | 153 → 40 | 903 → 252 ms | 0.068 → 0.000 |
| Mobile warm | 0 → 0 | 54 → 74 ms | 0.000 → 0.000 |

Separate checks confirmed that cached commits stayed visible during a slow stale refresh and while another tab held the refresh locks. Storage events updated the waiting tab's timeline without requests or freshness changes. Desktop and mobile checks found no horizontal overflow or browser errors.

## How it works

| Area | Responsibility |
| --- | --- |
| Configuration | `_config.yml` defines site metadata, the header GitHub icon, homepage sections, and external-feed settings; Ruby validation rejects invalid enabled-section settings. |
| Page generation | Jekyll, Minima, Liquid includes, and custom Sass generate the static site. |
| GitHub activity | `assets/js/github_activity.js` coordinates repository updates, milestones, and commits through one switch-aware configuration, request queue, failure policy, and cross-tab cache integration. |
| Repository data | `jekyll-github-metadata` supplies repository cards during the build; the shared controller refreshes update labels and revalidates its local catalogue weekly using GitHub ETags. |
| Recent milestones | The controller polls configured public repositories near the viewport, ranks open milestones by their latest closed issue, and displays the two most recently closed milestones beside the section heading. Both paginated result sets are conditionally revalidated each week. |
| Recent commits | Build metadata supplies eligible repository names; the controller loads author-linked commits near the viewport and, on weekly refresh, polls only repositories whose push timestamp changed. |
| External posts | Browser JavaScript loads the configured blog feed through RSS2JSON, renders it safely, and caches it locally for seven days. |
| Theme preference | Minima supplies the light and dark palettes; `assets/js/theme_toggle.js` applies and persists the visitor's explicit override. |
| Deployment | `.github/workflows/deploy-pages.yml` validates, builds, uploads, and deploys the site. |
| Repository mirror | `.github/workflows/gitlab-main-mirror.yml` keeps GitLab `main` aligned with GitHub `main`. |

Client-side features use progressive enhancement: the automatic GitHub header style falls back to the mark, repository cards remain available without GitHub API updates, the ASCII banner, recent-milestone and recent-commit sections stay hidden without JavaScript, the blog archive link remains available without JavaScript or RSS2JSON, and the theme continues to follow the system colour preference without the switcher.

## Deployment

The GitHub Actions workflow deploys pushes to `main` that can affect the published site or its build, and it can also be started manually. Pushes that change only the README, `LICENSE`, `.gitignore`, tests, or GitLab mirror workflow are skipped.

During deployment, the workflow:

1. installs the locked Ruby and npm dependencies
2. validates `_config.yml` and builds production assets with authenticated GitHub metadata
3. uploads and deploys `_site` to GitHub Pages

Tests in `tests/` remain available to run locally; the deployment workflow does not run them or depend on their results.

## GitLab mirror

GitHub `main` is the source of truth for the GitLab mirror. Every push to `main` starts the `Mirror main to GitLab` workflow, which also supports manual dispatch. The workflow verifies that both repositories finish on the same commit SHA and may force-update GitLab after a GitHub history rewrite.

Mirroring uses an SSH deploy-key pair. Store the private key in the GitHub repository secret `GITLAB_MIRROR_SSH_KEY`, and enable the corresponding public key as a read-write deploy key for the GitLab project at the same owner and repository path. Add that deploy key to the protected `main` branch's **Allowed to push and merge** setting. To synchronise rewritten GitHub history, also enable **Allowed to force push** for the branch. The cleanup workflow keeps the latest completed run for each workflow so the most recent mirror result remains available for troubleshooting.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| Repository cards are missing locally | Confirm each configured repository belongs to the site owner's account. Set `JEKYLL_GITHUB_TOKEN` in the shell if unauthenticated GitHub metadata is incomplete. Never commit the token. |
| Recent milestones are stale | The browser cache lasts seven days. Clear the site's `recent-milestones:v5:` and `recent-completed-milestones:v2:` local-storage entries to force an immediate refresh. |
| “unable to load recent milestones” appears | Confirm every configured repository is public and belongs to the site owner, the browser can reach `api.github.com`, and the visitor has not exhausted GitHub's unauthenticated API limit. |
| The recent-milestone section is missing | Confirm `recent_milestones.switch` is `true` and JavaScript is enabled; the section intentionally remains hidden when JavaScript does not initialise. |
| Recent commits are stale | The browser cache lasts seven days. Cached results remain visible during revalidation. Clear the site's `localStorage` to force a new request. |
| “unable to load recent commits” appears | Confirm the browser can reach `api.github.com` and has not exhausted GitHub's unauthenticated API limit. Forked and archived repositories are intentionally excluded. |
| The recent-commit section is missing | Confirm `recent_commits.switch` is enabled and JavaScript is available; the entire section intentionally remains hidden when JavaScript does not initialise. |
| External posts are stale | The browser cache lasts seven days. Clear the site's `localStorage` to force an immediate RSS2JSON refresh. |
| Only “View Posts (external site)” appears | Confirm JavaScript is enabled and the browser can reach `api.rss2json.com`; the link is the intentional fallback. |
| The theme no longer follows the system | Clear the site's `lib-port:theme:v1` local-storage entry to remove the explicit light or dark preference. |
| The header GitHub icon is missing | Confirm `github_icon.switch` is `true`, its `link` and `style` values are supported, and GitHub owner metadata is available during the build. |
| The GitLab mirror is stale | Check the latest `Mirror main to GitLab` run. Confirm `GITLAB_MIRROR_SSH_KEY` contains the private deploy key, its public counterpart remains enabled on the GitLab project with read-write access, and protected `main` allows that deploy key to push. If rewritten history must be mirrored, also confirm that the branch allows force pushes. Manually dispatch the workflow after correcting the problem. |
| The build cannot download Minima | Confirm the environment can reach GitHub and `codeload.github.com`, then rerun the build. |
| Configuration validation fails | Use YAML booleans for switches and provide every field required by an enabled section. |

## Customisation notes

Custom homepage markup lives in `_includes`, while component styling lives in [`_sass/minima/custom-styles.scss`](./_sass/minima/custom-styles.scss). Refer to the [Minima documentation](https://github.com/jekyll/minima) for broader theme customisation.

Minima's built-in feed configuration can conflict with this project's external-feed settings. The `jekyll-feed` dependency remains because Minima expects it, but the homepage intentionally links to the configured external feed instead of presenting the generated site feed.

The `remote_theme` setting intentionally omits a version or commit reference so each build uses the latest Minima revision.

## Licence

This project is available under the [MIT Licence](./LICENSE).
