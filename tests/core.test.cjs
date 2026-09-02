const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCalendarEvents,
  determineCompletion,
  parseAccessDetailsHtml,
  parseQuestionProgressHtml,
  parsePrairieDate,
  parseScorePercent,
  pickPrimaryDeadline,
  toICS
} = require("../extension/core.js");

test("parses PrairieLearn timestamps with offsets and timezone abbreviations", () => {
  assert.equal(parsePrairieDate("2026-09-11 23:59:59-05 (CDT)"), "2026-09-12T04:59:59.000Z");
  assert.equal(parsePrairieDate("2026-09-11 23:59:59 (CDT)"), "2026-09-12T04:59:59.000Z");
  assert.equal(parsePrairieDate("—"), null);
});

test("prefers the 100 percent deadline over bonus and late-credit tiers", () => {
  const tiers = [
    { credit: 110, end: "2026-08-29T04:59:59.000Z" },
    { credit: 100, end: "2026-09-02T04:59:59.000Z" },
    { credit: 80, end: "2026-09-09T04:59:59.000Z" }
  ];
  assert.equal(pickPrimaryDeadline(tiers), "2026-09-02T04:59:59.000Z");
});

test("parses the exact Access details HTML used by PrairieLearn", () => {
  const html = `
    <table class="table" aria-label="Access details">
      <tr><th>Credit</th><th>Start</th><th>End</th></tr>
      <tr>
        <td>100</td>
        <td>2026-08-20 00:00:01 (CDT)</td>
        <td>2026-09-03 23:59:59 (CDT)</td>
      </tr>
    </table>`;
  assert.deepEqual(parseAccessDetailsHtml(html), [{
    credit: 100,
    rawCredit: "100",
    start: "2026-08-20T05:00:01.000Z",
    end: "2026-09-04T04:59:59.000Z"
  }]);
});

test("detects attempted questions from PrairieLearn assessment-instance rows", () => {
  const html = `
    <table>
      <tr><td><a href="/pl/course_instance/1/instance_question/11/">Question 1</a></td>
          <td><a href="/pl/course_instance/1/instance_question/11/?variant_id=101">Attempt 1</a></td></tr>
      <tr><td><a href='/pl/course_instance/1/instance_question/12/'>Question 2</a></td>
          <td><a href='/pl/course_instance/1/instance_question/12/?foo=1&amp;variant_id=102'>Attempt 1</a></td></tr>
    </table>`;
  assert.deepEqual(parseQuestionProgressHtml(html), {
    questionCount: 2,
    attemptedCount: 2,
    allAttempted: true
  });
});

test("marks full credit or every-question-attempted work complete", () => {
  const started = {
    score: "95%",
    url: "https://us.prairielearn.com/pl/course_instance/1/assessment_instance/2/"
  };
  assert.equal(parseScorePercent("110%"), 110);
  assert.deepEqual(determineCompletion({ ...started, score: "110%" }), {
    completed: true,
    status: "completed",
    reason: "full_credit",
    scorePercent: 110
  });
  assert.equal(determineCompletion(started, {
    questionCount: 3,
    attemptedCount: 3,
    allAttempted: true
  }).completed, true);
  assert.deepEqual(determineCompletion(started, {
    questionCount: 3,
    attemptedCount: 2,
    allAttempted: false
  }), {
    completed: false,
    status: "in_progress",
    reason: "questions_remaining",
    scorePercent: 95,
    questionCount: 3,
    attemptedCount: 2
  });
  assert.equal(determineCompletion({
    score: "Not started",
    url: "https://us.prairielearn.com/pl/course_instance/1/assessment/2/"
  }).completed, false);
});

test("builds one stable calendar event for every positive-credit window", () => {
  const assessment = {
    id: "217654-14531169",
    courseName: "MATH 257, Fa26",
    group: "Homeworks",
    label: "HW1",
    title: "Week 1",
    url: "https://us.prairielearn.com/pl/course_instance/217654/assessment_instance/14531169/",
    score: "0%",
    primaryDeadline: "2026-09-02T04:59:59.000Z",
    tiers: [
      { credit: 110, end: "2026-08-29T04:59:59.000Z" },
      { credit: 100, end: "2026-09-02T04:59:59.000Z" },
      { credit: 80, end: "2026-09-09T04:59:59.000Z" }
    ]
  };
  const events = buildCalendarEvents([assessment]);
  assert.equal(events.length, 3);
  assert.match(events[0].uid, /110pct/);
  assert.equal(events[1].uid, "pl-217654-14531169-100pct@plcalendar.local");
  assert.equal(events[1].title, "MATH 257 · Week 1");
  assert.match(events[1].description, /Available credit: 100%/);
});

test("prefixes completed events without changing their stable calendar IDs", () => {
  const assessment = {
    id: "217654-14531169",
    courseName: "MATH 257, Fa26",
    group: "Homeworks",
    label: "HW1",
    title: "Week 1",
    url: "https://us.prairielearn.com/pl/course_instance/217654/assessment_instance/14531169/",
    score: "95%",
    completion: {
      completed: true,
      status: "completed",
      reason: "all_questions_attempted",
      questionCount: 4,
      attemptedCount: 4
    },
    tiers: [{ credit: 100, rawEnd: "2026-09-02 23:59:59 (CDT)", end: "2026-09-03T04:59:59.000Z" }]
  };
  const [event] = buildCalendarEvents([assessment]);
  assert.equal(event.uid, "pl-217654-14531169-100pct@plcalendar.local");
  assert.equal(event.title, "✅ MATH 257 · Week 1");
  assert.match(event.description, /Completion: Completed \(all questions attempted\)/);

  const timed = toICS([event], new Date("2026-08-27T00:00:00Z"));
  const allDay = toICS([event], new Date("2026-08-27T00:00:00Z"), { allDay: true });
  assert.match(timed, /SUMMARY:✅ MATH 257 · Week 1/);
  assert.match(allDay, /SUMMARY:✅ MATH 257 · Week 1/);
});

test("writes a valid calendar with alarms and escaped text", () => {
  const ics = toICS([{
    uid: "one@local",
    title: "Quiz, one",
    start: "2026-09-02T04:59:59.000Z",
    end: "2026-09-02T05:14:59.000Z",
    description: "Line 1\nLine 2",
    url: "https://example.test/quiz",
    category: "Quiz"
  }], new Date("2026-08-27T00:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /SUMMARY:Quiz\\, one/);
  assert.match(ics, /DESCRIPTION:Line 1\\nLine 2/);
  assert.match(ics, /TRIGGER:-P1D/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test("writes a separate all-day calendar on the local PrairieLearn cutoff date", () => {
  const ics = toICS([{
    uid: "one@local",
    title: "ECE 374B · Regular Expressions",
    start: "2026-09-04T04:59:59.000Z",
    end: "2026-09-04T05:14:59.000Z",
    allDayDate: "2026-09-03",
    description: "Available credit: 100%",
    url: "https://example.test/quiz",
    category: "Quiz"
  }], new Date("2026-08-27T00:00:00Z"), { allDay: true });
  assert.match(ics, /X-WR-CALNAME:PrairieLearn Deadlines \(All Day\)/);
  assert.match(ics, /UID:one-allday@local/);
  assert.match(ics, /DTSTART;VALUE=DATE:20260903/);
  assert.match(ics, /DTEND;VALUE=DATE:20260904/);
  assert.doesNotMatch(ics, /DTSTART:20260904T045959Z/);
});
