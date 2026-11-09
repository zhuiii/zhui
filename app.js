(function () {
  "use strict";

  var Z = window.ZhuiWater;
  var COPY = {
    amount: "请输入 1 到 3000 之间的整数毫升。",
    when: "请填写有效的时间。",
    future: "时间不能晚于现在。",
    "not-today": "只能记录今天的饮水。今天按上海时间计算。",
    target: "每日目标请设为 100 到 10000 的整数毫升。",
    interval: "间隔请设为 1 到 240 的整数分钟。",
  };

  var state = Z.defaultState();
  var whenTouched = false;
  var flashId = null;
  var shownDay = "";
  var dom = {};

  function $(id) {
    return document.getElementById(id);
  }

  function announce(message) {
    dom.toast.textContent = message;
  }

  function save() {
    try {
      Z.saveState(window.localStorage, state);
    } catch (error) {
      announce("无法写入浏览器存储，这次的修改可能不会保留。");
    }
  }

  function notificationKind() {
    if (!window.isSecureContext) return "insecure";
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  }

  function notificationCopy() {
    var kind = notificationKind();
    if (kind === "insecure") {
      return "当前地址不能弹出系统通知。用本机网址打开后，浏览器才允许通知。页面内提醒不受影响。";
    }
    if (kind === "unsupported") return "这个浏览器没有系统通知。页面内提醒可用。";
    if (kind === "granted") return "系统通知已允许。到点会弹出通知，页面里也会提醒。";
    if (kind === "denied") return "系统通知已被浏览器拒绝。到点仍会在页面里提醒。";
    if (state.reminder.enabled) return "尚未允许系统通知。到点仍会在页面里提醒。";
    return "开启后会请求系统通知权限。无论是否允许，页面里都会倒计时提醒。";
  }

  function showFormError(message) {
    dom.formError.textContent = message;
    dom.toast.textContent = "";
  }

  function clearFormError() {
    dom.formError.textContent = "";
  }

  function setWater(ratio) {
    var top = 40;
    var bottom = 220;
    var height = (bottom - top) * ratio;
    var y = bottom - height;
    dom.water.setAttribute("y", String(y));
    dom.water.setAttribute("height", String(Math.max(0, height)));
    dom.surface.setAttribute("cy", String(y));
    dom.surface.setAttribute("rx", String(18 + 16 * ratio));
    dom.surface.setAttribute("opacity", height > 3 ? "0.95" : "0");
  }

  function renderProgressAndList() {
    var now = Date.now();
    var summary = Z.summarize(state.entries, state.targetMl, now);
    var ratio = state.targetMl > 0 ? Math.min(1, summary.totalMl / state.targetMl) : 0;
    setWater(ratio);
    dom.total.textContent = summary.totalMl.toLocaleString("zh-CN");
    dom.percent.textContent = "完成 " + Math.round(ratio * 100) + "%";
    dom.remain.textContent = "还差 " + summary.remainingMl.toLocaleString("zh-CN") + " 毫升";
    if (summary.extraMl > 0) {
      dom.extra.hidden = false;
      dom.extra.textContent = "比计划多喝了 " + summary.extraMl.toLocaleString("zh-CN") + " 毫升";
    } else {
      dom.extra.hidden = true;
      dom.extra.textContent = "";
    }
    dom.goalFlag.hidden = !summary.reached;
    dom.readout.classList.toggle("is-reached", summary.reached);
    dom.glassCaption.hidden = summary.reached;
    dom.glassCaption.textContent = summary.totalMl === 0 ? "杯子还是空的" : "正在靠近今天的计划";
    document.title = summary.reached ? "饮水记录 · 今日目标已达成" : "饮水记录 · " + summary.totalMl + "/" + state.targetMl;
    renderList(summary);
  }

  function renderList(summary) {
    dom.logCount.textContent = summary.today.length + " 杯";
    dom.logList.replaceChildren();
    if (summary.today.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty";
      var title = document.createElement("p");
      title.className = "empty-title";
      title.textContent = "今天还没有记录";
      var body = document.createElement("p");
      body.textContent = "选一个常用分量，或自己填毫升数。喝下去的水会出现在这里。";
      empty.append(title, body);
      dom.logList.append(empty);
      flashId = null;
      return;
    }

    var list = document.createElement("ul");
    summary.today.forEach(function (entry) {
      var item = document.createElement("li");
      item.className = "log-row";
      if (entry.id === flashId) item.classList.add("is-new");

      var time = document.createElement("time");
      time.dateTime = new Date(entry.at).toISOString();
      time.textContent = Z.formatShanghaiTime(entry.at);

      var amount = document.createElement("span");
      amount.className = "log-amount";
      amount.textContent = Z.formatMl(entry.ml);

      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn tiny";
      button.textContent = "删除";
      button.setAttribute("aria-label", "删除 " + Z.formatShanghaiTime(entry.at) + " 的 " + Z.formatMl(entry.ml));
      button.addEventListener("click", function () {
        var label = Z.formatShanghaiTime(entry.at) + " 的 " + Z.formatMl(entry.ml);
        state = Z.removeEntry(state, entry.id);
        save();
        renderProgressAndList();
        announce("已删除 " + label + "。");
      });

      item.append(time, amount, button);
      list.append(item);
    });
    dom.logList.append(list);
    flashId = null;
  }

  function renderReminderSettings() {
    var enabled = state.reminder.enabled;
    dom.reminderToggle.setAttribute("aria-checked", enabled ? "true" : "false");
    dom.reminderToggleText.textContent = enabled ? "已开启" : "已关闭";
    if (document.activeElement !== dom.interval) {
      dom.interval.value = String(state.reminder.intervalMin);
    }
    document.querySelectorAll("[data-interval]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.interval) === state.reminder.intervalMin));
    });
    dom.notifyStatus.textContent = notificationCopy();
  }

  function updateCountdown(now) {
    if (!state.reminder.enabled || !Number.isFinite(state.reminder.nextAt)) {
      dom.countdown.textContent = "--:--:--";
      dom.countdown.classList.add("is-idle");
      dom.nextLabel.textContent = "当前间隔 " + state.reminder.intervalMin + " 分钟。打开开关后开始倒计时。";
      return;
    }
    dom.countdown.classList.remove("is-idle");
    dom.countdown.textContent = Z.formatCountdown(state.reminder.nextAt - now);
    dom.nextLabel.textContent = "下次提醒 " + Z.formatShanghaiTime(state.reminder.nextAt);
  }

  function showBanner() {
    dom.banner.hidden = false;
    dom.bannerText.textContent = "该喝水了。休息一下，喝一杯水。";
  }

  function hideBanner() {
    dom.banner.hidden = true;
  }

  function sendNotification() {
    if (notificationKind() !== "granted") return;
    var options = { body: "休息一下，喝一杯水。", lang: "zh-CN", tag: "zhui-water-reminder" };
    try {
      new Notification("该喝水了", Object.assign({ renotify: true }, options));
    } catch (error) {
      try {
        new Notification("该喝水了", options);
      } catch (again) {
        /* 页面内提醒仍然有效。 */
      }
    }
  }

  function checkReminder(now) {
    var result = Z.planReminderTick(state.reminder, now);
    if (result.reminder !== state.reminder) {
      state = {
        targetMl: state.targetMl,
        entries: state.entries,
        reminder: result.reminder,
      };
      save();
      renderReminderSettings();
    }
    if (result.fire) {
      showBanner();
      sendNotification();
    }
    updateCountdown(now);
  }

  function syncClock(now) {
    dom.clock.textContent = Z.formatShanghaiClock(now);
    var day = Z.shanghaiDayKey(now);
    if (shownDay && day !== shownDay) {
      shownDay = day;
      renderProgressAndList();
      announce("已经进入新的一天（上海时间）。今日记录已更新。");
    } else if (!shownDay) {
      shownDay = day;
    }
    if (!whenTouched && document.activeElement !== dom.when) {
      var next = Z.msToShanghaiInput(now);
      if (dom.when.value !== next) dom.when.value = next;
    }
  }

  function tick() {
    var now = Date.now();
    syncClock(now);
    checkReminder(now);
  }

  function logDrink(rawAmount) {
    var amount = Z.parseAmount(rawAmount);
    if (!amount.ok) {
      showFormError(COPY.amount);
      return;
    }
    var when = Z.classifyWhen(dom.when.value, Date.now());
    if (!when.ok) {
      showFormError(COPY[when.reason] || COPY.when);
      return;
    }
    clearFormError();
    var id = Z.createId();
    state = Z.addEntry(state, amount.ml, when.at, id);
    save();
    flashId = id;
    whenTouched = false;
    dom.when.value = Z.msToShanghaiInput(Date.now());
    renderProgressAndList();
    announce("已记下 " + Z.formatMl(amount.ml) + "。");
  }

  function commitInterval(raw) {
    var parsed = Z.parseInterval(raw);
    if (!parsed.ok) {
      dom.reminderError.textContent = COPY.interval;
      return;
    }
    dom.reminderError.textContent = "";
    var nextAt = state.reminder.enabled ? Date.now() + parsed.minutes * 60 * 1000 : state.reminder.nextAt;
    state = {
      targetMl: state.targetMl,
      entries: state.entries,
      reminder: {
        enabled: state.reminder.enabled,
        intervalMin: parsed.minutes,
        nextAt: nextAt,
      },
    };
    save();
    renderReminderSettings();
    updateCountdown(Date.now());
    announce("提醒间隔已设为 " + parsed.minutes + " 分钟。");
  }

  function requestNotificationPermission() {
    if (notificationKind() !== "default") {
      renderReminderSettings();
      return;
    }
    Notification.requestPermission()
      .catch(function () {
        return "default";
      })
      .then(function () {
        renderReminderSettings();
      });
  }

  function toggleReminder() {
    if (state.reminder.enabled) {
      state = {
        targetMl: state.targetMl,
        entries: state.entries,
        reminder: {
          enabled: false,
          intervalMin: state.reminder.intervalMin,
          nextAt: null,
        },
      };
      save();
      hideBanner();
      renderReminderSettings();
      updateCountdown(Date.now());
      announce("喝水提醒已关闭。");
      return;
    }
    var parsed = Z.parseInterval(dom.interval.value);
    if (!parsed.ok) {
      dom.reminderError.textContent = COPY.interval;
      return;
    }
    dom.reminderError.textContent = "";
    state = {
      targetMl: state.targetMl,
      entries: state.entries,
      reminder: {
        enabled: true,
        intervalMin: parsed.minutes,
        nextAt: Date.now() + parsed.minutes * 60 * 1000,
      },
    };
    save();
    renderReminderSettings();
    updateCountdown(Date.now());
    announce("喝水提醒已开启。");
    requestNotificationPermission();
  }

  function bind() {
    dom.logForm.addEventListener("submit", function (event) {
      event.preventDefault();
      logDrink(dom.amount.value);
    });
    dom.quick.addEventListener("click", function (event) {
      var button = event.target.closest("[data-ml]");
      if (!button) return;
      logDrink(button.dataset.ml);
    });
    dom.useNow.addEventListener("click", function () {
      whenTouched = false;
      dom.when.value = Z.msToShanghaiInput(Date.now());
      clearFormError();
    });
    dom.when.addEventListener("input", function () {
      whenTouched = true;
      clearFormError();
    });
    dom.amount.addEventListener("input", clearFormError);

    dom.planForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var parsed = Z.parseTarget(dom.target.value);
      if (!parsed.ok) {
        dom.planMsg.textContent = "";
        dom.planError.textContent = COPY.target;
        return;
      }
      dom.planError.textContent = "";
      state = {
        targetMl: parsed.ml,
        entries: state.entries,
        reminder: state.reminder,
      };
      save();
      renderProgressAndList();
      dom.planMsg.textContent = "计划已保存。";
    });
    dom.target.addEventListener("input", function () {
      dom.planError.textContent = "";
      dom.planMsg.textContent = "";
    });

    dom.reminderToggle.addEventListener("click", toggleReminder);
    dom.interval.addEventListener("change", function () {
      commitInterval(dom.interval.value);
    });
    document.querySelectorAll("[data-interval]").forEach(function (button) {
      button.addEventListener("click", function () {
        dom.interval.value = button.dataset.interval;
        commitInterval(button.dataset.interval);
      });
    });
    dom.bannerDismiss.addEventListener("click", hideBanner);

    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
  }

  function boot() {
    state = Z.loadState(window.localStorage);
    dom = {
      clock: $("clock"),
      banner: $("banner"),
      bannerText: $("banner-text"),
      bannerDismiss: $("banner-dismiss"),
      water: $("water"),
      surface: $("surface"),
      glassCaption: $("glass-caption"),
      readout: $("readout"),
      total: $("total"),
      percent: $("percent"),
      remain: $("remain"),
      extra: $("extra"),
      goalFlag: $("goal-flag"),
      planForm: $("plan-form"),
      target: $("target"),
      planError: $("plan-error"),
      planMsg: $("plan-msg"),
      reminderToggle: $("reminder-toggle"),
      reminderToggleText: $("reminder-toggle-text"),
      interval: $("interval"),
      countdown: $("countdown"),
      nextLabel: $("next-label"),
      notifyStatus: $("notify-status"),
      reminderError: $("reminder-error"),
      logForm: $("log-form"),
      quick: $("quick-add"),
      amount: $("amount"),
      when: $("when"),
      useNow: $("use-now"),
      formError: $("form-error"),
      toast: $("toast"),
      logCount: $("log-count"),
      logList: $("log-list"),
    };
    bind();
    dom.target.value = String(state.targetMl);
    dom.amount.value = "250";
    dom.interval.value = String(state.reminder.intervalMin);
    dom.when.value = Z.msToShanghaiInput(Date.now());
    shownDay = Z.shanghaiDayKey(Date.now());
    renderReminderSettings();
    renderProgressAndList();
    tick();
    window.setInterval(tick, 1000);

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "notifications" }).then(function (status) {
        status.onchange = renderReminderSettings;
      }).catch(function () {});
    }
  }

  boot();
})();
