/* global chrome, PLCalendarCore */
"use strict";

const elements = {
  scan: document.querySelector("#scan"),
  download: document.querySelector("#download"),
  autoSync: document.querySelector("#auto-sync"),
  endpoint: document.querySelector("#endpoint"),
  writeToken: document.querySelector("#write-token"),
  saveConnection: document.querySelector("#save-connection"),
  title: document.querySelector("#status-title"),
  detail: document.querySelector("#status-detail"),
  feedState: document.querySelector("#feed-state")
};

function showStatus(title, detail, isError = false) {
  elements.title.textContent = title;
  elements.detail.textContent = detail;
  elements.title.style.color = isError ? "#b42318" : "";
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  const deadlineCount = snapshot.events.length;
  const missing = snapshot.assessments.filter((item) => !item.tiers.some((tier) => tier.end && tier.credit > 0)).length;
  showStatus(
    `${deadlineCount} credit windows across ${snapshot.courseCount} courses`,
    `Last scan ${new Date(snapshot.scannedAt).toLocaleString()}${missing ? ` · ${missing} items have no posted cutoff` : ""}`
  );
  elements.download.disabled = !snapshot.events.length;
}

async function load() {
  const [{ settings }, { snapshot, connection }] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get(["snapshot", "connection"])
  ]);
  const merged = { ...PLCalendarCore.DEFAULT_SETTINGS, ...(settings || {}) };
  elements.autoSync.checked = merged.autoSync;
  elements.endpoint.value = merged.syncEndpoint;
  elements.writeToken.value = connection?.writeToken || "";
  elements.download.disabled = !snapshot?.events?.length;
  renderSnapshot(snapshot);
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

async function saveSettings() {
  const endpoint = elements.endpoint.value.trim() || PLCalendarCore.DEFAULT_SETTINGS.syncEndpoint;
  if (elements.autoSync.checked) await requestEndpointPermission(endpoint);
  const settings = {
    autoSync: elements.autoSync.checked,
    syncEndpoint: endpoint
  };
  await Promise.all([
    chrome.storage.sync.set({ settings }),
    chrome.storage.local.set({ connection: { writeToken: elements.writeToken.value.trim() } })
  ]);
  elements.feedState.textContent = settings.autoSync ? "Calendar sync enabled" : "Manual .ics export only";
}

elements.scan.addEventListener("click", async () => {
  elements.scan.disabled = true;
  showStatus("Scanning…", "Reading course and assessment pages.");
  try {
    await saveSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith("https://us.prairielearn.com/")) {
      throw new Error("Open a PrairieLearn tab before scanning.");
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN" });
    if (!response?.ok) throw new Error(response?.error || "The scan did not complete.");
    renderSnapshot(response.result);
    if (response.result.sync && !response.result.sync.ok) {
      elements.feedState.textContent = "Scanned; calendar server is unavailable";
    } else if (elements.autoSync.checked) {
      elements.feedState.textContent = "Calendar feed updated";
    }
  } catch (error) {
    showStatus("Scan failed", error.message, true);
  } finally {
    elements.scan.disabled = false;
  }
});

elements.download.addEventListener("click", async () => {
  const { snapshot } = await chrome.storage.local.get("snapshot");
  if (!snapshot?.events?.length) return;
  const ics = PLCalendarCore.toICS(snapshot.events);
  const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_ICS", ics });
  if (!response?.ok) showStatus("Download failed", response?.error || "Unknown error", true);
});

elements.autoSync.addEventListener("change", () => {
  saveSettings().catch((error) => showStatus("Could not save", error.message, true));
});

elements.saveConnection.addEventListener("click", async () => {
  elements.saveConnection.disabled = true;
  try {
    await saveSettings();
    showStatus("Connection saved", "The next PrairieLearn scan will use this calendar server.");
  } catch (error) {
    showStatus("Could not save connection", error.message, true);
  } finally {
    elements.saveConnection.disabled = false;
  }
});

load().catch((error) => showStatus("Could not load", error.message, true));
