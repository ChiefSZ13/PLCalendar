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
    return PLCalendarCore.normalizeSettings({
      ...PLCalendarCore.DEFAULT_SETTINGS,
      ...(settings || {}),
      writeToken: connection?.writeToken || ""
    });
  }

  function samePage(first, second) {
    const normalize = (value) => {
      const url = new URL(value);
      url.hash = "";
      return url.href.replace(/\/$/, "");
    };
    return normalize(first) === normalize(second);
  }

  async function enrichAssessmentCompletions(assessments) {
    const enriched = [...assessments];
    let nextIndex = 0;
    let failedChecks = 0;

    async function worker() {
      while (nextIndex < enriched.length) {
        const index = nextIndex++;
        const assessment = enriched[index];
        const baseline = assessment.completion || PLCalendarCore.determineCompletion(assessment);
        if (baseline.status === "not_started" || !assessment.url.includes("/assessment_instance/")) {
          enriched[index] = { ...assessment, completion: baseline };
          continue;
        }

        try {
          const assessmentDocument = samePage(location.href, assessment.url)
            ? document
            : await fetchDocument(assessment.url);
          const progress = PLCalendarCore.parseQuestionProgressHtml(
            assessmentDocument.documentElement.outerHTML
          );
          enriched[index] = {
            ...assessment,
            completion: PLCalendarCore.determineCompletion(assessment, progress)
          };
        } catch (error) {
          failedChecks += 1;
          console.warn(`Could not inspect completion for ${assessment.title}:`, error.message);
          enriched[index] = { ...assessment, completion: baseline };
        }
      }
    }

    const workerCount = Math.min(4, enriched.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return { assessments: enriched, failedChecks };
  }

  async function performScan() {
    const homepage = location.pathname === "/" ? document : await fetchDocument("https://us.prairielearn.com/");
    const courses = PLCalendarCore.parsePrairieLearnCourses(homepage, "https://us.prairielearn.com/");
    if (!courses.length) throw new Error("No PrairieLearn courses were found. Make sure you are signed in.");
    const settings = await loadSettings();
    const selectedCourses = settings.enabledSources.prairieLearn
      ? courses.filter((course) => PLCalendarCore.isCourseSelected(settings, "prairieLearn", course.id))
      : [];

    const results = await Promise.allSettled(selectedCourses.map(async (course) => {
      const courseDocument = location.href.replace(/\/$/, "") === course.url.replace(/\/$/, "")
        ? document
        : await fetchDocument(course.url);
      return PLCalendarCore.parseCourseDocument(courseDocument, course.url);
    }));

    const parsedAssessments = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const completionScan = await enrichAssessmentCompletions(parsedAssessments);
    const assessments = completionScan.assessments;
    const failedCourses = results.filter((result) => result.status === "rejected").length;
    const events = PLCalendarCore.buildCalendarEvents(assessments, settings);
    const snapshot = {
      source: "prairieLearn",
      scannedAt: new Date().toISOString(),
      enabled: settings.enabledSources.prairieLearn,
      courses,
      courseCount: selectedCourses.length,
      discoveredCourseCount: courses.length,
      failedCourses,
      failedCompletionChecks: completionScan.failedChecks,
      assessments,
      events
    };
    await chrome.storage.local.set({ snapshot });

    let sync = null;
    if (settings.autoSync) {
      sync = await chrome.runtime.sendMessage({
        type: "SYNC_LOCAL",
        endpoint: PLCalendarCore.sourceSyncEndpoint(settings.syncEndpoint, "prairieLearn"),
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
      const completedCount = result.assessments.filter((assessment) => assessment.completion?.completed).length;
      const inProgressCount = result.assessments.filter(
        (assessment) => assessment.completion?.status === "in_progress"
      ).length;
      const progress = `${completedCount} completed · ${inProgressCount} in progress · ${result.events.length} credit windows`;
      if (!result.enabled) {
        showRefreshBubble({
          title: "PrairieLearn monitoring is off",
          detail: `${result.discoveredCourseCount} courses available in extension settings`,
          tone: "warning"
        });
      } else if (!result.syncAttempted) {
        showRefreshBubble({
          title: "PrairieLearn automatically refreshed",
          detail: `${progress} · calendar sync is off`,
          tone: "warning"
        });
      } else if (result.sync && !result.sync.ok) {
        showRefreshBubble({
          title: "PrairieLearn refreshed",
          detail: `${progress} at ${time} · calendar server unavailable`,
          tone: "warning"
        });
      } else {
        showRefreshBubble({
          title: "Calendar automatically updated",
          detail: `${progress} · ${time}`
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
