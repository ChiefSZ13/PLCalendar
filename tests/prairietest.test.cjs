const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPrairieTestEvents,
  parseDateMetadata,
  parseDurationMinutes,
  parseExamTitle,
  parsePrairieTestDocument
} = require("../extension/prairietest-core.js");
const { toICS } = require("../extension/core.js");

test("parses PrairieTest date metadata, titles, and durations", () => {
  assert.equal(
    parseDateMetadata('{"date":"2026-09-08T23:00:00.000Z","timezone":"America/Chicago"}'),
    "2026-09-08T23:00:00.000Z"
  );
  assert.equal(parseDurationMinutes("50min, In-person, No accommodations"), 50);
  assert.deepEqual(parseExamTitle("ECE 330 (Fa26): Quiz 0"), {
    course: "ECE 330",
    exam: "Quiz 0",
    fullTitle: "ECE 330 (Fa26): Quiz 0"
  });
});

test("parses the reservation card fields exposed by PrairieTest", () => {
  const dateElement = {
    getAttribute: (name) => name === "data-format-date"
      ? '{"date":"2026-09-08T23:00:00.000Z","timezone":"America/Chicago"}'
      : null
  };
  const locationLink = { textContent: "Grainger Library 057" };
  const locationDetails = { textContent: "Room 057 in the basement of Grainger Library" };
  const locationElement = {
    textContent: "CBTF: Grainger Library 057 Room 057 in the basement of Grainger Library",
    querySelector: (selector) => selector === "a" ? locationLink : selector === "small" ? locationDetails : null
  };
  const row = {
    textContent: "ECE 330 (Fa26): Quiz 0 tomorrow, 6pm CBTF Grainger Library 057 50min, In-person, No accommodations",
    querySelector: (selector) => selector.includes("data-format-date") ? dateElement
      : selector === '[data-testid="location"]' ? locationElement
      : null
  };
  const link = {
    textContent: "ECE 330 (Fa26): Quiz 0",
    getAttribute: () => "/pt/student/reservation/3554945",
    closest: () => row
  };
  const reservations = parsePrairieTestDocument({ querySelectorAll: () => [link] });
  assert.deepEqual(reservations, [{
    id: "3554945",
    course: "ECE 330",
    exam: "Quiz 0",
    fullTitle: "ECE 330 (Fa26): Quiz 0",
    url: "https://us.prairietest.com/pt/student/reservation/3554945",
    start: "2026-09-08T23:00:00.000Z",
    durationMinutes: 50,
    location: "Grainger Library 057",
    locationDetails: "Room 057 in the basement of Grainger Library",
    mode: "In-person",
    accommodations: "No accommodations"
  }]);
});

test("builds stable timed PrairieTest events with their actual duration and location", () => {
  const [event] = buildPrairieTestEvents([{
    id: "3554945",
    course: "ECE 330",
    exam: "Quiz 0",
    fullTitle: "ECE 330 (Fa26): Quiz 0",
    url: "https://us.prairietest.com/pt/student/reservation/3554945",
    start: "2026-09-08T23:00:00.000Z",
    durationMinutes: 50,
    location: "Grainger Library 057",
    locationDetails: "Room 057 in the basement of Grainger Library",
    mode: "In-person",
    accommodations: "No accommodations"
  }]);
  assert.equal(event.uid, "prairietest-3554945@plcalendar.local");
  assert.equal(event.title, "ECE 330 · Quiz 0");
  assert.equal(event.end, "2026-09-08T23:50:00.000Z");
  assert.equal(event.location, "Grainger Library 057");

  const ics = toICS([event], new Date("2026-09-07T00:00:00Z"), {
    calendarName: "PrairieTest Reservations",
    calendarDescription: "Automatically collected PrairieTest exam reservations",
    alarmLabel: "PrairieTest exam"
  });
  assert.match(ics, /X-WR-CALNAME:PrairieTest Reservations/);
  assert.match(ics, /DTSTART:20260908T230000Z/);
  assert.match(ics, /DTEND:20260908T235000Z/);
  assert.match(ics, /LOCATION:Grainger Library 057/);
  assert.match(ics, /DESCRIPTION:PrairieTest exam tomorrow/);
});
