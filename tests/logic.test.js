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

function at(hhmm, day = "2026-11-09") {
  return logic.shanghaiInputToMs(`${day}T${hhmm}`);
}

function withReminder(overrides, state = logic.defaultState()) {
  return logic.withState(state, {
    reminder: { enabled: true, firedDay: null, firedIds: [], ...overrides },
  });
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
  assert.equal(exact.reached, true);

  const empty = logic.summarize([], 2000, todayEarly);
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

test("amounts, targets, and clock times stay in range", () => {
  assert.equal(logic.parseAmount("250").ml, 250);
  assert.equal(logic.parseAmount(0).ok, false);
  assert.equal(logic.parseAmount("3001").ok, false);
  assert.equal(logic.parseAmount("12.5").ok, false);
  assert.equal(logic.parseTarget(2000).ml, 2000);
  assert.equal(logic.parseTarget(50).ok, false);
  assert.equal(logic.parseClockTime("09:05").minutes, 545);
  assert.equal(logic.parseClockTime("24:00").ok, false);
  assert.equal(logic.parseClockTime("9:5").ok, false);
  assert.equal(logic.parseClockTime("9:05").time, "09:05");
  assert.equal(logic.parseClockTime("1330").time, "13:30");
  assert.equal(logic.parseClockTime("13：30").time, "13:30");
  assert.equal(logic.parseClockTime("8am").ok, false);
  assert.equal(logic.parseClockTime("").ok, false);
});

test("default plan is the 5-slot schedule totalling 1600 ml", () => {
  const state = logic.defaultState();
  assert.deepEqual(
    state.schedule.map((slot) => [slot.time, slot.ml]),
    [
      ["10:00", 200],
      ["13:30", 400],
      ["15:00", 400],
      ["16:30", 400],
      ["17:30", 200],
    ]
  );
  assert.equal(logic.scheduleTotal(state.schedule), 1600);
  assert.equal(state.targetMl, 1600);
});

test("slot validation reports the bad field and fills defaults", () => {
  assert.equal(logic.parseSlot({ time: "25:00", ml: 200 }).field, "time");
  assert.equal(logic.parseSlot({ time: "10:00", ml: 0 }).field, "ml");
  const ok = logic.parseSlot({ time: "10:00", ml: "300", label: "  ", note: " x " });
  assert.equal(ok.ok, true);
  assert.equal(ok.slot.label, "喝水");
  assert.equal(ok.slot.note, "x");
  assert.equal(ok.slot.ml, 300);
  assert.ok(ok.slot.id);
});

test("slot rows are sorted and flag done, late, and upcoming for today", () => {
  const base = logic.defaultState();
  const schedule = [base.schedule[2], base.schedule[0], base.schedule[1]];
  const entries = [
    { id: "e1", ml: 200, at: at("10:05"), slotId: "plan-1000" },
    { id: "e0", ml: 200, at: at("10:05", "2026-11-08"), slotId: "plan-1330" },
  ];
  const rows = logic.slotRows(logic.withState(base, { schedule, entries }), at("14:00"));
  assert.deepEqual(
    rows.map((row) => [row.slot.time, row.status]),
    [
      ["10:00", "done"],
      ["13:30", "late"],
      ["15:00", "upcoming"],
    ]
  );
});

test("next reminder skips done slots and ends after the last one", () => {
  const base = logic.defaultState();
  const entries = [{ id: "e", ml: 400, at: at("13:31"), slotId: "plan-1500" }];
  const state = logic.withState(base, { entries });
  assert.equal(logic.nextReminder(state, at("13:40")).slot.time, "16:30");
  assert.equal(logic.nextReminder(state, at("09:00")).slot.time, "10:00");
  assert.equal(logic.nextReminder(state, at("18:00")), null);
  assert.equal(logic.nextReminder(logic.withState(base, { schedule: [] }), at("09:00")), null);
});

test("reminders fire at each scheduled time once", () => {
  let state = withReminder({});
  const idle = logic.planSchedule(state, at("09:59"));
  assert.deepEqual(idle.fire, []);
  assert.equal(idle.reminder.firedDay, "2026-11-09");
  state = logic.withState(state, { reminder: idle.reminder });

  const first = logic.planSchedule(state, at("10:00"));
  assert.deepEqual(first.fire.map((slot) => slot.id), ["plan-1000"]);
  state = logic.withState(state, { reminder: first.reminder });

  const again = logic.planSchedule(state, at("10:01"));
  assert.deepEqual(again.fire, []);
  assert.equal(again.reminder, state.reminder);

  const second = logic.planSchedule(state, at("13:30"));
  assert.deepEqual(second.fire.map((slot) => slot.id), ["plan-1330"]);
});

test("turning reminders on mid-day does not replay old slots", () => {
  const state = withReminder({});
  const result = logic.planSchedule(state, at("15:02"));
  assert.deepEqual(result.fire.map((slot) => slot.id), ["plan-1500"]);
  assert.deepEqual(result.reminder.firedIds.sort(), ["plan-1000", "plan-1330", "plan-1500"]);

  const late = logic.planSchedule(withReminder({}), at("15:30"));
  assert.deepEqual(late.fire, []);
  assert.equal(late.reminder.firedIds.length, 3);
});

test("done slots do not remind and disabled reminders never fire", () => {
  const base = logic.defaultState();
  const entries = [{ id: "e", ml: 400, at: at("13:20"), slotId: "plan-1330" }];
  const done = logic.planSchedule(withReminder({}, logic.withState(base, { entries })), at("13:30"));
  assert.deepEqual(done.fire, []);

  const off = logic.planSchedule(logic.withState(base, { reminder: { enabled: false, firedDay: null, firedIds: [] } }), at("13:30"));
  assert.deepEqual(off.fire, []);
});

test("fired list resets on the next Shanghai day", () => {
  const state = withReminder({ firedDay: "2026-11-09", firedIds: ["plan-1000"] });
  const next = logic.planSchedule(state, at("10:00", "2026-11-10"));
  assert.deepEqual(next.fire.map((slot) => slot.id), ["plan-1000"]);
  assert.equal(next.reminder.firedDay, "2026-11-10");
});

test("new slot time suggestion is 30 minutes ahead, rounded, and stays today", () => {
  assert.equal(logic.suggestSlotTime(at("09:10")), "09:40");
  assert.equal(logic.suggestSlotTime(at("09:12")), "09:45");
  assert.equal(logic.suggestSlotTime(at("23:50")), "23:55");
});

test("storage keeps schedule and slot links, and drops bad rows", () => {
  const stamp = at("10:05");
  const sanitized = logic.sanitizeState({
    targetMl: 80,
    entries: [
      { id: "ok", ml: 250, at: stamp, slotId: "plan-1000" },
      { id: "zero", ml: 0, at: stamp },
      { ml: 180, at: stamp },
      null,
    ],
    schedule: [
      { id: "a", time: "08:00", ml: 300, label: "早起", note: "" },
      { id: "bad", time: "8am", ml: 300 },
      { id: "a", time: "09:00", ml: 100 },
    ],
    reminder: { enabled: true, firedDay: "2026-11-09", firedIds: ["a", 5] },
  });
  assert.equal(sanitized.targetMl, 1600);
  assert.equal(sanitized.entries.length, 2);
  assert.equal(sanitized.entries[0].slotId, "plan-1000");
  assert.equal(sanitized.schedule.length, 2);
  assert.notEqual(sanitized.schedule[0].id, sanitized.schedule[1].id);
  assert.deepEqual(sanitized.reminder, { enabled: true, firedDay: "2026-11-09", firedIds: ["a"] });

  assert.deepEqual(logic.sanitizeState({ targetMl: 2000, entries: [] }).schedule, logic.defaultSchedule());
  assert.deepEqual(logic.sanitizeState({ schedule: [] }).schedule, []);

  const storage = memory({ [logic.STORAGE_KEY]: "{oops" });
  assert.deepEqual(logic.loadState(storage), logic.defaultState());

  const fresh = memory();
  const saved = logic.addEntry(logic.defaultState(), 150, stamp, "cup", "plan-1000");
  logic.saveState(fresh, saved);
  const loaded = logic.loadState(fresh);
  assert.equal(loaded.entries[0].slotId, "plan-1000");
  assert.equal(loaded.schedule.length, 5);
  assert.equal(logic.removeEntry(loaded, "cup").entries.length, 0);
  assert.equal(logic.removeEntry(loaded, "missing").entries.length, 1);
});

test("countdown and amount formatting", () => {
  assert.equal(logic.formatCountdown(0), "00:00:00");
  assert.equal(logic.formatCountdown(61 * 60 * 1000), "01:01:00");
  assert.equal(logic.formatCountdown(-50), "00:00:00");
  assert.equal(logic.formatMl(1750), "1,750 毫升");
});
