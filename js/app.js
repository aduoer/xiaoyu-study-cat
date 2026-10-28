import { copy } from "./copy.js";
import { store, dayKey } from "./store.js";

const $ = (sel, root = document) => root.querySelector(sel);
const NS = "http://www.w3.org/2000/svg";

const el = {
  scene: $("#scene"),
  sceneSvg: $("#sceneSvg"),
  scenePill: $("#scenePill"),
  scenePillText: $("#scenePillText"),
  bubble: $("#bubble"),
  cat: $(".cat"),
  bowlFish: $("#bowlFish"),

  todayLabel: $("#todayLabel"),
  soundBtn: $("#soundBtn"),
  settingsBtn: $("#settingsBtn"),

  timerCard: $("#timerCard"),
  phaseLabel: $("#phaseLabel"),
  roundLabel: $("#roundLabel"),
  clock: $("#clock"),
  durations: $("#durations"),
  startBtn: $("#startBtn"),
  stopBtn: $("#stopBtn"),
  trackFill: $("#trackFill"),
  timerHint: $("#timerHint"),
  companionBtn: $("#companionBtn"),
  closeBtn: $("#closeBtn"),

  taskList: $("#taskList"),
  taskEmpty: $("#taskEmpty"),
  taskForm: $("#taskForm"),
  taskInput: $("#taskInput"),
  taskCount: $("#taskCount"),

  streakNum: $("#streakNum"),
  todayNum: $("#todayNum"),
  totalNum: $("#totalNum"),
  weekRow: $("#weekRow"),
  foodNum: $("#foodNum"),
  feedBtn: $("#feedBtn"),
  petBtn: $("#petBtn"),
  careNote: $("#careNote"),
  foodBowl: $("#foodBowl"),
  petHearts: $("#petHearts"),

  settingsDlg: $("#settingsDlg"),
  settingsForm: $("#settingsForm"),
  nameFish: $("#nameFish"),
  nameCat: $("#nameCat"),
  soundToggle: $("#soundToggle"),
  clearData: $("#clearData"),
  cancelSettings: $("#cancelSettings"),
};

const ui = {
  mode: "idle",
  total: 0,
  remaining: 0,
  endsAt: 0,
  round: 1,
  tickId: 0,
  bubbleId: 0,
  wakeId: 0,
  petTimer: 0,
  eatTimer: 0,
  petting: false,
  petStartAt: 0,
  eating: false,
  lastPetAt: 0,
  wake: null,
  audio: null,
};

let lastPicked = "";
let lastTitle = "";

/* ---------------- 小工具 ---------------- */

const nameOf = (k) => store.data.names[k] || (k === "fish" ? "小鱼" : "小猫");

function fmt(tpl, vars = {}) {
  return String(tpl)
    .replaceAll("{fish}", nameOf("fish"))
    .replaceAll("{cat}", nameOf("cat"))
    .replaceAll("{n}", String(vars.n ?? ""));
}

function pick(list) {
  const arr = Array.isArray(list) ? list : [list];
  let out = arr[Math.floor(Math.random() * arr.length)];
  if (arr.length > 1 && out === lastPicked) {
    out = arr[(arr.indexOf(out) + 1) % arr.length];
  }
  lastPicked = out;
  return out;
}

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function say(text, ms = 9000) {
  clearTimeout(ui.bubbleId);
  el.bubble.textContent = text;
  el.bubble.classList.add("is-on");
  ui.bubbleId = setTimeout(() => el.bubble.classList.remove("is-on"), ms);
}

function updateTitle() {
  let t = `${nameOf("cat")}陪${nameOf("fish")}写作业`;
  if (ui.mode === "focus" || ui.mode === "rest") t = `${fmtTime(ui.remaining)} · ${t}`;
  else if (ui.mode === "night") t = `晚安 · ${t}`;

  if (t !== lastTitle) {
    document.title = t;
    lastTitle = t;
  }
}

/* ---------------- 声音 ---------------- */

