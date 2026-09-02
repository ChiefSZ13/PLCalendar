/* global chrome, PLCalendarCore */
(() => {
  "use strict";

  let activeScan = null;

  async function fetchDocument(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`PrairieLearn returned HTTP ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function loadSettings() {
    const [{ settings }, { connection }] = await Promise.all([
      chrome.storage.sync.get("settings"),
      chrome.storage.local.get("connection")
    ]);
    return {
      ...PLCalendarCore.DEFAULT_SETTINGS,
      ...(settings || {}),
      writeToken: connection?.writeToken || ""
    };
  }

  async function performScan() {
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
        writeToken: settings.writeToken,
        snapshot
      });
    }
    return { ...snapshot, sync, syncAttempted: settings.autoSync };
  }

  function scanPrairieLearn() {
    if (activeScan) return activeScan;
    activeScan = performScan().finally(() => {
      activeScan = null;
    });
    return activeScan;
  }

  function showRefreshBubble({ title, detail, tone = "success" }) {
    document.querySelector("#pl-calendar-refresh-bubble")?.remove();

    const bubble = document.createElement("div");
    bubble.id = "pl-calendar-refresh-bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    Object.assign(bubble.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      maxWidth: "min(360px, calc(100vw - 40px))",
      padding: "11px 14px",
      border: tone === "warning" ? "1px solid #f6c453" : "1px solid #5dd3c8",
      borderRadius: "12px",
      color: "#f8fafc",
      background: tone === "warning" ? "#7c4a03" : "#115e59",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.24)",
      font: "13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none",
      opacity: "0",
      transform: "translateY(8px)",
      transition: "opacity 180ms ease, transform 180ms ease"
    });

    const icon = document.createElement("span");
    icon.textContent = tone === "warning" ? "!" : "✓";
    Object.assign(icon.style, {
      display: "grid",
      flex: "0 0 24px",
      width: "24px",
      height: "24px",
      placeItems: "center",
      borderRadius: "50%",
      color: tone === "warning" ? "#7c4a03" : "#115e59",
      background: tone === "warning" ? "#fde68a" : "#99f6e4",
      fontWeight: "800"
    });

    const copy = document.createElement("span");
    const heading = document.createElement("strong");
    const description = document.createElement("span");
    heading.textContent = title;
    description.textContent = detail;
    Object.assign(heading.style, { display: "block", fontWeight: "700" });
    Object.assign(description.style, { display: "block", marginTop: "1px", color: "rgba(248, 250, 252, 0.82)" });
    copy.append(heading, description);
    bubble.append(icon, copy);
    document.documentElement.appendChild(bubble);

    requestAnimationFrame(() => {
      bubble.style.opacity = "1";
      bubble.style.transform = "translateY(0)";
    });

    window.setTimeout(() => {
      bubble.style.opacity = "0";
      bubble.style.transform = "translateY(8px)";
      window.setTimeout(() => bubble.remove(), 200);
    }, 4200);
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
    try {
      const result = await scanPrairieLearn();
      const time = new Date(result.scannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (!result.syncAttempted) {
        showRefreshBubble({
          title: "PrairieLearn automatically refreshed",
          detail: `${result.events.length} credit windows · calendar sync is off`,
          tone: "warning"
        });
      } else if (result.sync && !result.sync.ok) {
        showRefreshBubble({
          title: "PrairieLearn refreshed",
          detail: `${result.events.length} credit windows at ${time} · calendar server unavailable`,
          tone: "warning"
        });
      } else {
        showRefreshBubble({
          title: "Calendar automatically updated",
          detail: `${result.events.length} credit windows · ${time}`
        });
      }
    } catch (error) {
      console.warn("PrairieLearn Calendar automatic scan failed:", error.message);
      showRefreshBubble({
        title: "Automatic refresh failed",
        detail: error.message,
        tone: "warning"
      });
    }
  }

  // Every PrairieLearn page load performs a no-cache scan of all courses and
  // immediately pushes the resulting snapshot to the configured companion.
  window.setTimeout(automaticScan, 1500);
})();
