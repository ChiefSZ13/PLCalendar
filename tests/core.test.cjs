const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildCalendarEvents,
  determineCompletion,
  parseAccessDetailsHtml,
  parseQuestionProgressHtml,
  parsePrairieDate,
  parseScorePercent,
  normalizeSettings,
  pickPrimaryDeadline,
  sourceSyncEndpoint,
  toICS
} = require("../extension/core.js");

test("normalizes persisted source and course-selection settings", () => {
  const defaults = normalizeSettings();
  assert.deepEqual(defaults.enabledSources, { prairieLearn: true, gradescope: false, prairieTest: true });
  assert.equal(defaults.selectedCourseIds.prairieLearn, null);
  assert.deepEqual(defaults.selectedCourseIds.gradescope, []);

  const customized = normalizeSettings({
    enabledSources: { gradescope: true },
    selectedCourseIds: { prairieLearn: [217654], gradescope: ["1378863", "1378863"] }
  });
  assert.deepEqual(customized.enabledSources, { prairieLearn: true, gradescope: true, prairieTest: true });
  assert.deepEqual(customized.selectedCourseIds.prairieLearn, ["217654"]);
  assert.deepEqual(customized.selectedCourseIds.gradescope, ["1378863"]);
  assert.equal(
    sourceSyncEndpoint("https://calendar.example/api/events", "gradescope"),
    "https://calendar.example/api/gradescope/events"
  );
  assert.equal(
    sourceSyncEndpoint("https://calendar.example/api/events", "prairieTest"),
    "https://calendar.example/api/prairietest/events"
  );
});

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

test("uses awarded points rather than opened variants to measure question progress", () => {
  const html = `
    <table>
      <tr><td><a href="/pl/course_instance/1/instance_question/11/">Question 1</a></td><td>1</td>
          <td><a href="/pl/course_instance/1/instance_question/11/?variant_id=101">Open</a></td><td>1 / 1</td></tr>
      <tr><td><a href='/pl/course_instance/1/instance_question/12/'>Question 2</a></td><td>1</td>
          <td><a href='/pl/course_instance/1/instance_question/12/?variant_id=102'>Open</a></td><td>0.5 / 1</td></tr>
      <tr><td><a href='/pl/course_instance/1/instance_question/13/'>Question 3</a></td><td>1</td>
          <td><a href='/pl/course_instance/1/instance_question/13/?variant_id=103'>Open</a></td><td>&mdash; / 1</td></tr>
    </table>`;
  assert.deepEqual(parseQuestionProgressHtml(html), {
    questionCount: 3,
    attemptedCount: 2,
    fullCreditCount: 1,
    partialCreditCount: 1,
    unansweredCount: 1,
    allAttempted: false,
    allFullCredit: false
  });
});

test("combines currently available credit with question-level full points", () => {
  const started = {
    url: "https://us.prairielearn.com/pl/course_instance/1/assessment_instance/2/"
  };
  assert.equal(parseScorePercent("110%"), 110);
  const noPartialQuestions = {
    questionCount: 10,
    attemptedCount: 8,
    fullCreditCount: 8,
    partialCreditCount: 0,
    unansweredCount: 2,
    allAttempted: false,
    allFullCredit: false
  };
  const partialQuestion = {
    ...noPartialQuestions,
    attemptedCount: 9,
    partialCreditCount: 1,
    unansweredCount: 1
  };

  const belowCeiling = determineCompletion({
    ...started,
    score: "80%",
    currentAvailableCredit: 100
  }, noPartialQuestions);
  assert.equal(belowCeiling.status, "in_progress");
  assert.equal(belowCeiling.reason, "below_available_credit");

  const ceilingMet = determineCompletion({
    ...started,
    score: "85%",
    currentAvailableCredit: 80
  }, noPartialQuestions);
  assert.equal(ceilingMet.completed, true);
  assert.equal(ceilingMet.reason, "available_credit_met");

  const partialOverridesCeiling = determineCompletion({
    ...started,
    score: "85%",
    currentAvailableCredit: 80
  }, partialQuestion);
  assert.equal(partialOverridesCeiling.status, "in_progress");
  assert.equal(partialOverridesCeiling.reason, "question_below_full_credit");

  const everyQuestionFull = determineCompletion({
    ...started,
    score: "95%",
    currentAvailableCredit: 100
  }, {
    questionCount: 3,
    attemptedCount: 3,
    fullCreditCount: 3,
    partialCreditCount: 0,
    unansweredCount: 0,
    allAttempted: true,
    allFullCredit: true
  });
  assert.equal(everyQuestionFull.completed, true);
  assert.equal(everyQuestionFull.reason, "all_questions_full_credit");

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
  assert.equal(events[1].title, "🟡 MATH 257 · Week 1");
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
    score: "85%",
    currentAvailableCredit: 80,
    completion: {
      completed: true,
      status: "completed",
      reason: "available_credit_met",
      scorePercent: 85,
      availableCredit: 80,
      questionCount: 4,
      attemptedCount: 4,
      fullCreditCount: 4,
      partialCreditCount: 0,
      unansweredCount: 0,
      allAttempted: true,
      allFullCredit: true
    },
    tiers: [{ credit: 100, rawEnd: "2026-09-02 23:59:59 (CDT)", end: "2026-09-03T04:59:59.000Z" }]
  };
  const [event] = buildCalendarEvents([assessment]);
  assert.equal(event.uid, "pl-217654-14531169-100pct@plcalendar.local");
  assert.equal(event.title, "✅ MATH 257 · Week 1");
  assert.match(event.description, /Completion: Completed \(current available credit reached\)/);
  assert.match(event.description, /Currently available credit: 80%/);

  const timed = toICS([event], new Date("2026-08-27T00:00:00Z"));
  const allDay = toICS([event], new Date("2026-08-27T00:00:00Z"), { allDay: true });
  assert.match(timed, /SUMMARY:✅ MATH 257 · Week 1/);
  assert.match(allDay, /SUMMARY:✅ MATH 257 · Week 1/);
});

test("prefixes in-progress events in both feeds without changing their IDs", () => {
  const assessment = {
    id: "225376-14538477",
    courseName: "ECE 374B, fa26",
    group: "Guided problem sets",
    label: "GPS1",
    title: "Regular Expressions",
    url: "https://us.prairielearn.com/pl/course_instance/225376/assessment_instance/14538477/",
    score: "85%",
    currentAvailableCredit: 80,
    completion: {
      completed: false,
      status: "in_progress",
      reason: "question_below_full_credit",
      questionCount: 19,
      attemptedCount: 18,
      fullCreditCount: 17,
      partialCreditCount: 1,
      unansweredCount: 1
    },
    tiers: [{ credit: 80, rawEnd: "2026-09-10 23:59:59 (CDT)", end: "2026-09-11T04:59:59.000Z" }]
  };
  const [event] = buildCalendarEvents([assessment]);
  assert.equal(event.uid, "pl-225376-14538477-80pct@plcalendar.local");
  assert.equal(event.title, "🟡 ECE 374B · Regular Expressions");
  assert.match(event.description, /an attempted question is below full points/);

  const timed = toICS([event], new Date("2026-09-01T00:00:00Z"));
  const allDay = toICS([event], new Date("2026-09-01T00:00:00Z"), { allDay: true });
  assert.match(timed, /SUMMARY:🟡 ECE 374B · Regular Expressions/);
  assert.match(allDay, /SUMMARY:🟡 ECE 374B · Regular Expressions/);
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
