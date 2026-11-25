/* ZY Player Web — 核心逻辑（Obsidian Cinema & Warm Amber 矢量设计版） */
"use strict";

/* ============ 本地存储（复用 APK 存储键，本地解锁 VIP/God） ============ */
const K = {
  SOURCE: "source", VIDEO: "video", LIKE: "like", HISTORY: "history",
  WEBDAV: "webdav", MODE: "mode", THEME: "theme", LAYOUT: "layout",
  VIP: "vip", VIP_SUPER: "vipSuper", GOD_IS: "isGod", GOD_NAME: "godName",
};
const _mem = {};
const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? (k in _mem ? _mem[k] : d) : JSON.parse(v); } catch { return k in _mem ? _mem[k] : d; } };
const SYNC_WATCH = new Set(["like", "history", "music_fav", "music_fav_groups", "music_hist", "novel_shelf", "novel_hist", "novel_prog"]);
let _syncPushTimer = null;
const set = (k, v) => {
  _mem[k] = v;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  if (SYNC_WATCH.has(k) && typeof cloudSyncPush === "function" && typeof NH !== "undefined" && NH.user) {
    clearTimeout(_syncPushTimer);
    _syncPushTimer = setTimeout(() => cloudSyncPush(true), 2000);
  }
};

function ensureLocalAuth() {
  set(K.VIP, true);
  set(K.VIP_SUPER, true);
  set(K.GOD_IS, true);
  if (!get(K.GOD_NAME)) set(K.GOD_NAME, "web-local");
}
ensureLocalAuth();

/* ============ 定制 24x24 纯矢量图标引擎（零 Emoji） ============ */
const IC = {
  brand: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5 14.5 9.5 21.5 12l-7 2.5L12 21.5l-2.5-7-7-2.5 7-2.5L12 2.5Z"/><circle cx="12" cy="12" r="2.1" fill="#0C0D10"/></svg>`,
  search: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>`,
  film: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 4v16M16.5 4v16M3 9.5h4.5M16.5 9.5H21M3 14.5h4.5M16.5 14.5H21"/></svg>`,
  music: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V6.2l11-2v11.8"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>`,
  tv: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="m8.5 2.5 3.5 4 3.5-4"/></svg>`,
  cloud: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.3 8.5a4 4 0 0 1-.8 10.5Z"/></svg>`,
  user: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>`,
  disc: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 6.5a5.5 5.5 0 0 1 5.5 5.5"/></svg>`,
  headphones: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="3.5" height="6" rx="1.5"/><rect x="17.5" y="13" width="3.5" height="6" rx="1.5"/></svg>`,
  heart: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.9c0 5.6-7.5 10.2-7.5 10.2Z"/></svg>`,
  heartFill: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 20.8c-.3 0-.6-.1-.8-.3C9.6 19.4 3.8 15 3.8 10.2 3.8 7.3 6 5.1 8.8 5.1c1.4 0 2.6.6 3.2 1.6.6-1 1.8-1.6 3.2-1.6 2.8 0 5 2.2 5 5.1 0 4.8-5.8 9.2-7.4 10.3-.2.2-.5.3-.8.3Z"/></svg>`,
  play: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 5.2c0-1.1 1.2-1.8 2.2-1.2l10.2 6.8c.9.6.9 1.8 0 2.4L9.7 20c-1 .6-2.2-.1-2.2-1.2V5.2Z"/></svg>`,
  pause: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/></svg>`,
  prev: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M18.5 5.6c0-.9-1-1.4-1.7-.9L8.5 11V5.5c0-.6-.4-1-1-1s-1 .4-1 1v13c0 .6.4 1 1 1s1-.4 1-1V13l8.3 6.3c.7.5 1.7 0 1.7-.9V5.6Z"/></svg>`,
  next: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M5.5 5.6c0-.9 1-1.4 1.7-.9L15.5 11V5.5c0-.6.4-1 1-1s1 .4 1 1v13c0 .6-.4 1-1 1s-1-.4-1-1V13l-8.3 6.3c-.7.5-1.7 0-1.7-.9V5.6Z"/></svg>`,
  repeat: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>`,
  repeatOne: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="m7 22-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/><path d="M11 10h1.5v4"/></svg>`,
  shuffle: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m18 3 3 3-3 3"/><path d="m18 15 3 3-3 3"/><path d="M3 6h3.5a4 4 0 0 1 3.3 1.7l4.4 6.6a4 4 0 0 0 3.3 1.7H21"/><path d="M3 18h3.5a4 4 0 0 0 3.3-1.7l.8-1.2M14.2 8.8l.4-.6A4 4 0 0 1 17.8 6.5H21"/></svg>`,
  queue: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h10M4 18h10"/><path d="m16.5 13 4.5 2.5-4.5 2.5v-5Z" fill="currentColor" stroke="none"/></svg>`,
  fullscreen: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/></svg>`,
  back: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  chevronDown: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  plus: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  database: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>`,
  upload: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>`,
  download: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4"/><path d="M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1"/></svg>`,
  save: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M12 17v-5m-2.5 2.5L12 17l2.5-2.5"/></svg>`,
  folder: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>`,
  trash: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M10 11v5M14 11v5"/></svg>`,
  wave: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4"/></svg>`,
  clock: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>`,
  forward: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6.5c0-.8.9-1.3 1.6-.8l7.5 5.5c.6.4.6 1.2 0 1.6l-7.5 5.5c-.7.5-1.6 0-1.6-.8v-11Zm9 0c0-.8.9-1.3 1.6-.8l7.5 5.5c.6.4.6 1.2 0 1.6l-7.5 5.5c-.7.5-1.6 0-1.6-.8v-11Z"/></svg>`,
  rewind: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M20 6.5c0-.8-.9-1.3-1.6-.8l-7.5 5.5c-.6.4-.6 1.2 0 1.6l7.5 5.5c.7.5 1.6 0 1.6-.8v-11Zm-9 0c0-.8-.9-1.3-1.6-.8l-7.5 5.5c-.6.4-.6 1.2 0 1.6l7.5 5.5c.7.5 1.6 0 1.6-.8v-11Z"/></svg>`,
  book: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H11v17H4.5A2.5 2.5 0 0 0 2 22V5.5Z"/><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H13v17h6.5a2.5 2.5 0 0 1 2.5 2V5.5Z"/></svg>`,
  bookmark: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17l-6-3.8L6 21V4Z"/></svg>`,
  bookmarkFill: `<svg class="svg-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v17.2a.6.6 0 0 1-.93.5L12 18.3l-5.07 3.4a.6.6 0 0 1-.93-.5V4Z"/></svg>`,
  list: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h11"/></svg>`,
  sort: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 4-3 3 3 3M4 7h12M17 20l3-3-3-3M20 17H8"/></svg>`,
  crown: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4.5 4 4.5-6 4.5 6L21 8l-2 10H5L3 8Z"/></svg>`,
  pip: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="15" rx="2"/><rect x="11.5" y="10.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none"/></svg>`,
  volume: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.8a9 9 0 0 1 0 12.4"/></svg>`,
};
const ico = (name) => IC[name] || "";
window._imgPh = (el, iconName, cls) => {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = ico(iconName);
  el.replaceWith(d);
};

/* ============ 内置默认源（MacCMS 格式，20 个内置源） ============ */
const DEFAULT_SOURCES = [
  { id: "ffzy", name: "非凡资源", api: "https://api.ffzyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "jszy", name: "极速资源", api: "https://jszyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "gszy", name: "光速资源", api: "https://api.guangsuapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "hnzy", name: "红牛资源", api: "https://www.hongniuzy2.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "bdzy", name: "百度资源", api: "https://api.apibdzy.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "360zy", name: "360资源", api: "https://360zy.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "wjzy", name: "无尽资源", api: "https://api.wujinapi.me/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "mdzy", name: "魔都资源", api: "https://www.mdzyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "sdzy", name: "闪电资源", api: "https://sdzyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "tyys", name: "天涯资源", api: "https://tyyszy.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "zdzy", name: "最大资源", api: "https://api.zuidapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "modu", name: "魔都动漫", api: "https://caiji.moduapi.cc/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "huya", name: "虎牙资源", api: "https://www.huyaapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "maotai", name: "茅台资源", api: "https://caiji.maotaizy.cc/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "lzi", name: "量子资源", api: "https://cj.lziapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "bfzy", name: "暴风资源", api: "https://bfzyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "wolong", name: "卧龙资源", api: "https://wolongzyw.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "yhzy", name: "樱花动漫", api: "https://m3u8.apiyhzy.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "feisu", name: "飞速资源", api: "https://www.feisuzyapi.com/api.php/provide/vod/", type: "mac", enabled: true },
  { id: "suoni", name: "索尼资源", api: "https://suoniapi.com/api.php/provide/vod/", type: "mac", enabled: true },
];
const SRC_VER = "20261124-v4";
let sources = get(K.SOURCE, null);
if (!sources || !sources.length || get("src_ver", "") !== SRC_VER) {
  const builtinIds = new Set(DEFAULT_SOURCES.map((d) => d.id).concat(["demo"]));
  const custom = (sources || []).filter((s) => !builtinIds.has(s.id));
  sources = DEFAULT_SOURCES.concat(custom);
  set(K.SOURCE, sources);
  set("src_ver", SRC_VER);
}
const saveSources = () => set(K.SOURCE, sources);
(async function syncLiveSources() {
  try {
    const r = await fetch("/api/sources/live");
    if (!r.ok) return;
    const d = await r.json();
    if (Array.isArray(d.items) && d.items.length) {
      const liveIds = new Set(d.items.map((x) => x.id));
      const custom = (sources || []).filter((s) => !liveIds.has(s.id) && !DEFAULT_SOURCES.some((b) => b.id === s.id));
      sources = d.items.concat(custom);
      saveSources();
    }
  } catch {}
})();

/* ============ 工具 ============ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(msg, ms = 1600) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function modal(title, bodyHtml) {
  return new Promise((resolve) => {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    $("#modal").classList.remove("hidden");
    const ok = () => { $("#modal").classList.add("hidden"); $("#modalOk").onclick = $("#modalCancel").onclick = null; resolve(true); };
    const cancel = () => { $("#modal").classList.add("hidden"); $("#modalOk").onclick = $("#modalCancel").onclick = null; resolve(false); };
    $("#modalOk").onclick = ok; $("#modalCancel").onclick = cancel;
  });
}
const CORS_PROXIES = [
  (u) => (location.protocol.startsWith("http") ? (window.__NH_API_BASE__ || "") + "/proxy?url=" + encodeURIComponent(u) : null),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
];
function buildVodUrl(api, query) {
  const base = api.replace(/\/$/, "");
  return (base.includes("/api.php") ? base : base + "/api.php/provide/vod") + "/?" + query;
}
async function fetchJson(url, timeout = 5000) {
  const tryFetch = async (target) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(target, { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  };
  try {
    return await tryFetch(url);
  } catch (err) {
    try {
      const urls = CORS_PROXIES.map((fn) => fn(url)).filter(Boolean);
      return await Promise.any(urls.map((u) => tryFetch(u)));
    } catch {
      throw err;
    }
  }
}

async function fetchText(url, timeout = 6000) {
  const tryFetch = async (target) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(target, { signal: ctl.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } finally { clearTimeout(t); }
  };
  try {
    return await tryFetch(url);
  } catch (err) {
    try {
      const urls = CORS_PROXIES.map((fn) => fn(url)).filter(Boolean);
      return await Promise.any(urls.map((u) => tryFetch(u)));
    } catch {
      throw err;
    }
  }
}

/* ============ 路由（影视/音乐/小说三模式矢量 Dock + 视图回退栈） ============ */
let appMode = get(K.MODE, "vod"); // "vod" | "music" | "novel"
if (!["vod", "music", "novel"].includes(appMode)) appMode = "vod";
const routes = {
  home: renderHome, live: renderLive, webdav: renderWebdav, me: renderMe,
  m_discover: renderMusicDiscover, m_player: renderMusicPlayer, m_fav: renderMusicFav,
  n_store: renderNovelStore, n_shelf: renderNovelShelf,
};
let currentRoute = "home";
const viewStack = [];
function pushView(fn) {
  viewStack.push(fn);
  history.pushState({ depth: viewStack.length }, "");
}
function closePlayer() {
  destroyPlayers();
  $("#playerLayer").classList.add("hidden");
  document.body.style.overflow = "";
  syncModeFab();
}
function closeReader() {
  stopNovelTts();
  saveCurrentReaderScroll();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("#tocMask").classList.add("hidden");
  $("#readerLayer").classList.add("hidden");
  document.body.style.overflow = "";
  syncModeFab();
}
function goBack() {
  if (!$("#tocMask").classList.contains("hidden")) { $("#tocMask").classList.add("hidden"); return; }
  if (!$("#readerLayer").classList.contains("hidden")) { closeReader(); return; }
  if (!$("#playerLayer").classList.contains("hidden")) { closePlayer(); return; }
  if (viewStack.length > 0) {
    viewStack.pop();
    const prev = viewStack[viewStack.length - 1];
    if (prev) prev();
    else routes[currentRoute]();
    window.scrollTo(0, 0);
  } else {
    routes[currentRoute]();
  }
}
window.addEventListener("popstate", () => goBack());
const backBar = (title) => `<div class="back-bar"><button class="btn ghost" onclick="history.back()" style="padding:5px 11px;font-size:13px">${ico("back")} 返回</button><span class="back-bar-title">${esc(title)}</span></div>`;

function renderTabbar() {
  const tb = $("#tabbar");
  const tabs = appMode === "music"
    ? [
        { route: "m_discover", icon: "disc", text: "曲库" },
        { route: "m_player", icon: "headphones", text: "播放器" },
        { route: "m_fav", icon: "heart", activeIcon: "heartFill", text: "收藏" },
      ]
    : appMode === "novel"
    ? [
        { route: "n_store", icon: "book", text: "书城" },
        { route: "n_shelf", icon: "bookmark", activeIcon: "bookmarkFill", text: "书架" },
      ]
    : [
        { route: "home", icon: "film", text: "影视" },
        { route: "live", icon: "tv", text: "直播" },
        { route: "webdav", icon: "cloud", text: "备份" },
        { route: "me", icon: "user", text: "我的" },
      ];
  tb.innerHTML = tabs.map((t) => {
    const on = currentRoute === t.route;
    return `<a href="#" class="tab ${on ? "active" : ""}" data-route="${t.route}"><span class="ico">${ico(on && t.activeIcon ? t.activeIcon : t.icon)}</span>${t.text}</a>`;
  }).join("");
  tb.querySelectorAll(".tab").forEach((el) => el.addEventListener("click", (e) => {
    e.preventDefault();
    go(el.dataset.route);
  }));
}

function updateTopbar() {
  const logo = $("#brandLogo");
  const inp = $("#searchInput");
  if (!logo || !inp) return;
  logo.innerHTML = `<span class="brand-mark">${ico("brand")}</span><span>Nova<span class="brand-dot">.</span>Hub</span>`;
  inp.placeholder = appMode === "music" ? "搜索歌曲、歌手或专辑" : appMode === "novel" ? "搜索书名、作者或书籍 ID" : "搜索影片或演员";
}

function switchMode(mode, targetRoute) {
  appMode = mode;
  set(K.MODE, mode);
  updateTopbar();
  syncModeFab();
  const defRoute = mode === "music" ? "m_discover" : mode === "novel" ? "n_store" : "home";
  go(targetRoute || defRoute);
}

function go(route) {
  currentRoute = route;
  viewStack.length = 0;
  renderTabbar();
  (routes[route] || renderHome)();
  updateMiniBar();
  window.scrollTo(0, 0);
}

/* ============ 影视 & 音乐 & 小说统一搜索入口 ============ */
const triggerSearch = () => {
  const q = $("#searchInput").value.trim();
  $("#searchInput").blur();
  if (appMode === "music") {
    if (q) searchMusic(q); else go("m_discover");
  } else if (appMode === "novel") {
    if (q) searchNovel(q); else go("n_store");
  } else {
    if (q) doSearch(q); else go("home");
  }
};
$("#searchBtn").addEventListener("click", triggerSearch);
$("#searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); triggerSearch(); }
});