function ensureAudio() {
  if (ui.audio) return ui.audio;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ui.audio = new AC();
  } catch {
    ui.audio = null;
  }
  return ui.audio;
}

function tone(freq, delay, dur, vol) {
  const ac = ui.audio;
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(vol, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.08);
}

function chime(kind) {
  if (!store.data.settings.sound) return;
  if (document.visibilityState !== "visible") return;
  const ac = ensureAudio();
  if (!ac) return;
  if (ac.state === "suspended") ac.resume().catch(() => {});

  if (kind === "start") {
    tone(523.25, 0, 1.3, 0.03);
    tone(783.99, 0.1, 1.4, 0.022);
  } else if (kind === "focusEnd") {
    tone(659.25, 0, 1.7, 0.05);
    tone(880.0, 0.18, 1.8, 0.042);
    tone(1174.66, 0.36, 2.1, 0.03);
  } else if (kind === "restEnd") {
    tone(523.25, 0, 1.5, 0.04);
    tone(783.99, 0.2, 1.6, 0.03);
  } else if (kind === "night") {
    tone(523.25, 0, 2.2, 0.04);
    tone(392.0, 0.3, 2.6, 0.034);
  } else if (kind === "tick") {
    tone(1046.5, 0, 0.4, 0.02);
  }
}

/* ---------------- 屏幕常亮 ---------------- */

async function acquireWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    ui.wake = await navigator.wakeLock.request("screen");
    ui.wake.addEventListener("release", () => {
      ui.wake = null;
    });
  } catch {
    ui.wake = null;
  }
}

function releaseWakeLock() {
  if (!ui.wake) return;
  ui.wake.release().catch(() => {});
  ui.wake = null;
}

/* ---------------- 计时 ---------------- */

const MODE = {
  idle: {
    phase: "准备好就开始",
    hint: "点开始，小猫就趴下；时间到了它才轻轻叫你。",
    start: "开始写作业",
    stop: null,
    live: false,
    asleep: false,
  },
  focus: {
    phase: "专注中",
    hint: "小猫趴下了，不吵你。写完这轮再理它。",
    start: "暂停",
    stop: "结束本轮",
    live: true,
    asleep: true,
  },
  paused: {
    phase: "暂停中",
    hint: "本子先合上，小猫替你看着。",
    start: "继续",
    stop: "结束本轮",
    live: true,
    asleep: true,
  },
  rest: {
    phase: "休息中",
    hint: "喝口水，伸个懒腰，别急着翻下一页。",
    start: "开始下一轮",
    stop: "跳过休息",
    live: true,
    asleep: false,
  },
  companion: {
    phase: "小猫在陪你",
    hint: "小猫会一直趴着。你写你的，不用管它。",
    start: "开始计时",
    stop: "结束陪读",
    live: false,
    asleep: true,
  },
  night: {
    phase: "小猫把灯关了",
    hint: "明天见。",
    start: "还不想睡？再写一轮",
    stop: null,
    live: false,
    asleep: true,
  },
};

function renderClock() {
  let text;
  if (ui.mode === "companion") text = "∞";
  else if (ui.mode === "night") text = "晚安";
  else if (ui.mode === "idle") text = fmtTime(store.data.settings.focus * 60000);
  else text = fmtTime(ui.remaining);

  if (el.clock.textContent !== text) el.clock.textContent = text;
  renderProgress();
  updateTitle();
}

