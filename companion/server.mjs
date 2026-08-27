import http from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { toICS } = require("../extension/core.js");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(projectRoot, "data");
const eventsPath = path.join(dataDirectory, "events.json");
const temporaryEventsPath = path.join(dataDirectory, "events.json.next");
const port = Number(process.env.PLCALENDAR_PORT || 49321);
const host = "127.0.0.1";

await mkdir(dataDirectory, { recursive: true });

function permittedOrigin(origin) {
  if (!origin) return null;
  if (origin === "https://us.prairielearn.com" || origin.startsWith("chrome-extension://")) return origin;
  return null;
}

function setCors(request, response) {
  const origin = permittedOrigin(request.headers.origin);
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(eventsPath, "utf8"));
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

const server = http.createServer(async (request, response) => {
  setCors(request, response);
  const url = new URL(request.url, `http://${host}:${port}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "POST" && url.pathname === "/api/events") {
      if (request.headers.origin && !permittedOrigin(request.headers.origin)) {
        sendJson(response, 403, { ok: false, error: "Origin is not permitted" });
        return;
      }
      const snapshot = await readBody(request);
      if (!Array.isArray(snapshot.events) || snapshot.events.length > 5000) {
        sendJson(response, 400, { ok: false, error: "Expected an events array with at most 5000 entries" });
        return;
      }
      const stored = {
        scannedAt: snapshot.scannedAt || new Date().toISOString(),
        courseCount: Number(snapshot.courseCount || 0),
        events: snapshot.events
      };
      await writeFile(temporaryEventsPath, JSON.stringify(stored, null, 2), "utf8");
      await rename(temporaryEventsPath, eventsPath);
      sendJson(response, 200, { ok: true, eventCount: stored.events.length, updatedAt: stored.scannedAt });
      return;
    }

    if (request.method === "GET" && url.pathname === "/calendar.ics") {
      const snapshot = await readSnapshot();
      response.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "inline; filename=\"prairielearn-deadlines.ics\"",
        "Cache-Control": "no-cache"
      });
      response.end(toICS(snapshot.events));
      return;
    }

    if (request.method === "GET" && url.pathname === "/calendar-all-day.ics") {
      const snapshot = await readSnapshot();
      response.writeHead(200, {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "inline; filename=\"prairielearn-deadlines-all-day.ics\"",
        "Cache-Control": "no-cache"
      });
      response.end(toICS(snapshot.events, new Date(), {
        allDay: true,
        calendarName: "PrairieLearn Deadlines (All Day)"
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/health") {
      const snapshot = await readSnapshot();
      sendJson(response, 200, {
        ok: true,
        eventCount: snapshot.events.length,
        updatedAt: snapshot.scannedAt || null
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/") {
      const snapshot = await readSnapshot();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(`<!doctype html><meta charset="utf-8"><title>PrairieLearn Calendar</title><style>body{font:16px -apple-system,sans-serif;max-width:680px;margin:64px auto;padding:0 24px;color:#18303a}code{background:#eef5f4;padding:3px 6px;border-radius:5px}</style><h1>PrairieLearn Calendar is running</h1><p>${snapshot.events.length} calendar events are available.</p><p>Timed feed: <code>http://${host}:${port}/calendar.ics</code></p><p>All-day feed: <code>http://${host}:${port}/calendar-all-day.ics</code></p>`);
      return;
    }

    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`PrairieLearn Calendar companion: http://${host}:${port}/`);
  console.log(`Timed Apple Calendar feed: http://${host}:${port}/calendar.ics`);
  console.log(`All-day Apple Calendar feed: http://${host}:${port}/calendar-all-day.ics`);
});