/* ============ 现代音乐模块（榜单 / 双源搜歌 / 专辑视图 / 动态歌词 / 收藏 / Mini 条） ============ */
const MUSIC_CHARTS = [
  { id: "3778678", name: "热歌榜" },
  { id: "19723756", name: "飙升榜" },
  { id: "3779629", name: "新歌榜" },
  { id: "2884035", name: "原创榜" },
  { id: "3001835560", name: "ACG 专区" },
  { id: "2250011882", name: "华语经典" },
  { id: "1978921795", name: "电子律动" },
  { id: "2809513713", name: "欧美流行" },
];
const M_MODES = ["order", "loop", "shuffle"];
const M_MODE_META = {
  order: { icon: "repeat", label: "顺序" },
  loop: { icon: "repeatOne", label: "单曲" },
  shuffle: { icon: "shuffle", label: "随机" },
};
const renderModeBtnHtml = () => `${ico(M_MODE_META[mPlayMode].icon)}<span style="font-size:11.5px">${M_MODE_META[mPlayMode].label}</span>`;

let curChart = "3778678";
let discoverList = get("music_queue", []);
let musicQueue = discoverList;
let curSongIdx = -1;
let curSong = null;
let curLyrics = [];
let activeLrcIdx = -1;
let mPlayMode = get("m_mode", "order");
let mErrCount = 0;
let mIsSearch = false;
let mSearchView = "album"; // "album" | "track"
let mSrcFilter = "all"; // "all" | "kuwo" | "netease"
let mPlayToken = 0;
let mSwitching = false;

const audioEl = new Audio();
audioEl.preload = "auto";
const songKey = (s) => (s ? `${s.source || "netease"}:${s.id || s.name}` : "");
const getMusicFavs = () => get("music_favs", []);
const isMusicFav = (song) => !!song && getMusicFavs().some((x) => songKey(x) === songKey(song));
function toggleMusicFav(song) {
  if (!song) return;
  let favs = getMusicFavs();
  const key = songKey(song);
  const idx = favs.findIndex((x) => songKey(x) === key);
  if (idx >= 0) { favs.splice(idx, 1); toast("已取消收藏"); }
  else { favs.unshift({ ...song, url: song.url || "" }); toast("已加入音乐收藏"); }
  set("music_favs", favs);
  if (currentRoute.startsWith("m_")) routes[currentRoute]();
}
function addMusicHist(song) {
  if (!song) return;
  const key = songKey(song);
  let h = get("music_hist", []).filter((x) => songKey(x) !== key);
  h.unshift(song);
  set("music_hist", h.slice(0, 30));
}

function parseLrc(raw) {
  if (!raw) return [];
  const map = new Map();
  raw.split(/\r?\n/).forEach((line) => {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) return;
    const text = line.replace(/\[[^\]]+\]/g, "").trim();
    if (!text) return;
    tags.forEach((m) => {
      const ms = m[3] ? (m[3].length === 1 ? Number(m[3]) * 100 : m[3].length === 2 ? Number(m[3]) * 10 : Number(m[3])) / 1000 : 0;
      const t = Number((Number(m[1]) * 60 + Number(m[2]) + ms).toFixed(2));
      map.set(t, map.has(t) ? map.get(t) + "\n" + text : text);
    });
  });
  return [...map.entries()].map(([t, text]) => ({ t, text })).sort((a, b) => a.t - b.t);
}

async function loadChart(chartId = curChart) {
  curChart = chartId;
  mIsSearch = false;
  const cached = get("chart_" + chartId, null);
  if (cached && cached.length && !discoverList.length) {
    discoverList = cached;
    if (currentRoute === "m_discover") renderMusicDiscover();
  }
  const apis = [
    `https://api.injahow.cn/meting/?type=playlist&id=${chartId}`,
    `https://api.i-meto.com/meting/api?server=netease&type=playlist&id=${chartId}`,
  ];
  for (const u of apis) {
    try {
      const list = await fetchJson(u, 7000);
      if (Array.isArray(list) && list.length) {
        discoverList = list.slice(0, 40).map((x) => {
          const idMatch = (x.url || "").match(/[?&]id=(\d+)/);
          return {
            id: String(x.id || (idMatch ? idMatch[1] : "")),
            name: x.name || x.title || "未知歌曲",
            artist: x.artist || x.author || "未知歌手",
            album: x.album || "",
            source: "netease",
            pic: x.pic || "",
            url: x.url || "",
            lrc: x.lrc || "",
          };
        });
        set("chart_" + chartId, discoverList);
        set("music_queue", discoverList);
        if (currentRoute === "m_discover") renderMusicDiscover();
        return;
      }
    } catch {}
  }
  if (!discoverList.length && currentRoute === "m_discover") toast("歌单加载失败，请使用顶部搜索");
}

function isFakeCoverTrack(name, q) {
  const ql = q.toLowerCase();
  const fakeRe = /原唱|翻唱|伴奏|纯音乐|八音盒|铃声|cover|instrumental|karaoke/i;
  return fakeRe.test(name) && !fakeRe.test(ql);
}

/**
 * 按精确匹配程度对搜索结果稳定排序（完全匹配 > 前缀匹配 > 包含关键词 > 副标题匹配 > 其余）。
 */
function sortByExactMatch(list, query, getTitle, getSub) {
  const kw = String(query || "").trim().toLowerCase();
  if (!kw || !Array.isArray(list) || list.length < 2) return list;
  const score = (item) => {
    const title = String(getTitle(item) || "").trim().toLowerCase();
    const sub = getSub ? String(getSub(item) || "").trim().toLowerCase() : "";
    if (title === kw) return 0;
    if (title.startsWith(kw)) return 1;
    if (title.includes(kw)) return 2;
    if (sub && (sub === kw || sub.includes(kw))) return 3;
    return 4;
  };
  return list.sort((a, b) => score(a) - score(b));
}

async function searchMusic(q) {
  if (!q) return;
  toast("正在检索正版曲库…");
  const kwList = [], neList = [];
  await Promise.allSettled([
    fetch(`/kw?act=search&q=${encodeURIComponent(q)}&rn=45`).then((r) => r.ok ? r.json() : []).then((res) => {
      if (Array.isArray(res)) res.forEach((x) => {
        if (!isFakeCoverTrack(x.name || "", q)) kwList.push(x);
      });
    }),
    fetchJson(`https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(q)}&count=45&pages=1`, 7000).then((res) => {
      if (Array.isArray(res)) res.forEach((x) => {
        const nm = x.name || "未知歌曲";
        if (isFakeCoverTrack(nm, q)) return;
        neList.push({
          id: String(x.id || ""),
          name: nm,
          artist: Array.isArray(x.artist) ? x.artist.join(" / ") : (x.artist || "未知歌手"),
          album: x.album || "单曲收录",
          source: "netease",
          pic: x.pic_id ? `https://api.injahow.cn/meting/?server=netease&type=pic&id=${x.pic_id}` : "",
          url: "",
          lrc: `https://api.injahow.cn/meting/?server=netease&type=lrc&id=${x.id}`,
        });
      });
    }),
  ]);
  const list = sortByExactMatch(kwList.concat(neList), q, (x) => x.name, (x) => x.artist);
  if (list.length) {
    discoverList = list;
    musicQueue = list;
    mIsSearch = true;
    mSearchView = "album";
    mSrcFilter = "all";
    set("music_queue", discoverList);
    curSongIdx = -1;
    if (appMode !== "music") switchMode("music", "m_discover");
    else go("m_discover");
    return;
  }
  toast("未找到匹配的曲目");
}

const M_BR_OPTS = [
  { v: "128", label: "标准 128k" },
  { v: "192", label: "高品 192k" },
  { v: "320", label: "极高 320k" },
  { v: "999", label: "无损 FLAC" },
];
let mBr = get("m_br", "320");
const brSelectHtml = () => `<select id="mBrSel" class="ui-select">${M_BR_OPTS.map((o) => `<option value="${o.v}" ${mBr === o.v ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
async function changeBr(newBr) {
  if ((newBr === "320" || newBr === "999") && !curUser?.is_pro) {
    toast("极高 320k / 无损 FLAC 为 Pro 会员专属权益，请兑换卡密解锁");
    return;
  }
  mBr = newBr;
  set("m_br", mBr);
  toast("已切换音质：" + (M_BR_OPTS.find((o) => o.v === mBr)?.label || mBr));
  if (curSong) {
    const token = ++mPlayToken;
    const pos = audioEl.currentTime || 0;
    const wasPlaying = !audioEl.paused;
    const playUrl = await resolveSongUrl(curSong);
    if (token !== mPlayToken || !playUrl) return;
    audioEl.src = playUrl;
    audioEl.load();
    audioEl.addEventListener("loadedmetadata", () => {
      if (token !== mPlayToken) return;
      if (pos > 1 && isFinite(audioEl.duration) && pos < audioEl.duration) audioEl.currentTime = pos;
      if (wasPlaying) audioEl.play().catch(() => {});
    }, { once: true });
    if (wasPlaying) audioEl.play().catch(() => {});
  }
}

function isSameSongMeta(target, cand) {
  const norm = (s) => String(s || "").toLowerCase().replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*（[^）]*）|[^\u4e00-\u9fa5a-z0-9]/g, "");
  const tn = norm(target.name), cn = norm(cand.name);
  if (!tn || tn !== cn) return false;
  const ta = String(target.artist || "").split(/[\/,&、\s]+/).map(norm).filter(Boolean);
  const ca = norm(cand.artist);
  return !ta.length || ta.some((a) => ca.includes(a));
}

async function matchExactKuwo(song) {
  try {
    const r = await fetch(`/kw?act=search&q=${encodeURIComponent(song.name + " " + (song.artist || ""))}&rn=8`);
    if (!r.ok) return null;
    const list = await r.json();
    const hit = (list || []).find((cand) => !isFakeCoverTrack(cand.name, song.name) && isSameSongMeta(song, cand));
    if (!hit) return null;
    const uRes = await fetch(`/kw?act=url&id=${encodeURIComponent(hit.id)}&br=${encodeURIComponent(mBr)}`);
    const uJson = uRes.ok ? await uRes.json() : null;
    if (uJson?.url) {
      song._kwRid = hit.id;
      if (!song.pic && hit.pic) song.pic = hit.pic;
      return uJson.url;
    }
  } catch {}
  return null;
}