function renderProgress() {
  let pct = 0;
  if (ui.mode === "focus" || ui.mode === "rest" || ui.mode === "paused") {
    pct = ui.total > 0 ? (1 - ui.remaining / ui.total) * 100 : 0;
  }
  el.trackFill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function applyMode() {
  const m = ui.mode;
  const cfg = MODE[m];
  const today = store.todayCount();
  const wasAsleep = el.scene.dataset.cat === "sleep";

  if (cfg.asleep && ui.eating) {
    clearTimeout(ui.eatTimer);
    ui.eating = false;
    el.scene.classList.remove("is-eating");
  }

  el.scene.dataset.cat = cfg.asleep ? "sleep" : "awake";
  if (wasAsleep && !cfg.asleep) {
    clearTimeout(ui.wakeId);
    el.cat.classList.remove("is-waking");
    void el.cat.getBoundingClientRect();
    el.cat.classList.add("is-waking");
    ui.wakeId = setTimeout(() => el.cat.classList.remove("is-waking"), 1500);
  }
  el.scene.classList.toggle("is-focus", cfg.asleep);
  el.scene.classList.toggle("is-night", m === "night");
  el.timerCard.classList.toggle("is-live", cfg.live);
  el.timerCard.classList.toggle("is-rest", m === "rest");
  el.timerCard.classList.toggle("is-night", m === "night");
  el.clock.classList.toggle("is-rest", m === "rest");
  el.clock.classList.toggle("is-static", m === "companion" || m === "night");
  el.clock.classList.toggle("is-night", m === "night");

  el.scenePill.classList.toggle("is-on", cfg.asleep);
  el.scenePillText.textContent =
    m === "paused"
      ? `${nameOf("cat")}还在 · 暂停中`
      : m === "companion"
        ? "陪读中 · 不打扰"
        : m === "night"
          ? `${nameOf("cat")}睡了 · 晚安`
          : `${nameOf("cat")}已趴下 · 不打扰`;

  el.phaseLabel.textContent = cfg.phase;
  el.roundLabel.textContent =
    m === "idle"
      ? today > 0
        ? `今晚已完成 ${today} 轮`
        : ""
      : m === "rest"
        ? "小猫在等你"
        : m === "companion"
          ? "不计时"
          : m === "night"
            ? `今晚 ${today} 轮 · 连续 ${store.streak()} 天`
            : `第 ${ui.round} 轮`;

  el.timerHint.textContent =
    m === "night" ? `今晚的小鱼都在缸里了，一共 ${today} 条。明天见。` : cfg.hint;
  el.startBtn.textContent = cfg.start;
  el.startBtn.classList.toggle("primary", m !== "night");
  el.startBtn.classList.toggle("ghost", m === "night");
  el.stopBtn.textContent = cfg.stop || "结束";
  el.stopBtn.hidden = !cfg.stop;
  el.durations.hidden = m !== "idle";
  el.companionBtn.hidden = m !== "idle" || today > 0;
  el.closeBtn.hidden = !((m === "idle" || m === "rest") && today > 0);

  el.durations.querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", Number(b.dataset.min) === store.data.settings.focus);
  });

  renderClock();
}

function stopTick() {
  clearInterval(ui.tickId);
  ui.tickId = 0;
}

function startTick() {
  stopTick();
  ui.tickId = setInterval(tick, 250);
  tick();
}

function tick() {
  if (!ui.endsAt) return;
  const remain = ui.endsAt - Date.now();
  ui.remaining = Math.max(0, remain);
  renderClock();
  if (remain <= 0) {
    if (ui.mode === "focus") finishFocus(false);
    else if (ui.mode === "rest") finishRest();
  }
}

function startFocus() {
  ensureAudio();
  const min = store.data.settings.focus;
  const total = min * 60000;

  ui.mode = "focus";
  ui.total = total;
  ui.remaining = total;
  ui.endsAt = Date.now() + total;
  ui.round = store.todayCount() + 1;

  store.data.companion = false;
  store.data.closedAt = null;
  store.data.timer = { kind: "focus", endsAt: ui.endsAt, total, round: ui.round };
  store.save();

  applyMode();
  startTick();
  acquireWakeLock();
  chime("start");

  const hour = new Date().getHours();
  const pool = hour >= 21 || hour < 5 ? copy.focusStartLate : copy.focusStart;
  say(fmt(pick(pool), { n: min }), 9000);
}

function pauseFocus() {
  const remain = Math.max(0, ui.endsAt - Date.now());
  stopTick();
  releaseWakeLock();

  ui.mode = "paused";
  ui.remaining = remain;
  ui.endsAt = 0;
  store.data.timer = { kind: "paused", remaining: remain, total: ui.total, round: ui.round };
  store.save();

  applyMode();
  say(fmt(pick(copy.paused)), 6000);
}

