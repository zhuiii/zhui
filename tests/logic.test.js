const test = require("node:test");
const assert = require("node:assert/strict");
const logic = require("../logic.js");

function memory(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
  };
}

test("Shanghai midnight splits the drinking day", () => {
  const before = Date.parse("2026-11-08T15:59:00.000Z");
  const midnight = Date.parse("2026-11-08T16:00:00.000Z");
  assert.equal(logic.shanghaiDayKey(before), "2026-11-08");
  assert.equal(logic.shanghaiDayKey(midnight), "2026-11-09");
  assert.equal(logic.shanghaiInputToMs("2026-11-09T00:00"), midnight);
  assert.equal(logic.msToShanghaiInput(midnight), "2026-11-09T00:00");
  assert.equal(logic.formatShanghaiTime(midnight), "00:00");
  assert.match(logic.formatShanghaiClock(midnight), /11月9日 星期一 00:00 · 上海/);
});

test("invalid wall times are rejected", () => {
  assert.equal(logic.shanghaiInputToMs("2026-02-31T12:00"), null);
  assert.equal(logic.shanghaiInputToMs("2026-11-09T24:00"), null);
  assert.equal(logic.shanghaiInputToMs("not-a-time"), null);
});

test("today summary ignores other Shanghai days and computes the plan", () => {
  const yesterday = Date.parse("2026-11-08T15:30:00.000Z");
  const todayEarly = Date.parse("2026-11-08T16:10:00.000Z");
  const todayLater = todayEarly + 60 * 60 * 1000;
  const entries = [
    { id: "y", ml: 500, at: yesterday },
    { id: "a", ml: 200, at: todayEarly },
    { id: "b", ml: 550, at: todayLater },
  ];
  const summary = logic.summarize(entries, 700, todayLater);
  assert.deepEqual(
    summary.today.map((entry) => entry.id),
    ["b", "a"]
  );
  assert.equal(summary.totalMl, 750);
  assert.equal(summary.remainingMl, 0);
  assert.equal(summary.extraMl, 50);
  assert.equal(summary.reached, true);

  const exact = logic.summarize([{ id: "a", ml: 200, at: todayEarly }], 200, todayEarly);
  assert.equal(exact.remainingMl, 0);
  assert.equal(exact.extraMl, 0);
  assert.equal(exact.reached, true);

  const empty = logic.summarize([], 2000, todayEarly);
  assert.equal(empty.totalMl, 0);
  assert.equal(empty.remainingMl, 2000);
  assert.equal(empty.reached, false);
});

test("drink time must be today in Shanghai and not in the future", () => {
  const now = Date.parse("2026-11-08T16:30:00.000Z");
  assert.equal(logic.classifyWhen("2026-11-09T00:10", now).ok, true);
  assert.equal(logic.classifyWhen("2026-11-08T23:50", now).reason, "not-today");
  assert.equal(logic.classifyWhen("2026-11-09T00:40", now).reason, "future");
  assert.equal(logic.classifyWhen("", now).reason, "when");
});

test("amounts, targets, and intervals stay in range", () => {
  assert.equal(logic.parseAmount("250").ml, 250);
  assert.equal(logic.parseAmount(0).ok, false);
  assert.equal(logic.parseAmount("3001").ok, false);
  assert.equal(logic.parseAmount("12.5").ok, false);
  assert.equal(logic.parseTarget(2000).ml, 2000);
  assert.equal(logic.parseTarget(50).ok, false);
  assert.equal(logic.parseInterval("60").minutes, 60);
  assert.equal(logic.parseInterval("0").ok, false);
  assert.equal(logic.parseInterval("241").ok, false);
});

test("storage drops bad rows and keeps the Shanghai log", () => {
  const at = Date.parse("2026-11-08T16:05:00.000Z");
  const sanitized = logic.sanitizeState({
    targetMl: 80,
    entries: [
      { id: "ok", ml: 250, at },
      { id: "zero", ml: 0, at },
      { ml: 180, at },
      null,
      { id: "bad-time", ml: 100, at: "nope" },
    ],
    reminder: { enabled: true, intervalMin: 999, nextAt: at },
  });
  assert.equal(sanitized.targetMl, 2000);
  assert.equal(sanitized.entries.length, 2);
  assert.equal(sanitized.entries[0].id, "ok");
  assert.equal(sanitized.entries[0].ml, 250);
  assert.equal(sanitized.entries[1].ml, 180);
  assert.equal(sanitized.reminder.enabled, true);
  assert.equal(sanitized.reminder.intervalMin, 60);
  assert.equal(sanitized.reminder.nextAt, at);

  const storage = memory({ [logic.STORAGE_KEY]: "{oops" });
  assert.deepEqual(logic.loadState(storage), logic.defaultState());

  const fresh = memory();
  const saved = logic.addEntry(logic.defaultState(), 150, at, "cup");
  logic.saveState(fresh, saved);
  const loaded = logic.loadState(fresh);
  assert.equal(loaded.entries[0].id, "cup");
  assert.equal(logic.removeEntry(loaded, "cup").entries.length, 0);
  assert.equal(logic.removeEntry(loaded, "missing").entries.length, 1);
});

test("countdown and reminder schedule", () => {
  assert.equal(logic.formatCountdown(0), "00:00:00");
  assert.equal(logic.formatCountdown(1000), "00:00:01");
  assert.equal(logic.formatCountdown(61 * 60 * 1000), "01:01:00");
  assert.equal(logic.formatCountdown(-50), "00:00:00");
  assert.equal(logic.formatMl(1750), "1,750 毫升");

  const now = 1_700_000_000_000;
  const off = logic.planReminderTick({ enabled: false, intervalMin: 30, nextAt: now - 1 }, now);
  assert.equal(off.fire, false);

  const armed = logic.planReminderTick({ enabled: true, intervalMin: 30, nextAt: null }, now);
  assert.equal(armed.fire, false);
  assert.equal(armed.reminder.nextAt, now + 30 * 60 * 1000);

  const waiting = logic.planReminderTick(armed.reminder, now + 1000);
  assert.equal(waiting.fire, false);
  assert.equal(waiting.reminder, armed.reminder);

  const due = logic.planReminderTick(armed.reminder, armed.reminder.nextAt);
  assert.equal(due.fire, true);
  assert.equal(due.reminder.nextAt, armed.reminder.nextAt + 30 * 60 * 1000);
});
