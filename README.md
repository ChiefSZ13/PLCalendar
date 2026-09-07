# Course Deadline Calendar

A private Edge/Chrome extension and self-hosted calendar service that keep PrairieLearn deadlines, Gradescope deadlines, and PrairieTest exam reservations synchronized with Apple Calendar.

## How it works

```text
PrairieLearn, Gradescope, or PrairieTest in your signed-in browser
                              │
                              │ HTTPS snapshots + private write token
                              ▼
                     Self-hosted Docker service
                              │
                              ├── PrairieLearn timed + all-day feeds
                              ├── Gradescope timed + all-day feeds
                              └── PrairieTest timed reservation feed
```

The extension is the collector. Passwords, cookies, university SSO credentials, and source pages remain in the browser; the server receives only normalized calendar events. Opening any supported site triggers a no-cache refresh, and an hourly background scan refreshes open site tabs. A small non-blocking bubble reports the result.

The popup has independent switches for all three sources plus persistent course checkboxes for PrairieLearn and Gradescope. PrairieTest has no course selector and synchronizes every reservation currently shown by the scheduling system. Gradescope starts disabled with no courses selected, while PrairieLearn and PrairieTest start enabled.

Event IDs are stable, so rescanning updates an existing Apple Calendar item instead of creating a duplicate. Titles use `COURSE NUMBER · assignment name`. In-progress work is prefixed with `🟡`, and completed work with `✅`.

### PrairieLearn events

Every positive-credit cutoff becomes an event. Its details include the available-credit percentage, exact cutoff, score, question progress, completion reason, and PrairieLearn link.

Completion combines the score, currently available-credit ceiling, and awarded points for every question. An assignment is completed when its score reaches the current ceiling with no attempted question below full points, or when every question has full points. An attempted question below full points remains in progress. This handles bonus totals above 100% and changing late-credit ceilings.

### Gradescope events

Every selected course assignment with a due date becomes one event. A Gradescope `Submitted` or `Graded` assignment is completed; draft or in-progress work is marked in progress. The details retain the reported status, exact due time, late due time when present, course name, and assignment link.

### PrairieTest events

Every exam reservation becomes one timed event using the exact scheduled start and duration. Event details include the original PrairieTest title, start time, duration, testing-center location, room details, delivery format, accommodation status, and reservation link. The testing room is also written to Apple Calendar's location field. Stable reservation IDs allow rescheduled exams to update in place.

## Load the extension

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository's `extension` directory.
4. Refresh any PrairieLearn, Gradescope, and PrairieTest tabs that were already open.
5. Open each service once so the extension can discover its courses.
6. Open the extension popup, enable the sources you want, select PrairieLearn or Gradescope courses as needed, and press **Scan enabled sources**.

Selections are saved in browser-synced extension storage. The private server write token stays in local extension storage.

## Local development

Requires Node.js 18 or newer.

```bash
npm start
```

The default service listens only at `127.0.0.1:49321` and does not require tokens. Run validation with:

```bash
npm test
npm run check
```

Local upload endpoints:

```text
http://127.0.0.1:49321/api/events
http://127.0.0.1:49321/api/gradescope/events
http://127.0.0.1:49321/api/prairietest/events
```

Local calendar feeds:

```text
http://127.0.0.1:49321/calendar.ics
http://127.0.0.1:49321/calendar-all-day.ics
http://127.0.0.1:49321/gradescope.ics
http://127.0.0.1:49321/gradescope-all-day.ics
http://127.0.0.1:49321/prairietest.ics
```

## Deploy with Docker

The Compose stack runs the Node service as an unprivileged user, stores calendar snapshots in a persistent Docker volume, and puts Caddy in front for automatic HTTPS. It works on `linux/amd64` and `linux/arm64` hosts.

Prerequisites:

- Docker Engine and the Docker Compose plugin
- A domain whose DNS A/AAAA record points to the server
- Inbound TCP ports 80 and 443, plus optional UDP 443, allowed by the firewall