function resumeFocus() {
  if (ui.remaining <= 0) {
    startFocus();
    return;
  }
  ui.endsAt = Date.now() + ui.remaining;
  ui.mode = "focus";
  store.data.timer = { kind: "focus", endsAt: ui.endsAt, total: ui.total, round: ui.round };
  store.save();
  applyMode();
  startTick();
  acquireWakeLock();
}

function finishFocus(silent, startRest = true) {
  stopTick();
  releaseWakeLock();

  store.addSession(ui.total / 60000);
  store.data.food += 1;

  if (!startRest) {
    ui.mode = "idle";
    ui.endsAt = 0;
    ui.remaining = 0;
    store.data.timer = null;
    store.save();
    applyMode();
    renderStats();
    renderBowl(true);
    renderCare();
    popFood();
    celebrate();
    return;
  }

  const restMs = store.data.settings.rest * 60000;
  ui.mode = "rest";
  ui.total = restMs;
  ui.remaining = restMs;
  ui.endsAt = Date.now() + restMs;

  store.data.timer = { kind: "rest", endsAt: ui.endsAt, total: restMs, round: ui.round };
  store.save();

  applyMode();
  startTick();
  renderStats();
  renderBowl(true);
  renderCare();
  popFood();
  celebrate();

  if (!silent) chime("focusEnd");
}

function finishRest() {
  stopTick();
  ui.mode = "idle";
  ui.endsAt = 0;
  ui.remaining = 0;
  store.data.timer = null;
  store.save();

  applyMode();
  chime("restEnd");
  say(fmt(pick(copy.restEnd)), 9000);
}

function celebrate() {
  const streak = store.streak();
  const today = store.todayCount();
  let msg;
  if (store.total() === 1 && store.data.feeds === 0) msg = copy.firstFood;
  else if (copy.milestones[streak]) msg = copy.milestones[streak];
  else if (today === 4) msg = copy.roundFour;
  else msg = pick(copy.focusEnd);
  say(fmt(msg), 13000);
  wiggle();
}

function stopCurrent() {
  if (ui.mode === "rest") {
    stopTick();
    ui.mode = "idle";
    ui.endsAt = 0;
    ui.remaining = 0;
    store.data.timer = null;
    store.save();
    applyMode();
    return;
  }

  if (ui.mode === "companion") {
    ui.mode = "idle";
    store.data.companion = false;
    store.data.timer = null;
    store.save();
    applyMode();
    say(fmt(pick(copy.companionEnd)), 8000);
    return;
  }

  if (ui.mode === "focus" || ui.mode === "paused") {
    const remain = ui.mode === "focus" ? Math.max(0, ui.endsAt - Date.now()) : ui.remaining;
    const elapsed = ui.total - remain;

    stopTick();
    releaseWakeLock();
    ui.mode = "idle";
    ui.endsAt = 0;
    ui.remaining = 0;
    store.data.timer = null;

    if (elapsed >= 5 * 60000) {
      store.addSession(elapsed / 60000);
      store.data.food += 1;
      renderStats();
      renderBowl(true);
      renderCare();
      popFood();
      say(fmt(pick(copy.stopEarly)), 9000);
      chime("focusEnd");
      wiggle();
    } else {
      say(fmt(pick(copy.stopQuick)), 6000);
    }
    store.save();
    applyMode();
  }
}

function startCompanion() {
  ensureAudio();
  ui.mode = "companion";
  ui.endsAt = 0;
  ui.remaining = 0;
  store.data.companion = true;
  store.data.closedAt = null;
  store.data.timer = null;
  store.save();
  applyMode();
  say(fmt(pick(copy.companion)), 10000);
}

function startNight() {
  if (store.todayCount() === 0) return;
  stopTick();
  releaseWakeLock();

  ui.mode = "night";
  ui.endsAt = 0;
  ui.remaining = 0;
  store.data.timer = null;
  store.data.companion = false;
  store.data.closedAt = dayKey();
  store.save();

  applyMode();
  chime("night");
  say(fmt(pick(copy.night)), 15000);
}

