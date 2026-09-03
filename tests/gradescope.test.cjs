const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assignmentStatus,
  buildGradescopeEvents,
  parseGradescopeCourses,
  parseGradescopeDate
} = require("../extension/gradescope-core.js");
const { toICS } = require("../extension/core.js");

test("discovers stable Gradescope course IDs without duplicating navigation links", () => {
  const links = [
    { getAttribute: () => "/courses/1378863", textContent: "STAT 400 Statistics and Probability I 2 assignments" },
    { getAttribute: () => "/courses/1378863", textContent: "STAT 400" },
    { getAttribute: () => "/courses/1222953", textContent: "ECE 120 Introduction to Computing 28 assignments" },
    { getAttribute: () => "/courses/1359390", textContent: "ECE 330Power Circuits 0 assignments" },
    { getAttribute: () => "/courses/1343966", textContent: "ECE/CS-374BIntroduction to Algorithms 0 assignments" },
    { getAttribute: () => "/account", textContent: "Account" }
  ];
  const documentRef = { querySelectorAll: () => links };
  assert.deepEqual(parseGradescopeCourses(documentRef), [
    {
      id: "1378863",
      name: "STAT 400 Statistics and Probability I",
      assignmentCount: 2,
      url: "https://www.gradescope.com/courses/1378863"
    },
    {
      id: "1222953",
      name: "ECE 120 Introduction to Computing",
      assignmentCount: 28,
      url: "https://www.gradescope.com/courses/1222953"
    },
    {
      id: "1359390",
      name: "ECE 330 — Power Circuits",
      assignmentCount: 0,
      url: "https://www.gradescope.com/courses/1359390"
    },
    {
      id: "1343966",
      name: "ECE/CS-374B — Introduction to Algorithms",
      assignmentCount: 0,
      url: "https://www.gradescope.com/courses/1343966"
    }
  ]);
});

test("parses Gradescope Central due dates across daylight and standard time", () => {
  assert.deepEqual(parseGradescopeDate("Due at September 08 at 11:59PM", 2026), {
    iso: "2026-09-09T04:59:00.000Z",
    date: "2026-09-08"
  });
  assert.deepEqual(parseGradescopeDate("Due at November 08 at 11:59PM", 2026), {
    iso: "2026-11-09T05:59:00.000Z",
    date: "2026-11-08"
  });
});

test("maps Gradescope submission labels to calendar states", () => {
  assert.deepEqual(assignmentStatus("Submitted"), { status: "completed", completed: true });
  assert.deepEqual(assignmentStatus("Ungraded"), { status: "not_started", completed: false });
  assert.deepEqual(assignmentStatus("Graded"), { status: "completed", completed: true });
  assert.deepEqual(assignmentStatus("In Progress"), { status: "in_progress", completed: false });
  assert.deepEqual(assignmentStatus("No Submission"), { status: "not_started", completed: false });
});

test("builds stable Gradescope events for timed and all-day feeds", () => {
  const [event] = buildGradescopeEvents([{
    id: "1378863-8528340",
    courseId: "1378863",
    courseName: "STAT 400",
    title: "Homework 01",
    url: "https://www.gradescope.com/courses/1378863/assignments/8528340/submissions/422723976",
    rawStatus: "Submitted",
    status: "completed",
    completed: true,
    due: "2026-09-04T04:59:00.000Z",
    dueDate: "2026-09-03",
    lateDue: { iso: "2026-09-04T16:59:00.000Z", date: "2026-09-04" }
  }]);
  assert.equal(event.uid, "gradescope-1378863-8528340@plcalendar.local");
  assert.equal(event.title, "✅ STAT 400 · Homework 01");
  assert.match(event.description, /Gradescope status: Submitted/);
  assert.match(event.description, /Late due:/);

  const timed = toICS([event], new Date("2026-09-02T00:00:00Z"), { calendarName: "Gradescope Deadlines" });
  const allDay = toICS([event], new Date("2026-09-02T00:00:00Z"), {
    allDay: true,
    calendarName: "Gradescope Deadlines (All Day)"
  });
  assert.match(timed, /X-WR-CALNAME:Gradescope Deadlines/);
  assert.match(timed, /DTSTART:20260904T045900Z/);
  assert.match(allDay, /DTSTART;VALUE=DATE:20260903/);
  assert.match(allDay, /UID:gradescope-1378863-8528340-allday@plcalendar.local/);
});
