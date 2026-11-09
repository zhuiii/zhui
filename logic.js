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
  var LIMITS = {
    amount: [1, 3000],
    target: [100, 10000],
    interval: [1, 240],
  };

  function defaultState() {
    return {
      targetMl: 2000,
      entries: [],
      reminder: {
        enabled: false,
        intervalMin: 60,
        nextAt: null,
      },
    };
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
    return parts.month + "月" + parts.day + "日 " + parts.weekday + " " + parts.hour + ":" + parts.minute + " · 上海";
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

  function parseInterval(value) {
    var parsed = parseRanged(value, LIMITS.interval[0], LIMITS.interval[1]);
    return parsed.ok ? { ok: true, minutes: parsed.value } : { ok: false };
  }

  function classifyWhen(value, now) {
    var at = shanghaiInputToMs(value);
    if (at == null) return { ok: false, reason: "when" };
    if (at > now + FUTURE_GRACE_MS) return { ok: false, reason: "future" };
    if (shanghaiDayKey(at) !== shanghaiDayKey(now)) return { ok: false, reason: "not-today" };
    return { ok: true, at: at };
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

  function createId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function addEntry(state, ml, at, id) {
    return {
      targetMl: state.targetMl,
      entries: state.entries.concat([{ id: id || createId(), ml: ml, at: at }]),
      reminder: state.reminder,
    };
  }

  function removeEntry(state, id) {
    return {
      targetMl: state.targetMl,
      entries: state.entries.filter(function (entry) {
        return entry.id !== id;
      }),
      reminder: state.reminder,
    };
  }

  function sanitizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== "object") return base;
    var target = parseTarget(raw.targetMl);
    var reminderRaw = raw.reminder && typeof raw.reminder === "object" ? raw.reminder : {};
    var interval = parseInterval(reminderRaw.intervalMin);
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
      entries.push({ id: id, ml: amount.ml, at: at });
    });
    var enabled = Boolean(reminderRaw.enabled);
    var nextAt = Number(reminderRaw.nextAt);
    return {
      targetMl: target.ok ? target.ml : base.targetMl,
      entries: entries,
      reminder: {
        enabled: enabled,
        intervalMin: interval.ok ? interval.minutes : base.reminder.intervalMin,
        nextAt: enabled && Number.isFinite(nextAt) ? nextAt : null,
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

  function planReminderTick(reminder, now) {
    if (!reminder.enabled) return { reminder: reminder, fire: false };
    var intervalMs = reminder.intervalMin * 60 * 1000;
    if (!Number.isFinite(reminder.nextAt)) {
      return {
        reminder: {
          enabled: reminder.enabled,
          intervalMin: reminder.intervalMin,
          nextAt: now + intervalMs,
        },
        fire: false,
      };
    }
    if (now >= reminder.nextAt) {
      return {
        reminder: {
          enabled: reminder.enabled,
          intervalMin: reminder.intervalMin,
          nextAt: now + intervalMs,
        },
        fire: true,
      };
    }
    return { reminder: reminder, fire: false };
  }

  return {
    TIME_ZONE: TIME_ZONE,
    STORAGE_KEY: STORAGE_KEY,
    LIMITS: LIMITS,
    defaultState: defaultState,
    shanghaiDayKey: shanghaiDayKey,
    shanghaiInputToMs: shanghaiInputToMs,
    msToShanghaiInput: msToShanghaiInput,
    formatShanghaiClock: formatShanghaiClock,
    formatShanghaiTime: formatShanghaiTime,
    formatCountdown: formatCountdown,
    formatMl: formatMl,
    parseAmount: parseAmount,
    parseTarget: parseTarget,
    parseInterval: parseInterval,
    classifyWhen: classifyWhen,
    summarize: summarize,
    sanitizeState: sanitizeState,
    loadState: loadState,
    saveState: saveState,
    addEntry: addEntry,
    removeEntry: removeEntry,
    createId: createId,
    planReminderTick: planReminderTick,
  };
});