function onStart() {
  switch (ui.mode) {
    case "idle":
      startFocus();
      break;
    case "focus":
      pauseFocus();
      break;
    case "paused":
      resumeFocus();
      break;
    case "rest":
    case "companion":
    case "night":
      startFocus();
      break;
  }
}

/* ---------------- 猫的小动作 ---------------- */

function wiggle() {
  el.cat.classList.remove("is-happy");
  void el.cat.getBoundingClientRect();
  el.cat.classList.add("is-happy");
  setTimeout(() => el.cat.classList.remove("is-happy"), 1200);
}

/* ---------------- 作业清单 ---------------- */

function renderTasks() {
  const tasks = store.data.tasks;
  el.taskList.replaceChildren();

  tasks.forEach((t) => {
    const li = document.createElement("li");
    li.dataset.id = t.id;
    if (t.done) li.className = "done";

    const tick = document.createElement("button");
    tick.type = "button";
    tick.className = "tick";
    tick.setAttribute("role", "checkbox");
    tick.setAttribute("aria-checked", String(t.done));
    tick.setAttribute("aria-label", `完成：${t.text}`);
    tick.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = t.text;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "del";
    del.setAttribute("aria-label", `删除：${t.text}`);
    del.innerHTML = '<svg aria-hidden="true"><use href="#i-x"/></svg>';

    li.append(tick, text, del);
    el.taskList.append(li);
  });

  const done = tasks.filter((t) => t.done).length;
  el.taskCount.textContent = tasks.length ? `${done} / ${tasks.length}` : "";
  el.taskEmpty.hidden = tasks.length > 0;
}

function addTask(text) {
  const clean = text.trim().slice(0, 40);
  if (!clean) return;
  store.data.tasks.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: clean, done: false });
  store.data.tasksDate = dayKey();
  store.save();
  renderTasks();
  el.taskInput.value = "";
  chime("tick");
}

function toggleTask(id) {
  const task = store.data.tasks.find((t) => t.id === id);
  if (!task) return;
  task.done = !task.done;
  store.save();
  renderTasks();

  if (task.done) {
    chime("tick");
    const all = store.data.tasks.length > 0 && store.data.tasks.every((t) => t.done);
    if (all) {
      say(fmt(pick(copy.allDone)), 11000);
      wiggle();
    }
  }
}

function removeTask(id) {
  store.data.tasks = store.data.tasks.filter((t) => t.id !== id);
  store.save();
  renderTasks();
}

/* ---------------- 记录 ---------------- */

function renderStats() {
  el.streakNum.textContent = String(store.streak());
  el.todayNum.textContent = String(store.todayCount());
  el.totalNum.textContent = String(store.total());

  el.weekRow.replaceChildren();
  store.week().forEach((d) => {
    const wrap = document.createElement("span");
    wrap.className = `day${d.count ? " on" : ""}${d.isToday ? " today" : ""}`;
    wrap.title = `${d.key} · ${d.count} 轮`;
    const dot = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = d.isToday ? "今" : d.dow;
    wrap.append(dot, label);
    el.weekRow.append(wrap);
  });
}

const FISH_SPOTS = [
  [-24, 0],
  [12, 8],
  [-6, -12],
  [22, -2],
  [-18, 14],
  [6, 18],
];
const FISH_COLORS = ["#7fd6e8", "#ffb3bd", "#ffd18f", "#9be0c9", "#c3b6f0", "#ffc4a3"];