async function resolveSongUrl(song) {
  if (song.source === "kuwo" && song.id) {
    try {
      const r = await fetch(`/kw?act=url&id=${encodeURIComponent(song.id)}&br=${encodeURIComponent(mBr)}`);
      const d = r.ok ? await r.json() : null;
      if (d?.url) return d.url;
    } catch {}
    return "";
  }
  if (song.source === "tencent") {
    return (await matchExactKuwo(song)) || "";
  }
  if (song.id) {
    try {
      const r = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${song.id}&br=${mBr}`, 5000);
      if (r && r.url && !r.url.includes("null")) return r.url;
    } catch {}
    const kwUrl = await matchExactKuwo(song);
    if (kwUrl) return kwUrl;
  }
  return song.url || "";
}

async function loadSongLyrics(song, token) {
  curLyrics = []; activeLrcIdx = -1;
  const targets = [];
  if (song.source === "kuwo" || song._kwRid) {
    const rid = song._kwRid || song.id;
    targets.push(async () => {
      const r = await fetch(`/kw?act=lrc&id=${encodeURIComponent(rid)}`);
      const d = r.ok ? await r.json() : null;
      return d?.lrc || "";
    });
    targets.push(async () => {
      const s = await fetchJson(`https://api.vkeys.cn/v2/music/tencent?word=${encodeURIComponent(song.name + " " + (song.artist || ""))}&choose=1`, 5000);
      const tid = s?.data?.id;
      if (!tid) return "";
      const ld = await fetchJson(`https://api.vkeys.cn/v2/music/tencent/lyric?id=${tid}`, 5000);
      return ld?.data?.lrc || "";
    });
  }
  if (song.source !== "kuwo") {
    if (song.lrc) targets.push(() => fetchText(song.lrc, 5000));
    if (song.id && song.source !== "tencent") targets.push(async () => {
      const d = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=${song.id}`, 5000);
      return d?.lyric || "";
    });
  }
  for (const fn of targets) {
    try {
      const txt = await fn();
      if (token !== mPlayToken) return;
      const parsed = parseLrc(txt);
      if (parsed.length) {
        if (token === mPlayToken && curSong && songKey(curSong) === songKey(song)) {
          curLyrics = parsed;
          if (currentRoute === "m_player") renderLyricsBox();
        }
        return;
      }
    } catch {}
  }
  if (token === mPlayToken && currentRoute === "m_player") renderLyricsBox();
}

async function playSongFromList(list, idx, openPlayerView = false) {
  if (!curUser) {
    toast("请先登录账号后收听（5 秒免费注册）");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  const song = list[idx];
  if (!song) return;
  const token = ++mPlayToken;
  musicQueue = list;
  curSongIdx = idx;
  curSong = song;
  addMusicHist(song);
  curLyrics = []; activeLrcIdx = -1;

  mSwitching = true;
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  mSwitching = false;

  if (openPlayerView) go("m_player");
  else {
    updateMiniBar();
    if (currentRoute.startsWith("m_")) routes[currentRoute]();
  }
  const prevKwRid = song._kwRid;
  loadSongLyrics(song, token);
  const playUrl = await resolveSongUrl(song);
  if (token !== mPlayToken) return;
  if (!playUrl) { handleMusicError(); return; }
  if (song._kwRid && song._kwRid !== prevKwRid) loadSongLyrics(song, token);
  audioEl.src = playUrl;
  audioEl.currentTime = 0;
  audioEl.load();
  audioEl.play().then(() => {
    if (token !== mPlayToken) return;
    mErrCount = 0;
    updateMiniBar();
    if (currentRoute === "m_player") syncPlayerUi();
  }).catch(() => {});
}

function nextMusicIdx(step = 1) {
  if (!musicQueue.length) return -1;
  if (mPlayMode === "shuffle") return Math.floor(Math.random() * musicQueue.length);
  return (curSongIdx + step + musicQueue.length) % musicQueue.length;
}
function handleMusicError() {
  if (!musicQueue.length) return;
  if (mErrCount >= 4) { mErrCount = 0; toast("连续多首受版权限制，请切换其他曲目"); return; }
  mErrCount++;
  toast("当前音源受限，已自动切至下一首");
  const ni = nextMusicIdx(1);
  if (ni >= 0 && ni !== curSongIdx) playSongFromList(musicQueue, ni, currentRoute === "m_player");
}
audioEl.onerror = () => {
  if (mSwitching || !audioEl.getAttribute("src")) return;
  if (curSong) handleMusicError();
};
audioEl.onloadedmetadata = () => {
  if (currentRoute === "m_player") {
    const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
    const seek = $("#mSeek"), curT = $("#mCurTime"), durT = $("#mDurTime");
    if (seek && !seek._dragging) seek.value = dur ? String(Math.round((audioEl.currentTime / dur) * 1000)) : "0";
    if (curT) curT.textContent = fmt(audioEl.currentTime || 0);
    if (durT) durT.textContent = fmt(dur);
  }
};
audioEl.onended = () => {
  if (mSleepMode === "track") {
    clearSleepTimer();
    toast("本曲播完已定时停止");
    return;
  }
  if (mPlayMode === "loop") { audioEl.currentTime = 0; audioEl.play().catch(() => {}); return; }
  const ni = nextMusicIdx(1);
  if (ni >= 0) playSongFromList(musicQueue, ni, currentRoute === "m_player");
};
audioEl.onplay = audioEl.onpause = () => {
  updateMiniBar();
  syncMediaSessionState();
  drawPipLyrics();
  if (currentRoute === "m_player") syncPlayerUi();
};
audioEl.ontimeupdate = () => {
  if (curLyrics.length) {
    const t = audioEl.currentTime;
    let ni = -1;
    for (let i = 0; i < curLyrics.length; i++) {
      if (t >= curLyrics[i].t) ni = i; else break;
    }
    if (ni !== activeLrcIdx) {
      activeLrcIdx = ni;
      updateMiniBar();
      syncMediaSessionTitle();
      drawPipLyrics();
      if (currentRoute === "m_player") highlightLyric(ni);
    }
  }
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
  if (currentRoute === "m_player" && dur) {
    const seek = $("#mSeek");
    if (seek && !seek._dragging) seek.value = String(Math.round((audioEl.currentTime / dur) * 1000));
    const curT = $("#mCurTime"), durT = $("#mDurTime");
    if (curT) curT.textContent = fmt(audioEl.currentTime || 0);
    if (durT) durT.textContent = fmt(dur);
  }
};

function syncMediaSessionTitle() {
  if (!curSong) { document.title = "NovaHub · 星隅"; return; }
  const lrc = activeLrcIdx >= 0 && curLyrics[activeLrcIdx] ? curLyrics[activeLrcIdx].text.replace(/\n/g, " ") : "";
  document.title = lrc ? `${lrc} - ${curSong.name}` : `${curSong.name} - ${curSong.artist || "NovaHub"}`;
}

function syncMediaSessionState() {
  if (!("mediaSession" in navigator) || !curSong) return;
  try {
    navigator.mediaSession.playbackState = audioEl.paused ? "paused" : "playing";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: curSong.name || "未知歌曲",
      artist: curSong.artist || "未知歌手",
      album: curSong.album || "NovaHub",
      artwork: curSong.pic ? [{ src: curSong.pic, sizes: "512x512", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => audioEl.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      const pi = nextMusicIdx(-1); if (pi >= 0) playSongFromList(musicQueue, pi, currentRoute === "m_player");
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, currentRoute === "m_player");
    });
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null && isFinite(audioEl.duration)) audioEl.currentTime = d.seekTime;
    });
  } catch {}
}

function updateMiniBar() {
  const bar = $("#miniBar");
  if (!bar) return;
  if (appMode !== "music" || !curSong || currentRoute === "m_player") { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const lrcLine = activeLrcIdx >= 0 && curLyrics[activeLrcIdx] ? curLyrics[activeLrcIdx].text.replace(/\n/g, " ") : (curSong.artist || "点击查看歌词");
  const cls = "mini-cov" + (audioEl.paused ? "" : " playing");
  bar.innerHTML = `
    ${curSong.pic ? `<img class="${cls}" src="${esc(curSong.pic)}" onerror="_imgPh(this,'disc','${cls}')">` : `<div class="${cls}">${ico("disc")}</div>`}
    <div class="mini-info"><div class="mini-title">${esc(curSong.name)}</div><div class="mini-sub">${esc(lrcLine)}</div></div>
    <button id="miniPlay" aria-label="播放暂停">${ico(audioEl.paused ? "play" : "pause")}</button>
    <button id="miniNext" aria-label="下一曲">${ico("next")}</button>`;
  bar.onclick = (e) => { if (!e.target.closest("button")) switchMode("music", "m_player"); };
  $("#miniPlay").onclick = (e) => { e.stopPropagation(); audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); };
  $("#miniNext").onclick = (e) => { e.stopPropagation(); const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, false); };
}

function paintMusicList(container, list) {
  if (!list.length) { container.innerHTML = `<div class="empty">暂无曲目</div>`; return; }
  container.innerHTML = "";
  list.forEach((m, i) => {
    const active = curSong && songKey(curSong) === songKey(m);
    const fav = isMusicFav(m);
    const sub = [m.artist || "未知歌手", m.album ? `《${m.album}》` : ""].filter(Boolean).join(" · ");
    const row = document.createElement("div");
    row.className = "m-row" + (active ? " active" : "");
    row.innerHTML = `
      ${m.pic ? `<img class="m-cov" loading="lazy" src="${esc(m.pic)}" onerror="_imgPh(this,'music','m-cov')">` : `<div class="m-cov">${ico("music")}</div>`}
      <div class="r-main">
        <div class="r-title">${active ? `<span class="m-playing-ind">${ico("wave")}</span>` : ""}${esc(m.name)}</div>
        <div class="r-sub">${esc(sub)}</div>
      </div>
      <button class="m-fav ${fav ? "on" : ""}" aria-label="收藏">${ico(fav ? "heartFill" : "heart")}</button>`;
    row.onclick = (e) => {
      if (e.target.closest(".m-fav")) { e.stopPropagation(); toggleMusicFav(m); return; }
      playSongFromList(list, i, true);
    };
    container.appendChild(row);
  });
}

function paintAlbumList(container, list) {
  if (!list.length) { container.innerHTML = `<div class="empty">暂无专辑</div>`; return; }
  const map = new Map();
  list.forEach((m) => {
    const key = (m.album || "单曲收录").trim();
    if (!map.has(key)) map.set(key, { name: key, artist: m.artist || "未知歌手", pic: m.pic || "", songs: [] });
    const g = map.get(key);
    if (!g.pic && m.pic) g.pic = m.pic;
    g.songs.push(m);
  });
  const albums = [...map.values()].sort((a, b) => b.songs.length - a.songs.length);
  container.innerHTML = "";
  albums.forEach((alb, ai) => {
    const card = document.createElement("div");
    card.className = "alb-card";
    card.innerHTML = `
      <div class="alb-head">
        ${alb.pic ? `<img class="alb-cov" loading="lazy" src="${esc(alb.pic)}" onerror="_imgPh(this,'disc','alb-cov')">` : `<div class="alb-cov">${ico("disc")}</div>`}
        <div class="r-main"><div class="r-title">《${esc(alb.name)}》</div><div class="r-sub">${esc(alb.artist)} · ${alb.songs.length} 首</div></div>
        <button class="btn primary alb-play" style="padding:5px 11px;font-size:12px;margin-right:4px">${ico("play")} 播放</button>
        <span class="r-arrow alb-arr">${ico(ai === 0 ? "chevronDown" : "chevronRight")}</span>
      </div>
      <div class="alb-tracks ${ai === 0 ? "" : "hidden"}"></div>`;
    const tracksEl = card.querySelector(".alb-tracks");
    paintMusicList(tracksEl, alb.songs);
    card.querySelector(".alb-play").onclick = (e) => { e.stopPropagation(); playSongFromList(alb.songs, 0, true); };
    card.querySelector(".alb-head").onclick = () => {
      const hid = tracksEl.classList.toggle("hidden");
      card.querySelector(".alb-arr").innerHTML = ico(hid ? "chevronRight" : "chevronDown");
    };
    container.appendChild(card);
  });
}

function renderMusicDiscover() {
  const filtered = mSrcFilter === "all" ? discoverList : discoverList.filter((x) => (x.source || "netease") === mSrcFilter);
  const albumCnt = new Set(filtered.map((x) => (x.album || "单曲收录").trim())).size;
  $("#view").innerHTML = `
    <div class="m-chips">${MUSIC_CHARTS.map((c) => `<button class="m-chip ${!mIsSearch && curChart === c.id ? "active" : ""}" data-id="${c.id}">${c.name}</button>`).join("")}</div>
    ${mIsSearch ? `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
      <button class="m-chip ${mSearchView === "album" ? "active" : ""}" data-v="album">${ico("disc")} 按专辑 (${albumCnt})</button>
      <button class="m-chip ${mSearchView === "track" ? "active" : ""}" data-v="track">${ico("music")} 全部单曲 (${filtered.length})</button>
    </div>` : ""}
    <div class="section-title" style="justify-content:space-between">
      <span>${mIsSearch ? (mSearchView === "album" ? `专辑分组 (${albumCnt})` : `曲目列表 (${filtered.length})`) : `精选曲目 (${filtered.length})`}</span>
      ${brSelectHtml()}
    </div>
    <div id="mListWrap"></div>`;
  $("#mBrSel").onchange = (e) => changeBr(e.target.value);
  document.querySelectorAll(".m-chip[data-id]").forEach((el) => el.onclick = () => { discoverList = []; loadChart(el.dataset.id); });
  if (mIsSearch) {
    document.querySelectorAll(".m-chip[data-v]").forEach((el) => el.onclick = () => { mSearchView = el.dataset.v; renderMusicDiscover(); });
  }
  const wrap = $("#mListWrap");
  if (!discoverList.length) { wrap.innerHTML = `<div class="empty">正在载入精选曲库…</div>`; loadChart(curChart); return; }
  if (mIsSearch && mSearchView === "album") paintAlbumList(wrap, filtered);
  else { wrap.className = "group"; paintMusicList(wrap, filtered); }
}

function renderLyricsBox() {
  const box = $("#lrcBox");
  if (!box) return;
  const isInstrumental = !curLyrics.length || (curLyrics.length <= 2 && /纯音乐|没有填词|请欣赏/.test(curLyrics.map((l) => l.text).join("")));
  if (isInstrumental) { box.innerHTML = `<div class="lrc-line active" style="margin-top:24px">🎵 纯音乐 · 沉浸伴奏聆听</div>`; return; }
  box.innerHTML = curLyrics.map((l, i) => `<div class="lrc-line ${i === activeLrcIdx ? "active" : ""}" data-i="${i}">${esc(l.text).replace(/\n/g, "<br>")}</div>`).join("");
  box.querySelectorAll(".lrc-line").forEach((el) => el.onclick = () => {
    const l = curLyrics[+el.dataset.i];
    if (l && isFinite(audioEl.duration) && audioEl.duration > 0) { audioEl.currentTime = l.t; if (audioEl.paused) audioEl.play().catch(() => {}); }
  });
  highlightLyric(activeLrcIdx);
}
function highlightLyric(idx) {
  const box = $("#lrcBox");
  if (!box) return;
  box.querySelectorAll(".lrc-line").forEach((el, i) => el.classList.toggle("active", i === idx));
  const cur = box.querySelector(`.lrc-line[data-i="${idx}"]`);
  if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2 + cur.clientHeight / 2);
}
function syncPlayerUi() {
  const disc = $("#mDisc"), btn = $("#mPlayMain");
  if (disc) disc.classList.toggle("playing", !audioEl.paused);
  if (btn) btn.innerHTML = ico(audioEl.paused ? "play" : "pause");
}

function renderMusicPlayer() {
  if (!curSong) {
    $("#view").innerHTML = `<div class="empty">尚未选择播放曲目<br><br><button class="btn primary" onclick="go('m_discover')">前往曲库选歌</button></div>`;
    return;
  }
  const fav = isMusicFav(curSong);
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
  $("#view").innerHTML = `
    <div class="m-player">
      <div style="width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;gap:6px">
        <button class="btn ghost" onclick="go('m_discover')" style="padding:5px 10px;font-size:12.5px">${ico("back")} 曲库</button>
        <div style="flex:1;min-width:0;padding:0 4px">
          <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(curSong.name)}</div>
          <div class="hint" style="margin:2px 0 0">${esc(curSong.artist || "")}</div>
        </div>
        ${brSelectHtml()}
        <button id="mPlayerFav" class="m-fav ${fav ? "on" : ""}" style="font-size:20px" aria-label="收藏">${ico(fav ? "heartFill" : "heart")}</button>
      </div>
      <div id="mDisc" class="m-disc ${audioEl.paused ? "" : "playing"}">
        ${curSong.pic ? `<img src="${esc(curSong.pic)}" onerror="_imgPh(this,'disc','m-disc-ph')">` : `<div class="m-disc-ph">${ico("disc")}</div>`}
      </div>
      <div class="m-tools">
        <button id="mSleepBtn" class="m-tool-btn ${mSleepMode ? "active" : ""}">${ico("clock")} <span id="mSleepTxt">${sleepLabel()}</span></button>
        <button id="mPipBtn" class="m-tool-btn ${pipActive ? "active" : ""}">${ico("pip")} 悬浮歌词</button>
      </div>
      <div id="lrcBox" class="lrc-box"></div>
      <div class="m-prog">
        <span id="mCurTime">${fmt(audioEl.currentTime || 0)}</span>
        <input id="mSeek" type="range" min="0" max="1000" value="${dur ? Math.round((audioEl.currentTime / dur) * 1000) : 0}">
        <span id="mDurTime">${fmt(dur)}</span>
      </div>
      <div class="m-ctrl">
        <button id="mModeBtn" class="m-mode-btn">${renderModeBtnHtml()}</button>
        <button id="mPrevBtn" aria-label="上一曲">${ico("prev")}</button>
        <button id="mPlayMain" class="m-play-btn" aria-label="播放暂停">${ico(audioEl.paused ? "play" : "pause")}</button>
        <button id="mNextBtn" aria-label="下一曲">${ico("next")}</button>
        <button id="mListBtn" aria-label="返回曲库">${ico("queue")}</button>
      </div>
    </div>`;
  renderLyricsBox();
  $("#mBrSel").onchange = (e) => {
    if (e.target.value === "999" && !isProUser()) {
      toast("FLAC 无损音质为 NovaHub Pro 专属权益，已为您切换 320K 高品", 2400);
      e.target.value = "320";
      changeBr("320");
      return;
    }
    changeBr(e.target.value);
  };
  $("#mSleepBtn").onclick = cycleSleepTimer;
  $("#mPipBtn").onclick = togglePipLyrics;
  $("#mPlayerFav").onclick = () => toggleMusicFav(curSong);
  $("#mModeBtn").onclick = () => {
    mPlayMode = M_MODES[(M_MODES.indexOf(mPlayMode) + 1) % M_MODES.length];
    set("m_mode", mPlayMode);
    $("#mModeBtn").innerHTML = renderModeBtnHtml();
  };
  $("#mPlayMain").onclick = () => { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); syncPlayerUi(); };
  $("#mPrevBtn").onclick = () => { const pi = nextMusicIdx(-1); if (pi >= 0) playSongFromList(musicQueue, pi, true); };
  $("#mNextBtn").onclick = () => { const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, true); };
  $("#mListBtn").onclick = () => go("m_discover");
  const sk = $("#mSeek");
  sk.oninput = () => { sk._dragging = true; if (isFinite(audioEl.duration) && audioEl.duration > 0) $("#mCurTime").textContent = fmt((sk.value / 1000) * audioEl.duration); };
  sk.onchange = () => { sk._dragging = false; if (isFinite(audioEl.duration) && audioEl.duration > 0) audioEl.currentTime = (sk.value / 1000) * audioEl.duration; };
}

let curMusicFavGroup = "全部";
function getMusicFavGroups() {
  const custom = get("music_fav_groups", []);
  const fromFavs = getMusicFavs().map((x) => x.group).filter(Boolean);
  return ["全部", "我喜欢的音乐", ...new Set([...custom, ...fromFavs].filter((g) => g && g !== "全部" && g !== "我喜欢的音乐"))];
}

function renderMusicFav() {
  const favs = getMusicFavs().map((x) => ({ ...x, group: x.group || "我喜欢的音乐" }));
  const groups = getMusicFavGroups();
  if (!groups.includes(curMusicFavGroup)) curMusicFavGroup = "全部";
  const shown = curMusicFavGroup === "全部" ? favs : favs.filter((x) => x.group === curMusicFavGroup);
  const hist = get("music_hist", []);
  $("#view").innerHTML = `
    <div class="m-chips" id="mFavGroups">
      ${groups.map((g) => `<button class="m-chip ${curMusicFavGroup === g ? "active" : ""}" data-fg="${esc(g)}">${esc(g)}</button>`).join("")}
      <button class="m-chip" id="addFavGroupBtn">+ 新建分组</button>
    </div>
    <div class="section-title" style="justify-content:space-between">
      <span>${ico("heartFill")} ${esc(curMusicFavGroup)} (${shown.length})</span>
      ${curMusicFavGroup !== "全部" && curMusicFavGroup !== "我喜欢的音乐" ? `<button class="btn ghost sm" id="delFavGroupBtn">删除分组</button>` : ""}
    </div>
    <div class="group" id="mFavList"></div>
    <div class="section-title">${ico("clock")} 最近播放 (${hist.length})</div>
    <div class="group" id="mHistList"></div>`;
  $("#mFavGroups").querySelectorAll("[data-fg]").forEach((el) => {
    el.onclick = () => { curMusicFavGroup = el.dataset.fg; renderMusicFav(); };
  });
  $("#addFavGroupBtn").onclick = () => {
    const name = (prompt("输入新歌单分组名称：", "") || "").trim();
    if (!name || name === "全部") return;
    const custom = get("music_fav_groups", []);
    if (!custom.includes(name) && name !== "我喜欢的音乐") {
      custom.push(name);
      set("music_fav_groups", custom);
    }
    curMusicFavGroup = name;
    renderMusicFav();
  };
  const delBtn = $("#delFavGroupBtn");
  if (delBtn) delBtn.onclick = () => {
    const g = curMusicFavGroup;
    set("music_fav_groups", get("music_fav_groups", []).filter((x) => x !== g));
    set("music_fav", getMusicFavs().map((x) => x.group === g ? { ...x, group: "我喜欢的音乐" } : x));
    curMusicFavGroup = "全部";
    renderMusicFav();
    toast(`已删除分组「${g}」，歌曲已移回默认分组`);
  };
  paintMusicList($("#mFavList"), shown);
  if (shown.length) {
    $("#mFavList").querySelectorAll(".m-item").forEach((row, idx) => {
      const btn = document.createElement("button");
      btn.className = "m-act";
      btn.title = "移动分组";
      btn.textContent = shown[idx].group === "我喜欢的音乐" ? "分组" : shown[idx].group;
      btn.style.cssText = "font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid var(--line);color:var(--text-2);margin-right:4px";
      btn.onclick = (e) => {
        e.stopPropagation();
        const target = (prompt(`将「${shown[idx].name}」移动到分组：`, shown[idx].group) || "").trim();
        if (!target || target === "全部") return;
        const custom = get("music_fav_groups", []);
        if (!custom.includes(target) && target !== "我喜欢的音乐") { custom.push(target); set("music_fav_groups", custom); }
        const k = songKey(shown[idx]);
        set("music_fav", getMusicFavs().map((x) => songKey(x) === k ? { ...x, group: target } : x));
        renderMusicFav();
        toast(`已移入「${target}」`);
      };
      row.insertBefore(btn, row.lastElementChild);
    });
  }
  paintMusicList($("#mHistList"), hist);
}

/* ============ 影视首页 ============ */
function renderHome() {
  const likes = get(K.LIKE, []);
  const history = get(K.HISTORY, []).filter((x) => x.srcId && !String(x.id).startsWith("ep-"));
  const enabled = sources.filter((s) => s.enabled);
  $("#view").innerHTML = `
    ${history.length ? `<div class="section-title">${ico("clock")} 继续观看</div><div class="grid" id="histGrid"></div>` : ""}
    ${renderAdSlotHtml()}
    ${likes.length ? `<div class="section-title">${ico("heart")} 我的片单</div><div class="grid" id="likeGrid"></div>` : ""}
    <div class="section-title" id="srcToggle" style="justify-content:space-between;cursor:pointer;padding:6px 2px">
      <span style="display:inline-flex;align-items:center;gap:6px">${ico("database")} 影视片库 (${enabled.length})</span>
      <span id="srcArrow" style="display:inline-flex;align-items:center;gap:3px;font-size:12px">${ico("chevronRight")} 展开</span>
    </div>
    <div id="srcWrap" style="display:none">
      <div id="srcList"></div>
      <button class="btn ghost block" id="addSrc">${ico("plus")} 手动添加片库源</button>
      <div class="hint">支持标准 JSON 影视接口。批量管理请前往「我的 → 源管理」。</div>
    </div>
  `;
  if (history.length) paintGrid($("#histGrid"), history.slice(0, 6).map((x) => {
    const p = getProgress(x.srcId + ":" + x.id);
    return { ...x, _fromHistory: true, remark: p ? `第${p.idx + 1}集 ${fmt(p.time)}` : x.remark };
  }));
  if (likes.length) paintGrid($("#likeGrid"), likes.slice(0, 12));
  const list = $("#srcList");
  list.innerHTML = enabled.length ? "" : `<div class="empty">暂无启用的片库源<br>点击下方添加，或前往「我的 → 源管理」批量导入</div>`;
  enabled.forEach((s) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span class="r-ico">${ico("database")}</span><div class="r-main"><div class="r-title">${esc(s.name)}</div><div class="r-sub">${esc(s.api)}</div></div><span class="r-arrow">${ico("chevronRight")}</span>`;
    row.onclick = () => openSource(s);
    list.appendChild(row);
  });
  $("#srcToggle").onclick = () => {
    const w = $("#srcWrap"), open = w.style.display === "none";
    w.style.display = open ? "block" : "none";
    $("#srcArrow").innerHTML = `${ico(open ? "chevronDown" : "chevronRight")} ${open ? "收起" : "展开"}`;
  };
  $("#addSrc").onclick = () => go("me") || setTimeout(() => $("#srcManager")?.scrollIntoView(), 50);
  bindAdSlots($("#view"));
}

