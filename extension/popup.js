/* global chrome, PLCalendarCore */
"use strict";

const SOURCE_META = Object.freeze({
  prairieLearn: {
    label: "PrairieLearn",
    patterns: ["https://us.prairielearn.com/*"],
    snapshotKey: "snapshot",
    coursesElement: "#prairielearn-courses",
    summaryElement: "#prairielearn-summary",
    hasCourses: true,
    downloadFilename: "prairielearn-deadlines.ics"
  },
  gradescope: {
    label: "Gradescope",
    patterns: ["https://www.gradescope.com/*", "https://gradescope.com/*"],
    snapshotKey: "gradescopeSnapshot",
    coursesElement: "#gradescope-courses",
    summaryElement: "#gradescope-summary",
    hasCourses: true,
    downloadFilename: "gradescope-deadlines.ics"
  },
  prairieTest: {
    label: "PrairieTest",
    patterns: ["https://us.prairietest.com/*"],
    snapshotKey: "prairieTestSnapshot",
    coursesElement: null,
    summaryElement: "#prairietest-summary",
    hasCourses: false,
    downloadFilename: "prairietest-reservations.ics"
  }
});

const elements = {
  scan: document.querySelector("#scan"),
  downloads: {
    prairieLearn: document.querySelector("#download-prairielearn"),
    gradescope: document.querySelector("#download-gradescope"),
    prairieTest: document.querySelector("#download-prairietest")
  },
  sourceToggles: {
    prairieLearn: document.querySelector("#monitor-prairielearn"),
    gradescope: document.querySelector("#monitor-gradescope"),
    prairieTest: document.querySelector("#monitor-prairietest")
  },
  autoSync: document.querySelector("#auto-sync"),
  endpoint: document.querySelector("#endpoint"),
  writeToken: document.querySelector("#write-token"),
  saveConnection: document.querySelector("#save-connection"),
  title: document.querySelector("#status-title"),
  detail: document.querySelector("#status-detail"),
  feedState: document.querySelector("#feed-state")
};

let currentSettings = PLCalendarCore.normalizeSettings();
let snapshots = { prairieLearn: null, gradescope: null, prairieTest: null };

function showStatus(title, detail, isError = false) {
  elements.title.textContent = title;
  elements.detail.textContent = detail;
  elements.title.style.color = isError ? "#b42318" : "";
}

function selectedIdsFromUi(source) {
  return Array.from(document.querySelectorAll(`[data-course-source="${source}"]`))
    .filter((input) => input.checked)
    .map((input) => input.value);
}

function renderCourses(source) {
  const meta = SOURCE_META[source];
  if (!meta.hasCourses) return;
  const container = document.querySelector(meta.coursesElement);
  const courses = snapshots[source]?.courses || [];
  const selection = currentSettings.selectedCourseIds[source];
  container.replaceChildren();

  for (const course of courses) {
    const label = document.createElement("label");
    label.className = "course-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(course.id);
    checkbox.dataset.courseSource = source;
    checkbox.checked = selection === null || selection.includes(String(course.id));
    const copy = document.createElement("span");
    copy.textContent = course.name;
    if (Number.isInteger(course.assignmentCount)) {
      const count = document.createElement("small");
      count.textContent = `${course.assignmentCount} assignment${course.assignmentCount === 1 ? "" : "s"}`;
      copy.append(count);
    }
    label.append(checkbox, copy);
    container.append(label);
  }
}

function renderSummaries() {
  for (const [source, meta] of Object.entries(SOURCE_META)) {
    const snapshot = snapshots[source];
    const eventCount = snapshot?.events?.length ?? 0;
    if (meta.hasCourses) {
      const courses = snapshot?.courses || [];
      const selection = currentSettings.selectedCourseIds[source];
      const selectedCount = selection === null
        ? (courses.length || snapshot?.courseCount || 0)
        : selection.length;
      document.querySelector(meta.summaryElement).textContent = snapshot
        ? currentSettings.enabledSources[source]
          ? `${selectedCount} selected · ${eventCount} event${eventCount === 1 ? "" : "s"}`
          : `${selectedCount} selected · monitoring off`
        : source === "gradescope" ? "Open Gradescope once to discover courses" : "No scan yet";
    } else {
      document.querySelector(meta.summaryElement).textContent = currentSettings.enabledSources[source]
        ? snapshot ? `${eventCount} reservation${eventCount === 1 ? "" : "s"}` : "Open PrairieTest to sync reservations"
        : "Monitoring off";
    }
    elements.downloads[source].disabled = !eventCount;
  }
  const totalEvents = Object.entries(snapshots).reduce((sum, [source, snapshot]) => (
    sum + (currentSettings.enabledSources[source] ? snapshot?.events?.length || 0 : 0)
  ), 0);
  const latest = Object.values(snapshots)
    .map((snapshot) => snapshot?.scannedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  showStatus(
    `${totalEvents} calendar events across enabled sources`,
    latest ? `Last scan ${new Date(latest).toLocaleString()}` : "Choose sources and courses, then scan."
  );
}

function render() {
  elements.autoSync.checked = currentSettings.autoSync;
  elements.endpoint.value = currentSettings.syncEndpoint;
  for (const source of Object.keys(SOURCE_META)) {
    elements.sourceToggles[source].checked = currentSettings.enabledSources[source];
  }
  renderCourses("prairieLearn");
  renderCourses("gradescope");
  renderSummaries();
}

async function load() {
  const [{ settings }, local] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get(["snapshot", "gradescopeSnapshot", "prairieTestSnapshot", "connection"])
  ]);
  currentSettings = PLCalendarCore.normalizeSettings(settings || {});
  snapshots = {
    prairieLearn: local.snapshot || null,
    gradescope: local.gradescopeSnapshot || null,
    prairieTest: local.prairieTestSnapshot || null
  };
  elements.writeToken.value = local.connection?.writeToken || "";
  render();
}