function renderBowl(isNew) {
  const n = Math.min(store.todayCount(), 6);
  if (!isNew && el.bowlFish.dataset.count === String(n)) return;

  el.bowlFish.replaceChildren();
  el.bowlFish.dataset.count = String(n);

  for (let i = 0; i < n; i++) {
    const wrap = document.createElementNS(NS, "g");
    wrap.setAttribute("transform", `translate(${980 + FISH_SPOTS[i][0]} ${404 + FISH_SPOTS[i][1]})`);

    const pop = document.createElementNS(NS, "g");
    if (isNew && i === n - 1) pop.setAttribute("class", "fish-pop");

    const swim = document.createElementNS(NS, "g");
    swim.setAttribute("class", "swim");
    swim.style.setProperty("--dur", `${7 + (i % 4) * 1.7}s`);
    swim.style.setProperty("--dx", `${(i % 2 ? -1 : 1) * (7 + i)}px`);
    swim.style.setProperty("--dy", `${((i % 3) - 1) * 3}px`);
    swim.style.setProperty("--delay", `-${i * 1.3}s`);

    const flip = document.createElementNS(NS, "g");
    if (i % 2) flip.setAttribute("transform", "scale(-1 1)");

    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M7 0C4 -4.6 -4 -4.6 -7 0C-4 4.6 4 4.6 7 0ZM-7 0L-12 -4L-12 4Z");
    body.setAttribute("fill", FISH_COLORS[i % FISH_COLORS.length]);

    const eye = document.createElementNS(NS, "circle");
    eye.setAttribute("cx", "3");
    eye.setAttribute("cy", "-1");
    eye.setAttribute("r", "1");
    eye.setAttribute("fill", "#0b1a22");
    eye.setAttribute("opacity", ".5");

    flip.append(body, eye);
    swim.append(flip);
    pop.append(swim);
    wrap.append(pop);
    el.bowlFish.append(wrap);
  }
}

/* ---------------- 摸一摸 / 喂小猫 ---------------- */

function renderCare() {
  el.foodNum.textContent = String(store.data.food);
  el.careNote.textContent = `摸过 ${store.data.pets} 次 · 喂过 ${store.data.feeds} 次`;
  el.feedBtn.classList.toggle("is-empty", store.data.food <= 0);
}

function popFood() {
  el.foodNum.classList.remove("is-pop");
  void el.foodNum.offsetWidth;
  el.foodNum.classList.add("is-pop");
}

