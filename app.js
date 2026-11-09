(function () {
  "use strict";

  var Z = window.ZhuiWater;
  var AMOUNT_ERROR = "请输入 1 到 3000 之间的整数毫升。";
  var SVG_NS = "http://www.w3.org/2000/svg";

  var state = Z.defaultState();
  var statRange = "day";
  var flashId = null;
  var shownDay = "";
  var dom = {};
  var tabs = [];

  function $(id) {
    return document.getElementById(id);
  }

  function update(patch) {
    state = Z.withState(state, patch);
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

  function slotLabel(slotId) {
    for (var i = 0; i < state.schedule.length; i += 1) {
      if (state.schedule[i].id === slotId) return state.schedule[i].label;
    }
    return "";
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
    return "开启后会请求系统通知权限。无论是否允许，页面里都会提醒。";
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
    var target = Z.dailyTarget(state);
    var summary = Z.summarize(state.entries, target, now);
    var ratio = target > 0 ? Math.min(1, summary.totalMl / target) : 0;
    dom.planLine.textContent = "今日计划 " + Z.formatMl(target);
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
    document.title = summary.reached ? "饮水记录 · 今日目标已达成" : "饮水记录 · " + summary.totalMl + "/" + target;
    renderList(summary);
    updateSlotStatuses(now);
    if (!dom.panelStats.hidden) renderStats();
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
      var tag = entry.slotId ? slotLabel(entry.slotId) : "";
      if (tag) {
        var chip = document.createElement("span");
        chip.className = "log-tag";
        chip.textContent = tag;
        amount.append(chip);
      }

      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn tiny";
      button.textContent = "删除";
      button.setAttribute("aria-label", "删除 " + Z.formatShanghaiTime(entry.at) + " 的 " + Z.formatMl(entry.ml));
      button.addEventListener("click", function () {
        var label = Z.formatShanghaiTime(entry.at) + " 的 " + Z.formatMl(entry.ml);
        update(Z.removeEntry(state, entry.id));
        save();
        renderProgressAndList();
        updateNext(Date.now());
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
    dom.notifyStatus.textContent = notificationCopy();
  }

  function updateNext(now) {
    if (!state.reminder.enabled) {
      dom.nextTime.textContent = "--:--";
      dom.nextTime.classList.add("is-idle");
      dom.nextLabel.textContent = "提醒已关闭。打开开关后，到方案里的时间点会提醒你。";
      return;
    }
    var next = Z.nextReminder(state, now);
    if (!next) {
      dom.nextTime.textContent = "--:--";
      dom.nextTime.classList.add("is-idle");
      dom.nextLabel.textContent =
        state.schedule.length === 0 ? "方案里还没有时间点。" : "今天的提醒已经全部结束。明天继续。";
      return;
    }
    dom.nextTime.classList.remove("is-idle");
    dom.nextTime.textContent = next.slot.time;
    dom.nextLabel.textContent = next.slot.label + " · " + Z.formatMl(next.slot.ml);
  }

  function renderPlanTotal() {
    var total = Z.scheduleTotal(state.schedule);
    dom.planTotal.textContent =
      state.schedule.length === 0
        ? "方案里还没有时间点，今日计划暂按 " + Z.formatMl(state.targetMl) + " 计算。"
        : "方案合计 " + Z.formatMl(total) + "，也就是每天的计划。";
  }

  function makeInput(className, type, label, attrs) {
    var input = document.createElement("input");
    input.className = className;
    input.type = type;
    input.setAttribute("aria-label", label);
    Object.keys(attrs || {}).forEach(function (key) {
      input.setAttribute(key, attrs[key]);
    });
    return input;
  }

  function createSlotRow(slot) {
    var item = document.createElement("li");
    item.className = "slot";
    item.dataset.id = slot.id;

    var time = makeInput("s-time", "text", "提醒时间（24 小时制）", {
      inputmode: "numeric",
      maxlength: "5",
      placeholder: "13:30",
      autocomplete: "off",
    });
    time.value = slot.time;
    var ml = makeInput("s-ml", "number", "毫升", { min: "1", max: "3000", step: "1", inputmode: "numeric" });
    ml.value = String(slot.ml);
    var label = makeInput("s-label", "text", "名称", { maxlength: "24", placeholder: "名称" });
    label.value = slot.label;
    var note = makeInput("s-note", "text", "备注", { maxlength: "60", placeholder: "备注（可不填）" });
    note.value = slot.note;

    var unit = document.createElement("span");
    unit.className = "s-unit";
    unit.textContent = "毫升";

    var side = document.createElement("div");
    side.className = "slot-side";
    var status = document.createElement("span");
    status.className = "slot-status";
    var drink = document.createElement("button");
    drink.type = "button";
    drink.className = "btn small primary";
    drink.dataset.action = "drink";
    drink.textContent = "喝了";
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn small danger";
    remove.dataset.action = "remove";
    remove.textContent = "删除";
    side.append(status, drink, remove);

    var mlWrap = document.createElement("div");
    mlWrap.className = "s-ml-wrap";
    mlWrap.append(ml, unit);
    item.append(time, mlWrap, label, note, side);
    return item;
  }

  function renderSchedule(focusId) {
    dom.slotList.replaceChildren();
    if (state.schedule.length === 0) {
      var empty = document.createElement("li");
      empty.className = "slot-empty";
      empty.textContent = "还没有时间点。点「添加时间点」开始，或恢复默认方案。";
      dom.slotList.append(empty);
    } else {
      Z.sortSchedule(state.schedule).forEach(function (slot) {
        dom.slotList.append(createSlotRow(slot));
      });
    }
    renderPlanTotal();
    updateSlotStatuses(Date.now());
    if (focusId) {
      var row = dom.slotList.querySelector('[data-id="' + focusId + '"] .s-time');
      if (row) row.focus();
    }
  }

  function updateSlotStatuses(now) {
    var rows = Z.slotRows(state, now);
    rows.forEach(function (row) {
      var li = dom.slotList.querySelector('[data-id="' + row.slot.id + '"]');
      if (!li) return;
      var status = li.querySelector(".slot-status");
      var drink = li.querySelector('[data-action="drink"]');
      li.dataset.status = row.status;
      if (row.status === "done") {
        status.textContent = "已喝 " + Z.formatShanghaiTime(row.entry.at);
        drink.disabled = true;
      } else {
        status.textContent = row.status === "late" ? "已过时间" : "待喝";
        drink.disabled = false;
      }
    });
  }

  function collectSchedule() {
    var rows = Array.prototype.slice.call(dom.slotList.querySelectorAll(".slot"));
    var list = [];
    var problem = "";
    rows.forEach(function (row, index) {
      var time = row.querySelector(".s-time");
      var ml = row.querySelector(".s-ml");
      var parsed = Z.parseSlot({
        id: row.dataset.id,
        time: time.value,
        ml: ml.value,
        label: row.querySelector(".s-label").value,
        note: row.querySelector(".s-note").value,
      });
      time.removeAttribute("aria-invalid");
      ml.removeAttribute("aria-invalid");
      if (!parsed.ok) {
        var bad = parsed.field === "time" ? time : ml;
        bad.setAttribute("aria-invalid", "true");
        if (!problem) {
          problem =
            "第 " + (index + 1) + " 行" + (parsed.field === "time" ? "的时间请按 24 小时制填写，例如 13:30。" : "的毫升请填 1 到 3000 的整数。");
        }
        return;
      }
      time.value = parsed.slot.time;
      list.push(parsed.slot);
    });
    if (problem) {
      dom.slotError.textContent = problem + "改好之前，这一行不会保存。";
      return;
    }
    dom.slotError.textContent = "";

    var movedIds = [];
    list.forEach(function (slot) {
      var before = state.schedule.filter(function (old) {
        return old.id === slot.id;
      })[0];
      if (before && before.time !== slot.time) movedIds.push(slot.id);
    });
    var reminder = state.reminder;
    if (movedIds.length) {
      reminder = {
        enabled: reminder.enabled,
        firedDay: reminder.firedDay,
        firedIds: reminder.firedIds.filter(function (id) {
          return movedIds.indexOf(id) === -1;
        }),
      };
    }
    update({ schedule: list, reminder: reminder });
    save();
    renderPlanTotal();
    renderProgressAndList();
    updateNext(Date.now());
  }

  function showBanner(slots) {
    dom.bannerBody.replaceChildren();
    dom.bannerActions.replaceChildren();
    var head = document.createElement("strong");
    head.textContent = "该喝水了。";
    dom.bannerBody.append(head);
    slots.forEach(function (slot) {
      var line = document.createElement("p");
      line.textContent = slot.time + " " + slot.label + "，喝 " + Z.formatMl(slot.ml) + (slot.note ? "（" + slot.note + "）" : "");
      dom.bannerBody.append(line);

      var done = document.createElement("button");
      done.type = "button";
      done.className = "btn light";
      done.textContent = "记下 " + slot.ml + " 毫升";
      done.addEventListener("click", function () {
        logSlot(slot.id);
        if (dom.bannerActions.querySelectorAll("[data-slot]").length <= 1) hideBanner();
        else done.remove();
      });
      done.dataset.slot = slot.id;
      dom.bannerActions.append(done);
    });
    var dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "btn banner-dismiss";
    dismiss.textContent = "知道了";
    dismiss.addEventListener("click", hideBanner);
    dom.bannerActions.append(dismiss);
    dom.banner.hidden = false;
  }

  function hideBanner() {
    dom.banner.hidden = true;
  }

  function sendNotification(slots) {
    if (notificationKind() !== "granted") return;
    var body = slots
      .map(function (slot) {
        return slot.label + " " + Z.formatMl(slot.ml) + (slot.note ? "（" + slot.note + "）" : "");
      })
      .join("；");
    var options = { body: body, lang: "zh-CN", tag: "zhui-water-reminder" };
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
    var result = Z.planSchedule(state, now);
    if (result.reminder !== state.reminder) {
      update({ reminder: result.reminder });
      save();
    }
    if (result.fire.length) {
      showBanner(result.fire);
      sendNotification(result.fire);
    }
    updateNext(now);
    updateSlotStatuses(now);
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
  }

  function tick() {
    var now = Date.now();
    syncClock(now);
    checkReminder(now);
  }

  function logDrink(rawAmount) {
    var amount = Z.parseAmount(rawAmount);
    if (!amount.ok) {
      showFormError(AMOUNT_ERROR);
      return false;
    }
    clearFormError();
    addEntryAt(amount.ml, Date.now());
    return true;
  }

  function addEntryAt(ml, at, slotId) {
    var id = Z.createId();
    update(Z.addEntry(state, ml, at, id, slotId));
    save();
    flashId = id;
    renderProgressAndList();
    updateNext(Date.now());
    announce("已记下 " + Z.formatMl(ml) + "。");
  }

  function logSlot(slotId) {
    var slot = state.schedule.filter(function (item) {
      return item.id === slotId;
    })[0];
    if (!slot) return;
    var now = Date.now();
    if (Z.slotRows(state, now).some(function (row) {
      return row.slot.id === slotId && row.status === "done";
    })) {
      return;
    }
    addEntryAt(slot.ml, now, slotId);
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
    var reminder = state.reminder;
    if (reminder.enabled) {
      update({ reminder: { enabled: false, firedDay: reminder.firedDay, firedIds: reminder.firedIds } });
      save();
      hideBanner();
      renderReminderSettings();
      updateNext(Date.now());
      announce("喝水提醒已关闭。");
      return;
    }
    update({ reminder: { enabled: true, firedDay: reminder.firedDay, firedIds: reminder.firedIds } });
    save();
    renderReminderSettings();
    checkReminder(Date.now());
    announce("喝水提醒已开启。");
    requestNotificationPermission();
  }

  function selectTab(name) {
    tabs.forEach(function (item) {
      var active = item.name === name;
      item.tab.setAttribute("aria-selected", String(active));
      item.tab.tabIndex = active ? 0 : -1;
      item.panel.hidden = !active;
    });
    if (name === "plan") renderSchedule();
    if (name === "stats") renderStats();
  }

  function svgEl(name, attrs, text) {
    var el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, attrs[key]);
    });
    if (text != null) el.textContent = text;
    return el;
  }

  function niceScale(value) {
    var steps = [100, 200, 250, 500, 1000, 2000, 5000];
    var step = 5000;
    for (var i = 0; i < steps.length; i += 1) {
      if (value / 4 <= steps[i]) {
        step = steps[i];
        break;
      }
    }
    return { step: step, max: Math.max(step * 2, Math.ceil(value / step) * step) };
  }

  function drawChart(items, opts) {
    var W = 720;
    var H = 280;
    var L = 52;
    var R = 14;
    var T = 24;
    var B = 48;
    var plotW = W - L - R;
    var plotH = H - T - B;
    var peak = opts.target || 0;
    items.forEach(function (item) {
      if (!item.future && item.ml > peak) peak = item.ml;
    });
    var scale = niceScale(peak * 1.08 || 100);
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, class: "chart-svg", role: "img", "aria-label": opts.label });

    for (var v = 0; v <= scale.max; v += scale.step) {
      var gy = T + plotH - (v / scale.max) * plotH;
      svg.append(svgEl("line", { x1: L, x2: W - R, y1: gy, y2: gy, class: v === 0 ? "axis-line" : "grid-line" }));
      svg.append(svgEl("text", { x: L - 8, y: gy + 4, class: "axis-text", "text-anchor": "end" }, v.toLocaleString("zh-CN")));
    }

    var slot = plotW / items.length;
    var barW = Math.min(44, slot * 0.62);
    items.forEach(function (item, i) {
      var cx = L + slot * i + slot / 2;
      if (!item.future && item.ml > 0) {
        var h = (item.ml / scale.max) * plotH;
        var cls = "bar";
        if (opts.target && item.ml >= opts.target) cls += " is-good";
        else if (item.isToday) cls += " is-today";
        var bar = svgEl("rect", {
          x: cx - barW / 2,
          y: T + plotH - h,
          width: barW,
          height: h,
          rx: Math.min(5, barW / 3),
          class: cls,
        });
        bar.append(svgEl("title", {}, item.tip));
        svg.append(bar);
        if (opts.valueLabels) {
          svg.append(svgEl("text", { x: cx, y: T + plotH - h - 6, class: "value-text", "text-anchor": "middle" }, String(item.ml)));
        }
      }
      if (i % opts.labelEvery === 0) {
        svg.append(
          svgEl("text", { x: cx, y: T + plotH + 18, class: "axis-text" + (item.isToday ? " is-today" : ""), "text-anchor": "middle" }, item.label)
        );
        if (item.sub) {
          svg.append(svgEl("text", { x: cx, y: T + plotH + 34, class: "axis-text sub", "text-anchor": "middle" }, item.sub));
        }
      }
    });

    if (opts.target) {
      var ty = T + plotH - (opts.target / scale.max) * plotH;
      svg.append(svgEl("line", { x1: L, x2: W - R, y1: ty, y2: ty, class: "target-line" }));
      svg.append(svgEl("text", { x: W - R, y: ty - 6, class: "target-text", "text-anchor": "end" }, "每日计划 " + opts.target.toLocaleString("zh-CN")));
    }
    return svg;
  }

  function tile(label, value) {
    var box = document.createElement("div");
    box.className = "tile";
    var name = document.createElement("span");
    name.textContent = label;
    var strong = document.createElement("strong");
    strong.textContent = value;
    box.append(name, strong);
    return box;
  }

  function renderStats() {
    var now = Date.now();
    var target = Z.dailyTarget(state);
    dom.statSeg.querySelectorAll("[data-range]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.range === statRange));
    });
    var tiles = [];
    var items;
    var opts;
    var hasData;
    var note;

    if (statRange === "day") {
      var summary = Z.summarize(state.entries, target, now);
      var hours = Z.statsHourly(state.entries, now);
      items = hours.map(function (hour) {
        return { label: hour.label + "时", ml: hour.ml, tip: hour.label + " 点：" + Z.formatMl(hour.ml) };
      });
      tiles = [
        tile("今日合计", Z.formatMl(summary.totalMl)),
        tile("完成度", (target > 0 ? Math.round((summary.totalMl / target) * 100) : 0) + "%"),
        tile("今日杯数", summary.today.length + " 杯"),
      ];
      dom.statCaption.textContent = "今天每个小时喝了多少（上海时间）";
      opts = { target: null, labelEvery: 3, valueLabels: false, label: "今日按小时的饮水量柱状图" };
      hasData = summary.totalMl > 0;
      note = hasData ? "柱子高度是那个小时喝的毫升数。" : "今天还没有记录。";
    } else {
      var days = Z.statsDays(state.entries, now, statRange);
      var stats = Z.statsSummary(days, target);
      items = days.map(function (day) {
        return {
          label: day.label,
          sub: day.sub && statRange === "week" ? day.sub : "",
          ml: day.ml,
          future: day.future,
          isToday: day.isToday,
          tip: day.sub + "：" + Z.formatMl(day.ml),
        };
      });
      var span = statRange === "week" ? "最近 7 天" : "本月";
      tiles = [
        tile(span + "合计", Z.formatMl(stats.totalMl)),
        tile("日均", Z.formatMl(stats.averageMl)),
        tile("达标天数", stats.reachedDays + " / " + stats.elapsedDays + " 天"),
      ];
      dom.statCaption.textContent =
        statRange === "week"
          ? "最近 7 天，每天一共喝了多少"
          : Number(Z.shanghaiDayKey(now).slice(5, 7)) + " 月，每天一共喝了多少";
      opts = {
        target: target,
        labelEvery: 1,
        valueLabels: statRange === "week",
        label: (statRange === "week" ? "最近 7 天" : "本月") + "每日饮水量柱状图",
      };
      hasData = stats.totalMl > 0;
      note = hasData
        ? "虚线是每日计划（来自喝水方案），绿色柱子表示当天达标。日均按已过去的天数算。"
        : "这段时间还没有记录。";
    }
    dom.statTiles.replaceChildren.apply(dom.statTiles, tiles);
    dom.statChart.replaceChildren(drawChart(items, opts));
    dom.statNote.textContent = note;
  }

  function bind() {
    dom.logForm.addEventListener("submit", function (event) {
      event.preventDefault();
      if (logDrink(dom.amount.value)) dom.amount.value = "";
    });
    dom.quick.addEventListener("click", function (event) {
      var button = event.target.closest("[data-ml]");
      if (!button) return;
      logDrink(button.dataset.ml);
    });
    dom.amount.addEventListener("input", clearFormError);

    dom.reminderToggle.addEventListener("click", toggleReminder);
    dom.editPlan.addEventListener("click", function () {
      selectTab("plan");
      dom.tabPlan.focus();
    });
    tabs.forEach(function (item, index) {
      item.tab.addEventListener("click", function () {
        selectTab(item.name);
      });
      item.tab.addEventListener("keydown", function (event) {
        var step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!step) return;
        var target = tabs[(index + step + tabs.length) % tabs.length];
        selectTab(target.name);
        target.tab.focus();
      });
    });
    dom.statSeg.addEventListener("click", function (event) {
      var button = event.target.closest("[data-range]");
      if (!button) return;
      statRange = button.dataset.range;
      renderStats();
    });

    dom.slotList.addEventListener("change", collectSchedule);
    dom.slotList.addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      if (!button) return;
      var row = button.closest(".slot");
      if (!row) return;
      if (button.dataset.action === "drink") {
        logSlot(row.dataset.id);
        return;
      }
      update({
        schedule: state.schedule.filter(function (slot) {
          return slot.id !== row.dataset.id;
        }),
      });
      save();
      dom.slotError.textContent = "";
      renderSchedule();
      renderProgressAndList();
      updateNext(Date.now());
    });
    dom.addSlot.addEventListener("click", function () {
      if (state.schedule.length >= 24) {
        dom.slotError.textContent = "最多可以设 24 个时间点。";
        return;
      }
      collectSchedule();
      if (dom.slotError.textContent) return;
      var slot = Z.parseSlot({ time: Z.suggestSlotTime(Date.now()), ml: 250, label: "喝水", note: "" }).slot;
      update({ schedule: state.schedule.concat([slot]) });
      save();
      renderSchedule(slot.id);
      renderProgressAndList();
      updateNext(Date.now());
    });
    dom.resetPlan.addEventListener("click", function () {
      if (!window.confirm("用默认方案替换当前的喝水方案吗？")) return;
      update({ schedule: Z.defaultSchedule() });
      save();
      dom.slotError.textContent = "";
      renderSchedule();
      renderProgressAndList();
      updateNext(Date.now());
    });

    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
  }

  function boot() {
    state = Z.loadState(window.localStorage);
    dom = {
      clock: $("clock"),
      banner: $("banner"),
      bannerBody: $("banner-body"),
      bannerActions: $("banner-actions"),
      water: $("water"),
      surface: $("surface"),
      glassCaption: $("glass-caption"),
      readout: $("readout"),
      total: $("total"),
      percent: $("percent"),
      remain: $("remain"),
      extra: $("extra"),
      goalFlag: $("goal-flag"),
      reminderToggle: $("reminder-toggle"),
      reminderToggleText: $("reminder-toggle-text"),
      nextTime: $("next-time"),
      planLine: $("plan-line"),
      nextLabel: $("next-label"),
      notifyStatus: $("notify-status"),
      editPlan: $("edit-plan"),
      tabLog: $("tab-log"),
      tabPlan: $("tab-plan"),
      tabStats: $("tab-stats"),
      panelStats: $("panel-stats"),
      statSeg: document.querySelector(".seg"),
      statCaption: $("stat-caption"),
      statTiles: $("stat-tiles"),
      statChart: $("stat-chart"),
      statNote: $("stat-note"),
      panelLog: $("panel-log"),
      panelPlan: $("panel-plan"),
      logForm: $("log-form"),
      quick: $("quick-add"),
      amount: $("amount"),
      formError: $("form-error"),
      toast: $("toast"),
      logCount: $("log-count"),
      logList: $("log-list"),
      slotList: $("slot-list"),
      slotError: $("slot-error"),
      planTotal: $("plan-total"),
      addSlot: $("add-slot"),
      resetPlan: $("reset-plan"),
    };
    tabs = [
      { name: "log", tab: dom.tabLog, panel: dom.panelLog },
      { name: "plan", tab: dom.tabPlan, panel: dom.panelPlan },
      { name: "stats", tab: dom.tabStats, panel: dom.panelStats },
    ];
    bind();
    shownDay = Z.shanghaiDayKey(Date.now());
    renderReminderSettings();
    renderSchedule();
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
