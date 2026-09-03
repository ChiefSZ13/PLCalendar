import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toICS } = require("../extension/core.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.resolve(process.env.PLCALENDAR_DATA_DIR || path.join(projectRoot, "data"));
const sourceConfig = Object.freeze({
  prairieLearn: {
    eventsPath: path.join(dataDirectory, "events.json"),
    apiPath: "/api/events",
    timedFilename: "calendar.ics",
    allDayFilename: "calendar-all-day.ics",
    calendarName: "PrairieLearn Deadlines"
  },
  gradescope: {
    eventsPath: path.join(dataDirectory, "gradescope-events.json"),
    apiPath: "/api/gradescope/events",
    timedFilename: "gradescope.ics",
    allDayFilename: "gradescope-all-day.ics",
    calendarName: "Gradescope Deadlines"
  }
});
const port = Number(process.env.PLCALENDAR_PORT || 49321);
const host = process.env.PLCALENDAR_HOST || "127.0.0.1";
const writeToken = process.env.PLCALENDAR_WRITE_TOKEN?.trim() || "";
const feedToken = process.env.PLCALENDAR_FEED_TOKEN?.trim() || "";
const publicBaseUrl = (process.env.PLCALENDAR_PUBLIC_BASE_URL || "").replace(/\/$/, "");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PLCALENDAR_PORT must be an integer between 1 and 65535");
}

await mkdir(dataDirectory, { recursive: true });

function permittedOrigin(origin) {
  if (!origin) return null;
  if (["https://us.prairielearn.com", "https://www.gradescope.com", "https://gradescope.com"].includes(origin)
      || origin.startsWith("chrome-extension://")) return origin;
  return null;
}

