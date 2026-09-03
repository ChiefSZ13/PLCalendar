/* global module, PLCalendarCore */
var GradescopeCalendarCore = ((SharedCore) => {
  "use strict";

  const cleanText = SharedCore.cleanText;
  const MONTHS = Object.freeze({
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9,
    october: 9, nov: 10, november: 10, dec: 11, december: 11
  });

  function zonedDateTimeToIso(year, month, day, hour, minute, timeZone = "America/Chicago") {
    const wallTime = Date.UTC(year, month, day, hour, minute, 0);
    let instant = wallTime;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(new Date(instant));
      const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      const represented = Date.UTC(
        Number(fields.year), Number(fields.month) - 1, Number(fields.day),
        Number(fields.hour), Number(fields.minute), Number(fields.second)
      );
      instant += wallTime - represented;
    }
    return new Date(instant).toISOString();
  }

  function parseGradescopeDate(value, fallbackYear, timeZone = "America/Chicago") {
    const text = cleanText(value);
    if (!text) return null;

    const explicitIso = text.match(/\b(20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}))\b/);
    if (explicitIso) {
      const date = new Date(explicitIso[1]);
      return Number.isNaN(date.getTime()) ? null : {
        iso: date.toISOString(),
        date: new Intl.DateTimeFormat("en-CA", {
          timeZone, year: "numeric", month: "2-digit", day: "2-digit"
        }).format(date)
      };
    }

    const match = text.match(
      /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i
    );
    if (!match) return null;

    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const year = Number(match[3] || fallbackYear);
    if (!Number.isInteger(year) || month === undefined || day < 1 || day > 31) return null;
    let hour = Number(match[4]) % 12;
    if (match[6].toUpperCase() === "PM") hour += 12;
    const minute = Number(match[5]);
    const iso = zonedDateTimeToIso(year, month, day, hour, minute, timeZone);
    return { iso, date: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
  }

  function parseGradescopeCourses(documentRef, baseUrl = "https://www.gradescope.com/") {
    return Array.from(documentRef.querySelectorAll('a[href*="/courses/"]'))
      .map((link) => {
        const url = new URL(link.getAttribute("href"), baseUrl);
        const id = url.pathname.match(/^\/courses\/(\d+)\/?$/)?.[1];
        if (!id) return null;
        const rawName = cleanText(link.textContent);
        const assignmentCount = Number(rawName.match(/(\d+)\s+assignments?\s*$/i)?.[1] || 0);
        const name = cleanText(rawName.replace(/\d+\s+assignments?\s*$/i, ""))
          .replace(/^([A-Za-z/& -]*\d+(?:\/\d+)?(?:-[A-Z0-9]+)?[A-Z]?)(?=[A-Z][a-z])/, "$1 — ")
          .replace(/^(.+\b(?:20\d{2}|[A-Z]{2}\d{2}))(?=[A-Z][a-z])/, "$1 — ")
          .replace(/([a-z])([A-Z][a-z])/, "$1 — $2");
        return { id, name: name || `Gradescope course ${id}`, assignmentCount, url: url.href };
      })
      .filter(Boolean)
      .filter((course, index, all) => all.findIndex((item) => item.id === course.id) === index);
  }

  function courseTerm(documentRef) {
    const match = cleanText(documentRef.body?.textContent).match(/\b(Spring|Summer|Fall|Winter)\s+(20\d{2})\b/i);
    return match ? { season: match[1], year: Number(match[2]) } : { season: "", year: new Date().getFullYear() };
  }

  function courseName(documentRef) {
    const fromTitle = cleanText(documentRef.title).replace(/\s+Dashboard\s*\|\s*Gradescope\s*$/i, "");
    return fromTitle || cleanText(documentRef.querySelector("h1")?.textContent) || "Gradescope";
  }

  function metadataStrings(row) {
    const values = [];
    for (const element of row.querySelectorAll("*")) {
      for (const attribute of ["aria-label", "title", "data-original-title", "data-tooltip", "datetime"]) {
        const value = element.getAttribute(attribute);
        if (value) values.push(cleanText(value));
      }
    }
    return values;
  }

  function dateFromRow(row, type, year) {
    const metadata = metadataStrings(row);
    const isLate = type === "late";
    const candidate = metadata.find((value) => isLate
      ? /late due date/i.test(value)
      : /\bdue at\b/i.test(value) && !/late due date/i.test(value));
    if (candidate) return parseGradescopeDate(candidate, year);

    const rowText = cleanText(row.textContent);
    const pattern = isLate
      ? /Late Due Date:\s*([A-Za-z]+\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i
      : /(?:^|\s)Due:\s*([A-Za-z]+\s+\d{1,2}\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM))/i;
    return parseGradescopeDate(rowText.match(pattern)?.[1], year);
  }

  function assignmentStatus(value) {
    const raw = cleanText(value);
    if (/\bsubmitted\b|\bgraded\b/i.test(raw)) return { status: "completed", completed: true };
    if (/in progress|draft/i.test(raw)) return { status: "in_progress", completed: false };
    return { status: "not_started", completed: false };
  }

  function parseGradescopeCourseDocument(documentRef, pageUrl) {
    const courseId = String(pageUrl).match(/\/courses\/(\d+)/)?.[1] || "unknown";
    const name = courseName(documentRef);
    const term = courseTerm(documentRef);
    const table = Array.from(documentRef.querySelectorAll("table"))
      .find((candidate) => /assignments list|due date/i.test(cleanText(candidate.textContent)));
    if (!table) return { course: { id: courseId, name, url: pageUrl }, assignments: [] };

    const assignments = [];
    for (const row of table.querySelectorAll("tbody tr, tr")) {
      const cells = Array.from(row.querySelectorAll(":scope > th, :scope > td"));
      if (cells.length < 3) continue;
      const due = dateFromRow(row, "due", term.year);
      if (!due) continue;

      const rowHtml = row.outerHTML;
      const link = row.querySelector('a[href*="/assignments/"]');
      const assignmentId = link?.getAttribute("href")?.match(/\/assignments\/(\d+)/)?.[1]
        || rowHtml.match(/\/assignments\/(\d+)/i)?.[1]
        || rowHtml.match(/assignment[_-]id["'=:\s]+(\d+)/i)?.[1]
        || cleanText(cells[0].textContent).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const rawTitle = cleanText(cells[0].textContent);
      const title = cleanText(rawTitle.replace(/^(?:Submit|View)\s+/i, ""));
      const rawStatus = cleanText(cells[1].textContent);
      const state = assignmentStatus(rawStatus);
      const directUrl = link
        ? new URL(link.getAttribute("href"), pageUrl).href
        : /^\d+$/.test(assignmentId) ? new URL(`/courses/${courseId}/assignments/${assignmentId}`, pageUrl).href : pageUrl;

      assignments.push({
        id: `${courseId}-${assignmentId}`,
        courseId,
        courseName: name,
        title: title || `Assignment ${assignmentId}`,
        url: directUrl,
        rawStatus,
        ...state,
        due: due.iso,
        dueDate: due.date,
        lateDue: dateFromRow(row, "late", term.year)
      });
    }
    return { course: { id: courseId, name, url: pageUrl }, assignments };
  }

  function gradescopeCourseCode(value) {
    return cleanText(value).match(/\b[A-Z]{2,}(?:\/[A-Z]{2,})?[-\s]*\d+[A-Z]?\b/i)?.[0]
      ?.toUpperCase().replace("-", " ") || cleanText(value);
  }

  function buildGradescopeEvents(assignments) {
    return assignments.filter((assignment) => assignment.due).map((assignment) => {
      const prefix = assignment.completed ? "✅ " : assignment.status === "in_progress" ? "🟡 " : "";
      const startMs = new Date(assignment.due).getTime();
      return {
        uid: `gradescope-${assignment.id}@plcalendar.local`,
        title: `${prefix}${gradescopeCourseCode(assignment.courseName)} · ${assignment.title}`,
        start: assignment.due,
        end: new Date(startMs + 15 * 60 * 1000).toISOString(),
        allDayDate: assignment.dueDate,
        url: assignment.url,
        description: [
          `Gradescope status: ${assignment.rawStatus || "Unknown"}`,
          `Due: ${new Date(assignment.due).toLocaleString()}`,
          assignment.lateDue ? `Late due: ${new Date(assignment.lateDue.iso).toLocaleString()}` : "",
          `Course: ${assignment.courseName}`,
          `Open: ${assignment.url}`
        ].filter(Boolean).join("\n"),
        category: "Gradescope",
        completed: assignment.completed,
        status: assignment.status,
        source: "gradescope"
      };
    }).sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  return {
    assignmentStatus,
    buildGradescopeEvents,
    parseGradescopeCourseDocument,
    parseGradescopeCourses,
    parseGradescopeDate,
    zonedDateTimeToIso
  };
})(typeof PLCalendarCore !== "undefined" ? PLCalendarCore : require("./core.js"));

if (typeof module !== "undefined" && module.exports) module.exports = GradescopeCalendarCore;
