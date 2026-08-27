/* global chrome, PLCalendarCore */
"use strict";

const elements = {
  scan: document.querySelector("#scan"),
  download: document.querySelector("#download"),
  autoSync: document.querySelector("#auto-sync"),
  endpoint: document.querySelector("#endpoint"),
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
  const [{ settings }, { snapshot }] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get("snapshot")
  ]);
  const merged = { ...PLCalendarCore.DEFAULT_SETTINGS, ...(settings || {}) };
  elements.autoSync.checked = merged.autoSync;
  elements.endpoint.value = merged.syncEndpoint;
  elements.download.disabled = !snapshot?.events?.length;
  renderSnapshot(snapshot);
}

async function saveSettings() {
  const settings = {
    autoSync: elements.autoSync.checked,
    syncEndpoint: elements.endpoint.value.trim() || PLCalendarCore.DEFAULT_SETTINGS.syncEndpoint
  };
  await chrome.storage.sync.set({ settings });
  elements.feedState.textContent = settings.autoSync ? "Local feed enabled" : "Manual .ics export only";
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
      elements.feedState.textContent = "Scanned; local companion is not running";
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

for (const element of [elements.autoSync, elements.endpoint]) {
  element.addEventListener("change", saveSettings);
}

load().catch((error) => showStatus("Could not load", error.message, true));