function setCors(request, response) {
  const origin = permittedOrigin(request.headers.origin);
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function tokenMatches(provided, expected) {
  if (!expected) return true;
  const providedBuffer = Buffer.from(provided || "");
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function bearerToken(request) {
  const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function feedDefinition(filename) {
  for (const [source, config] of Object.entries(sourceConfig)) {
    if (filename === config.timedFilename) return { source, allDay: false, filename, config };
    if (filename === config.allDayFilename) return { source, allDay: true, filename, config };
  }
  return null;
}

function calendarKind(pathname) {
  const legacy = pathname.match(/^\/([^/]+\.ics)$/);
  if (legacy && !feedToken) return feedDefinition(legacy[1]);

  const protectedFeed = pathname.match(/^\/feeds\/([^/]+)\/([^/]+\.ics)$/);
  if (!protectedFeed || !tokenMatches(decodeURIComponent(protectedFeed[1]), feedToken)) return null;
  return feedDefinition(protectedFeed[2]);
}

function feedPath(filename) {
  return feedToken ? `/feeds/FEED_TOKEN/${filename}` : `/${filename}`;
}

function latestTimestamp(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

async function readSnapshot(source = "prairieLearn") {
  try {
    const parsed = JSON.parse(await readFile(sourceConfig[source].eventsPath, "utf8"));
    return parsed && Array.isArray(parsed.events) ? parsed : { events: [] };
  } catch (error) {
    if (error.code === "ENOENT") return { events: [] };
    throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 2_000_000) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function writeSnapshot(source, snapshot) {
  const temporaryPath = path.join(dataDirectory, `${source}-events-${crypto.randomUUID()}.json.next`);
  try {
    await writeFile(temporaryPath, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, sourceConfig[source].eventsPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  setCors(request, response);
  const url = new URL(request.url, `http://${host}:${port}`);

  if (request.method === "OPTIONS") {
    if (request.headers.origin && !permittedOrigin(request.headers.origin)) {
      response.writeHead(403);
    } else {
      response.writeHead(204);
    }
    response.end();
    return;
  }

  try {
    const uploadSource = Object.entries(sourceConfig)
      .find(([, config]) => config.apiPath === url.pathname)?.[0];
    if (request.method === "POST" && uploadSource) {
      if (request.headers.origin && !permittedOrigin(request.headers.origin)) {
        sendJson(response, 403, { ok: false, error: "Origin is not permitted" });
        return;
      }
      if (!tokenMatches(bearerToken(request), writeToken)) {
        sendJson(response, 401, { ok: false, error: "A valid write token is required" }, {
          "WWW-Authenticate": "Bearer"
        });
        return;
      }

      const snapshot = await readBody(request);
      if (!Array.isArray(snapshot.events) || snapshot.events.length > 5000) {
        sendJson(response, 400, { ok: false, error: "Expected an events array with at most 5000 entries" });
        return;
      }
      const stored = {
        source: uploadSource,
        scannedAt: snapshot.scannedAt || new Date().toISOString(),
        courseCount: Number(snapshot.courseCount || 0),
        events: snapshot.events
      };
      await writeSnapshot(uploadSource, stored);
      sendJson(response, 200, {
        ok: true,
        source: uploadSource,
        eventCount: stored.events.length,
        updatedAt: stored.scannedAt
      });
      return;
    }

    const kind = request.method === "GET" ? calendarKind(url.pathname) : null;
    if (kind) {
      const snapshot = await readSnapshot(kind.source);
      response.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="${kind.filename}"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(toICS(snapshot.events, new Date(), kind.allDay ? {
        allDay: true,
        calendarName: `${kind.config.calendarName} (All Day)`
      } : { calendarName: kind.config.calendarName }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const prairieLearn = await readSnapshot("prairieLearn");
      const gradescope = await readSnapshot("gradescope");
      sendJson(response, 200, {
        ok: true,
        eventCount: prairieLearn.events.length + gradescope.events.length,
        updatedAt: latestTimestamp(prairieLearn.scannedAt, gradescope.scannedAt),
        sources: {
          prairieLearn: { eventCount: prairieLearn.events.length, updatedAt: prairieLearn.scannedAt || null },
          gradescope: { eventCount: gradescope.events.length, updatedAt: gradescope.scannedAt || null }
        }
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const prairieLearn = await readSnapshot("prairieLearn");
      const gradescope = await readSnapshot("gradescope");
      const base = publicBaseUrl || `http://${host}:${port}`;
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      response.end(`<!doctype html><meta charset="utf-8"><title>Course Deadline Calendar</title><style>body{font:16px -apple-system,sans-serif;max-width:760px;margin:64px auto;padding:0 24px;color:#18303a}code{background:#eef5f4;padding:3px 6px;border-radius:5px}</style><h1>Course Deadline Calendar is running</h1><h2>PrairieLearn (${prairieLearn.events.length} events)</h2><p>Timed feed: <code>${base}${feedPath("calendar.ics")}</code></p><p>All-day feed: <code>${base}${feedPath("calendar-all-day.ics")}</code></p><h2>Gradescope (${gradescope.events.length} events)</h2><p>Timed feed: <code>${base}${feedPath("gradescope.ics")}</code></p><p>All-day feed: <code>${base}${feedPath("gradescope-all-day.ics")}</code></p>`);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { ok: false, error: status === 400 ? "Request body must be valid JSON" : error.message });
  }
});

server.listen(port, host, () => {
  const base = publicBaseUrl || `http://${host}:${port}`;
  console.log(`Course Deadline Calendar companion: ${base}/`);
  console.log(`PrairieLearn timed feed: ${base}${feedPath("calendar.ics")}`);
  console.log(`PrairieLearn all-day feed: ${base}${feedPath("calendar-all-day.ics")}`);
  console.log(`Gradescope timed feed: ${base}${feedPath("gradescope.ics")}`);
  console.log(`Gradescope all-day feed: ${base}${feedPath("gradescope-all-day.ics")}`);
  if (!writeToken) console.warn("Warning: PLCALENDAR_WRITE_TOKEN is not set; uploads are unauthenticated.");
  if (!feedToken) console.warn("Warning: PLCALENDAR_FEED_TOKEN is not set; calendar feeds are public.");
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
