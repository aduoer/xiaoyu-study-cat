/* 本地存档：全部只存在这台设备的浏览器里，不上传任何地方。 */

export const KEY = "mao-yu-study-v1";

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fresh() {
  return {
    v: 1,
    names: { fish: "小鱼", cat: "小猫" },
    settings: { sound: true, focus: 25, rest: 5 },
    tasks: [],
    tasksDate: dayKey(),
    sessions: [],
    timer: null,
    companion: false,
    closedAt: null,
    foods: { kibble: 3, stick: 1, can: 1 },
    foodDate: dayKey(),
    pendingFeed: null,
    pets: 0,
    feeds: 0,
  };
}

function str(v, fallback, max = 6) {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : fallback;
}

export const store = {
  data: fresh(),

  load() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      raw = null;
    }
    const base = fresh();
    if (!raw || typeof raw !== "object") {
      this.data = base;
      return;
    }

    this.data = {
      ...base,
      ...raw,
      names: {
        fish: str(raw.names?.fish, base.names.fish),
        cat: str(raw.names?.cat, base.names.cat),
      },
      settings: {
        sound: raw.settings?.sound !== false,
        focus: [15, 25, 40].includes(raw.settings?.focus) ? raw.settings.focus : 25,
        rest: [5, 10].includes(raw.settings?.rest) ? raw.settings.rest : 5,
      },
      tasks: Array.isArray(raw.tasks)
        ? raw.tasks
            .filter((t) => t && typeof t.text === "string")
            .map((t) => ({ id: String(t.id || Math.random()), text: t.text.slice(0, 40), done: !!t.done }))
        : [],
      sessions: Array.isArray(raw.sessions)
        ? raw.sessions.filter((s) => s && typeof s.d === "string" && typeof s.t === "number")
        : [],
      timer: raw.timer && typeof raw.timer === "object" ? raw.timer : null,
      companion: raw.companion === true,
      closedAt: typeof raw.closedAt === "string" ? raw.closedAt : null,
      foods: {
        kibble: Number.isFinite(raw.foods?.kibble)
          ? Math.max(0, Math.floor(raw.foods.kibble))
          : Number.isFinite(raw.food)
            ? Math.max(0, Math.floor(raw.food))
            : 3,
        stick: Number.isFinite(raw.foods?.stick) ? Math.max(0, Math.floor(raw.foods.stick)) : 1,
        can: Number.isFinite(raw.foods?.can) ? Math.max(0, Math.floor(raw.foods.can)) : 1,
      },
      foodDate: typeof raw.foodDate === "string" ? raw.foodDate : dayKey(),
      pendingFeed: ["kibble", "stick", "can"].includes(raw.pendingFeed)
        ? raw.pendingFeed
        : raw.pendingFeed === true
          ? "kibble"
          : null,
      pets: Number.isFinite(raw.pets) ? Math.max(0, Math.floor(raw.pets)) : 0,
      feeds: Number.isFinite(raw.feeds) ? Math.max(0, Math.floor(raw.feeds)) : 0,
    };

    // 每天补货：猫粮 3 份、猫条 1 根、罐头 1 个，想喂的时候总有的喂
    if (this.data.foodDate !== dayKey()) {
      this.data.foods.kibble = Math.max(this.data.foods.kibble, 3);
      this.data.foods.stick = Math.max(this.data.foods.stick, 1);
      this.data.foods.can = Math.max(this.data.foods.can, 1);
      this.data.foodDate = dayKey();
    }

    // 换了一天：没写完的作业接着留着，写完的清掉
    if (this.data.tasksDate !== dayKey()) {
      this.data.tasks = this.data.tasks.filter((t) => !t.done);
      this.data.tasksDate = dayKey();
      this.data.companion = false;
    }
  },

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* 隐私模式下写不进去，也不影响使用 */
    }
  },

  reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    this.data = fresh();
  },

  todayCount() {
    const k = dayKey();
    return this.data.sessions.filter((s) => s.d === k).length;
  },

  total() {
    return this.data.sessions.length;
  },

  addSession(minutes) {
    this.data.sessions.push({ d: dayKey(), t: Date.now(), m: Math.max(1, Math.round(minutes)) });
    if (this.data.sessions.length > 2000) this.data.sessions = this.data.sessions.slice(-2000);
    this.save();
  },

  streak() {
    const days = new Set(this.data.sessions.map((s) => s.d));
    const d = new Date();
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(dayKey(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  },

  week() {
    const out = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const k = dayKey(d);
      out.push({
        key: k,
        count: this.data.sessions.filter((s) => s.d === k).length,
        dow: "日一二三四五六"[d.getDay()],
        isToday: i === 0,
      });
    }
    return out;
  },
};