function paintGrid(el, items) {
  el.innerHTML = items.map((v) => `
    <div class="card" data-pic="${esc(v.pic || "")}" data-name="${esc(v.name)}">
      ${v.pic ? `<img class="poster" loading="lazy" src="${esc(v.pic)}" onerror="_imgPh(this,'film','poster-ph')">` : `<div class="poster-ph">${ico("film")}</div>`}
      <div class="name">${esc(v.name)}</div>
      ${v.remark ? `<span class="tag">${esc(v.remark)}</span>` : ""}
    </div>`).join("");
  el.querySelectorAll(".card").forEach((c, i) => {
    c.onclick = () => openDetail(items[i]);
  });
}

/* 打开数据源：拉首页列表（MacCMS ac=detail） */
async function openSource(src, _fromBack) {
  if (!_fromBack) pushView(() => openSource(src, true));
  $("#view").innerHTML = `${backBar(src.name)}<div class="empty">正在读取「${esc(src.name)}」片库…</div>`;
  try {
    const url = buildVodUrl(src.api, "ac=detail&pg=1");
    const j = await fetchJson(url);
    const list = (j.list || []).map((v) => ({
      id: String(v.vod_id), name: v.vod_name, pic: v.vod_pic, remark: v.vod_remark || v.vod_year || "",
      srcId: src.id,
    }));
    $("#view").innerHTML = `
      ${backBar(`${src.name} · 最新更新 (${list.length})`)}
      <div class="grid" id="srcGrid"></div>`;
    paintGrid($("#srcGrid"), list);
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">数据源读取失败：${esc(e.message)}<br><br><button class="btn ghost" onclick="history.back()">${ico("back")} 返回</button></div>`;
  }
}

/* 详情 + 播放 */
async function openDetail(v, _fromBack) {
  if (!_fromBack) pushView(() => openDetail(v, true));
  const src = sources.find((s) => s.id === v.srcId) || sources.find((s) => s.enabled);
  if (!src || !v.id) { toast("缺少源信息"); return; }
  $("#view").innerHTML = `${backBar(v.name)}<div class="empty">正在载入影片详情…</div>`;
  try {
    const url = buildVodUrl(src.api, `ac=detail&ids=${encodeURIComponent(v.id)}`);
    const j = await fetchJson(url);
    const d = (j.list || [])[0] || {};
    const groups = (d.vod_play_url || "").split("$$$").map((g) =>
      g.split("#").filter(Boolean).map((ep) => {
        const i = ep.indexOf("$");
        return i > -1 ? { name: ep.slice(0, i), url: ep.slice(i + 1).trim() } : { name: "正片", url: ep.trim() };
      })
    ).filter((g) => g.length);
    const isDirect = (u) => /\.(m3u8|mp4|flv|mkv|webm)(\?|$)/i.test(u);
    groups.sort((a, b) => (isDirect(b[0]?.url) ? 1 : 0) - (isDirect(a[0]?.url) ? 1 : 0));
    const eps = groups[0] || [];
    const liked = get(K.LIKE, []).some((x) => x.id === v.id);
    $("#view").innerHTML = `
      ${backBar(d.vod_name || v.name)}
      <div class="form">
        <div style="display:flex;gap:12px">
          ${d.vod_pic ? `<img src="${esc(d.vod_pic)}" style="width:94px;aspect-ratio:3/4.2;object-fit:cover;border-radius:8px;border:1px solid var(--line)" onerror="this.style.display='none'">` : ""}
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:600">${esc(d.vod_name || v.name)}</div>
            <div class="hint">${esc([d.vod_year, d.vod_area, d.vod_lang].filter(Boolean).join(" · "))}<br>${esc(d.vod_actor || "").slice(0, 60)}</div>
          </div>
        </div>
        <div class="hint" style="margin-top:10px">${esc(d.vod_content || "").replace(/<[^>]+>/g, "").slice(0, 200) || "暂无剧情简介"}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn primary" id="btnPlay0">${ico("play")} 立即播放</button>
          <button class="btn ghost" id="btnLike">${ico(liked ? "heartFill" : "heart")} ${liked ? "已收藏" : "收藏"}</button>
        </div>
      </div>
      <div class="section-title">剧集选集 (${eps.length})</div>
      <div class="ep-wrap" id="eps"></div>`;
    $("#eps").innerHTML = eps.map((e, i) => `<div class="ep" data-i="${i}">${esc(e.name)}</div>`).join("");
    const vodKey = src.id + ":" + v.id;
    const saved = getProgress(vodKey);
    $("#eps").querySelectorAll(".ep").forEach((el) => el.onclick = () => play(v.name + " · " + eps[el.dataset.i].name, eps[el.dataset.i].url, eps, +el.dataset.i, vodKey, 0));
    const playSaved = () => {
      if (!eps.length) return toast("暂无可用播放源");
      const idx = saved && saved.idx < eps.length ? saved.idx : 0;
      play(v.name + " · " + eps[idx].name, eps[idx].url, eps, idx, vodKey, saved ? saved.time : 0);
    };
    if (v._fromHistory && eps.length) playSaved();
    $("#btnPlay0").onclick = playSaved;
    $("#btnLike").onclick = () => {
      let likes = get(K.LIKE, []);
      const idx = likes.findIndex((x) => x.id === v.id);
      if (idx === -1) {
        likes.unshift({ id: v.id, name: v.name, pic: v.pic, srcId: v.srcId, remark: d.vod_remark || "" });
        set(K.LIKE, likes);
        $("#btnLike").innerHTML = `${ico("heartFill")} 已收藏`;
        toast("已加入片单");
      } else {
        likes.splice(idx, 1);
        set(K.LIKE, likes);
        $("#btnLike").innerHTML = `${ico("heart")} 收藏`;
        toast("已移出片单");
      }
    };
    addHistory({ id: v.id, name: v.name, pic: v.pic, srcId: v.srcId, remark: d.vod_remark || "" });
  } catch (e) {
    $("#view").innerHTML = `${backBar(v.name)}<div class="empty">详情载入失败：${esc(e.message)}</div>`;
  }
}

function addHistory(item) {
  let h = get(K.HISTORY, []).filter((x) => x.id !== item.id);
  h.unshift(item); set(K.HISTORY, h.slice(0, 30));
}
function saveProgress(vodKey, idx, time) {
  if (!vodKey || !time || time < 1) return;
  const p = get("progress", {});
  p[vodKey] = { idx, time: Math.floor(time) };
  set("progress", p);
}
function getProgress(vodKey) {
  return vodKey ? (get("progress", {})[vodKey] || null) : null;
}

/* ============ 搜索（MacCMS ac=detail，多源并发） ============ */
async function doSearch(q, _fromBack) {
  if (!_fromBack) pushView(() => doSearch(q, true));
  $("#view").innerHTML = `${backBar("搜索：" + q)}<div class="empty">正在并发检索「${esc(q)}」…</div>`;
  const results = [];
  await Promise.allSettled(
    sources.filter((x) => x.enabled).map(async (s) => {
      const url = buildVodUrl(s.api, `ac=detail&wd=${encodeURIComponent(q)}&pg=1`);
      const j = await fetchJson(url, 6000);
      const hits = (j.list || []).filter((v) => {
        const name = (v.vod_name || "").toLowerCase();
        const kw = q.toLowerCase();
        return name.includes(kw) || kw.split(/\s+/).some((w) => w.length > 1 && name.includes(w));
      });
      sortByExactMatch(hits, q, (v) => v.vod_name);
      hits.slice(0, 12).forEach((v) => results.push({
        id: String(v.vod_id), name: v.vod_name, pic: v.vod_pic, remark: v.vod_remark || "", srcId: s.id, from: s.name,
      }));
    })
  );
  if (!results.length) { $("#view").innerHTML = `${backBar("搜索：" + q)}<div class="empty">未检索到「${esc(q)}」<br>请尝试更换关键词</div>`; return; }
  sortByExactMatch(results, q, (x) => x.name);
  $("#view").innerHTML = `${backBar(`检索结果 (${results.length})`)}<div class="grid" id="sGrid"></div>`;
  paintGrid($("#sGrid"), results);
}

