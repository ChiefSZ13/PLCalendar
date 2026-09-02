const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitUntilHealthy(baseUrl, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Server did not become healthy:\n${output()}`);
}

test("protects remote writes and calendar feeds with separate tokens", async (context) => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "plcalendar-test-"));
  const port = await availablePort();
  const writeToken = "test-write-token";
  const feedToken = "test-feed-token";
  let logs = "";
  const child = spawn(process.execPath, ["companion/server.mjs"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PLCALENDAR_HOST: "127.0.0.1",
      PLCALENDAR_PORT: String(port),
      PLCALENDAR_DATA_DIR: dataDirectory,
      PLCALENDAR_WRITE_TOKEN: writeToken,
      PLCALENDAR_FEED_TOKEN: feedToken
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntilHealthy(baseUrl, child, () => logs);

  const snapshot = {
    scannedAt: "2026-09-01T12:00:00.000Z",
    courseCount: 1,
    events: [{
      uid: "pl-test-100pct@plcalendar.local",
      title: "ECE 330 · Homework 1",
      start: "2026-09-04T04:59:59.000Z",
      end: "2026-09-04T05:14:59.000Z",
      allDayDate: "2026-09-03",
      description: "Available credit: 100%",
      url: "https://us.prairielearn.com/example",
      category: "Homework"
    }]
  };

  const unauthorizedWrite = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  assert.equal(unauthorizedWrite.status, 401);

  const authorizedWrite = await fetch(`${baseUrl}/api/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${writeToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(snapshot)
  });
  assert.equal(authorizedWrite.status, 200);
  assert.equal((await authorizedWrite.json()).eventCount, 1);

  assert.equal((await fetch(`${baseUrl}/calendar.ics`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/feeds/wrong/calendar.ics`)).status, 404);

  const timedFeed = await fetch(`${baseUrl}/feeds/${feedToken}/calendar.ics`);
  assert.equal(timedFeed.status, 200);
  assert.match(await timedFeed.text(), /SUMMARY:ECE 330 · Homework 1/);

  const allDayFeed = await fetch(`${baseUrl}/feeds/${feedToken}/calendar-all-day.ics`);
  assert.equal(allDayFeed.status, 200);
  assert.match(await allDayFeed.text(), /DTSTART;VALUE=DATE:20260903/);
});
