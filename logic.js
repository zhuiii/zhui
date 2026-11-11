(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.ZhuiWater = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var TIME_ZONE = "Asia/Shanghai";
  var STORAGE_KEY = "zhui.water.v1";
  var FUTURE_GRACE_MS = 60 * 1000;
  var REMIND_GRACE_MS = 10 * 60 * 1000;
  var LIMITS = {
    amount: [1, 3000],
    target: [100, 10000],
  };

  function defaultSchedule() {
    return [
      { id: "plan-1000", time: "10:00", ml: 200, label: "上午工作", note: "10:00–11:30 小口抿，不强求" },
      { id: "plan-1330", time: "13:30", ml: 400, label: "下午第一杯水", note: "开始发力" },
      { id: "plan-1500", time: "15:00", ml: 400, label: "下午第二杯水", note: "可以换成黑咖啡或无糖茶" },
      { id: "plan-1630", time: "16:30", ml: 400, label: "下午第三杯水", note: "" },
      { id: "plan-1730", time: "17:30", ml: 200, label: "下班前", note: "收尾" },
    ];
  }

  function defaultState() {
    return {
      targetMl: 1600,
      entries: [],
      schedule: defaultSchedule(),
      reminder: {
        enabled: false,
        firedDay: null,
        firedIds: [],
      },
    };
  }

  function withState(state, patch) {
    return Object.assign({}, state, patch);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function shanghaiParts(date) {
    var fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    var parts = {};
    fmt.formatToParts(date).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    if (parts.hour === "24") parts.hour = "00";
    return parts;
  }

  function shanghaiDayKey(ms) {
    var parts = shanghaiParts(new Date(ms));
    return parts.year + "-" + parts.month + "-" + parts.day;
  }

  function msToShanghaiInput(ms) {
    var parts = shanghaiParts(new Date(ms));
    return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
  }

  function shanghaiInputToMs(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ""));
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4]);
    var minute = Number(match[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    var ms = Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0);
    var back = shanghaiParts(new Date(ms));
    if (
      back.year !== match[1] ||
      back.month !== match[2] ||
      back.day !== match[3] ||
      back.hour !== match[4] ||
      back.minute !== match[5]
    ) {
      return null;
    }
    return ms;
  }

  function formatShanghaiClock(ms) {
    var fmt = new Intl.DateTimeFormat("zh-CN", {
      timeZone: TIME_ZONE,
      month: "long",
      day: "numeric",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    var parts = {};
    fmt.formatToParts(new Date(ms)).forEach(function (part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
    if (parts.hour === "24") parts.hour = "00";
    return parts.month + "月" + parts.day + "日 " + parts.weekday + " " + parts.hour + ":" + parts.minute;
  }

  function formatShanghaiTime(ms) {
    var parts = shanghaiParts(new Date(ms));
    return parts.hour + ":" + parts.minute;
  }

  function formatCountdown(ms) {
    var total = Math.max(0, Math.floor(Number(ms) / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }

  function formatMl(ml) {
    return Number(ml).toLocaleString("zh-CN") + " 毫升";
  }

  function parseRanged(value, min, max) {
    var text = typeof value === "number" ? String(value) : String(value == null ? "" : value).trim();
    if (!/^\d+$/.test(text)) return { ok: false };
    var number = Number(text);
    if (!Number.isInteger(number) || number < min || number > max) return { ok: false };
    return { ok: true, value: number };
  }

  function parseAmount(value) {
    var parsed = parseRanged(value, LIMITS.amount[0], LIMITS.amount[1]);
    return parsed.ok ? { ok: true, ml: parsed.value } : { ok: false };
  }

  function parseTarget(value) {
    var parsed = parseRanged(value, LIMITS.target[0], LIMITS.target[1]);
    return parsed.ok ? { ok: true, ml: parsed.value } : { ok: false };
  }

  function parseClockTime(value) {
    var text = String(value == null ? "" : value).trim().replace(/[：.]/g, ":");
    var match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text) || /^(\d{2})(\d{2})$/.exec(text);
    if (!match) return { ok: false };
    var hour = Number(match[1]);
    var minute = Number(match[2]);
    if (hour > 23 || minute > 59) return { ok: false };
    return { ok: true, time: pad(hour) + ":" + pad(minute), minutes: hour * 60 + minute };
  }

  function classifyWhen(value, now) {
    var at = shanghaiInputToMs(value);
    if (at == null) return { ok: false, reason: "when" };
    if (at > now + FUTURE_GRACE_MS) return { ok: false, reason: "future" };
    if (shanghaiDayKey(at) !== shanghaiDayKey(now)) return { ok: false, reason: "not-today" };
    return { ok: true, at: at };
  }

  function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function parseSlot(raw) {
    if (!raw || typeof raw !== "object") return { ok: false, field: "time" };
    var time = parseClockTime(raw.time);
    if (!time.ok) return { ok: false, field: "time" };
    var amount = parseAmount(raw.ml);
    if (!amount.ok) return { ok: false, field: "ml" };
    var label = String(raw.label == null ? "" : raw.label).trim().slice(0, 24) || "喝水";
    var note = String(raw.note == null ? "" : raw.note).trim().slice(0, 60);
    var id = typeof raw.id === "string" ? raw.id.trim() : "";
    return {
      ok: true,
      slot: { id: id && id.length <= 80 ? id : createId(), time: time.time, ml: amount.ml, label: label, note: note },
    };
  }

  function sortSchedule(schedule) {
    return schedule.slice().sort(function (a, b) {
      return a.time < b.time ? -1 : a.time > b.time ? 1 : a.id < b.id ? -1 : 1;
    });
  }

  function sanitizeSchedule(list) {
    var seen = new Set();
    var out = [];
    list.forEach(function (raw) {
      var parsed = parseSlot(raw);
      if (!parsed.ok) return;
      var slot = parsed.slot;
      if (seen.has(slot.id)) slot.id = createId();
      seen.add(slot.id);
      out.push(slot);
    });
    return out.slice(0, 24);
  }

  function slotMs(slot, now) {
    return shanghaiInputToMs(shanghaiDayKey(now) + "T" + slot.time);
  }

  function doneSlotIds(entries, now) {
    var day = shanghaiDayKey(now);
    var done = {};
    entries.forEach(function (entry) {
      if (entry.slotId && shanghaiDayKey(entry.at) === day) done[entry.slotId] = entry;
    });
    return done;
  }

  function slotRows(state, now) {
    var done = doneSlotIds(state.entries, now);
    return sortSchedule(state.schedule).map(function (slot) {
      var at = slotMs(slot, now);
      var status = done[slot.id] ? "done" : at <= now ? "late" : "upcoming";
      return { slot: slot, at: at, status: status, entry: done[slot.id] || null };
    });
  }

  function nextReminder(state, now) {
    var rows = slotRows(state, now);
    for (var i = 0; i < rows.length; i += 1) {
      if (rows[i].status === "upcoming") return { slot: rows[i].slot, at: rows[i].at };
    }
    return null;
  }

  function planSchedule(state, now) {
    var reminder = state.reminder;
    if (!reminder.enabled) return { reminder: reminder, fire: [] };
    var day = shanghaiDayKey(now);
    var fired = reminder.firedDay === day ? reminder.firedIds : [];
    var rows = slotRows(state, now).filter(function (row) {
      return row.at <= now && fired.indexOf(row.slot.id) === -1;
    });
    if (rows.length === 0 && reminder.firedDay === day) return { reminder: reminder, fire: [] };
    var fire = rows
      .filter(function (row) {
        return row.status !== "done" && now - row.at <= REMIND_GRACE_MS;
      })
      .map(function (row) {
        return row.slot;
      });
    return {
      reminder: {
        enabled: true,
        firedDay: day,
        firedIds: fired.concat(
          rows.map(function (row) {
            return row.slot.id;
          })
        ),
      },
      fire: fire,
    };
  }

  function suggestSlotTime(now) {
    var parts = shanghaiParts(new Date(now));
    var minutes = Number(parts.hour) * 60 + Number(parts.minute) + 30;
    minutes = Math.min(23 * 60 + 55, Math.ceil(minutes / 5) * 5);
    return pad(Math.floor(minutes / 60)) + ":" + pad(minutes % 60);
  }

  function scheduleTotal(schedule) {
    return schedule.reduce(function (sum, slot) {
      return sum + slot.ml;
    }, 0);
  }

  function dailyTarget(state) {
    return state.targetMl;
  }

  function addDays(dayKey, n) {
    var p = dayKey.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function dayTotals(entries) {
    var totals = {};
    entries.forEach(function (entry) {
      var key = shanghaiDayKey(entry.at);
      totals[key] = (totals[key] || 0) + entry.ml;
    });
    return totals;
  }

  function statsHourly(entries, now) {
    var day = shanghaiDayKey(now);
    var hours = [];
    for (var h = 0; h < 24; h += 1) hours.push({ label: String(h), ml: 0 });
    entries.forEach(function (entry) {
      if (shanghaiDayKey(entry.at) !== day) return;
      hours[Number(shanghaiParts(new Date(entry.at)).hour)].ml += entry.ml;
    });
    return hours;
  }

  function statsDays(entries, now, kind) {
    var today = shanghaiDayKey(now);
    var totals = dayTotals(entries);
    var keys = [];
    var i;
    if (kind === "week") {
      for (i = 6; i >= 0; i -= 1) keys.push(addDays(today, -i));
    } else {
      var year = Number(today.slice(0, 4));
      var month = Number(today.slice(5, 7));
      var count = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (i = 1; i <= count; i += 1) keys.push(today.slice(0, 8) + pad(i));
    }
    var weekdays = "日一二三四五六";
    return keys.map(function (key) {
      var p = key.split("-").map(Number);
      var weekday = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
      return {
        key: key,
        label: kind === "week" ? "周" + weekdays.charAt(weekday) : String(p[2]),
        sub: p[1] + "/" + p[2],
        ml: totals[key] || 0,
        future: key > today,
        isToday: key === today,
      };
    });
  }

  function statsSummary(days, target) {
    var elapsed = days.filter(function (day) {
      return !day.future;
    });
    var total = elapsed.reduce(function (sum, day) {
      return sum + day.ml;
    }, 0);
    return {
      totalMl: total,
      averageMl: elapsed.length ? Math.round(total / elapsed.length) : 0,
      reachedDays: elapsed.filter(function (day) {
        return day.ml >= target;
      }).length,
      elapsedDays: elapsed.length,
      recordedDays: elapsed.filter(function (day) {
        return day.ml > 0;
      }).length,
    };
  }

  function summarize(entries, targetMl, now) {
    var day = shanghaiDayKey(now);
    var today = entries
      .filter(function (entry) {
        return shanghaiDayKey(entry.at) === day;
      })
      .slice()
      .sort(function (a, b) {
        return b.at - a.at || (a.id < b.id ? 1 : -1);
      });
    var totalMl = today.reduce(function (sum, entry) {
      return sum + entry.ml;
    }, 0);
    return {
      day: day,
      today: today,
      totalMl: totalMl,
      remainingMl: Math.max(0, targetMl - totalMl),
      extraMl: Math.max(0, totalMl - targetMl),
      reached: targetMl > 0 && totalMl >= targetMl,
    };
  }

  function addEntry(state, ml, at, id, slotId) {
    var entry = { id: id || createId(), ml: ml, at: at };
    if (slotId) entry.slotId = slotId;
    return withState(state, { entries: state.entries.concat([entry]) });
  }

  function removeEntry(state, id) {
    return withState(state, {
      entries: state.entries.filter(function (entry) {
        return entry.id !== id;
      }),
    });
  }

  function sanitizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    var target = parseTarget(raw.targetMl);
    var reminderRaw = raw.reminder && typeof raw.reminder === "object" ? raw.reminder : {};
    var seen = new Set();
    var entries = [];
    var list = Array.isArray(raw.entries) ? raw.entries : [];
    list.forEach(function (item) {
      if (!item || typeof item !== "object") return;
      var amount = parseAmount(item.ml);
      var at = Number(item.at);
      if (!amount.ok || !Number.isFinite(at)) return;
      if (at < Date.UTC(2000, 0, 1) || at > Date.UTC(2100, 0, 1)) return;
      var id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || id.length > 80 || seen.has(id)) id = createId();
      seen.add(id);
      var entry = { id: id, ml: amount.ml, at: at };
      if (typeof item.slotId === "string" && item.slotId && item.slotId.length <= 80) entry.slotId = item.slotId;
      entries.push(entry);
    });
    var firedIds = Array.isArray(reminderRaw.firedIds)
      ? reminderRaw.firedIds.filter(function (id) {
          return typeof id === "string";
        })
      : [];
    return {
      targetMl: target.ok ? target.ml : base.targetMl,
      entries: entries,
      schedule: Array.isArray(raw.schedule) ? sanitizeSchedule(raw.schedule) : base.schedule,
      reminder: {
        enabled: Boolean(reminderRaw.enabled),
        firedDay: typeof reminderRaw.firedDay === "string" ? reminderRaw.firedDay : null,
        firedIds: firedIds,
      },
    };
  }

  function loadState(storage) {
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      return sanitizeState(JSON.parse(raw));
    } catch (error) {
      return defaultState();
    }
  }

  function saveState(storage, state) {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  return {
    TIME_ZONE: TIME_ZONE,
    STORAGE_KEY: STORAGE_KEY,
    LIMITS: LIMITS,
    REMIND_GRACE_MS: REMIND_GRACE_MS,
    defaultState: defaultState,
    defaultSchedule: defaultSchedule,
    withState: withState,
    shanghaiDayKey: shanghaiDayKey,
    shanghaiInputToMs: shanghaiInputToMs,
    msToShanghaiInput: msToShanghaiInput,
    formatShanghaiClock: formatShanghaiClock,
    formatShanghaiTime: formatShanghaiTime,
    formatCountdown: formatCountdown,
    formatMl: formatMl,
    parseAmount: parseAmount,
    parseTarget: parseTarget,
    parseClockTime: parseClockTime,
    parseSlot: parseSlot,
    classifyWhen: classifyWhen,
    summarize: summarize,
    sanitizeState: sanitizeState,
    loadState: loadState,
    saveState: saveState,
    addEntry: addEntry,
    removeEntry: removeEntry,
    createId: createId,
    sortSchedule: sortSchedule,
    slotRows: slotRows,
    nextReminder: nextReminder,
    planSchedule: planSchedule,
    suggestSlotTime: suggestSlotTime,
    scheduleTotal: scheduleTotal,
    dailyTarget: dailyTarget,
    statsHourly: statsHourly,
    statsDays: statsDays,
    statsSummary: statsSummary,
  };
});
