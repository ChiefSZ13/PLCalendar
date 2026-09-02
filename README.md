# PrairieLearn Calendar

A private Chrome/Edge extension and self-hosted calendar service that turn the PrairieLearn credit windows visible to your signed-in browser into continuously updated Apple Calendar feeds.

## How it works

```text
PrairieLearn in your signed-in browser
                │
                │ HTTPS snapshot + private write token
                ▼
       Self-hosted Docker service
                │
                ├── timed ICS feed
                └── all-day ICS feed
```

The browser extension is the collector, so PrairieLearn passwords, cookies, and university SSO credentials never go to the server. Every PrairieLearn page load performs a fresh scan and uploads the result. The server stores only the latest normalized calendar snapshot.

Each positive-credit cutoff becomes a stable calendar event. The title is `COURSE NUMBER · assignment name`; work in progress is prefixed with `🟡` and completed work with `✅`. The available-credit percentage, exact cutoff, completion reason, question progress, score, and PrairieLearn link are in the event details. Stable event IDs let Apple Calendar update existing events when PrairieLearn changes a credit window or completion state.

Completion combines the score, PrairieLearn's currently available-credit ceiling, and the awarded points shown for every question. An assignment is completed when its score reaches the current ceiling with no attempted question below full points, or when every question has full points. An attempted question below full points always keeps the assignment in progress. Opened variants with no awarded points do not count as attempts. This handles changing late-credit ceilings and bonus totals without treating a merely opened question as finished. The same rule is applied to timed and all-day feeds on every automatic scan.

## Local development

Requires Node.js 18 or newer.

```bash
npm start
```

The default local service listens only at `127.0.0.1:49321` and does not require tokens. Run the checks with:

```bash
npm test
npm run check
```

Load the extension by opening `edge://extensions`, enabling **Developer mode**, choosing **Load unpacked**, and selecting the repository's `extension` directory. Refresh an open PrairieLearn tab after reloading the extension.

Local feed URLs:

```text
http://127.0.0.1:49321/calendar.ics
http://127.0.0.1:49321/calendar-all-day.ics
```

## Deploy with Docker

The production Compose stack runs the Node service as an unprivileged user, keeps calendar data in a persistent Docker volume, and places Caddy in front of it for automatic HTTPS. It works on any `linux/amd64` or `linux/arm64` Docker host.

Prerequisites:

- A server with Docker Engine and the Docker Compose plugin.
- A domain whose DNS A/AAAA record points to the server.
- Inbound TCP ports 80 and 443, plus optional UDP 443, allowed by the firewall.

On the server:

```bash
git clone https://github.com/YOUR-ACCOUNT/PLCalendar.git
cd PLCalendar
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

Put the domain, released image name, and the two independently generated values into `.env`. Never commit that file.

```dotenv
PLCALENDAR_DOMAIN=calendar.example.com
PLCALENDAR_IMAGE=ghcr.io/your-account/plcalendar:v0.5.0
PLCALENDAR_WRITE_TOKEN=first-generated-secret
PLCALENDAR_FEED_TOKEN=second-generated-secret
```

Start the stack:

```bash
docker compose pull
docker compose up -d --no-build
docker compose ps
```

The persistent `plcalendar-data` volume survives image upgrades and container replacement. Caddy stores its certificates in separate persistent volumes.

## Connect the Edge extension

Open the extension popup and enter:

```text
Calendar server endpoint: https://calendar.example.com/api/events
Private write token:      the value of PLCALENDAR_WRITE_TOKEN
```

Press **Save connection** and approve access to that exact server when Edge asks. The write token is stored in extension-local storage rather than browser-synced storage. Opening or reloading PrairieLearn will then scan and upload automatically; the small confirmation bubble reports whether the server update succeeded.

## Subscribe with Apple Calendar

Use **File → New Calendar Subscription…** and replace the placeholders below with your domain and `PLCALENDAR_FEED_TOKEN` value:

```text
https://calendar.example.com/feeds/FEED_TOKEN/calendar.ics
https://calendar.example.com/feeds/FEED_TOKEN/calendar-all-day.ics
```

The first feed preserves exact cutoff times. The second displays each cutoff in Apple Calendar's all-day area while retaining its precise time and available-credit percentage in the details. Treat subscription URLs as private because they contain the read token.

## Publish releases to GitHub Container Registry

The included GitHub Actions workflow builds multi-platform images and publishes them to `ghcr.io` whenever a semantic version tag is pushed:

```bash
git tag -a v0.5.0 -m "Release v0.5.0"
git push origin v0.5.0
```

The workflow publishes immutable version and commit tags, plus convenience `0.5` and `latest` tags. Pin the server to the full version such as `v0.5.0` instead of `latest` so upgrades and rollbacks are deliberate.

For a public image, change the package visibility to public in GitHub after its first publication. For a private image, authenticate the server before pulling:

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

Rollback uses exactly the same commands after changing the image back to the previous version. Do not run `docker compose down -v`; the `-v` option deletes the stored calendar data and Caddy state.

## Security boundaries

- Remote deployments require HTTPS and use separate write and calendar-feed tokens.
- The server never receives PrairieLearn credentials or cookies.
- `.env` and `data/` are ignored by Git and excluded from Docker builds.
- Anyone holding the feed URL can read the calendar snapshot, so rotate `PLCALENDAR_FEED_TOKEN` if the URL is exposed.
- A scan still requires an open, signed-in PrairieLearn browser session. Hosting the companion remotely removes the always-on laptop server; it does not attempt to automate university SSO or MFA.
