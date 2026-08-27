/* global chrome, PLCalendarCore */
(() => {
  "use strict";

  let scanning = false;

  async function fetchDocument(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`PrairieLearn returned HTTP ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function loadSettings() {
    const stored = await chrome.storage.sync.get("settings");
    return { ...PLCalendarCore.DEFAULT_SETTINGS, ...(stored.settings || {}) };
  }

  async function scanPrairieLearn() {
    if (scanning) throw new Error("A scan is already running");
    scanning = true;
    try {
      const homepage = location.pathname === "/" ? document : await fetchDocument("https://us.prairielearn.com/");
      const courseUrls = PLCalendarCore.findCourseUrls(homepage, "https://us.prairielearn.com/");
      if (!courseUrls.length) throw new Error("No PrairieLearn courses were found. Make sure you are signed in.");

      const results = await Promise.allSettled(courseUrls.map(async (url) => {
        const courseDocument = location.href.replace(/\/$/, "") === url.replace(/\/$/, "")
          ? document
          : await fetchDocument(url);
        return PLCalendarCore.parseCourseDocument(courseDocument, url);
      }));

      const assessments = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      const failedCourses = results.filter((result) => result.status === "rejected").length;
      const settings = await loadSettings();
      const events = PLCalendarCore.buildCalendarEvents(assessments, settings);
      const snapshot = {
        scannedAt: new Date().toISOString(),
        courseCount: courseUrls.length,
        failedCourses,
        assessments,
        events
      };
      await chrome.storage.local.set({ snapshot });

      let sync = null;
      if (settings.autoSync) {
        sync = await chrome.runtime.sendMessage({
          type: "SYNC_LOCAL",
          endpoint: settings.syncEndpoint,
          snapshot
        });
      }
      return { ...snapshot, sync };
    } finally {
      scanning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "SCAN") return false;
    scanPrairieLearn().then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  });

  async function automaticScan() {
    const { snapshot } = await chrome.storage.local.get("snapshot");
    const age = snapshot?.scannedAt ? Date.now() - new Date(snapshot.scannedAt).getTime() : Infinity;
    if (age < 30 * 60 * 1000) return;
    try {
      await scanPrairieLearn();
    } catch (error) {
      console.warn("PrairieLearn Calendar automatic scan failed:", error.message);
    }
  }

  window.setTimeout(automaticScan, 1500);
})();