/* ============ 视频播放器 ============ */
const P = { hls: null, flv: null, eps: [], idx: 0, title: "", vodKey: "" };
function play(title, url, eps = [], idx = 0, vodKey = "", seekTime = 0) {
  if (!curUser) {
    toast("请先登录账号后观看（5 秒免费注册）");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  P.title = title; P.eps = eps; P.idx = idx; P.vodKey = vodKey;
  $("#playerTitle").textContent = title;
  $("#playerLayer").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  syncModeFab();
  renderEpisodes();
  mountSource(url, seekTime);
}
function renderEpisodes() {
  $("#epList").innerHTML = P.eps.length > 1
    ? `<div class="ep-wrap">${P.eps.map((e, i) => `<div class="ep ${i === P.idx ? "active" : ""}" data-i="${i}">${esc(e.name)}</div>`).join("")}</div>` : "";
  $("#epList").querySelectorAll(".ep").forEach((el) => el.onclick = () => {
    P.idx = +el.dataset.i; renderEpisodes(); mountSource(P.eps[P.idx].url);
    $("#playerTitle").textContent = P.title.replace(/ · .*$/, "") + " · " + P.eps[P.idx].name;
  });
}
function destroyPlayers() {
  if (P.hls) { P.hls.destroy(); P.hls = null; }
  if (P.flv) { P.flv.destroy(); P.flv = null; }
  const v = $("#video"); v.removeAttribute("src"); v.load();
}
function tip(msg, isHtml = false) {
  const el = $("#playerTip");
  if (isHtml) el.innerHTML = msg || "";
  else el.textContent = msg || "";
  el.style.display = msg ? "flex" : "none";
}
function mountSource(url, seekTime = 0) {
  destroyPlayers();
  const v = $("#video");
  if (seekTime > 1) {
    let seekDone = false;
    const applySeek = () => {
      if (seekDone) return;
      if (v.duration && seekTime < v.duration) {
        seekDone = true;
        v.currentTime = seekTime;
        toast("已续播至 " + fmt(seekTime));
      }
    };
    v.addEventListener("loadedmetadata", applySeek, { once: true });
    v.addEventListener("canplay", applySeek, { once: true });
  }
  const isHls = /\.m3u8(\?|$)/i.test(url);
  const isFlv = /\.flv(\?|$)/i.test(url);
  const isMp4 = /\.(mp4|mkv|webm|ts)(\?|$)/i.test(url);
  $("#qualitySel").innerHTML = "<option>自动</option>";
  tip("正在缓冲视频流…");
  if (isHls && window.Hls && Hls.isSupported()) {
    P.hls = new Hls({ maxBufferLength: 30 });
    P.hls.loadSource(url); P.hls.attachMedia(v);
    P.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      tip(""); v.play().catch(() => {});
      const lv = P.hls.levels || [];
      $("#qualitySel").innerHTML = "<option value='-1'>自动</option>" + lv.map((l, i) => `<option value="${i}">${Math.round((l.height || l.bitrate / 1000))}P</option>`).join("");
    });
    P.hls.on(Hls.Events.ERROR, (_e, d) => {
      if (!d.fatal) return;
      if (v.canPlayType("application/vnd.apple.mpegurl")) {
        destroyPlayers();
        v.src = url;
        v.play().catch(() => {});
        tip("");
      } else {
        tip("视频流异常：" + d.type + (d.details ? " / " + d.details : ""));
      }
    });
    P.hls.on(Hls.Events.LEVEL_SWITCHED, (_e, d) => { if (P.hls.autoLevelEnabled) $("#qualitySel").value = String(d.level); });
  } else if (isFlv && window.flvjs && flvjs.isSupported()) {
    P.flv = flvjs.createPlayer({ type: "flv", url, isLive: true });
    P.flv.attachMediaElement(v); P.flv.load(); P.flv.play().catch(() => {});
    tip("");
  } else if (isHls && v.canPlayType("application/vnd.apple.mpegurl")) {
    v.src = url;
    v.play().catch(() => {}); tip("");
  } else {
    v.src = url; v.play().catch(() => {});
    if (isMp4) tip("");
  }
  v.onerror = () => {
    const kw = (P.title || "").split(" · ")[0].trim();
    tip(
      `<span>当前线路无法播放</span>` +
      (kw ? `<button id="switchSrcBtn" class="btn primary" style="margin-top:10px;padding:6px 14px;font-size:13px">${ico("search")} 检索其他可用片源</button>` : ""),
      true
    );
    const btn = $("#switchSrcBtn");
    if (btn) btn.onclick = () => { closePlayer(); doSearch(kw); };
  };
  v.onloadedmetadata = () => {
    const rate = parseFloat($("#rateSel")?.value || "1") || 1;
    v.playbackRate = rate;
  };
  v.onended = () => {
    if (P.eps && P.idx + 1 < P.eps.length) {
      P.idx += 1;
      renderEpisodes();
      const nextEp = P.eps[P.idx];
      $("#playerTitle").textContent = P.title.replace(/ · .*$/, "") + " · " + nextEp.name;
      toast(`自动连播：${nextEp.name}`);
      mountSource(nextEp.url, 0);
    }
  };
}
$("#rateSel").addEventListener("change", (e) => {
  const v = $("#video");
  const r = parseFloat(e.target.value) || 1;
  v.playbackRate = r;
  toast(`播放倍速：${r}x`);
});
$("#qualitySel").addEventListener("change", (e) => {
  if (P.hls) { const i = +e.target.value; P.hls.currentLevel = i; P.hls.nextLevel = i; }
});
$("#playerBack").onclick = closePlayer;
$("#playerFav").onclick = () => toast("已记录至观看历史");
$("#btnPlay").onclick = () => { const v = $("#video"); v.paused ? v.play() : v.pause(); };
$("#btnFs").onclick = async () => {
  const v = $("#video"), box = $(".player-box");
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    try { screen.orientation?.unlock?.(); } catch {}
    return;
  }
  if (box.requestFullscreen || box.webkitRequestFullscreen) {
    try {
      await (box.requestFullscreen || box.webkitRequestFullscreen).call(box);
      await screen.orientation?.lock?.("landscape").catch(() => {});
      return;
    } catch {}
  }
  if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
};
$("#seek").addEventListener("input", (e) => { const v = $("#video"); if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration; });
let _lastPaused = null;
setInterval(() => {
  const v = $("#video"); if (!v.duration) return;
  $("#seek").value = String((v.currentTime / v.duration) * 1000);
  $("#timeText").textContent = fmt(v.currentTime) + " / " + fmt(v.duration);
  if (P.vodKey && Math.floor(v.currentTime) % 5 === 0) saveProgress(P.vodKey, P.idx, v.currentTime);
  if (_lastPaused !== v.paused) {
    _lastPaused = v.paused;
    $("#btnPlay").innerHTML = ico(v.paused ? "play" : "pause");
  }
}, 500);
function fmt(s) {
  s = isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/* 播放器手势：左右滑动控制前进/后退 */
(() => {
  const box = $(".player-box");
  const v = $("#video");
  let sx = 0, sy = 0, startTime = 0, targetTime = -1, swiping = false;
  box.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !v.duration) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    startTime = v.currentTime;
    targetTime = -1;
    swiping = false;
  }, { passive: true });
  box.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1 || !v.duration) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (!swiping && Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) swiping = true;
    if (!swiping) return;
    e.preventDefault();
    const delta = Math.round((dx / Math.max(box.clientWidth, 300)) * 120);
    targetTime = Math.max(0, Math.min(v.duration, startTime + delta));
    const diff = Math.round(targetTime - startTime);
    tip(
      `<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--accent)">${ico(diff >= 0 ? "forward" : "rewind")} ${diff >= 0 ? "+" : ""}${diff}s (${fmt(targetTime)} / ${fmt(v.duration)})</span>`,
      true
    );
  }, { passive: false });
  box.addEventListener("touchend", () => {
    if (swiping && targetTime >= 0 && v.duration) v.currentTime = targetTime;
    if (swiping) tip("");
    swiping = false;
  });
})();

/* ============ 直播（m3u8 频道） ============ */
const DEFAULT_CHANNELS = [
  { name: "CCTV-1 综合", url: "https://live-hls-web-aje.getaj.net/AJE/index.m3u8" },
  { name: "CCTV-13 新闻", url: "http://ivi.bupt.edu.cn/hls/cctv13.m3u8" },
  { name: "CCTV-1 备用", url: "http://ivi.bupt.edu.cn/hls/cctv1hd.m3u8" },
  { name: "CCTV-3 综艺", url: "http://ivi.bupt.edu.cn/hls/cctv3hd.m3u8" },
  { name: "CCTV-5 体育", url: "http://ivi.bupt.edu.cn/hls/cctv5hd.m3u8" },
  { name: "CCTV-6 电影", url: "http://ivi.bupt.edu.cn/hls/cctv6hd.m3u8" },
  { name: "CCTV-8 电视剧", url: "http://ivi.bupt.edu.cn/hls/cctv8hd.m3u8" },
  { name: "北京卫视", url: "http://ivi.bupt.edu.cn/hls/btv1hd.m3u8" },
  { name: "湖南卫视", url: "http://ivi.bupt.edu.cn/hls/hunanhd.m3u8" },
  { name: "浙江卫视", url: "http://ivi.bupt.edu.cn/hls/zjhd.m3u8" },
  { name: "江苏卫视", url: "http://ivi.bupt.edu.cn/hls/jshd.m3u8" },
  { name: "东方卫视", url: "http://ivi.bupt.edu.cn/hls/dfhd.m3u8" },
];
const CH_VER = "20261123-v2";
let channels = get("channels", null);
if (!channels || !channels.length || get("ch_ver", "") !== CH_VER) {
  const customCh = (channels || []).filter((c) => !c.url.includes("live.example.com"));
  const seen = new Set(DEFAULT_CHANNELS.map((c) => c.url));
  channels = DEFAULT_CHANNELS.concat(customCh.filter((c) => !seen.has(c.url)));
  set("channels", channels);
  set("ch_ver", CH_VER);
}
const saveChannels = () => set("channels", channels);

function renderLive() {
  $("#view").innerHTML = `
    <div class="section-title">${ico("tv")} 电视直播频道 (${channels.length})</div>
    <div class="ch-grid" id="chGrid"></div>
    <button class="btn ghost block" id="addCh">${ico("plus")} 添加频道 / 导入 M3U 列表</button>
    <div class="hint">支持 m3u8 与 flv 直播流；支持直接粘贴标准 #EXTINF M3U 列表文本批量解析。</div>`;
  $("#chGrid").innerHTML = channels.map((c, i) => `<div class="ch" data-i="${i}"><span class="dot"></span><span>${esc(c.name)}</span></div>`).join("") || `<div class="empty">暂无直播频道</div>`;
  $("#chGrid").querySelectorAll(".ch").forEach((el) => el.onclick = () => {
    const c = channels[+el.dataset.i]; play(c.name, c.url, channels.map((x) => ({ name: x.name, url: x.url })), +el.dataset.i);
  });
  $("#addCh").onclick = async () => {
    if (!(await modal("添加频道 / 导入 M3U", `
      <div class="form" style="margin:0;border:none;padding:0">
        <label>频道名称</label><input id="mName" placeholder="如 CCTV-5">
        <label>播放地址</label><input id="mUrl" placeholder="https://...m3u8 或 flv">
        <label>或粘贴 M3U 列表文本</label><textarea id="mM3u" placeholder="#EXTINF:-1,频道名&#10;https://...m3u8"></textarea>
      </div>`))) return;
    const name = $("#mName")?.value.trim(), url = $("#mUrl")?.value.trim(), m3u = $("#mM3u")?.value.trim();
    if (m3u) {
      const lines = m3u.split(/\r?\n/); let added = 0;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("#EXTINF")) {
          const nm = lines[i].split(",").slice(1).join(",").trim() || "频道" + (added + 1);
          const u = (lines[i + 1] || "").trim();
          if (u && !u.startsWith("#")) { channels.push({ name: nm, url: u }); added++; i++; }
        } else if (lines[i].trim() && !lines[i].startsWith("#")) {
          channels.push({ name: "频道" + (added + 1), url: lines[i].trim() }); added++;
        }
      }
      saveChannels(); renderLive(); toast(`已导入 ${added} 个频道`);
    } else if (name && url) {
      channels.push({ name, url }); saveChannels(); renderLive(); toast("频道已添加");
    } else toast("请填写完整信息");
  };
}

