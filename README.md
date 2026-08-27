# PrairieLearn Calendar (draft)

A local-first Chrome/Edge extension that reads the PrairieLearn assessments visible to your signed-in browser and turns their credit-window deadlines into an Apple Calendar feed.

## What the draft does

- Discovers all courses on the PrairieLearn homepage.
- Reads each course's assessment table without storing login cookies or credentials.
- Uses the exact timestamps in PrairieLearn's **Access details**.
- Creates one event for every positive-credit window (for example, 110%, 100%, and 80%).
- Uses `COURSE NUMBER · assignment name` as the title and puts the available-credit percentage in the event details.
- Keeps stable calendar event IDs, so subscribed calendars update existing events.
- Scans when you visit PrairieLearn (at most every 30 minutes), once an hour while a PrairieLearn tab remains open, or whenever you press **Scan PrairieLearn**.
- Offers a one-time `.ics` download even when the local companion is not running.

Assignments with no end time in PrairieLearn are recorded in the extension status but are not added to the calendar. For example, the currently visible ECE 330 HW1 exposes `100%` credit with no end date, so inventing a cutoff would be unsafe.

## 1. Run the local calendar companion

Requires Node.js 18 or newer.

```bash
cd /Users/steven/Documents/PLCalendar
npm start
```

Keep that process running. It listens only on your own computer at `127.0.0.1:49321`; it does not upload course data anywhere.

## 2. Load the extension

In Edge, open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select:

```text
/Users/steven/Documents/PLCalendar/extension
```

Refresh the PrairieLearn tab once after loading the extension. Open the extension popup and press **Scan PrairieLearn**.

## 3. Subscribe from Apple Calendar

In Apple Calendar, choose **File → New Calendar Subscription…** and enter:

```text
http://127.0.0.1:49321/calendar.ics
```

Choose an auto-refresh interval. The extension updates the feed when it scans; Apple Calendar pulls those changes on its own refresh schedule.

To keep the timed calendar and add a second calendar whose deadlines appear in Apple Calendar's all-day area, create another subscription using:

```text
http://127.0.0.1:49321/calendar-all-day.ics
```

Both feeds use the same scanned data and update together. The all-day feed keeps the precise cutoff time and available-credit percentage in each event's details.

## Verify the companion

- Status page: <http://127.0.0.1:49321/>
- Health check: <http://127.0.0.1:49321/health>
- Calendar feed: <http://127.0.0.1:49321/calendar.ics>
- All-day calendar feed: <http://127.0.0.1:49321/calendar-all-day.ics>

Run the local checks with:

```bash
npm test
npm run check
```

## Current boundaries

- The draft supports `https://us.prairielearn.com`. Additional PrairieLearn hosts can be added to the manifest.
- Scanning requires at least one open PrairieLearn tab so the extension can use the existing signed-in session.
- The companion must be running for a live Apple Calendar subscription. The `.ics` download remains available as a manual fallback.
- Microsoft To Do is a sensible next adapter, but it would require Microsoft OAuth and Graph permissions. The calendar feed gets the first version working without handing credentials to this project.

## Good next features

1. Native macOS launch agent so the companion starts automatically at login.
2. Per-course colors and filters.
3. Notifications when PrairieLearn adds or changes a deadline.
4. Microsoft To Do sync with explicit OAuth consent.
5. Canvas and course-website adapters feeding the same normalized event format.
