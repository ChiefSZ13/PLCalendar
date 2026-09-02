/* global chrome */
"use strict";

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("scan-reminder", { periodInMinutes: 60 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "scan-reminder") return;
  const tabs = await chrome.tabs.query({ url: "https://us.prairielearn.com/*" });
  const tab = tabs.find((candidate) => candidate.id);
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: "SCAN" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SYNC_LOCAL") {
    const endpoint = message.endpoint || "http://127.0.0.1:49321/api/events";
    const headers = { "Content-Type": "application/json" };
    if (message.writeToken) headers.Authorization = `Bearer ${message.writeToken}`;
    fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message.snapshot)
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Calendar companion returned HTTP ${response.status}`);
      sendResponse({ ok: true, result: await response.json() });
    }).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "DOWNLOAD_ICS") {
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(message.ics)}`;
    chrome.downloads.download({ url, filename: "prairielearn-deadlines.ics", saveAs: true }).then(
      (downloadId) => sendResponse({ ok: true, downloadId }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  }
  return false;
});
