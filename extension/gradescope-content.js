/* global chrome, PLCalendarCore, GradescopeCalendarCore */
(() => {
  "use strict";

  let activeScan = null;

  async function fetchDocument(url) {
    const response = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Gradescope returned HTTP ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  }

  async function loadSettings() {
    const [{ settings }, { connection }] = await Promise.all([
      chrome.storage.sync.get("settings"),
      chrome.storage.local.get("connection")
    ]);
    return PLCalendarCore.normalizeSettings({
      ...(settings || {}),
      writeToken: connection?.writeToken || ""
    });
  }

  function samePage(first, second) {
    const normalize = (value) => new URL(value).href.replace(/\/$/, "");
    return normalize(first) === normalize(second);
  }

  async function performScan() {
    const homepage = location.pathname === "/"
      ? document
      : await fetchDocument("https://www.gradescope.com/");
    const courses = GradescopeCalendarCore.parseGradescopeCourses(homepage, "https://www.gradescope.com/");
    if (!courses.length) throw new Error("No Gradescope courses were found. Make sure you are signed in.");

    const settings = await loadSettings();
    const selectedCourses = settings.enabledSources.gradescope
      ? courses.filter((course) => PLCalendarCore.isCourseSelected(settings, "gradescope", course.id))
      : [];
    const results = await Promise.allSettled(selectedCourses.map(async (course) => {
      const courseDocument = samePage(location.href, course.url) ? document : await fetchDocument(course.url);
      return GradescopeCalendarCore.parseGradescopeCourseDocument(courseDocument, course.url);
    }));
    const assignments = results.flatMap((result) => result.status === "fulfilled" ? result.value.assignments : []);
    const events = GradescopeCalendarCore.buildGradescopeEvents(assignments);
    const snapshot = {
      source: "gradescope",
      scannedAt: new Date().toISOString(),
      enabled: settings.enabledSources.gradescope,
      courses,
      courseCount: selectedCourses.length,
      discoveredCourseCount: courses.length,
      failedCourses: results.filter((result) => result.status === "rejected").length,
      assignments,
      events
    };
    await chrome.storage.local.set({ gradescopeSnapshot: snapshot });

    let sync = null;
    if (settings.autoSync) {
      sync = await chrome.runtime.sendMessage({
        type: "SYNC_LOCAL",
        endpoint: PLCalendarCore.sourceSyncEndpoint(settings.syncEndpoint, "gradescope"),
        writeToken: settings.writeToken,
        snapshot
      });
    }
    return { ...snapshot, sync, syncAttempted: settings.autoSync };
  }

  function scanGradescope() {
    if (activeScan) return activeScan;
    activeScan = performScan().finally(() => { activeScan = null; });
    return activeScan;
  }

  function showRefreshBubble({ title, detail, tone = "success" }) {
    document.querySelector("#pl-calendar-refresh-bubble")?.remove();
    const bubble = document.createElement("div");
    bubble.id = "pl-calendar-refresh-bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    Object.assign(bubble.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: "2147483647",
      maxWidth: "min(380px, calc(100vw - 40px))", padding: "11px 14px",
      border: tone === "warning" ? "1px solid #f6c453" : "1px solid #5dd3c8",
      borderRadius: "12px", color: "#f8fafc",
      background: tone === "warning" ? "#7c4a03" : "#115e59",
      boxShadow: "0 10px 30px rgba(15, 23, 42, 0.24)",
      font: "13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      pointerEvents: "none", opacity: "0", transform: "translateY(8px)",
      transition: "opacity 180ms ease, transform 180ms ease"
    });
    const heading = document.createElement("strong");
    const description = document.createElement("span");
    heading.textContent = title;
    description.textContent = detail;
    Object.assign(heading.style, { display: "block", fontWeight: "700" });
    Object.assign(description.style, { display: "block", marginTop: "2px", color: "rgba(248, 250, 252, 0.82)" });
    bubble.append(heading, description);
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
    scanGradescope().then(
      (result) => sendResponse({ ok: true, result }),
      (error) => sendResponse({ ok: false, error: error.message })
    );
    return true;
  });

  async function automaticScan() {
    try {
      const result = await scanGradescope();
      const time = new Date(result.scannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (!result.enabled) {
        showRefreshBubble({
          title: "Gradescope monitoring is off",
          detail: `${result.discoveredCourseCount} courses available in extension settings`,
          tone: "warning"
        });
      } else if (!result.syncAttempted) {
        showRefreshBubble({
          title: "Gradescope automatically refreshed",
          detail: `${result.events.length} due dates · calendar sync is off`,
          tone: "warning"
        });
      } else if (result.sync && !result.sync.ok) {
        showRefreshBubble({
          title: "Gradescope refreshed",
          detail: `${result.events.length} due dates at ${time} · calendar server unavailable`,
          tone: "warning"
        });
      } else {
        showRefreshBubble({
          title: "Gradescope calendar updated",
          detail: `${result.events.length} due dates · ${time}`
        });
      }
    } catch (error) {
      console.warn("Gradescope Calendar automatic scan failed:", error.message);
      showRefreshBubble({ title: "Gradescope refresh failed", detail: error.message, tone: "warning" });
    }
  }

  window.setTimeout(automaticScan, 1500);
})();