async function requestEndpointPermission(endpoint) {
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The endpoint must use HTTP or HTTPS.");
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Remote calendar servers must use HTTPS.");
  }
  const origin = `${url.protocol}//${url.host}/*`;
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });
  if (!hasPermission) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error("Edge needs permission to connect to this calendar server.");
  }
}

async function saveSettings({ requestPermission = false } = {}) {
  const endpoint = elements.endpoint.value.trim() || PLCalendarCore.DEFAULT_SETTINGS.syncEndpoint;
  if (requestPermission && elements.autoSync.checked) await requestEndpointPermission(endpoint);
  currentSettings = PLCalendarCore.normalizeSettings({
    ...currentSettings,
    autoSync: elements.autoSync.checked,
    syncEndpoint: endpoint,
    enabledSources: {
      prairieLearn: elements.sourceToggles.prairieLearn.checked,
      gradescope: elements.sourceToggles.gradescope.checked,
      prairieTest: elements.sourceToggles.prairieTest.checked
    },
    selectedCourseIds: {
      prairieLearn: snapshots.prairieLearn?.courses?.length
        ? selectedIdsFromUi("prairieLearn")
        : currentSettings.selectedCourseIds.prairieLearn,
      gradescope: snapshots.gradescope?.courses?.length
        ? selectedIdsFromUi("gradescope")
        : currentSettings.selectedCourseIds.gradescope
    }
  });
  await Promise.all([
    chrome.storage.sync.set({ settings: currentSettings }),
    chrome.storage.local.set({ connection: { writeToken: elements.writeToken.value.trim() } })
  ]);
  return currentSettings;
}

async function findSourceTab(source) {
  for (const pattern of SOURCE_META[source].patterns) {
    const tabs = await chrome.tabs.query({ url: pattern });
    const tab = tabs.find((candidate) => candidate.id);
    if (tab) return tab;
  }
  return null;
}

async function scanSource(source) {
  const tab = await findSourceTab(source);
  if (!tab?.id) {
    if (currentSettings.enabledSources[source]) {
      throw new Error(`Open ${SOURCE_META[source].label} in a browser tab.`);
    }
    return null;
  }
  const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
  if (!response?.ok) throw new Error(response?.error || `${SOURCE_META[source].label} scan failed.`);
  snapshots[source] = response.result;
  return response.result;
}

elements.scan.addEventListener("click", async () => {
  elements.scan.disabled = true;
  showStatus("Scanning…", "Reading enabled courses, assignments, and exam reservations.");
  try {
    await saveSettings({ requestPermission: true });
    const results = await Promise.allSettled(Object.keys(SOURCE_META).map(scanSource));
    render();
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason.message);
    if (failures.length) showStatus("Scan partly completed", failures.join(" "), true);
    else elements.feedState.textContent = currentSettings.autoSync ? "Calendar feeds updated" : "Local snapshots updated";
  } catch (error) {
    showStatus("Scan failed", error.message, true);
  } finally {
    elements.scan.disabled = false;
  }
});

for (const source of Object.keys(SOURCE_META)) {
  if (SOURCE_META[source].hasCourses) {
    document.querySelector(SOURCE_META[source].coursesElement).addEventListener("change", async (event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      try {
        await saveSettings();
        renderSummaries();
        elements.feedState.textContent = "Course selection saved; scan to apply it";
      } catch (error) {
        showStatus("Could not save course selection", error.message, true);
      }
    });
  }

  elements.sourceToggles[source].addEventListener("change", async () => {
    try {
      await saveSettings();
      renderSummaries();
      elements.feedState.textContent = `${SOURCE_META[source].label} monitoring ${elements.sourceToggles[source].checked ? "enabled" : "disabled"}; scan to apply it`;
    } catch (error) {
      showStatus("Could not save source setting", error.message, true);
    }
  });

  elements.downloads[source].addEventListener("click", async () => {
    const snapshot = snapshots[source];
    if (!snapshot?.events?.length) return;
    const ics = PLCalendarCore.toICS(snapshot.events, new Date(), {
      calendarName: source === "prairieTest" ? "PrairieTest Reservations" : `${SOURCE_META[source].label} Deadlines`,
      calendarDescription: source === "prairieTest"
        ? "Automatically collected PrairieTest exam reservations"
        : `Automatically collected ${SOURCE_META[source].label} deadlines`,
      alarmLabel: source === "prairieTest" ? "PrairieTest exam" : `${SOURCE_META[source].label} deadline`
    });
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_ICS",
      ics,
      filename: SOURCE_META[source].downloadFilename
    });
    if (!response?.ok) showStatus("Download failed", response?.error || "Unknown error", true);
  });
}

elements.autoSync.addEventListener("change", () => {
  saveSettings({ requestPermission: true }).then(() => {
    elements.feedState.textContent = elements.autoSync.checked ? "Calendar server sync enabled" : "Calendar server sync disabled";
  }).catch((error) => showStatus("Could not save", error.message, true));
});

elements.saveConnection.addEventListener("click", async () => {
  elements.saveConnection.disabled = true;
  try {
    await saveSettings({ requestPermission: true });
    showStatus("Connection saved", "All three sources will use this calendar server.");
  } catch (error) {
    showStatus("Could not save connection", error.message, true);
  } finally {
    elements.saveConnection.disabled = false;
  }
});

load().catch((error) => showStatus("Could not load", error.message, true));
