/* global module */
var PLCalendarCore = (() => {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    autoSync: true,
    syncEndpoint: "http://127.0.0.1:49321/api/events"
  });

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parsePrairieDate(value) {
    const text = cleanText(value);
    if (!text || text === "—" || text === "-") return null;

    const match = text.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:([+-])(\d{2})(?::?(\d{2}))?)?(?:\s+\(([A-Z]{2,5})\))?/
    );
    if (!match) return null;

    const [, year, month, day, hour, minute, second, sign, offsetHour, offsetMinute, zone] = match;
    const knownOffsets = { CDT: "-05:00", CST: "-06:00", EDT: "-04:00", EST: "-05:00" };
    let offset = "";
    if (sign && offsetHour) offset = `${sign}${offsetHour}:${offsetMinute || "00"}`;
    else if (zone && knownOffsets[zone]) offset = knownOffsets[zone];

    const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function parseCredit(value) {
    const match = cleanText(value).match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function decodeHtmlText(value) {
    const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return cleanText(String(value || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity) => {
        if (entity[0] === "#") {
          const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
          const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
          return String.fromCodePoint(Number.parseInt(digits, radix));
        }
        return entities[entity.toLowerCase()] || `&${entity};`;
      }));
  }

  function parseAccessDetailsHtml(html) {
    if (!html) return [];

    const rows = Array.from(String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi), (match) => match[1]);
    return rows
      .map((row) => Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (match) => decodeHtmlText(match[1])))
      .filter((cells) => cells.length >= 3)
      .map(([rawCredit, rawStart, rawEnd]) => ({
        credit: parseCredit(rawCredit),
        rawCredit,
        start: parsePrairieDate(rawStart),
        end: parsePrairieDate(rawEnd)
      }));
  }

  function readAccessTiers(button) {
    return parseAccessDetailsHtml(button?.getAttribute("data-bs-content"));
  }

  function pickPrimaryDeadline(tiers) {
    const candidates = tiers.filter((tier) => tier.end && tier.credit !== null && tier.credit > 0);
    if (!candidates.length) return null;

    const fullCredit = candidates
      .filter((tier) => tier.credit === 100)
      .sort((a, b) => new Date(a.end) - new Date(b.end));
    if (fullCredit.length) return fullCredit[fullCredit.length - 1].end;

    const bestCredit = Math.max(...candidates.map((tier) => tier.credit));
    return candidates
      .filter((tier) => tier.credit === bestCredit)
      .sort((a, b) => new Date(a.end) - new Date(b.end))[0].end;
  }

  function courseNameFromDocument(documentRef) {
    const navItems = Array.from(documentRef.querySelectorAll("nav li"))
      .map((node) => cleanText(node.textContent))
      .filter(Boolean);
    const shortName = navItems.find((text) => !/^(Home|Assessments|Gradebook)$/i.test(text));
    return shortName || cleanText(documentRef.title).replace(/\s*\|\s*PrairieLearn\s*$/i, "") || "PrairieLearn";
  }

  function parseCourseDocument(documentRef, pageUrl) {
    const courseId = String(pageUrl).match(/\/course_instance\/(\d+)/)?.[1] || "unknown";
    const courseName = courseNameFromDocument(documentRef);
    const assessments = [];

    for (const groupBody of documentRef.querySelectorAll('table[aria-label="Assessments"] tbody')) {
      const group = cleanText(groupBody.querySelector('[data-testid="assessment-group-heading"]')?.textContent);
      for (const row of groupBody.querySelectorAll("tr")) {
        const cells = row.querySelectorAll("td");
        if (cells.length < 4) continue;

        const link = cells[1].querySelector('a[href*="/assessment"]');
        if (!link) continue;
        const url = new URL(link.getAttribute("href"), pageUrl).href;
        const assessmentId = url.match(/\/(?:assessment|assessment_instance)\/(\d+)/)?.[1] || url;
        const tiers = readAccessTiers(cells[2].querySelector('[data-bs-content]'));

        assessments.push({
          id: `${courseId}-${assessmentId}`,
          courseId,
          courseName,
          group,
          label: cleanText(cells[0].textContent),
          title: cleanText(link.textContent),
          url,
          score: cleanText(cells[3].textContent),
          tiers,
          primaryDeadline: pickPrimaryDeadline(tiers)
        });
      }
    }
    return assessments;
  }

  function findCourseUrls(documentRef, baseUrl) {
    return Array.from(documentRef.querySelectorAll('a[href^="/pl/course_instance/"]'))
      .map((link) => new URL(link.getAttribute("href"), baseUrl).href)
      .filter((url) => /^https:\/\/us\.prairielearn\.com\/pl\/course_instance\/\d+\/?$/.test(url))
      .filter((url, index, all) => all.indexOf(url) === index);
  }

  function eventDescription(assessment) {
    const details = [
      `${assessment.courseName} · ${assessment.group || "Assessment"}`,
      assessment.label ? `PrairieLearn label: ${assessment.label}` : "",
      assessment.score ? `Status/score at last scan: ${assessment.score}` : "",
      `Open: ${assessment.url}`
    ];
    return details.filter(Boolean).join("\n");
  }

  function courseCode(courseName) {
    return cleanText(courseName).match(/\b[A-Z]{2,}\s*\d+[A-Z]?\b/i)?.[0]?.toUpperCase() || cleanText(courseName);
  }

  function buildCalendarEvents(assessments) {
    const events = [];

    for (const assessment of assessments) {
      const seen = new Set();
      for (const tier of assessment.tiers || []) {
        const identity = `${tier.credit}|${tier.end}`;
        if (!tier.end || tier.credit === null || tier.credit <= 0 || seen.has(identity)) continue;
        seen.add(identity);
        const tierMs = new Date(tier.end).getTime();
        events.push({
          uid: `pl-${assessment.id}-${String(tier.credit).replace(".", "_")}pct@plcalendar.local`,
          title: `${courseCode(assessment.courseName)} · ${assessment.title}`,
          start: tier.end,
          end: new Date(tierMs + 15 * 60 * 1000).toISOString(),
          allDayDate: tier.rawEnd?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null,
          url: assessment.url,
          description: [
            `Available credit: ${tier.credit}%`,
            `Credit window ends: ${new Date(tier.end).toLocaleString()}`,
            eventDescription(assessment)
          ].join("\n"),
          category: assessment.group || "PrairieLearn"
        });
      }
    }
    return events.sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  function escapeICS(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function toICSDate(value) {
    return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  }

  function localDateOnly(value, timeZone = "America/Chicago") {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date(value));
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  }

  function toICSAllDayDate(value) {
    return String(value).replaceAll("-", "");
  }

  function nextDate(value) {
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  }

  function allDayUid(uid) {
    const separator = String(uid).lastIndexOf("@");
    return separator === -1
      ? `${uid}-allday`
      : `${String(uid).slice(0, separator)}-allday${String(uid).slice(separator)}`;
  }

  function foldICSLine(line) {
    const chunks = [];
    let remaining = line;
    while (remaining.length > 72) {
      chunks.push(remaining.slice(0, 72));
      remaining = ` ${remaining.slice(72)}`;
    }
    chunks.push(remaining);
    return chunks.join("\r\n");
  }

  function toICS(events, generatedAt = new Date(), options = {}) {
    const stamp = toICSDate(generatedAt);
    const allDay = options.allDay === true;
    const calendarName = options.calendarName || (allDay
      ? "PrairieLearn Deadlines (All Day)"
      : "PrairieLearn Deadlines");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//PLCalendar//PrairieLearn Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${escapeICS(calendarName)}`,
      "X-WR-CALDESC:Automatically collected PrairieLearn deadlines"
    ];

    for (const event of events) {
      const allDayDate = event.allDayDate || localDateOnly(event.start);
      const startLine = allDay
        ? `DTSTART;VALUE=DATE:${toICSAllDayDate(allDayDate)}`
        : `DTSTART:${toICSDate(event.start)}`;
      const endLine = allDay
        ? `DTEND;VALUE=DATE:${toICSAllDayDate(nextDate(allDayDate))}`
        : `DTEND:${toICSDate(event.end)}`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${escapeICS(allDay ? allDayUid(event.uid) : event.uid)}`,
        `DTSTAMP:${stamp}`,
        startLine,
        endLine,
        `SUMMARY:${escapeICS(event.title)}`,
        `DESCRIPTION:${escapeICS(event.description)}`,
        `URL:${escapeICS(event.url)}`,
        `CATEGORIES:${escapeICS(event.category)}`,
        "BEGIN:VALARM",
        "TRIGGER:-P1D",
        "ACTION:DISPLAY",
        "DESCRIPTION:PrairieLearn deadline tomorrow",
        "END:VALARM",
        "BEGIN:VALARM",
        "TRIGGER:-PT2H",
        "ACTION:DISPLAY",
        "DESCRIPTION:PrairieLearn deadline in 2 hours",
        "END:VALARM",
        "END:VEVENT"
      );
    }
    lines.push("END:VCALENDAR");
    return `${lines.map(foldICSLine).join("\r\n")}\r\n`;
  }

  return {
    DEFAULT_SETTINGS,
    buildCalendarEvents,
    cleanText,
    findCourseUrls,
    parseAccessDetailsHtml,
    parseCourseDocument,
    parsePrairieDate,
    pickPrimaryDeadline,
    toICS
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PLCalendarCore;
