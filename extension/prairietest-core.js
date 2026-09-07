/* global module, PLCalendarCore */
var PrairieTestCalendarCore = ((SharedCore) => {
  "use strict";

  const cleanText = SharedCore.cleanText;

  function parseDateMetadata(value) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value);
      const date = new Date(parsed?.date);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    } catch {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }

  function parseDurationMinutes(value) {
    const match = cleanText(value).match(/\b(\d+)\s*(?:min|minutes?)\b/i);
    return match ? Number(match[1]) : null;
  }

  function parseExamTitle(value) {
    const fullTitle = cleanText(value);
    const match = fullTitle.match(/^(.+?)\s*\([^)]*\)\s*:\s*(.+)$/);
    if (!match) return { course: "", exam: fullTitle, fullTitle };
    return { course: cleanText(match[1]), exam: cleanText(match[2]), fullTitle };
  }

  function parsePrairieTestDocument(documentRef, pageUrl = "https://us.prairietest.com/pt") {
    const reservations = [];
    for (const link of documentRef.querySelectorAll('a[href*="/student/reservation/"]')) {
      const row = link.closest("li") || link.parentElement?.parentElement;
      if (!row) continue;
      const url = new URL(link.getAttribute("href"), pageUrl).href;
      const id = url.match(/\/student\/reservation\/(\d+)/)?.[1];
      const dateElement = row.querySelector('[data-testid="date"] [data-format-date], [data-format-date]');
      const start = parseDateMetadata(dateElement?.getAttribute("data-format-date"));
      if (!id || !start) continue;

      const title = parseExamTitle(link.textContent);
      const locationElement = row.querySelector('[data-testid="location"]');
      const locationLink = locationElement?.querySelector("a");
      const location = cleanText(locationLink?.textContent || locationElement?.textContent);
      const locationDetails = cleanText(locationElement?.querySelector("small")?.textContent);
      const rowText = cleanText(row.textContent);
      const durationMinutes = parseDurationMinutes(rowText) || 60;
      const mode = rowText.match(/\b(In-person|Online|Remote)\b/i)?.[1] || "";
      const accommodations = rowText.match(/\b(?:No accommodations|With accommodations)\b/i)?.[0] || "";

      reservations.push({
        id,
        ...title,
        url,
        start,
        durationMinutes,
        location,
        locationDetails,
        mode,
        accommodations
      });
    }
    return reservations.filter((reservation, index, all) => (
      all.findIndex((item) => item.id === reservation.id) === index
    ));
  }

  function buildPrairieTestEvents(reservations) {
    return reservations.map((reservation) => {
      const startMs = new Date(reservation.start).getTime();
      const durationMinutes = Number(reservation.durationMinutes) || 60;
      const title = reservation.course
        ? `${reservation.course} · ${reservation.exam}`
        : reservation.exam;
      return {
        uid: `prairietest-${reservation.id}@plcalendar.local`,
        title,
        start: reservation.start,
        end: new Date(startMs + durationMinutes * 60 * 1000).toISOString(),
        url: reservation.url,
        location: reservation.location,
        description: [
          `PrairieTest reservation: ${reservation.fullTitle || title}`,
          `Starts: ${new Date(reservation.start).toLocaleString()}`,
          `Duration: ${durationMinutes} minutes`,
          reservation.location ? `Location: ${reservation.location}` : "",
          reservation.locationDetails ? `Location details: ${reservation.locationDetails}` : "",
          reservation.mode ? `Format: ${reservation.mode}` : "",
          reservation.accommodations ? `Accommodations: ${reservation.accommodations}` : "",
          `Open reservation: ${reservation.url}`
        ].filter(Boolean).join("\n"),
        category: "PrairieTest",
        source: "prairieTest"
      };
    }).sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  return {
    buildPrairieTestEvents,
    parseDateMetadata,
    parseDurationMinutes,
    parseExamTitle,
    parsePrairieTestDocument
  };
})(typeof PLCalendarCore !== "undefined" ? PLCalendarCore : require("./core.js"));

if (typeof module !== "undefined" && module.exports) module.exports = PrairieTestCalendarCore;