/* ============ 备份同步 / WebDAV ============ */
function renderWebdav() {
  const d = get(K.WEBDAV, { url: "", user: "", pwd: "" });
  $("#view").innerHTML = `
    <div class="section-title">${ico("cloud")} WebDAV 云端同步</div>
    <div class="form">
      <label>服务器地址</label><input id="davUrl" value="${esc(d.url)}" placeholder="https://dav.example.com/dav">
      <label>账号</label><input id="davUser" value="${esc(d.user)}" autocomplete="username">
      <label>密码</label><input id="davPwd" type="password" value="${esc(d.pwd)}" autocomplete="current-password">
      <div class="hint">连接凭据仅存储在本机浏览器 localStorage 中。</div>
    </div>
    <button class="btn primary block" id="davSave">保存连接配置</button>
    <div class="group">
      <div class="row" id="davExport"><span class="r-ico">${ico("upload")}</span><div class="r-main"><div class="r-title">上传备份至 WebDAV</div><div class="r-sub">同步 zyplayer-backup.json 到云端</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
      <div class="row" id="davImport"><span class="r-ico">${ico("download")}</span><div class="r-main"><div class="r-title">从 WebDAV 恢复数据</div><div class="r-sub">拉取云端配置并覆盖合并至本机</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
    </div>
    <div class="section-title">${ico("save")} 本地文件备份</div>
    <div class="group">
      <div class="row" id="locExport"><span class="r-ico">${ico("save")}</span><div class="r-main"><div class="r-title">导出 JSON 备份文件</div><div class="r-sub">打包下载源、片单、音乐收藏与历史记录</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
      <div class="row" id="locImport"><span class="r-ico">${ico("folder")}</span><div class="r-main"><div class="r-title">从本地文件导入恢复</div><div class="r-sub">选择已导出的 JSON 备份文件</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
    </div>
    <input type="file" id="fileIn" accept=".json,application/json" style="display:none">`;
  $("#davSave").onclick = () => {
    set(K.WEBDAV, { url: $("#davUrl").value.trim(), user: $("#davUser").value.trim(), pwd: $("#davPwd").value });
    toast("连接配置已保存");
  };
  const auth = () => { const c = get(K.WEBDAV, {}); return c.url ? "Basic " + btoa(unescape(encodeURIComponent(c.user + ":" + c.pwd))) : null; };
  const file = "zyplayer-backup.json";
  const payload = () => JSON.stringify({
    version: 1, time: Date.now(),
    data: Object.fromEntries([K.SOURCE, K.LIKE, K.HISTORY, K.VIP, K.GOD_IS, K.GOD_NAME, "channels", "music_favs", "music_hist", "progress", "novel_shelf", "novel_hist", "novel_prog", "novel_cfg"].map((k) => [k, get(k, null)])),
  }, null, 2);
  $("#davExport").onclick = async () => {
    const a = auth(), c = get(K.WEBDAV, {});
    if (!a) return toast("请先保存 WebDAV 连接配置");
    try {
      const r = await fetch(c.url.replace(/\/$/, "") + "/" + file, { method: "PUT", headers: { Authorization: a, "Content-Type": "application/json" }, body: payload() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      toast("云端备份成功");
    } catch (e) { toast("上传失败：" + e.message, 2600); }
  };
  $("#davImport").onclick = async () => {
    const a = auth(), c = get(K.WEBDAV, {});
    if (!a) return toast("请先保存 WebDAV 连接配置");
    try {
      const r = await fetch(c.url.replace(/\/$/, "") + "/" + file, { headers: { Authorization: a } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      restore(await r.json()); toast("云端恢复成功");
    } catch (e) { toast("恢复失败：" + e.message, 2600); }
  };
  $("#locExport").onclick = () => {
    const blob = new Blob([payload()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "zyplayer-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click(); URL.revokeObjectURL(a.href); toast("备份文件已下载");
  };
  $("#locImport").onclick = () => $("#fileIn").click();
  $("#fileIn").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { restore(JSON.parse(await f.text())); toast("数据已恢复"); renderWebdav(); }
    catch { toast("JSON 文件解析失败"); }
    e.target.value = "";
  };
}
function restore(obj) {
  const d = obj.data || obj;
  Object.entries(d).forEach(([k, v]) => { if (v !== null && v !== undefined) set(k, v); });
  ensureLocalAuth();
}

/* ============ 我的（NovaHub Pro 会员中心 + 源管理 + 数据设置） ============ */
function renderMe() {
  const u = NH.user;
  const pro = isProUser();
  const expText = pro
    ? `Pro 会员生效中 · 剩余 ${u.remain_days} 天`
    : (u ? "当前为标准免费版 · 开通 Pro 享免广告与云同步" : "登录账号开启云端多端同步与 Pro 会员权益");

  $("#view").innerHTML = `
    <div class="vip-card">
      <div class="vip-top">
        <div class="vip-ava">${ico(pro ? "crown" : "user")}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15.5px;font-weight:700;display:flex;align-items:center;gap:7px">
            <span>${u ? esc(u.username) : "未登录游客"}</span>
            <span class="badge ${pro ? "" : "gray"}">${pro ? "PRO" : "标准版"}</span>
          </div>
          <div class="hint" style="margin-top:3px">${esc(expText)}</div>
        </div>
      </div>
      <div class="vip-perks">
        <span class="vip-perk">全局免广告</span>
        <span class="vip-perk">云端多端同步</span>
        <span class="vip-perk">FLAC 无损音质</span>
        <span class="vip-perk">高速预加载</span>
      </div>
      <div class="vip-actions">
        ${u ? `
          <button class="btn primary" id="btnRedeem">${ico("crown")} 卡密兑换 / 续期</button>
          <button class="btn ghost" id="btnCloudPush">${ico("upload")} 云端备份</button>
          <button class="btn ghost" id="btnCloudPull">${ico("download")} 云端恢复</button>
          <button class="btn ghost" id="btnLogout" style="flex:0 0 auto">退出</button>
        ` : `
          <button class="btn primary" id="btnLoginOpen">登录 / 注册账号</button>
          <button class="btn ghost" id="btnSponsorInfo">${ico("crown")} 赞助获取 Pro</button>
        `}
      </div>
    </div>

    <div class="section-title" id="srcManager">${ico("database")} 影视源管理 (${sources.length})</div>
    <div class="group" id="srcRows"></div>
    <button class="btn ghost block" id="addSrc2">${ico("plus")} 添加单个片库源</button>
    <div class="form">
      <label>批量导入 JSON 片库配置（支持数组 [{name, api}]）</label>
      <textarea id="batchSrc" placeholder='[{"name":"示例片库","api":"https://api.xxx.com/api.php/provide/vod/"}]'></textarea>
      <button class="btn primary block" id="doBatch" style="margin:10px 0 4px">执行导入</button>
      <div class="hint">支持标准 JSON 影视接口批量导入与管理。</div>
    </div>

    <div class="section-title">数据维护</div>
    <div class="group">
      <div class="row" id="goWebdav"><span class="r-ico">${ico("cloud")}</span><div class="r-main"><div class="r-title">WebDAV 与本地文件备份</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
      <div class="row danger" id="clearAll"><span class="r-ico">${ico("trash")}</span><div class="r-main"><div class="r-title">重置并清空本机缓存数据</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
    </div>

    <div class="section-title">版本信息</div>
    <div class="hint">NovaHub · 星隅 — 私人影视放映、黑胶听音与精品小说阅读终端。<br>内置高清影视片库、无损音乐曲库与流式在线小说阅读引擎。</div>`;

  if (!u) {
    $("#btnLoginOpen").onclick = openAuthModal;
    $("#btnSponsorInfo").onclick = () => modal("赞助获取 NovaHub Pro", `<div class="hint" style="font-size:13px;line-height:1.7">${esc(NH.cfg.sponsor_tip || "请联系站长获取兑换卡密，登录后即可一键激活 Pro 会员。")}</div>`);
  } else {
    $("#btnRedeem").onclick = openRedeemModal;
    $("#btnCloudPush").onclick = cloudSyncPush;
    $("#btnCloudPull").onclick = cloudSyncPull;
    $("#btnLogout").onclick = () => {
      NH.token = ""; NH.user = null;
      set("nh_token", ""); set("nh_user", null);
      renderMe(); toast("已退出登录");
    };
  }

  const rows = $("#srcRows");
  rows.innerHTML = sources.length ? "" : `<div class="row" style="cursor:default"><div class="r-main"><div class="r-sub">暂无数据源</div></div></div>`;
  sources.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<div class="r-main"><div class="r-title">${esc(s.name)} ${s.enabled ? '<span class="badge">启用</span>' : '<span class="badge gray">停用</span>'}</div><div class="r-sub">${esc(s.api)}</div></div>
      <button class="btn ghost" data-a="toggle" style="padding:5px 10px;font-size:12px">${s.enabled ? "停用" : "启用"}</button>
      <button class="btn ghost" data-a="del" style="padding:5px 9px;font-size:13px;color:var(--crimson)" aria-label="删除">${ico("trash")}</button>`;
    row.querySelector('[data-a="toggle"]').onclick = (e) => { e.stopPropagation(); s.enabled = !s.enabled; saveSources(); renderMe(); };
    row.querySelector('[data-a="del"]').onclick = async (e) => {
      e.stopPropagation();
      if (await modal("删除数据源", `确定移除「${esc(s.name)}」？`)) { sources.splice(i, 1); saveSources(); renderMe(); }
    };
    rows.appendChild(row);
  });

  $("#addSrc2").onclick = async () => {
    if (!(await modal("添加数据源", `<div class="form" style="margin:0;border:none;padding:0"><label>源名称</label><input id="sName" placeholder="自定义名称">
      <label>MacCMS 接口地址</label><input id="sApi" placeholder="https://api.xxx.com/api.php/provide/vod/"></div>`))) return;
    const n = $("#sName")?.value.trim(), a = $("#sApi")?.value.trim();
    if (n && a) { sources.push({ id: "s" + Date.now(), name: n, api: a, type: "mac", enabled: true }); saveSources(); renderMe(); toast("数据源已添加"); }
    else toast("请填写完整名称与地址");
  };
  $("#doBatch").onclick = () => {
    try {
      const arr = JSON.parse($("#batchSrc").value);
      const list = Array.isArray(arr) ? arr : (arr.source || arr.sites || []);
      let n = 0;
      list.forEach((s) => {
        const name = s.name || s.n, api = s.api || s.url || s.host;
        if (name && api) { sources.push({ id: "s" + Date.now() + n, name, api, type: "mac", enabled: s.enabled !== false }); n++; }
      });
      if (!n) return toast("未识别到有效源字段");
      saveSources(); renderMe(); toast(`成功导入 ${n} 个数据源`);
    } catch { toast("JSON 格式解析失败"); }
  };
  $("#goWebdav").onclick = () => go("webdav");
  $("#clearAll").onclick = async () => {
    if (await modal("清空本机数据", "将重置所有自定义源、观看进度、影视片单、音乐收藏与小说书架，确定继续？")) {
      [K.SOURCE, K.LIKE, K.HISTORY, K.WEBDAV, "channels", "music_favs", "music_hist", "progress", "novel_shelf", "novel_hist", "novel_prog", "novel_cfg"].forEach((k) => localStorage.removeItem(k));
      sources = DEFAULT_SOURCES.slice(); channels = DEFAULT_CHANNELS.slice();
      ensureLocalAuth(); renderMe(); toast("本机数据已重置");
    }
  };
}

/* ============ 番茄小说实时流式直读模块（书城 / 书架 / 详情目录 / 多主题阅读器） ============ */
const NOVEL_CATS = [
  { id: "悬疑脑洞", name: "悬疑脑洞" },
  { id: "都市高武", name: "都市高武" },
  { id: "玄幻脑洞", name: "玄幻脑洞" },
  { id: "科幻末世", name: "科幻末世" },
  { id: "传统玄幻", name: "传统玄幻" },
  { id: "历史古代", name: "历史古代" },
  { id: "都市日常", name: "都市日常" },
  { id: "古言脑洞", name: "古言脑洞" },
];

let curNovelCat = "悬疑脑洞";
let novelStoreList = get("novel_cat_" + curNovelCat, []);
let novelIsSearch = false;
let novelSearchKw = "";
const _novelDirMem = new Map(); // book_id -> chapters[]
const _novelChMem = new Map();  // `${book_id}:${index}` -> chapterObj

const getNovelShelf = () => get("novel_shelf", []);
const isInNovelShelf = (bid) => !!bid && getNovelShelf().some((x) => String(x.book_id) === String(bid));
function toggleNovelShelf(book) {
  if (!book || !book.book_id) return false;
  const list = getNovelShelf();
  const idx = list.findIndex((x) => String(x.book_id) === String(book.book_id));
  let added = false;
  if (idx >= 0) {
    list.splice(idx, 1);
    toast("已移出书架");
  } else {
    list.unshift({
      book_id: String(book.book_id),
      title: book.title || "未知书名",
      author: book.author || "未知作者",
      cover: book.cover || "",
      category: book.category || "",
      score: book.score || "",
      status: book.status || "",
      abstract: book.abstract || "",
    });
    added = true;
    toast("已加入书架");
  }
  set("novel_shelf", list);
  return added;
}

function addNovelHist(book) {
  if (!book || !book.book_id) return;
  const list = get("novel_hist", []).filter((x) => String(x.book_id) !== String(book.book_id));
  list.unshift({
    book_id: String(book.book_id),
    title: book.title || "未知书名",
    author: book.author || "未知作者",
    cover: book.cover || "",
    category: book.category || "",
    score: book.score || "",
    status: book.status || "",
    abstract: book.abstract || "",
  });
  set("novel_hist", list.slice(0, 40));
}

function getNovelProg(bid) {
  return bid ? (get("novel_prog", {})[String(bid)] || null) : null;
}
function saveNovelProg(bid, index, title, total, ratio = 0) {
  if (!bid || !index) return;
  const all = get("novel_prog", {});
  all[String(bid)] = { index: Number(index), title: title || `第${index}章`, total: Number(total || 0), ratio: Number(ratio || 0), ts: Date.now() };
  set("novel_prog", all);
}

function paintNovelList(container, list, opts = {}) {
  if (!list || !list.length) {
    container.innerHTML = `<div class="empty">${opts.emptyText || "暂无相关书籍"}</div>`;
    return;
  }
  container.className = "novel-list";
  container.innerHTML = list.map((b) => {
    const prog = getNovelProg(b.book_id);
    const metaParts = [b.author || "未知作者", b.category, b.status].filter(Boolean);
    const badgeHtml = prog
      ? `<span class="badge">读至 第${prog.index}章</span>`
      : (b.score ? `<span class="novel-score">${esc(b.score)} 分</span>` : "");
    return `<div class="novel-card">
      ${b.cover ? `<img class="novel-cov" loading="lazy" src="${esc(b.cover)}" onerror="_imgPh(this,'book','novel-cov')">` : `<div class="novel-cov">${ico("book")}</div>`}
      <div class="novel-info">
        <div>
          <div class="novel-head-row">
            <div class="novel-title">${esc(b.title)}</div>
            ${badgeHtml}
          </div>
          <div class="novel-meta">${esc(metaParts.join(" · "))}</div>
        </div>
        <div class="novel-desc">${esc((b.abstract || "暂无作品简介").replace(/\s+/g, " "))}</div>
      </div>
    </div>`;
  }).join("");
  container.querySelectorAll(".novel-card").forEach((el, i) => {
    el.onclick = () => {
      const b = list[i];
      if (opts.directRead) {
        const prog = getNovelProg(b.book_id);
        if (prog && prog.index) { openNovelDetail(b, false, true); return; }
      }
      openNovelDetail(b);
    };
  });
}

async function loadNovelCategory(cat = curNovelCat) {
  curNovelCat = cat;
  novelIsSearch = false;
  const cached = get("novel_cat_" + cat, null);
  if (cached && cached.length && !novelStoreList.length) {
    novelStoreList = cached;
    if (currentRoute === "n_store") renderNovelStore();
  }
  try {
    const r = await fetch(`/api/novel/search?q=${encodeURIComponent(cat)}`);
    const d = await r.json();
    if (Array.isArray(d.items) && d.items.length) {
      novelStoreList = d.items;
      set("novel_cat_" + cat, d.items);
      if (currentRoute === "n_store") renderNovelStore();
      return;
    }
  } catch {}
  if (!novelStoreList.length && currentRoute === "n_store") {
    const wrap = $("#nStoreWrap");
    if (wrap) wrap.innerHTML = `<div class="empty">书城连接超时，请使用顶部搜索框直接检索书名</div>`;
  }
}

async function searchNovel(q) {
  if (!q) return;
  novelIsSearch = true;
  novelSearchKw = q;
  if (currentRoute !== "n_store") {
    currentRoute = "n_store";
    viewStack.length = 0;
    renderTabbar();
  }
  $("#view").innerHTML = `<div class="section-title">${ico("search")} 正在检索「${esc(q)}」…</div><div class="empty">正在实时检索书库…</div>`;
  try {
    const r = await fetch(`/api/novel/search?q=${encodeURIComponent(q)}`);
    const d = await r.json();
    novelStoreList = sortByExactMatch(Array.isArray(d.items) ? d.items : [], q, (x) => x.title || x.name, (x) => x.author);
    renderNovelStore();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">检索失败：${esc(e.message)}</div>`;
  }
}

function renderNovelStore() {
  $("#view").innerHTML = `
    <div class="m-chips">${NOVEL_CATS.map((c) => `<button class="m-chip ${!novelIsSearch && curNovelCat === c.id ? "active" : ""}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>
    ${renderAdSlotHtml()}
    <div class="section-title" style="justify-content:space-between">
      <span>${ico("book")} ${novelIsSearch ? `「${esc(novelSearchKw)}」搜索结果 (${novelStoreList.length})` : `${esc(curNovelCat)} · 精选推荐 (${novelStoreList.length})`}</span>
    </div>
    <div id="nStoreWrap"></div>`;
  bindAdSlots($("#view"));
  document.querySelectorAll(".m-chip[data-cat]").forEach((el) => {
    el.onclick = () => {
      $("#searchInput").value = "";
      novelStoreList = [];
      renderNovelStore();
      loadNovelCategory(el.dataset.cat);
    };
  });
  const wrap = $("#nStoreWrap");
  if (!novelStoreList.length && !novelIsSearch) {
    wrap.innerHTML = `<div class="empty">正在加载精选书单…</div>`;
    loadNovelCategory(curNovelCat);
    return;
  }
  paintNovelList(wrap, novelStoreList, { emptyText: "未找到匹配小说，可尝试输入完整书名、作者或 19 位 Book ID" });
}

function renderNovelShelf() {
  const shelf = getNovelShelf();
  const hist = get("novel_hist", []);
  $("#view").innerHTML = `
    <div class="section-title">${ico("bookmarkFill")} 我的书架 (${shelf.length})</div>
    <div id="nShelfList"></div>
    <div class="section-title">${ico("clock")} 最近阅读 (${hist.length})</div>
    <div id="nHistList"></div>`;
  paintNovelList($("#nShelfList"), shelf, { emptyText: "书架空空如也，去「书城」挑选一本好书吧", directRead: true });
  paintNovelList($("#nHistList"), hist, { emptyText: "暂无最近阅读记录", directRead: true });
}

async function fetchBookChapters(bookId) {
  const key = String(bookId);
  if (_novelDirMem.has(key)) return _novelDirMem.get(key);
  const r = await fetch(`/api/novel/book?book_id=${encodeURIComponent(key)}`);
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || ("HTTP " + r.status));
  const chapters = d.chapters || [];
  if (chapters.length) _novelDirMem.set(key, chapters);
  return chapters;
}

async function openNovelDetail(book, _fromBack = false, autoResume = false) {
  if (!_fromBack) pushView(() => openNovelDetail(book, true, false));
  const inShelf = isInNovelShelf(book.book_id);
  const prog = getNovelProg(book.book_id);
  const meta = [book.author || "未知作者", book.category, book.status, book.score ? `${book.score} 分` : ""].filter(Boolean).join(" · ");
  $("#view").innerHTML = `
    ${backBar(book.title)}
    <div class="form">
      <div style="display:flex;gap:13px">
        ${book.cover ? `<img src="${esc(book.cover)}" style="width:88px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex-shrink:0" onerror="this.style.display='none'">` : ""}
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:700;line-height:1.35">${esc(book.title)}</div>
          <div class="hint" style="margin-top:5px">${esc(meta)}</div>
          ${prog ? `<div style="margin-top:7px"><span class="badge">上次读至：${esc(prog.title || `第${prog.index}章`)}</span></div>` : ""}
        </div>
      </div>
      <div class="hint" style="margin-top:11px;white-space:pre-line;max-height:110px;overflow-y:auto">${esc(book.abstract || "暂无作品简介")}</div>
      <div style="display:flex;gap:8px;margin-top:13px">
        <button class="btn primary" id="btnReadStart" style="flex:1">${ico("book")} ${prog ? `继续阅读 (第${prog.index}章)` : "立即在线阅读"}</button>
        <button class="btn ghost" id="btnShelfToggle">${ico(inShelf ? "bookmarkFill" : "bookmark")} ${inShelf ? "已在书架" : "加入书架"}</button>
      </div>
    </div>
    <div class="section-title" style="justify-content:space-between">
      <span id="nDirCount">${ico("list")} 正在拉取全书章节目录…</span>
      <button id="nDirOrderBtn" class="btn ghost" style="padding:4px 10px;font-size:12px;display:none">${ico("sort")} 倒序</button>
    </div>
    <div id="nDirRanges" class="m-chips"></div>
    <div id="nDirList"><div class="empty">正在获取目录…</div></div>`;

  $("#btnShelfToggle").onclick = () => {
    const nowOn = toggleNovelShelf(book);
    $("#btnShelfToggle").innerHTML = `${ico(nowOn ? "bookmarkFill" : "bookmark")} ${nowOn ? "已在书架" : "加入书架"}`;
  };

  try {
    const chapters = await fetchBookChapters(book.book_id);
    if (!chapters.length) {
      $("#nDirList").innerHTML = `<div class="empty">暂未获取到章节目录</div>`;
      return;
    }
    const startRead = () => {
      const latestProg = getNovelProg(book.book_id);
      const targetIdx = latestProg && latestProg.index <= chapters.length ? latestProg.index : 1;
      openNovelReader(book, chapters, targetIdx);
    };
    $("#btnReadStart").onclick = startRead;
    if (autoResume) { startRead(); return; }

    let isDesc = false;
    const pageSize = 100;
    const totalPages = Math.ceil(chapters.length / pageSize);
    let curPage = prog ? Math.min(totalPages - 1, Math.floor((prog.index - 1) / pageSize)) : 0;

    $("#nDirCount").innerHTML = `${ico("list")} 章节目录 (共 ${chapters.length} 章)`;
    const orderBtn = $("#nDirOrderBtn");
    orderBtn.style.display = "inline-flex";

    const renderDirSlice = () => {
      const ordered = isDesc ? chapters.slice().reverse() : chapters;
      if (totalPages > 1) {
        const chips = [];
        for (let p = 0; p < totalPages; p++) {
          const s = p * pageSize + 1;
          const e = Math.min(ordered.length, (p + 1) * pageSize);
          const label = isDesc ? `${ordered[s - 1].index}-${ordered[e - 1].index}章` : `${s}-${e}章`;
          chips.push(`<button class="m-chip ${p === curPage ? "active" : ""}" data-p="${p}">${label}</button>`);
        }
        $("#nDirRanges").innerHTML = chips.join("");
        $("#nDirRanges").querySelectorAll(".m-chip").forEach((el) => {
          el.onclick = () => { curPage = +el.dataset.p; renderDirSlice(); };
        });
      } else {
        $("#nDirRanges").innerHTML = "";
      }
      const slice = ordered.slice(curPage * pageSize, (curPage + 1) * pageSize);
      const latestP = getNovelProg(book.book_id);
      const box = $("#nDirList");
      box.className = "ch-list-grid";
      box.innerHTML = slice.map((c) => `
        <div class="ch-item ${latestP && latestP.index === c.index ? "active" : ""}" data-idx="${c.index}">
          <span style="overflow:hidden;text-overflow:ellipsis">${esc(c.title)}</span>
          ${latestP && latestP.index === c.index ? '<span class="badge">当前</span>' : ""}
        </div>`).join("");
      box.querySelectorAll(".ch-item").forEach((el) => {
        el.onclick = () => openNovelReader(book, chapters, +el.dataset.idx);
      });
    };

    orderBtn.onclick = () => {
      isDesc = !isDesc;
      curPage = 0;
      orderBtn.innerHTML = `${ico("sort")} ${isDesc ? "正序" : "倒序"}`;
      renderDirSlice();
    };
    renderDirSlice();
  } catch (e) {
    $("#nDirList").innerHTML = `<div class="empty">目录加载失败：${esc(e.message)}</div>`;
  }
}

/* 全屏沉浸阅读器状态与控制 */
const R = {
  book: null,
  chapters: [],
  index: 1,
  token: 0,
  tocDesc: false,
  tocPage: 0,
  pageIdx: 0,
  totalPages: 1,
  stepW: 0,
  cfg: get("novel_cfg", { fontSize: 18, theme: "dark", mode: "scroll" }),
};

function layoutReaderPages(targetRatio = null) {
  const layer = $("#readerLayer");
  const sc = $("#readerScroll");
  const art = $("#readerArticle");
  const hud = $("#readerPageHud");
  if (!layer || !sc || !art) return;

  const isPage = R.cfg.mode === "page";
  layer.classList.toggle("mode-page", isPage);
  if (!isPage) {
    art.style.columnWidth = "";
    art.style.width = "";
    art.style.transform = "";
    hud.classList.add("hidden");
    return;
  }

  const padX = 36;
  const colW = Math.max(240, sc.clientWidth - padX);
  const gap = 36;
  R.stepW = colW + gap;
  art.style.columnWidth = `${colW}px`;
  art.style.columnGap = `${gap}px`;
  art.style.transform = "translate3d(0,0,0)";

  requestAnimationFrame(() => {
    const sw = Math.max(colW, art.scrollWidth);
    R.totalPages = Math.max(1, Math.round((sw + gap) / R.stepW));
    if (targetRatio !== null && targetRatio > 0) {
      R.pageIdx = Math.min(R.totalPages - 1, Math.round(targetRatio * (R.totalPages - 1)));
    } else {
      R.pageIdx = Math.min(R.totalPages - 1, Math.max(0, R.pageIdx));
    }
    applyPageTransform();
  });
}

function applyPageTransform() {
  const art = $("#readerArticle");
  const hud = $("#readerPageHud");
  if (!art || R.cfg.mode !== "page") return;
  art.style.transform = `translate3d(-${R.pageIdx * R.stepW}px, 0, 0)`;
  hud.textContent = `${R.pageIdx + 1} / ${R.totalPages}`;
  hud.classList.remove("hidden");
}

function applyReaderCfg() {
  const layer = $("#readerLayer");
  const art = $("#readerArticle");
  if (!layer || !art) return;
  if (!R.cfg.mode) R.cfg.mode = "scroll";
  layer.dataset.rtheme = R.cfg.theme || "dark";
  art.style.fontSize = (R.cfg.fontSize || 18) + "px";
  $("#rFontVal").textContent = String(R.cfg.fontSize || 18);
  layer.querySelectorAll(".r-swatch").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === R.cfg.theme);
  });
  layer.querySelectorAll(".r-pmode").forEach((b) => {
    b.classList.toggle("active", b.dataset.pmode === R.cfg.mode);
  });
  set("novel_cfg", R.cfg);
  layoutReaderPages();
}

function saveCurrentReaderScroll() {
  if (!R.book || $("#readerLayer").classList.contains("hidden")) return;
  let ratio = 0;
  if (R.cfg.mode === "page") {
    ratio = R.totalPages > 1 ? R.pageIdx / (R.totalPages - 1) : 0;
  } else {
    const sc = $("#readerScroll");
    const max = sc.scrollHeight - sc.clientHeight;
    ratio = max > 20 ? Math.min(1, Math.max(0, sc.scrollTop / max)) : 0;
  }
  const ch = R.chapters[R.index - 1];
  saveNovelProg(R.book.book_id, R.index, ch ? ch.title : `第${R.index}章`, R.chapters.length, Number(ratio.toFixed(4)));
}

async function fetchSingleChapter(bookId, index) {
  const key = `${bookId}:${index}`;
  if (_novelChMem.has(key)) return _novelChMem.get(key);
  const r = await fetch(`/api/novel/chapter?book_id=${encodeURIComponent(bookId)}&index=${index}`);
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || ("HTTP " + r.status));
  _novelChMem.set(key, d);
  return d;
}

function syncReaderShelfBtn() {
  if (!R.book) return;
  const on = isInNovelShelf(R.book.book_id);
  $("#readerShelfBtn").innerHTML = `${ico(on ? "bookmarkFill" : "bookmark")} ${on ? "已藏" : "加书架"}`;
}

async function loadReaderChapter(index, restoreRatio = 0) {
  if (!R.book || !R.chapters.length) return;
  index = Math.max(1, Math.min(R.chapters.length, index));
  R.index = index;
  const myToken = ++R.token;
  const chMeta = R.chapters[index - 1];

  $("#readerBookTitle").textContent = R.book.title;
  $("#readerChSub").textContent = `${chMeta ? chMeta.title : `第${index}章`} · ${index}/${R.chapters.length}`;
  $("#readerInlineNav").style.display = "none";

  const memKey = `${R.book.book_id}:${index}`;
  if (!_novelChMem.has(memKey)) {
    $("#readerScroll").scrollTop = 0;
    $("#readerArticle").innerHTML = `<h2>${esc(chMeta ? chMeta.title : `第${index}章`)}</h2><div class="empty" style="padding:40px 0">正在实时解锁并排版章节正文…</div>`;
  }

  try {
    const d = await fetchSingleChapter(R.book.book_id, index);
    if (myToken !== R.token) return;

    $("#readerChSub").textContent = `${d.title} · ${index}/${R.chapters.length}`;
    $("#readerArticle").innerHTML = `<h2>${esc(d.title)}</h2>${d.content}`;
    $("#readerInlineNav").style.display = "flex";
    $("#rPrevBtn").disabled = $("#rPrevInline").disabled = index <= 1;
    $("#rNextBtn").disabled = $("#rNextInline").disabled = index >= R.chapters.length;

    const sc = $("#readerScroll");
    R.pageIdx = 0;
    if (R.cfg.mode === "page") {
      layoutReaderPages(restoreRatio);
    } else if (restoreRatio > 0.01) {
      requestAnimationFrame(() => {
        const max = sc.scrollHeight - sc.clientHeight;
        if (max > 0) sc.scrollTop = Math.round(max * restoreRatio);
      });
    } else {
      sc.scrollTop = 0;
    }

    saveNovelProg(R.book.book_id, index, d.title, R.chapters.length, restoreRatio);

    // 前端静默预拉取下一章到内存，翻页 0ms 瞬开
    if (index < R.chapters.length) {
      fetchSingleChapter(R.book.book_id, index + 1).catch(() => {});
    }
  } catch (e) {
    if (myToken !== R.token) return;
    $("#readerArticle").innerHTML = `
      <h2>${esc(chMeta ? chMeta.title : `第${index}章`)}</h2>
      <div class="empty" style="padding:36px 0">
        章节加载失败：${esc(e.message)}<br><br>
        <button class="btn primary" id="rRetryBtn">点击重试</button>
      </div>`;
    const btn = $("#rRetryBtn");
    if (btn) btn.onclick = () => loadReaderChapter(index, restoreRatio);
  }
}

function openNovelReader(book, chapters, index = 1) {
  const wasHidden = $("#readerLayer").classList.contains("hidden");
  R.book = book;
  R.chapters = chapters;
  addNovelHist(book);

  const saved = getNovelProg(book.book_id);
  const ratio = saved && saved.index === index ? (saved.ratio || 0) : 0;

  applyReaderCfg();
  syncReaderShelfBtn();
  $("#readerLayer").classList.remove("hidden", "bars-hidden");
  document.body.style.overflow = "hidden";
  syncModeFab();
  if (wasHidden) history.pushState({ reader: true }, "");

  loadReaderChapter(index, ratio);
}

function openReaderToc() {
  if (!R.chapters.length) return;
  const pageSize = 100;
  const totalPages = Math.ceil(R.chapters.length / pageSize);
  R.tocPage = R.tocDesc
    ? Math.floor((R.chapters.length - R.index) / pageSize)
    : Math.floor((R.index - 1) / pageSize);

  const renderSheet = () => {
    $("#tocTitle").textContent = `目录 (${R.index}/${R.chapters.length})`;
    $("#tocReverseBtn").innerHTML = `${ico("sort")} ${R.tocDesc ? "正序" : "倒序"}`;
    const ordered = R.tocDesc ? R.chapters.slice().reverse() : R.chapters;

    if (totalPages > 1) {
      const chips = [];
      for (let p = 0; p < totalPages; p++) {
        const s = p * pageSize + 1;
        const e = Math.min(ordered.length, (p + 1) * pageSize);
        const label = R.tocDesc ? `${ordered[s - 1].index}-${ordered[e - 1].index}章` : `${s}-${e}章`;
        chips.push(`<button class="m-chip ${p === R.tocPage ? "active" : ""}" data-tp="${p}">${label}</button>`);
      }
      $("#tocRangeChips").innerHTML = chips.join("");
      $("#tocRangeChips").querySelectorAll(".m-chip").forEach((el) => {
        el.onclick = () => { R.tocPage = +el.dataset.tp; renderSheet(); };
      });
    } else {
      $("#tocRangeChips").innerHTML = "";
    }

    const slice = ordered.slice(R.tocPage * pageSize, (R.tocPage + 1) * pageSize);
    const listEl = $("#tocList");
    listEl.innerHTML = slice.map((c) => `<div class="toc-row ${c.index === R.index ? "active" : ""}" data-idx="${c.index}">${esc(c.title)}</div>`).join("");
    listEl.querySelectorAll(".toc-row").forEach((el) => {
      el.onclick = () => {
        $("#tocMask").classList.add("hidden");
        loadReaderChapter(+el.dataset.idx, 0);
      };
    });
    const curEl = listEl.querySelector(".toc-row.active");
    if (curEl) curEl.scrollIntoView({ block: "center" });
  };

  $("#tocMask").classList.remove("hidden");
  renderSheet();
  $("#tocReverseBtn").onclick = () => { R.tocDesc = !R.tocDesc; R.tocPage = 0; renderSheet(); };
}

/* 绑定阅读器固定控件与手势 */
(() => {
  $("#readerBack").innerHTML = `${ico("back")} 返回`;
  $("#readerFsBtn").innerHTML = ico("fullscreen");
  $("#rTocBtn").innerHTML = `${ico("list")} 目录`;
  $("#rTtsBtn").innerHTML = `${ico("volume")} 听书`;
  $("#rTtsBtn").onclick = toggleNovelTts;

  $("#readerBack").onclick = () => history.back();
  $("#readerFsBtn").onclick = () => {
    const layer = $("#readerLayer");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else (layer.requestFullscreen || layer.webkitRequestFullscreen || (() => {})).call(layer);
  };
  $("#readerShelfBtn").onclick = () => {
    if (!R.book) return;
    toggleNovelShelf(R.book);
    syncReaderShelfBtn();
  };

  $("#rFontDec").onclick = () => { R.cfg.fontSize = Math.max(14, (R.cfg.fontSize || 18) - 1); applyReaderCfg(); };
  $("#rFontInc").onclick = () => { R.cfg.fontSize = Math.min(28, (R.cfg.fontSize || 18) + 1); applyReaderCfg(); };
  document.querySelectorAll("#readerLayer .r-swatch").forEach((btn) => {
    btn.onclick = () => { R.cfg.theme = btn.dataset.theme; applyReaderCfg(); };
  });
  document.querySelectorAll("#readerLayer .r-pmode").forEach((btn) => {
    btn.onclick = () => {
      R.cfg.mode = btn.dataset.pmode;
      R.pageIdx = 0;
      applyReaderCfg();
    };
  });

  const goPrev = () => { if (R.index > 1) loadReaderChapter(R.index - 1, 0); else toast("已是第一章"); };
  const goNext = () => { if (R.index < R.chapters.length) loadReaderChapter(R.index + 1, 0); else toast("已读至最新章"); };
  const pagePrev = () => {
    if (R.cfg.mode !== "page") { goPrev(); return; }
    if (R.pageIdx > 0) { R.pageIdx--; applyPageTransform(); saveCurrentReaderScroll(); }
    else goPrev();
  };
  const pageNext = () => {
    if (R.cfg.mode !== "page") { goNext(); return; }
    if (R.pageIdx < R.totalPages - 1) { R.pageIdx++; applyPageTransform(); saveCurrentReaderScroll(); }
    else goNext();
  };

  $("#rPrevBtn").onclick = $("#rPrevInline").onclick = goPrev;
  $("#rNextBtn").onclick = $("#rNextInline").onclick = goNext;
  $("#rTocBtn").onclick = $("#rTocInline").onclick = openReaderToc;

  $("#tocMask").onclick = (e) => { if (e.target === $("#tocMask")) $("#tocMask").classList.add("hidden"); };

  // 点击热区：翻页模式下左翻/中呼出栏/右翻；滚动模式下中部呼出栏
  $("#readerScroll").addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest("a")) return;
    const sel = window.getSelection();
    if (sel && String(sel).length > 0) return;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    if (R.cfg.mode === "page") {
      if (x < 0.3) pagePrev();
      else if (x > 0.7) pageNext();
      else $("#readerLayer").classList.toggle("bars-hidden");
    } else if (y > 0.25 && y < 0.75) {
      $("#readerLayer").classList.toggle("bars-hidden");
    }
  });

  // 左右滑动手势翻页
  let tsx = 0, tsy = 0;
  $("#readerScroll").addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) { tsx = e.touches[0].clientX; tsy = e.touches[0].clientY; }
  }, { passive: true });
  $("#readerScroll").addEventListener("touchend", (e) => {
    if (R.cfg.mode !== "page" || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - tsx;
    const dy = e.changedTouches[0].clientY - tsy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) pageNext(); else pagePrev();
    }
  }, { passive: true });

  // 滚动时防抖自动保存精确阅读位置，向下大幅滚动自动收起工具栏沉浸阅读
  let saveTimer = null, lastSt = 0;
  $("#readerScroll").addEventListener("scroll", () => {
    if (R.cfg.mode === "page") return;
    const st = $("#readerScroll").scrollTop;
    if (st - lastSt > 45 && st > 120) $("#readerLayer").classList.add("bars-hidden");
    lastSt = st;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrentReaderScroll, 400);
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (!$("#readerLayer").classList.contains("hidden") && R.cfg.mode === "page") layoutReaderPages();
  });

  // 键盘方向键 / 空格快捷翻页
  window.addEventListener("keydown", (e) => {
    if ($("#readerLayer").classList.contains("hidden") || !$("#tocMask").classList.contains("hidden")) return;
    if (e.key === "ArrowLeft") pagePrev();
    else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); pageNext(); }
  });
})();

/* ============ 全局悬浮三模块切换器（可拖拽 + 全屏侧边收起） ============ */
const FAB_META = {
  vod: { icon: "film", label: "影视放映" },
  music: { icon: "music", label: "黑胶音乐" },
  novel: { icon: "book", label: "精品小说" },
};

function syncModeFab() {
  const fab = $("#modeFab");
  const btn = $("#fabBtn");
  const menu = $("#fabMenu");
  if (!fab || !btn || !menu) return;
  const inFsLayer = !$("#playerLayer").classList.contains("hidden") || !$("#readerLayer").classList.contains("hidden");
  fab.classList.toggle("edge-hidden", inFsLayer);
  if (inFsLayer) menu.classList.add("hidden");
  btn.innerHTML = ico(FAB_META[appMode]?.icon || "film");
  menu.querySelectorAll(".fab-item").forEach((el) => {
    const m = el.dataset.mode;
    el.innerHTML = `${ico(FAB_META[m].icon)}<span>${FAB_META[m].label}</span>`;
    el.classList.toggle("active", m === appMode);
  });
}

(() => {
  const fab = $("#modeFab");
  const btn = $("#fabBtn");
  const menu = $("#fabMenu");
  if (!fab || !btn || !menu) return;

  let sx = 0, sy = 0, moved = false, startBottom = 122;
  btn.addEventListener("pointerdown", (e) => {
    sx = e.clientX; sy = e.clientY; moved = false;
    startBottom = parseInt(fab.style.bottom || "122", 10) || 122;
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!e.buttons) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 8) { moved = true; menu.classList.add("hidden"); }
    if (!moved) return;
    const nextBottom = Math.max(74, Math.min(window.innerHeight - 120, startBottom - dy));
    fab.style.bottom = `${nextBottom}px`;
  });
  btn.addEventListener("pointerup", (e) => {
    if (moved) {
      const isLeft = e.clientX < window.innerWidth / 2;
      fab.classList.toggle("left", isLeft);
      fab.style.left = isLeft ? "14px" : "auto";
      fab.style.right = isLeft ? "auto" : "14px";
    } else {
      menu.classList.toggle("hidden");
    }
  });
  menu.querySelectorAll(".fab-item").forEach((el) => {
    el.onclick = () => {
      menu.classList.add("hidden");
      switchMode(el.dataset.mode);
    };
  });
  document.addEventListener("click", (e) => {
    if (!fab.contains(e.target)) menu.classList.add("hidden");
  });
})();

/* ============ 商业化会员鉴权 / 卡密兑换 / 云端同步 / 动态赞助位 ============ */
const NH = {
  token: get("nh_token", ""),
  user: get("nh_user", null),
  cfg: get("nh_site_cfg", { ad_enabled: false, ad_title: "", ad_desc: "", ad_url: "", ad_btn: "了解 Pro", sponsor_tip: "" }),
};
const isProUser = () => !!(NH.user && NH.user.is_pro);

async function nhApi(path, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (NH.token) headers["Authorization"] = "Bearer " + NH.token;
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
  return d;
}

async function loadSiteConfig() {
  try {
    const cfg = await nhApi("/api/config");
    NH.cfg = cfg;
    set("nh_site_cfg", cfg);
    if (currentRoute === "home" || currentRoute === "n_store") routes[currentRoute]();
  } catch {}
}

async function refreshAuthUser() {
  if (!NH.token) return;
  try {
    const d = await nhApi("/api/auth/me");
    NH.user = d.user || null;
    if (!NH.user) { NH.token = ""; set("nh_token", ""); }
    set("nh_user", NH.user);
    if (currentRoute === "me" || currentRoute === "home" || currentRoute === "n_store") routes[currentRoute]();
  } catch {}
}

function renderAdSlotHtml() {
  if (!NH.cfg || !NH.cfg.ad_enabled || isProUser()) return "";
  return `<div class="ad-card" data-ad-slot="1">
    <div class="ad-body">
      <div class="ad-head"><span class="ad-tag">赞助</span><span class="ad-title">${esc(NH.cfg.ad_title || "支持 NovaHub · 星隅")}</span></div>
      <div class="ad-desc">${esc(NH.cfg.ad_desc || "开通 Pro 会员享全局免广告与云端多端同步")}</div>
    </div>
    <button class="ad-cta" type="button">${esc(NH.cfg.ad_btn || "了解 Pro")}</button>
  </div>`;
}

function bindAdSlots(root) {
  if (!root) return;
  root.querySelectorAll("[data-ad-slot]").forEach((el) => {
    el.onclick = () => {
      if (NH.cfg.ad_url && NH.cfg.ad_url.startsWith("http")) window.open(NH.cfg.ad_url, "_blank", "noopener");
      else switchMode("vod", "me");
    };
  });
}

async function openAuthModal() {
  const ok = await modal("登录 / 注册 NovaHub 账号", `
    <div class="form" style="margin:0;border:none;padding:0">
      <label>账号（3~24 位字母或数字）</label><input id="authUser" placeholder="输入账号" autocomplete="username">
      <label>密码（6 位以上）</label><input id="authPwd" type="password" placeholder="输入密码" autocomplete="current-password">
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer">
        <input id="authIsReg" type="checkbox" style="width:auto"> <span>新账号注册（勾选则创建新账号）</span>
      </label>
    </div>`);
  if (!ok) return;
  const username = $("#authUser")?.value.trim();
  const password = $("#authPwd")?.value.trim();
  const isReg = !!$("#authIsReg")?.checked;
  if (!username || !password) return toast("请填写完整账号与密码");
  try {
    const d = await nhApi(isReg ? "/api/auth/register" : "/api/auth/login", "POST", { username, password });
    NH.token = d.token; NH.user = d.user;
    set("nh_token", d.token); set("nh_user", d.user);
    toast(isReg ? "注册并登录成功" : "登录成功");
    renderMe();
  } catch (e) {
    toast(e.message, 2400);
  }
}

async function openRedeemModal() {
  const ok = await modal("卡密兑换 NovaHub Pro", `
    <div class="form" style="margin:0;border:none;padding:0">
      <label>输入兑换卡密</label>
      <input id="redeemIn" placeholder="例如：NH-XXXX-XXXX-XXXX" style="text-transform:uppercase">
      <div class="hint">${esc(NH.cfg.sponsor_tip || "兑换成功后立即激活或叠加 Pro 会员有效期。")}</div>
    </div>`);
  if (!ok) return;
  const code = $("#redeemIn")?.value.trim();
  if (!code) return toast("请输入有效卡密");
  try {
    const d = await nhApi("/api/vip/redeem", "POST", { code });
    NH.user = d.user;
    set("nh_user", d.user);
    toast(`兑换成功！已增加 ${d.days} 天 Pro 权益`, 2600);
    renderMe();
  } catch (e) {
    toast(e.message, 2600);
  }
}

async function cloudSyncPush(silent = false) {
  if (!NH.user) { if (!silent) toast("请先登录账号"); return; }
  const keys = [K.SOURCE, K.LIKE, K.HISTORY, "channels", "music_fav", "music_fav_groups", "music_hist", "progress", "novel_shelf", "novel_hist", "novel_prog", "novel_cfg"];
  const data = Object.fromEntries(keys.map((k) => [k, get(k, null)]));
  try {
    await nhApi("/api/sync", "POST", { data });
    if (!silent) toast("全站片单、书架与进度已同步至云端");
  } catch (e) {
    if (!silent) toast("同步失败：" + e.message, 2400);
  }
}

async function cloudSyncPull(silent = false) {
  if (!NH.user) { if (!silent) toast("请先登录账号"); return; }
  try {
    const d = await nhApi("/api/sync", "GET");
    if (!d.sync || !d.sync.data) { if (!silent) toast("云端暂无历史备份"); return; }
    restore(d.sync.data);
    sources = get(K.SOURCE, DEFAULT_SOURCES);
    channels = get("channels", DEFAULT_CHANNELS);
    if (!silent) {
      toast("已从云端恢复全部片单、书架与阅读进度");
      renderMe();
    }
  } catch (e) {
    if (!silent) toast("恢复失败：" + e.message, 2400);
  }
}

/* ============ 音乐睡眠定时关闭 & 画中画悬浮歌词窗 ============ */
let mSleepMode = ""; // "" | "15" | "30" | "60" | "track"
let mSleepTimer = null;
let mSleepEndAt = 0;

function sleepLabel() {
  if (!mSleepMode) return "定时关闭";
  if (mSleepMode === "track") return "播完本曲";
  const left = Math.max(1, Math.ceil((mSleepEndAt - Date.now()) / 60000));
  return `${left}分后停`;
}
function clearSleepTimer() {
  clearTimeout(mSleepTimer);
  mSleepTimer = null; mSleepMode = ""; mSleepEndAt = 0;
  const b = $("#mSleepBtn"), t = $("#mSleepTxt");
  if (b) b.classList.remove("active");
  if (t) t.textContent = "定时关闭";
}
function cycleSleepTimer() {
  const order = ["", "15", "30", "60", "track"];
  const next = order[(order.indexOf(mSleepMode) + 1) % order.length];
  clearSleepTimer();
  mSleepMode = next;
  if (next === "15" || next === "30" || next === "60") {
    const mins = Number(next);
    mSleepEndAt = Date.now() + mins * 60000;
    mSleepTimer = setTimeout(() => {
      audioEl.pause();
      clearSleepTimer();
      toast("定时结束，已暂停播放");
    }, mins * 60000);
    toast(`已设定 ${mins} 分钟后停止播放`);
  } else if (next === "track") {
    toast("已设定播完当前曲目后停止");
  } else {
    toast("已关闭睡眠定时");
  }
  const b = $("#mSleepBtn"), t = $("#mSleepTxt");
  if (b) b.classList.toggle("active", !!mSleepMode);
  if (t) t.textContent = sleepLabel();
}

let pipActive = false, pipCanvas = null, pipCtx = null, pipVideo = null;
function drawPipLyrics() {
  if (!pipCtx || !pipCanvas) return;
  const w = pipCanvas.width, h = pipCanvas.height;
  pipCtx.fillStyle = "#0E1015";
  pipCtx.fillRect(0, 0, w, h);
  pipCtx.strokeStyle = "rgba(229,184,105,0.45)";
  pipCtx.lineWidth = 2;
  pipCtx.strokeRect(6, 6, w - 12, h - 12);

  const title = curSong ? `${curSong.name} · ${curSong.artist || ""}` : "NovaHub · 星隅";
  const curLine = activeLrcIdx >= 0 && curLyrics[activeLrcIdx] ? curLyrics[activeLrcIdx].text.replace(/\n/g, " ") : (curSong ? curSong.name : "暂无播放");
  const nextLine = activeLrcIdx >= 0 && curLyrics[activeLrcIdx + 1] ? curLyrics[activeLrcIdx + 1].text.replace(/\n/g, " ") : "";

  pipCtx.textAlign = "center";
  pipCtx.fillStyle = "#8C93A3";
  pipCtx.font = "500 18px sans-serif";
  pipCtx.fillText(title.slice(0, 32), w / 2, 42);

  pipCtx.fillStyle = "#E5B869";
  pipCtx.font = "700 26px sans-serif";
  pipCtx.fillText(curLine.slice(0, 26), w / 2, 102);

  if (nextLine) {
    pipCtx.fillStyle = "#B6BCC8";
    pipCtx.font = "400 18px sans-serif";
    pipCtx.fillText(nextLine.slice(0, 32), w / 2, 146);
  }
}

async function togglePipLyrics() {
  if (!("pictureInPictureEnabled" in document) || !document.pictureInPictureEnabled) {
    return toast("当前浏览器不支持画中画悬浮窗");
  }
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return;
    }
    if (!pipCanvas) {
      pipCanvas = document.createElement("canvas");
      pipCanvas.width = 640; pipCanvas.height = 180;
      pipCtx = pipCanvas.getContext("2d");
      pipVideo = document.createElement("video");
      pipVideo.muted = true; pipVideo.playsInline = true;
      pipVideo.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0";
      document.body.appendChild(pipVideo);
      pipVideo.addEventListener("enterpictureinpicture", () => { pipActive = true; $("#mPipBtn")?.classList.add("active"); });
      pipVideo.addEventListener("leavepictureinpicture", () => { pipActive = false; $("#mPipBtn")?.classList.remove("active"); });
    }
    drawPipLyrics();
    if (!pipVideo.srcObject) pipVideo.srcObject = pipCanvas.captureStream(5);
    await pipVideo.play();
    await pipVideo.requestPictureInPicture();
  } catch (e) {
    toast("悬浮窗开启失败：" + (e.message || "浏览器限制"), 2200);
  }
}

/* ============ 小说 Web Speech TTS 语音听书 ============ */
let ttsSpeaking = false;
let ttsToken = 0;

function stopNovelTts() {
  ttsToken++;
  ttsSpeaking = false;
  try { window.speechSynthesis?.cancel(); } catch {}
  const btn = $("#rTtsBtn");
  if (btn) {
    btn.classList.remove("speaking");
    btn.innerHTML = `${ico("volume")} 听书`;
  }
}

function toggleNovelTts() {
  if (!("speechSynthesis" in window)) return toast("当前浏览器不支持语音听书");
  if (ttsSpeaking) {
    stopNovelTts();
    toast("已停止语音听书");
    return;
  }
  const paras = [...document.querySelectorAll("#readerArticle p")].map((p) => p.textContent.trim()).filter(Boolean);
  if (!paras.length) return toast("当前章节暂无可朗读正文");

  ttsSpeaking = true;
  const myTok = ++ttsToken;
  const btn = $("#rTtsBtn");
  if (btn) {
    btn.classList.add("speaking");
    btn.innerHTML = `${ico("pause")} 停读`;
  }
  toast("开始语音听书，读完自动连播下一章");

  let idx = 0;
  const speakNext = () => {
    if (!ttsSpeaking || myTok !== ttsToken) return;
    if (idx >= paras.length) {
      if (R.index < R.chapters.length) {
        loadReaderChapter(R.index + 1, 0).then(() => {
          if (ttsSpeaking && myTok === ttsToken) {
            ttsSpeaking = false;
            setTimeout(toggleNovelTts, 350);
          }
        });
      } else {
        stopNovelTts();
        toast("全书朗读完毕");
      }
      return;
    }
    const u = new SpeechSynthesisUtterance(paras[idx++]);
    u.lang = "zh-CN";
    u.rate = 1.1;
    u.onend = () => { if (myTok === ttsToken && ttsSpeaking) speakNext(); };
    u.onerror = () => { if (myTok === ttsToken && ttsSpeaking) speakNext(); };
    window.speechSynthesis.speak(u);
  };
  try { window.speechSynthesis.cancel(); } catch {}
  speakNext();
}

/* ============ 初始化固定控件矢量图标与启动 ============ */
$("#topSearchIco").innerHTML = ico("search");
$("#playerBack").innerHTML = `${ico("back")} 返回`;
$("#playerFav").innerHTML = `${ico("heart")} 记录`;
$("#btnPlay").innerHTML = ico("play");
$("#btnFs").innerHTML = ico("fullscreen");
updateTopbar();
syncModeFab();
go(appMode === "music" ? "m_discover" : appMode === "novel" ? "n_store" : "home");
loadSiteConfig();
refreshAuthUser();