On the server:

```bash
git clone https://github.com/YOUR-ACCOUNT/PLCalendar.git
cd PLCalendar
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the domain, released image, and two independently generated secrets in `.env`. Never commit this file.

```dotenv
PLCALENDAR_DOMAIN=calendar.example.com
PLCALENDAR_IMAGE=ghcr.io/your-account/plcalendar:v0.7.0
PLCALENDAR_WRITE_TOKEN=first-generated-secret
PLCALENDAR_FEED_TOKEN=second-generated-secret
```

Start the stack:

```bash
docker compose pull
docker compose up -d --no-build
docker compose ps
```

The `plcalendar-data` volume survives image upgrades and container replacement. Caddy certificate state uses separate persistent volumes.

## Connect the extension to the server

In the extension popup, enter the PrairieLearn upload endpoint and write token:

```text
Calendar server endpoint: https://calendar.example.com/api/events
Private write token:      the value of PLCALENDAR_WRITE_TOKEN
```

Press **Save connection** and approve access to that exact server if Edge asks. The extension derives the Gradescope (`/api/gradescope/events`) and PrairieTest (`/api/prairietest/events`) upload endpoints from this address automatically.

## Subscribe with Apple Calendar

Use **File → New Calendar Subscription…** and replace the placeholders with your domain and `PLCALENDAR_FEED_TOKEN`:

```text
# PrairieLearn exact-time and all-day feeds
https://calendar.example.com/feeds/FEED_TOKEN/calendar.ics
https://calendar.example.com/feeds/FEED_TOKEN/calendar-all-day.ics

# Gradescope exact-time and all-day feeds
https://calendar.example.com/feeds/FEED_TOKEN/gradescope.ics
https://calendar.example.com/feeds/FEED_TOKEN/gradescope-all-day.ics

# PrairieTest scheduled exam feed
https://calendar.example.com/feeds/FEED_TOKEN/prairietest.ics
```

The timed feeds preserve exact deadlines or reservation intervals. The all-day feeds display assignment deadlines in Apple Calendar's all-day area while keeping exact times and other metadata in the event details. PrairieTest intentionally has no all-day feed. Subscribe only to the source/layout combinations you want. Treat every subscription URL as private because it contains the read token.

## Publish releases to GitHub Container Registry

The GitHub Actions workflow builds multi-platform images and publishes them to `ghcr.io` whenever a semantic version tag is pushed:

```bash
git tag -a v0.7.0 -m "Release v0.7.0"
git push origin v0.7.0
```

The workflow publishes immutable version and commit tags plus convenience `0.7` and `latest` tags. Pin production to the full version (for example, `v0.7.0`) so upgrades and rollbacks stay deliberate.

For a private image, authenticate the server before pulling:

```bash
echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u YOUR-ACCOUNT --password-stdin
```

The token needs only package-read access and should remain on the server.

## Upgrade or roll back

Change `PLCALENDAR_IMAGE` in `.env` to the desired release, then run:

```bash
docker compose pull plcalendar
docker compose up -d --no-deps --no-build plcalendar
docker compose ps
curl --fail https://calendar.example.com/health
```

Rollback uses the same commands after changing the image back. Do not run `docker compose down -v`; `-v` deletes stored snapshots and Caddy state.

## Security boundaries

- Remote deployments require HTTPS and use separate write and calendar-feed tokens.
- The server never receives PrairieLearn, Gradescope, or PrairieTest credentials, cookies, or raw pages.
- `.env` and `data/` are ignored by Git and excluded from Docker builds.
- Anyone holding a feed URL can read that source's calendar snapshot, so rotate `PLCALENDAR_FEED_TOKEN` if a URL is exposed.
- Scanning still requires open, signed-in browser sessions. Remote hosting removes the always-on laptop server; it does not automate SSO or MFA.