function spawnHearts(n = 1) {
  for (let i = 0; i < n; i++) {
    const wrap = document.createElementNS(NS, "g");
    const x = 446 + (Math.random() * 110 - 55);
    const y = 214 + (Math.random() * 24 - 12);
    wrap.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(1.4)`);

    const heart = document.createElementNS(NS, "path");
    heart.setAttribute(
      "d",
      "M0 0C-2.6-3.9-9.1-5.2-10.4 0c-1.3 5.2 5.2 9.1 10.4 13 5.2-3.9 11.7-7.8 10.4-13-1.3-5.2-7.8-3.9-10.4 0Z",
    );
    heart.setAttribute("fill", ["#ff8fa0", "#ffb3c1", "#ffe0cf"][Math.floor(Math.random() * 3)]);
    heart.setAttribute("stroke", "#fff");
    heart.setAttribute("stroke-opacity", ".3");
    heart.setAttribute("stroke-width", ".9");
    heart.setAttribute("class", "pet-heart");
    heart.style.setProperty("--hx", `${(Math.random() * 36 - 18).toFixed(0)}px`);
    heart.style.setProperty("--hr", `${(Math.random() * 24 - 12).toFixed(0)}deg`);

    wrap.append(heart);
    el.petHearts.append(wrap);
    setTimeout(() => wrap.remove(), 1800);
  }
}

function petStart() {
  if (ui.eating) return;
  if (!ui.petting) {
    ui.petting = true;
    ui.petStartAt = Date.now();
    el.scene.classList.add("is-petting");
    store.data.pets += 1;
    store.save();
    renderCare();
  }
  spawnHearts(2);
  clearInterval(ui.petTimer);
  ui.petTimer = setInterval(() => spawnHearts(1), 460);
}

function petEnd() {
  if (!ui.petting) return;
  ui.petting = false;
  el.scene.classList.remove("is-petting");
  clearInterval(ui.petTimer);
  ui.petTimer = 0;

  if (ui.mode === "focus" || ui.mode === "paused" || ui.mode === "companion" || ui.mode === "night") {
    return;
  }
  if (Date.now() - ui.lastPetAt < 2600) return;

  ui.lastPetAt = Date.now();
  const quick = Date.now() - ui.petStartAt < 280;
  say(fmt(pick(quick ? copy.catAwake : copy.pet)), 5200);
}

function petBurst() {
  if (ui.petting) return;
  petStart();
  setTimeout(petEnd, 1200);
}

function feedCat() {
  if (ui.eating) return;

  if (ui.mode === "focus" || ui.mode === "paused" || ui.mode === "companion") {
    say(fmt(copy.feedAsleep), 5000);
    return;
  }
  if (ui.mode === "night") {
    say(fmt(copy.feedNight), 5000);
    return;
  }
  if (store.data.food <= 0) {
    say(fmt(copy.feedEmpty), 6000);
    return;
  }

  store.data.food -= 1;
  store.data.feeds += 1;
  store.save();
  renderCare();

  clearTimeout(ui.bubbleId);
  el.bubble.classList.remove("is-on");

  ui.eating = true;
  el.scene.classList.add("is-eating");
  clearTimeout(ui.eatTimer);
  ui.eatTimer = setTimeout(() => {
    ui.eating = false;
    el.scene.classList.remove("is-eating");
    spawnHearts(3);
    say(fmt(pick(copy.feed)), 6200);
  }, 3000);
}

/* ---------------- 设置 ---------------- */

function applyNames() {
  document.querySelectorAll('[data-name="fish"]').forEach((n) => {
    n.textContent = nameOf("fish");
  });
  document.querySelectorAll('[data-name="cat"]').forEach((n) => {
    n.textContent = nameOf("cat");
  });
  lastTitle = "";
  updateTitle();
}

function updateSoundBtn() {
  const on = store.data.settings.sound;
  el.soundBtn.classList.toggle("is-muted", !on);
  el.soundBtn.setAttribute("aria-pressed", String(on));
  el.soundBtn.setAttribute("aria-label", on ? "关闭提示音" : "打开提示音");
}

function openSettings() {
  el.nameFish.value = store.data.names.fish;
  el.nameCat.value = store.data.names.cat;
  el.soundToggle.checked = store.data.settings.sound;

  el.settingsForm.querySelectorAll('input[name="focus"]').forEach((r) => {
    r.checked = Number(r.value) === store.data.settings.focus;
  });
  el.settingsForm.querySelectorAll('input[name="rest"]').forEach((r) => {
    r.checked = Number(r.value) === store.data.settings.rest;
  });

  el.clearData.dataset.armed = "";
  el.clearData.textContent = "清空所有记录";
  el.settingsDlg.showModal();
}

function saveSettings(e) {
  e.preventDefault();
  store.data.names = {
    fish: el.nameFish.value.trim().slice(0, 6) || "小鱼",
    cat: el.nameCat.value.trim().slice(0, 6) || "小猫",
  };
  const focus = Number(el.settingsForm.querySelector('input[name="focus"]:checked')?.value || 25);
  const rest = Number(el.settingsForm.querySelector('input[name="rest"]:checked')?.value || 5);
  store.data.settings.focus = focus;
  store.data.settings.rest = rest;
  store.data.settings.sound = el.soundToggle.checked;
  store.save();

  applyNames();
  updateSoundBtn();
  applyMode();
  el.settingsDlg.close();
}

/* ---------------- 初始化 ---------------- */

function updateToday() {
  const d = new Date();
  el.todayLabel.textContent = `${d.getMonth() + 1}月${d.getDate()}日 · 周${"日一二三四五六"[d.getDay()]}`;
  el.todayLabel.dateTime = dayKey(d);
}

function fitScene() {
  const narrow = window.innerWidth <= 720;
  el.sceneSvg.setAttribute("viewBox", narrow ? "250 0 820 520" : "0 0 1200 520");
}

function restoreTimer() {
  const t = store.data.timer;

  if (t && Number.isFinite(t.total)) {
    if (t.kind === "paused") {
      ui.mode = "paused";
      ui.total = t.total;
      ui.remaining = Math.max(0, t.remaining || 0);
      ui.round = t.round || 1;
      applyMode();
      return true;
    }

    if (t.kind === "focus" || t.kind === "rest") {
      const remain = t.endsAt - Date.now();

      if (remain > 0) {
        ui.mode = t.kind;
        ui.total = t.total;
        ui.remaining = remain;
        ui.endsAt = t.endsAt;
        ui.round = t.round || 1;
        applyMode();
        startTick();
        if (t.kind === "focus") acquireWakeLock();
        return true;
      }

      if (t.kind === "focus" && -remain < 2 * 3600 * 1000) {
        ui.mode = "focus";
        ui.total = t.total;
        ui.remaining = 0;
        ui.round = t.round || 1;
        finishFocus(true, -remain < 10 * 60 * 1000);
        return true;
      }
    }

    store.data.timer = null;
    store.save();
  }

  if (store.data.companion) {
    ui.mode = "companion";
    applyMode();
    return true;
  }

  if (store.data.closedAt === dayKey()) {
    ui.mode = "night";
    applyMode();
    return true;
  }

  ui.mode = "idle";
  applyMode();
  return false;
}

function bind() {
  el.startBtn.addEventListener("click", onStart);
  el.stopBtn.addEventListener("click", stopCurrent);
  el.companionBtn.addEventListener("click", startCompanion);
  el.closeBtn.addEventListener("click", startNight);

  el.durations.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-min]");
    if (!btn) return;
    store.data.settings.focus = Number(btn.dataset.min);
    store.save();
    applyMode();
  });

  el.cat.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    petStart();
  });
  window.addEventListener("pointerup", petEnd);
  window.addEventListener("pointercancel", petEnd);
  el.petBtn.addEventListener("click", petBurst);
  el.feedBtn.addEventListener("click", feedCat);

  el.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(el.taskInput.value);
    el.taskInput.focus();
  });

  el.taskList.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    if (e.target.closest(".tick")) toggleTask(li.dataset.id);
    else if (e.target.closest(".del")) removeTask(li.dataset.id);
  });

  el.soundBtn.addEventListener("click", () => {
    store.data.settings.sound = !store.data.settings.sound;
    store.save();
    updateSoundBtn();
    if (store.data.settings.sound) chime("tick");
  });

  el.settingsBtn.addEventListener("click", openSettings);
  el.settingsForm.addEventListener("submit", saveSettings);
  el.cancelSettings.addEventListener("click", () => el.settingsDlg.close());

  el.clearData.addEventListener("click", () => {
    if (el.clearData.dataset.armed === "1") {
      store.reset();
      location.reload();
      return;
    }
    el.clearData.dataset.armed = "1";
    el.clearData.textContent = "再点一次，真的清空";
  });

  el.settingsDlg.addEventListener("close", () => {
    el.clearData.dataset.armed = "";
    el.clearData.textContent = "清空所有记录";
  });

  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space") return;
    if (el.settingsDlg.open) return;
    const tag = document.activeElement?.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    onStart();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (ui.mode === "focus" && ui.endsAt) acquireWakeLock();
      tick();
      updateTitle();
    }
  });

  window.addEventListener("resize", fitScene);
}

function init() {
  store.load();
  updateToday();
  applyNames();
  updateSoundBtn();
  renderTasks();
  renderStats();
  renderBowl(false);
  renderCare();
  fitScene();
  bind();

  const restored = restoreTimer();
  if (!restored) {
    setTimeout(() => {
      if (ui.mode === "idle" && !el.bubble.classList.contains("is-on")) {
        say(fmt(pick(copy.greet)), 11000);
      }
    }, 1500);
  }

  let stamp = dayKey();
  setInterval(() => {
    if (dayKey() === stamp) return;
    stamp = dayKey();
    store.load();
    updateToday();
    renderTasks();
    renderStats();
    renderBowl(false);
    applyMode();
  }, 60000);

  if (
    "serviceWorker" in navigator &&
    (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}

init();
