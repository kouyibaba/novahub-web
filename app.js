/* ZY Player Web — 核心逻辑（Obsidian Cinema & Warm Amber 矢量设计版） */
"use strict";

const WEB_VERSION = "v2.5.5";

/* ============ 本地存储（复用 APK 存储键，本地解锁 VIP/God） ============ */
const K = {
  SOURCE: "source", VIDEO: "video", LIKE: "like", HISTORY: "history",
  WEBDAV: "webdav", MODE: "mode", THEME: "theme", LAYOUT: "layout",
  VIP: "vip", VIP_SUPER: "vipSuper", GOD_IS: "isGod", GOD_NAME: "godName",
};
const _mem = {};
const get = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? (k in _mem ? _mem[k] : d) : JSON.parse(v); } catch { return k in _mem ? _mem[k] : d; } };
const NH = {
  token: get("nh_token", ""),
  user: get("nh_user", null),
  offline: false,
  cfg: get("nh_site_cfg", { ad_enabled: false, ad_title: "", ad_desc: "", ad_url: "", ad_btn: "了解 Pro", sponsor_tip: "" }),
};
const isProUser = () => !!(NH.user && NH.user.is_pro);
const isAppClient = () => !!(window.NovaNative && typeof window.NovaNative.getAppVersion === "function");
const getDeviceId = () => {
  try {
    if (typeof window !== "undefined" && window.NovaNative && typeof window.NovaNative.getDeviceFingerprint === "function") {
      const fp = String(window.NovaNative.getDeviceFingerprint() || "").trim();
      if (fp) {
        try { localStorage.setItem("nh_device_id", JSON.stringify(fp)); } catch {}
        return fp;
      }
    }
  } catch {}
  let id = get("nh_device_id", "");
  if (!id) {
    id = "d_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem("nh_device_id", JSON.stringify(id)); } catch {}
  }
  return id;
};
const getDeviceInfo = () => {
  if (isAppClient()) {
    try { return "Android App " + (window.NovaNative.getAppVersion() || ""); } catch { return "Android App"; }
  }
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "Android Browser";
  if (/iPhone|iPad/i.test(ua)) return "iOS Browser";
  if (/Windows/i.test(ua)) return "Windows Browser";
  if (/Mac/i.test(ua)) return "macOS Browser";
  return "Web Browser";
};
// Media API requests need the same account token as nhApi, including Pages routing.
const _mediaFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  if (NH.token && typeof input === "string") {
    const target = new URL(input, location.href);
    const apiOrigin = window.__NH_API_BASE__ ? new URL(window.__NH_API_BASE__).origin : location.origin;
    if ((target.origin === location.origin || target.origin === apiOrigin) &&
        (target.pathname === "/kw" || target.pathname.startsWith("/api/live/") || target.pathname.startsWith("/api/media/") ||
         target.pathname.startsWith("/api/vod/") || target.pathname.startsWith("/api/novel/") || target.pathname.startsWith("/api/notifications"))) {
      const headers = new Headers(init.headers || {});
      if (!headers.has("Authorization")) headers.set("Authorization", "Bearer " + NH.token);
      init = { ...init, headers };
    }
  }
  return _mediaFetch(input, init);
};
const SYNC_KEYS = [
  K.LIKE, K.HISTORY, "history_deleted", "history_cleared_at", "channels", "music_favs", "music_fav_groups",
  "music_hist", "m_br", "progress", "skip_cfg", "novel_shelf", "novel_hist", "novel_prog",
  "novel_cfg", "nh_shist_vod", "nh_shist_music", "nh_shist_novel",
];
const SYNC_WATCH = new Set(SYNC_KEYS);
let _syncPushTimer = null;
let _isRestoring = false;
let _syncDirty = false;
let _bootReady = false;
const set = (k, v) => {
  _mem[k] = v;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  if (_bootReady && !_isRestoring && SYNC_WATCH.has(k) && typeof cloudSyncPush === "function" && NH.user) {
    _syncDirty = true;
    clearTimeout(_syncPushTimer);
    _syncPushTimer = setTimeout(() => cloudSyncPush(true), 2000);
  }
};

// Legacy local privilege flags are no longer read or written; server membership is authoritative.
const authSession = NovaSession.create(NH, {
  write: set,
  request: async (token) => {
    const response = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Session unavailable'), { status: response.status });
    return data;
  },
});
window.__nhNativeSessionReady = (saved, persist) => {
  const restored = authSession.nativeReady(saved, persist);
  if (restored) {
    if (routes[currentRoute]) routes[currentRoute]();
    refreshAuthUser();
  }
};

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
  sun: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2.5 12H5M19 12h2.5M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>`,
  bell: `<svg class="svg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
};
const ico = (name) => IC[name] || "";
window._imgPh = (el, iconName, cls) => {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = ico(iconName);
  el.replaceWith(d);
};

/* ============ 内置默认源（MacCMS 格式，20 个内置源） ============ */
// Retained only for authenticated private-source migration; browsing uses managed APIs.
let sources = get(K.SOURCE, []);
const vodClient = NovaVod.create(q => nhApi('/api/vod/search?q=' + encodeURIComponent(q)));
let viewRequest = 0;
const historyBlocked = new Set();
function historyState() {
  return Object.fromEntries(['history','progress','history_deleted','history_cleared_at'].map(k=>[k,get(k,k==='history'?[]:k==='history_cleared_at'?0:{})]));
}
function applyHistoryState(state) {
  for (const k of ['history','progress','history_deleted','history_cleared_at']) set(k,state[k]);
}
async function migrateLegacySources(extra) {
  if (!NH.user) return;
  const legacy = Array.isArray(extra) ? extra : sources;
  if (Array.isArray(legacy) && legacy.length) await nhApi('/api/vod/migrate','POST',{sources:legacy.slice(0,100)});
}

/* ============ 工具 ============ */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function resolveApiMediaUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("/api/")) return ((typeof window !== "undefined" && window.__NH_API_BASE__) || "") + s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}
function syncOverlayHost(el) {
  if (!el) return;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  const targetParent = (fsEl && fsEl.appendChild) ? fsEl : document.body;
  if (targetParent && el.parentElement !== targetParent) {
    try { targetParent.appendChild(el); } catch {}
  }
}
function toast(msg, ms = 1600) {
  const t = $("#toast");
  syncOverlayHost(t);
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}
function modal(title, bodyHtml) {
  return new Promise((resolve) => {
    const m = $("#modal");
    syncOverlayHost(m);
    if (typeof _fsUiTimer !== "undefined" && _fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
    const okBtn = $("#modalOk");
    const cancelBtn = $("#modalCancel");
    if (okBtn) okBtn.textContent = "确定";
    if (cancelBtn) {
      cancelBtn.textContent = "取消";
      cancelBtn.style.display = "";
    }
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = bodyHtml;
    m.classList.remove("hidden");
    const resetBtns = () => {
      if (okBtn) { okBtn.textContent = "确定"; okBtn.onclick = null; }
      if (cancelBtn) { cancelBtn.textContent = "取消"; cancelBtn.style.display = ""; cancelBtn.onclick = null; }
    };
    const ok = () => { m.classList.add("hidden"); resetBtns(); resolve(true); };
    const cancel = () => { m.classList.add("hidden"); resetBtns(); resolve(false); };
    if (okBtn) okBtn.onclick = ok;
    if (cancelBtn) cancelBtn.onclick = cancel;
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
async function fetchJson(url, timeout = 12000) {
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
  document.body.classList.add("detail-view");
  history.pushState({ depth: viewStack.length }, "");
}
let _playerPushed = false;
let _skipNextPop = false;
function closePlayer(fromPop = false) {
  if (typeof P !== "undefined" && P.vodKey && !P.isLive) {
    const v = $("#video");
    if (v && v.currentTime > 1) saveProgress(P.vodKey, P.idx, v.currentTime, true);
  }
  if (typeof castState !== "undefined" && castState.active && typeof stopActiveCast === "function") {
    stopActiveCast(true);
  }
  if (typeof openFsEpDrawer === "function") openFsEpDrawer(false);
  if (typeof setPlayerFullscreen === "function") setPlayerFullscreen(false);
  destroyPlayers();
  $("#playerLayer").classList.add("hidden");
  document.body.style.overflow = "";
  syncModeFab();
  if (_playerPushed) {
    _playerPushed = false;
    if (!fromPop) {
      _skipNextPop = true;
      history.back();
    }
  }
  if (typeof flushPendingAdminPopup === "function") setTimeout(flushPendingAdminPopup, 260);
}
function closeReader() {
  stopNovelTts();
  saveCurrentReaderScroll();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("#tocMask").classList.add("hidden");
  $("#readerLayer").classList.add("hidden");
  document.body.style.overflow = "";
  syncModeFab();
  if (typeof flushPendingAdminPopup === "function") setTimeout(flushPendingAdminPopup, 260);
}
function goBack(fromPop = false) {
  if (typeof cancelActiveSearch === "function") cancelActiveSearch(true);
  else if (typeof vodClient !== "undefined") { vodClient.cancel(); viewRequest++; }
  if (!$("#tocMask").classList.contains("hidden")) { $("#tocMask").classList.add("hidden"); return; }
  if (!$("#readerLayer").classList.contains("hidden")) { closeReader(); return; }
  if (!$("#playerLayer").classList.contains("hidden")) { closePlayer(fromPop); return; }
  if (viewStack.length > 0) {
    viewStack.pop();
    document.body.classList.toggle("detail-view", viewStack.length > 0);
    const prev = viewStack[viewStack.length - 1];
    if (prev) prev();
    else routes[currentRoute]();
    window.scrollTo(0, 0);
  } else {
    routes[currentRoute]();
  }
}
let _appBackPending = false;
let _appBackTimer;
function requestAppBack() {
  if (_appBackPending) return true;
  const visible = (selector) => {
    const element = $(selector);
    return element && !element.classList.contains("hidden");
  };
  if (visible("#modal")) { $("#modalCancel").click(); return true; }
  if (visible("#fsEpDrawer")) { openFsEpDrawer(false); return true; }
  if (visible("#tocMask")) { $("#tocMask").classList.add("hidden"); return true; }
  if (visible("#searchHistPop")) { hideSearchHistPop(); return true; }
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return true; }
  if ($("#playerLayer")?.classList.contains("is-fs")) { setPlayerFullscreen(false); return true; }
  const reader = visible("#readerLayer");
  const player = visible("#playerLayer");
  if (!reader && !player && !viewStack.length) return false;
  const entry = history.state || {};
  const ownsEntry = reader ? entry.reader : player ? entry.player : entry.depth === viewStack.length;
  if (ownsEntry) {
    _appBackPending = true;
    clearTimeout(_appBackTimer);
    _appBackTimer = setTimeout(() => { _appBackPending = false; }, 1500);
    history.back();
  } else {
    goBack(true);
  }
  return true;
}
window.__nhHandleBack = requestAppBack;
window.addEventListener("popstate", () => {
  _appBackPending = false;
  clearTimeout(_appBackTimer);
  if (_skipNextPop) { _skipNextPop = false; return; }
  goBack(true);
});
const backBar = (title) => `<header class="back-bar"><button class="nav-back" type="button" aria-label="返回上一页" onclick="requestAppBack()">${ico("back")}</button><h1 class="back-bar-title">${esc(title)}</h1><span aria-hidden="true"></span></header>`;

function renderTabbar() {
  const tb = $("#tabbar");
  const tabs = appMode === "music"
    ? [
        { route: "m_discover", icon: "disc", text: "曲库" },
        { route: "m_player", icon: "headphones", text: "播放器" },
        { route: "m_fav", icon: "heart", activeIcon: "heartFill", text: "收藏" },
        { route: "me", icon: "user", text: "我的" },
      ]
    : appMode === "novel"
    ? [
        { route: "n_store", icon: "book", text: "书城" },
        { route: "n_shelf", icon: "bookmark", activeIcon: "bookmarkFill", text: "书架" },
        { route: "me", icon: "user", text: "我的" },
      ]
    : [
        { route: "home", icon: "film", text: "影视" },
        { route: "live", icon: "tv", text: "电视" },
        { route: "me", icon: "user", text: "我的" },
      ];
  let pills = $("#nhModePills");
  if (!pills && $(".topbar")) {
    pills = document.createElement("div");
    pills.id = "nhModePills";
    pills.className = "mode-pills";
    pills.innerHTML = `<span class="mode-pill-slider" aria-hidden="true"></span>` + [
      { m: "vod", label: "影视" },
      { m: "music", label: "音乐" },
      { m: "novel", label: "小说" },
    ].map((x) => `<button class="mode-pill" data-m="${x.m}">${x.label}</button>`).join("");
    pills.querySelectorAll(".mode-pill").forEach((b) => {
      b.onclick = () => switchMode(b.dataset.m);
    });
    const anchor = $("#searchHistPop") || $(".topbar");
    anchor.insertAdjacentElement("afterend", pills);
  }
  if (pills) {
    const order = ["vod", "music", "novel"];
    const idx = Math.max(0, order.indexOf(appMode));
    pills.querySelectorAll(".mode-pill").forEach((b) => b.classList.toggle("active", b.dataset.m === appMode));
    const slider = pills.querySelector(".mode-pill-slider");
    if (slider) slider.style.transform = `translateX(calc(${idx} * (100% + 6px)))`;
  }
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
  if (typeof cancelActiveSearch === "function") cancelActiveSearch(true);
  appMode = mode;
  set(K.MODE, mode);
  updateTopbar();
  syncModeFab();
  const defRoute = mode === "music" ? "m_discover" : mode === "novel" ? "n_store" : "home";
  go(targetRoute || defRoute);
}

const HOME_SWIPE_ORDER = ["vod", "music", "novel"];
function resolveHomeSwipeMode(curMode, dx, dy, dt) {
  if (dt > 750 || Math.abs(dx) < 64 || Math.abs(dx) <= Math.abs(dy) * 1.6) return "";
  const idx = HOME_SWIPE_ORDER.indexOf(curMode);
  if (idx < 0) return "";
  const nextIdx = dx < 0 ? idx + 1 : idx - 1;
  if (nextIdx < 0 || nextIdx >= HOME_SWIPE_ORDER.length) return "";
  return HOME_SWIPE_ORDER[nextIdx];
}

function bindHomeSwipeNavigation() {
  if (bindHomeSwipeNavigation._bound) return;
  bindHomeSwipeNavigation._bound = true;
  let active = false, sx = 0, sy = 0, st = 0;
  const isHidden = (sel) => {
    const el = $(sel);
    return !el || el.classList.contains("hidden");
  };
  const isOnModuleHome = () => {
    if (viewStack.length > 0) return false;
    const okRoute = (appMode === "vod" && currentRoute === "home")
      || (appMode === "music" && currentRoute === "m_discover")
      || (appMode === "novel" && currentRoute === "n_store");
    if (!okRoute) return false;
    return isHidden("#playerLayer") && isHidden("#readerLayer") && isHidden("#modal")
      && isHidden("#accessGateLayer") && isHidden("#searchHistPop") && isHidden("#tocMask");
  };
  const hasHScrollParent = (target) => {
    let el = target && target.nodeType === 1 ? target : target?.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      if (el.scrollWidth > el.clientWidth + 4) {
        const ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      el = el.parentElement;
    }
    return false;
  };
  document.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1 || !isOnModuleHome()) { active = false; return; }
    const t = e.touches[0];
    const vw = window.innerWidth || document.documentElement.clientWidth || 360;
    if (t.clientX < 28 || t.clientX > vw - 28) { active = false; return; }
    const target = e.target;
    if (target && target.closest && target.closest("input, textarea, select, [contenteditable]")) { active = false; return; }
    if (hasHScrollParent(target)) { active = false; return; }
    active = true;
    sx = t.clientX;
    sy = t.clientY;
    st = Date.now();
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (active && (!e.touches || e.touches.length !== 1)) active = false;
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    if (!isOnModuleHome() || !e.changedTouches || !e.changedTouches.length) return;
    const t = e.changedTouches[0];
    const nextMode = resolveHomeSwipeMode(appMode, t.clientX - sx, t.clientY - sy, Date.now() - st);
    if (nextMode && nextMode !== appMode) switchMode(nextMode);
  }, { passive: true });
  document.addEventListener("touchcancel", () => { active = false; }, { passive: true });
}

let _bootDone = false;
function go(route) {
  const applyRoute = () => {
    if (typeof cancelActiveSearch === "function") cancelActiveSearch(true);
    else { vodClient.cancel(); viewRequest++; }
    currentRoute = route;
    viewStack.length = 0;
    document.body.classList.remove("detail-view");
    const isMp = route === "m_player" && !!curSong;
    const vEl = $("#view");
    if (vEl) vEl.classList.toggle("view-mplayer", isMp);
    document.body.classList.toggle("in-mplayer", isMp);
    renderTabbar();
    (routes[route] || renderHome)();
    updateMiniBar();
    window.scrollTo(0, 0);
  };
  if (_bootDone && typeof document.startViewTransition === "function") {
    const t = document.startViewTransition(applyRoute);
    t.finished.finally(() => {
      const v = $("#view");
      if (v) { v.setAttribute("tabindex", "-1"); v.focus({ preventScroll: true }); }
    });
  } else {
    applyRoute();
  }
}

/* ============ 搜索动效、分模块历史与阶梯交错辅助 ============ */
const _searchHistKey = () => "nh_shist_" + appMode;
const getSearchHist = () => get(_searchHistKey(), []);
function addSearchHist(q) {
  if (!q) return;
  const list = [q, ...getSearchHist().filter((x) => x !== q)].slice(0, 8);
  set(_searchHistKey(), list);
}
function hideSearchHistPop() {
  const pop = $("#searchHistPop");
  if (pop) pop.classList.add("hidden");
}
function renderSearchHistPop() {
  const pop = $("#searchHistPop");
  if (!pop) return;
  const list = getSearchHist();
  if (!list.length) { pop.classList.add("hidden"); return; }
  pop.innerHTML = `
    <div class="sh-head"><span>最近搜索</span><button class="sh-clear" id="shClearAll" type="button">清空历史</button></div>
    <div class="sh-chips">${list.map((w) => `<button class="sh-chip" type="button" data-kw="${esc(w)}">${esc(w)}</button>`).join("")}</div>`;
  pop.classList.remove("hidden");
  pop.querySelector("#shClearAll").onclick = (e) => { e.stopPropagation(); set(_searchHistKey(), []); hideSearchHistPop(); };
  pop.querySelectorAll(".sh-chip").forEach((c) => {
    c.onclick = (e) => {
      e.stopPropagation();
      $("#searchInput").value = c.dataset.kw;
      syncSearchClear();
      triggerSearch();
    };
  });
}
function syncSearchClear() {
  const inp = $("#searchInput"), clr = $("#searchClear");
  if (inp && clr) clr.classList.toggle("hidden", !inp.value.trim());
}
let _searchAbort = null;
let _searchLoading = false;
function setSearchLoading(on) {
  _searchLoading = !!on;
  const bar = $("#topProgress"), btn = $("#searchBtn");
  if (bar) bar.classList.toggle("hidden", !on);
  if (btn) {
    btn.disabled = false;
    btn.classList.toggle("is-cancel", !!on);
    btn.setAttribute("aria-label", on ? "取消搜索" : "搜索");
    btn.textContent = on ? "取消" : "搜索";
  }
}
function cancelActiveSearch(silent = false) {
  const hadActive = _searchLoading || !!_searchAbort;
  if (_searchAbort) {
    try { _searchAbort.abort(); } catch {}
    _searchAbort = null;
  }
  if (typeof vodClient !== "undefined" && typeof vodClient.cancel === "function") {
    vodClient.cancel();
  }
  if (typeof viewRequest !== "undefined") viewRequest++;
  setSearchLoading(false);
  if (!silent && hadActive && typeof toast === "function") toast("已取消搜索");
}
function cancelSearchAndLeave() {
  cancelActiveSearch(false);
  if (viewStack.length > 0) {
    goBack();
  } else if (typeof routes[currentRoute] === "function") {
    routes[currentRoute]();
  }
}
function renderSearchLoadingHtml(q, sub = "正在匹配多路资源，请稍候…") {
  return `<div class="search-loading-box" role="status" aria-live="polite">
    <div class="nh-spinner-lg" aria-hidden="true"></div>
    <div class="search-loading-title">正在搜索「${esc(q)}」</div>
    <div class="search-loading-sub">${esc(sub)}</div>
    <button type="button" class="btn ghost" data-cancel-search="1" style="margin-top:12px;padding:6px 18px;font-size:12.5px">取消搜索</button>
  </div>`;
}
function renderSkeletonHtml(type = "grid", count = 6, bare = false) {
  if (type === "list") {
    return `<div class="sk-list">${Array.from({ length: count }, () => `<div class="sk-row"></div>`).join("")}</div>`;
  }
  const cards = Array.from({ length: count }, () => `<div class="sk-card"><div class="sk-poster"></div><div class="sk-line"></div><div class="sk-line short"></div></div>`).join("");
  return bare ? cards : `<div class="sk-grid">${cards}</div>`;
}
function applyStagger(container) {
  if (!container) return;
  container.classList.add("nh-stagger");
  if (!CSS.supports("animation-delay: calc(sibling-index() * 0.1s)")) {
    [...container.children].slice(0, 12).forEach((el, idx) => el.style.setProperty("--sibling-index", idx));
  }
}

/* ============ 影视 & 音乐 & 小说统一搜索入口 ============ */
const triggerSearch = () => {
  const q = $("#searchInput").value.trim();
  $("#searchInput").blur();
  hideSearchHistPop();
  if (q) addSearchHist(q);
  if (appMode === "music") {
    if (q) searchMusic(q); else go("m_discover");
  } else if (appMode === "novel") {
    if (q) searchNovel(q); else go("n_store");
  } else {
    if (q) doSearch(q); else go("home");
  }
};
$("#searchBtn").addEventListener("click", () => {
  if (_searchLoading) { cancelSearchAndLeave(); return; }
  triggerSearch();
});
document.addEventListener("click", (e) => {
  if (e.target && e.target.closest && e.target.closest("[data-cancel-search]")) {
    cancelSearchAndLeave();
  }
});
$("#searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); triggerSearch(); }
});
$("#searchInput").addEventListener("input", syncSearchClear);
$("#searchInput").addEventListener("focus", renderSearchHistPop);
if ($("#searchClear")) {
  $("#searchClear").addEventListener("click", () => {
    $("#searchInput").value = "";
    syncSearchClear();
    $("#searchInput").focus();
    renderSearchHistPop();
  });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-box") && !e.target.closest("#searchHistPop")) hideSearchHistPop();
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
let mSearchQuery = "";
let mSearchView = "track"; // "track" | "album"（搜索默认直接呈现在列表中的单曲）
let mSrcFilter = "all"; // "all" | "kuwo" | "netease"
let mPlayToken = 0;
let mSwitching = false;
const DEFAULT_HOT_ARTISTS = ["周杰伦", "林俊杰", "陈奕迅", "G.E.M.邓紫棋", "薛之谦", "毛不易", "陶喆", "王菲"];

const audioEl = new Audio();
audioEl.preload = "auto";
audioEl.style.display = "none";
if (document.body) document.body.appendChild(audioEl);
const songKey = (s) => (s ? `${s.source || "netease"}:${s.id || s.name}` : "");
const getMusicFavs = () => get("music_favs", []);
const isMusicFav = (song) => !!song && getMusicFavs().some((x) => songKey(x) === songKey(song));
function toggleMusicFav(song) {
  if (!song) return;
  let favs = getMusicFavs();
  const key = songKey(song);
  const idx = favs.findIndex((x) => songKey(x) === key);
  if (idx >= 0) {
    favs.splice(idx, 1);
    set("music_favs", favs);
    toast("已取消收藏");
    if (currentRoute.startsWith("m_")) routes[currentRoute]();
    return;
  }
  const defGrp = (typeof curMusicFavGroup !== "undefined" && curMusicFavGroup !== "全部") ? curMusicFavGroup : "我喜欢的音乐";
  const groups = (typeof getMusicFavGroups === "function" ? getMusicFavGroups() : ["我喜欢的音乐"]).filter((g) => g !== "全部");
  nhPrompt("收藏到歌单分组", defGrp, (grp) => {
    const g = grp === "全部" ? "我喜欢的音乐" : grp;
    const custom = get("music_fav_groups", []);
    if (!custom.includes(g) && g !== "我喜欢的音乐") { custom.push(g); set("music_fav_groups", custom); }
    favs.unshift({ ...song, url: song.url || "", group: g });
    set("music_favs", favs);
    toast(`已收藏到「${g}」`);
    if (currentRoute.startsWith("m_")) routes[currentRoute]();
  }, groups);
  return;
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
  const ql = String(q || "").toLowerCase();
  const fakeRe = /原唱|翻唱|伴奏|纯音乐|八音盒|铃声|童声|儿歌|DJ|慢摇|remix|cover|instrumental|karaoke|3d环绕|吉他版|钢琴版|古筝|二胡|萨克斯|唢呐|戏腔|朗诵|变调/i;
  return fakeRe.test(String(name || "")) && !fakeRe.test(ql);
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
  cancelActiveSearch(true);
  const mine = ++viewRequest;
  const ac = new AbortController();
  _searchAbort = ac;
  setSearchLoading(true);
  const view = $("#view");
  if (view) view.innerHTML = `<div class="section-title">${ico("search")} 搜索：${esc(q)}</div>${renderSearchLoadingHtml(q, "正在检索曲库与歌单…")}`;
  const kwList = [], neList = [];
  const normTrackKey = (nm, ar) => {
    const c = (s) => String(s || "").toLowerCase().replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*（[^）]*）|[^\u4e00-\u9fa5a-z0-9]/g, "");
    return c(nm) + "|" + c(ar);
  };
  try {
    // 优先检索高可播率酷我曲库，并清理歌手转义分隔符
    const kwRes = await fetch(`/kw?act=search&q=${encodeURIComponent(q)}&rn=45`, { signal: ac.signal })
      .then((r) => r.ok ? r.json() : []).catch(() => []);
    if (mine !== viewRequest || ac.signal.aborted) return;
    if (Array.isArray(kwRes)) {
      kwRes.forEach((x) => {
        const nm = String(x.name || "").replace(/\u00a0/g, " ").trim();
        if (!nm || isFakeCoverTrack(nm, q)) return;
        kwList.push({
          ...x,
          name: nm,
          artist: String(x.artist || "未知歌手").replace(/\\u0026|&/g, " / ").replace(/\u00a0/g, " ").trim(),
          album: String(x.album || "单曲收录").replace(/\u00a0/g, " ").trim() || "单曲收录",
        });
      });
    }
    // 仅当酷我有效结果不足 5 首时才回退补充网易云曲库，减少不可播杂曲
    if (kwList.length < 5) {
      const neRes = await fetch(`https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(q)}&count=30&pages=1`, { signal: ac.signal })
        .then((r) => r.ok ? r.json() : []).catch(() => []);
      if (mine !== viewRequest || ac.signal.aborted) return;
      if (Array.isArray(neRes)) {
        neRes.forEach((x) => {
          const nm = String(x.name || "").trim() || "未知歌曲";
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
      }
    }
  } finally {
    if (_searchAbort === ac) _searchAbort = null;
    if (mine === viewRequest) setSearchLoading(false);
  }
  if (mine !== viewRequest || ac.signal.aborted) return;
  const seen = new Set();
  const merged = [];
  kwList.concat(neList).forEach((item) => {
    const k = normTrackKey(item.name, item.artist);
    if (seen.has(k)) return;
    seen.add(k);
    merged.push(item);
  });
  const list = sortByExactMatch(merged, q, (x) => x.name, (x) => x.artist);
  if (list.length) {
    discoverList = list;
    musicQueue = list;
    mIsSearch = true;
    mSearchQuery = q;
    mSearchView = "track";
    mSrcFilter = "all";
    set("music_queue", discoverList);
    curSongIdx = -1;
    if (appMode !== "music") switchMode("music", "m_discover");
    else go("m_discover");
    return;
  }
  if ($("#view")) $("#view").innerHTML = `<div class="empty">未找到「${esc(q)}」相关曲目<br>请尝试更换歌名或歌手关键词</div>`;
  toast("未找到匹配的曲目");
}

const M_BR_OPTS = [
  { v: "128", label: "标准 128k" },
  { v: "192", label: "高品 192k" },
  { v: "320", label: "极高 320k" },
  { v: "999", label: "无损 FLAC" },
];
let mBr = get("m_br", "192");
if (!isProUser() && !["128", "192"].includes(mBr)) mBr = "192";
const brSelectHtml = () => `<select id="mBrSel" class="ui-select">${M_BR_OPTS.map((o) => `<option value="${o.v}" ${mBr === o.v ? "selected" : ""}>${o.label}</option>`).join("")}</select>`;
async function changeBr(newBr) {
  if ((newBr === "320" || newBr === "999") && !NH.user?.is_pro) {
    toast("320k / FLAC 音质需 Pro 权益，能否提供以曲源实际支持为准");
    return;
  }
  mBr = newBr;
  set("m_br", mBr);
  toast("已切换音质：" + (M_BR_OPTS.find((o) => o.v === mBr)?.label || mBr));
  if (curSong) {
    const token = ++mPlayToken;
    const pos = audioEl.currentTime || 0;
    const wasPlaying = !audioEl.paused;
    curSong._tried128 = false;
    const playUrl = ensureHttpsAudio(await resolveSongUrl(curSong));
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

/** 确保在 HTTPS 页面及 App 内核中音频直链升级为 HTTPS，防止混合内容拦截 */
function ensureHttpsAudio(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (location.protocol === "https:" && s.startsWith("http://")) return "https://" + s.slice(7);
  return s;
}

function isSameSongMeta(target, cand, loose = false) {
  const norm = (s) => String(s || "").toLowerCase().replace(/\s*\([^)]*\)|\s*\[[^\]]*\]|\s*（[^）]*）|[^\u4e00-\u9fa5a-z0-9]/g, "");
  const tn = norm(target.name), cn = norm(cand.name);
  if (!tn || !cn) return false;
  if (loose ? !(cn.includes(tn) || tn.includes(cn)) : tn !== cn) return false;
  const ta = String(target.artist || "").split(/[\/,&、\s]+/).map(norm).filter(Boolean);
  const ca = norm(cand.artist);
  return !ta.length || ta.some((a) => ca.includes(a));
}

/** 优先精确、其次宽松匹配酷我曲库，必要时回退仅按歌名再查一次 */
async function matchExactKuwo(song, brOverride = null) {
  const br = brOverride || mBr;
  const queries = [String(song.name || "") + (song.artist ? " " + song.artist : "")];
  if (song.artist) queries.push(String(song.name || ""));
  for (const qStr of queries) {
    if (!qStr.trim()) continue;
    try {
      const r = await fetch(`/kw?act=search&q=${encodeURIComponent(qStr.trim())}&rn=10`);
      if (!r.ok) continue;
      const list = await r.json();
      const valid = (list || []).filter((c) => !isFakeCoverTrack(c.name, song.name));
      const hit = valid.find((c) => isSameSongMeta(song, c, false)) || valid.find((c) => isSameSongMeta(song, c, true));
      if (!hit) continue;
      const uRes = await fetch(`/kw?act=url&id=${encodeURIComponent(hit.id)}&br=${encodeURIComponent(br)}`);
      const uJson = uRes.ok ? await uRes.json() : null;
      const safeUrl = ensureHttpsAudio(uJson?.url);
      if (safeUrl) {
        song._kwRid = hit.id;
        if (!song.pic && hit.pic) song.pic = hit.pic;
        return safeUrl;
      }
    } catch {}
  }
  return null;
}

async function resolveSongUrl(song, brOverride = null) {
  const selectedBr = brOverride || mBr;
  const br = !isProUser() && !["128", "192"].includes(selectedBr) ? "192" : selectedBr;
  if (song.source === "kuwo" && song.id) {
    try {
      const r = await fetch(`/kw?act=url&id=${encodeURIComponent(song.id)}&br=${encodeURIComponent(br)}`);
      const d = r.ok ? await r.json() : null;
      const u = ensureHttpsAudio(d?.url);
      if (u) return u;
    } catch {}
    return "";
  }
  // 榜单与老收藏曲目优先直连酷我高可用 HTTPS 曲库，大幅降低超时与受限率
  const kwUrl = await matchExactKuwo(song, br);
  if (kwUrl) return kwUrl;
  if (song.source === "tencent") return "";
  if (song.id) {
    try {
      const r = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=${song.id}&br=${br}`, 3500);
      const u = ensureHttpsAudio(r?.url);
      if (u && !u.includes("null")) return u;
    } catch {}
  }
  return ensureHttpsAudio(song.url);
}

async function loadSongLyrics(song, token) {
  curLyrics = []; activeLrcIdx = -1;
  const targets = [];
  const songName = String(song.name || "").trim();
  const songArtist = String(song.artist || "").trim();
  if (song.source === "kuwo" || song._kwRid) {
    const rid = song._kwRid || song.id;
    targets.push(async () => {
      const r = await fetch(`/kw?act=lrc&id=${encodeURIComponent(rid)}&name=${encodeURIComponent(songName)}&artist=${encodeURIComponent(songArtist)}`);
      const d = r.ok ? await r.json() : null;
      return d?.lrc || "";
    });
  }
  if (song.lrc) targets.push(() => fetchText(song.lrc, 5000));
  if (song.id && song.source !== "kuwo" && song.source !== "tencent") {
    targets.push(async () => {
      const d = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=${encodeURIComponent(song.id)}`, 5000);
      return d?.lyric || "";
    });
  }
  // 全曲源统一兜底：按歌名+歌手检索 gdstudio（网易云）标准 LRC，覆盖酷我/收藏旧曲目
  if (songName) {
    targets.push(async () => {
      const kw = `${songName} ${songArtist}`.trim();
      const list = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=search&source=netease&name=${encodeURIComponent(kw)}&count=5&pages=1`, 5000);
      if (!Array.isArray(list) || !list.length) return "";
      const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
      const wn = norm(songName), wa = norm(songArtist);
      const hit = list.find((it) => {
        const iname = norm(it?.name);
        const iart = norm(Array.isArray(it?.artist) ? it.artist.join("/") : it?.artist);
        return wn && iname === wn && (!wa || iart.includes(wa) || wa.includes(iart));
      }) || list[0];
      if (!hit?.id) return "";
      const ld = await fetchJson(`https://music-api.gdstudio.xyz/api.php?types=lyric&source=netease&id=${encodeURIComponent(hit.id)}`, 5000);
      return ld?.lyric || ld?.tlyric || "";
    });
  }
  if (song.source === "kuwo" || song._kwRid) {
    targets.push(async () => {
      const s = await fetchJson(`https://api.vkeys.cn/v2/music/tencent?word=${encodeURIComponent((songName + " " + songArtist).trim())}&choose=1`, 3500);
      const tid = s?.data?.id;
      if (!tid) return "";
      const ld = await fetchJson(`https://api.vkeys.cn/v2/music/tencent/lyric?id=${tid}`, 3500);
      return ld?.data?.lrc || "";
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
          const t = audioEl.currentTime || 0;
          let ni = -1;
          for (let i = 0; i < curLyrics.length; i++) {
            if (t >= curLyrics[i].t) ni = i; else break;
          }
          activeLrcIdx = ni;
          updateMiniBar();
          syncMediaSessionTitle();
          syncMediaSessionState();
          if (currentRoute === "m_player") renderLyricsBox();
        }
        return;
      }
    } catch {}
  }
  if (token === mPlayToken && currentRoute === "m_player") renderLyricsBox();
}

/** 播放视频时强制停止音乐与听书播报，避免声音重叠 */
function stopMusicForVideo() {
  mPlayToken++;
  mSwitching = true;
  try { audioEl.pause(); } catch {}
  mSwitching = false;
  if (typeof stopNovelTts === "function") {
    try { stopNovelTts(); } catch {}
  }
  updateMiniBar();
  if ("mediaSession" in navigator && !curSong) {
    try { navigator.mediaSession.playbackState = "none"; } catch {}
  }
}

/** 播放音乐时同步暂停正在播放的视频与听书 */
function pauseVideoForAudio() {
  const v = $("#video");
  if (v && !v.paused) {
    try { v.pause(); } catch {}
  }
  if (typeof stopNovelTts === "function") {
    try { stopNovelTts(); } catch {}
  }
}

async function playSongFromList(list, idx, openPlayerView = false) {
  if (!NH.user) {
    toast("请先登录账号后收听");
    if (typeof syncAccessGate === "function") syncAccessGate();
    else if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  if (typeof handleExpiredAccessAction === "function" && !handleExpiredAccessAction()) return;
  const song = list[idx];
  if (!song) return;
  pauseVideoForAudio();
  const token = ++mPlayToken;
  musicQueue = list;
  curSongIdx = idx;
  curSong = song;
  song._tried128 = false;
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
  const playUrl = ensureHttpsAudio(await resolveSongUrl(song));
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
audioEl.onerror = async () => {
  if (mSwitching || !audioEl.getAttribute("src")) return;
  if (!curSong) return;
  // 高码率或 FLAC 流若偶发解码/加载失败，先降级尝试 128k MP3 再决定切歌
  if (!curSong._tried128 && mBr !== "128") {
    curSong._tried128 = true;
    const token = mPlayToken;
    const fbUrl = ensureHttpsAudio(await resolveSongUrl(curSong, "128"));
    if (token !== mPlayToken) return;
    if (fbUrl && fbUrl !== audioEl.src) {
      audioEl.src = fbUrl;
      audioEl.load();
      audioEl.play().catch(() => {});
      return;
    }
  }
  handleMusicError();
};
function paintRange(el, pct, bufPct = 0) {
  if (!el) return;
  const p = Math.max(0, Math.min(100, Number(pct) || 0)).toFixed(2) + "%";
  const b = Math.max(0, Math.min(100, Number(bufPct) || 0)).toFixed(2) + "%";
  el.style.setProperty("--p", p);
  el.style.setProperty("--b", b);
}

function getBufferedPct(media) {
  try {
    if (!media || !isFinite(media.duration) || media.duration <= 0 || !media.buffered?.length) return 0;
    const end = media.buffered.end(media.buffered.length - 1);
    return (end / media.duration) * 100;
  } catch { return 0; }
}

/** 提取当前高亮单行歌词文本 */
function getCurrentLyricLine() {
  return activeLrcIdx >= 0 && curLyrics[activeLrcIdx]
    ? curLyrics[activeLrcIdx].text.replace(/\n/g, " ").trim()
    : "";
}

/** 同步媒体通知状态至 Android 原生前台通知栏（支持歌词、封面、进度与总时长） */
function syncNativeMedia(title, artist, isPlaying, mediaType = "audio", opts = null) {
  const o = opts || {};
  const t = String(title || "NovaHub");
  const a = String(artist || "");
  if (window.NovaNative && typeof window.NovaNative.updateMediaRich === "function") {
    try {
      const posMs = Math.max(0, Math.round(Number(o.positionMs) || 0));
      const durMs = Math.max(0, Math.round(Number(o.durationMs) || 0));
      const spd = Number(o.speed) > 0 ? Number(o.speed) : 1;
      window.NovaNative.updateMediaRich(
        t, a, String(o.lyric || ""), String(o.coverUrl || ""),
        !!isPlaying, posMs, durMs, spd, String(mediaType || "audio")
      );
      return;
    } catch {}
  }
  if (window.NovaNative && typeof window.NovaNative.updateMediaNotification === "function") {
    try { window.NovaNative.updateMediaNotification(t, a, !!isPlaying, mediaType); } catch {}
  }
}

function clearNativeMedia() {
  if (window.NovaNative && typeof window.NovaNative.clearMediaNotification === "function") {
    try { window.NovaNative.clearMediaNotification(); } catch {}
  }
}

/** 供原生 Android 通知栏进度条拖拽回调跳转指定毫秒 */
window.__nhMediaSeek = (posMs) => {
  const sec = Math.max(0, (Number(posMs) || 0) / 1000);
  const layer = $("#playerLayer");
  const isVideoActive = layer && !layer.classList.contains("hidden");
  if (isVideoActive) {
    const v = $("#video");
    if (v && !P.isLive && isFinite(v.duration) && v.duration > 0) {
      v.currentTime = Math.min(v.duration, sec);
      syncVideoMediaSession();
    }
    return;
  }
  if (!curSong || !isFinite(audioEl.duration) || audioEl.duration <= 0) return;
  const target = Math.min(audioEl.duration, sec);
  audioEl.currentTime = target;
  if (curLyrics.length) {
    let ni = -1;
    for (let i = 0; i < curLyrics.length; i++) {
      if (target >= curLyrics[i].t) ni = i; else break;
    }
    activeLrcIdx = ni;
    updateMiniBar();
    syncMediaSessionTitle();
    if (currentRoute === "m_player") highlightLyric(ni);
  }
  if (currentRoute === "m_player") {
    const pct = (target / audioEl.duration) * 100;
    const seek = $("#mSeek"), curT = $("#mCurTime");
    if (seek && !seek._dragging) {
      seek.value = String(Math.round(pct * 10));
      paintRange(seek, pct, getBufferedPct(audioEl));
    }
    if (curT) curT.textContent = fmt(target);
  }
  syncAudioPositionState();
  syncMediaSessionState();
};

/** 供原生 Android 通知栏按钮回调操控当前网页播放 */
window.__nhMediaAction = (act) => {
  const layer = $("#playerLayer");
  const isVideoActive = layer && !layer.classList.contains("hidden");
  if (isVideoActive) {
    const v = $("#video");
    if (!v) return;
    if (act === "play_pause") { v.paused ? v.play().catch(() => {}) : v.pause(); }
    else if (act === "prev" && P.eps.length > 1 && P.idx > 0) { P.idx -= 1; renderEpisodes(); mountSource(P.eps[P.idx].url); }
    else if (act === "next" && P.eps.length > 1 && P.idx + 1 < P.eps.length) { P.idx += 1; renderEpisodes(); mountSource(P.eps[P.idx].url); }
    else if (act === "close") { v.pause(); clearNativeMedia(); }
    return;
  }
  if (!curSong) { clearNativeMedia(); return; }
  if (act === "play_pause") { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); }
  else if (act === "prev") { const pi = nextMusicIdx(-1); if (pi >= 0) playSongFromList(musicQueue, pi, currentRoute === "m_player"); }
  else if (act === "next") { const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, currentRoute === "m_player"); }
  else if (act === "close") { audioEl.pause(); clearNativeMedia(); }
};

audioEl.onloadedmetadata = () => {
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
  const pct = dur ? (audioEl.currentTime / dur) * 100 : 0;
  if (currentRoute === "m_player") {
    const seek = $("#mSeek"), curT = $("#mCurTime"), durT = $("#mDurTime");
    if (seek && !seek._dragging) {
      seek.value = dur ? String(Math.round(pct * 10)) : "0";
      paintRange(seek, pct, getBufferedPct(audioEl));
    }
    if (curT) curT.textContent = fmt(audioEl.currentTime || 0);
    if (durT) durT.textContent = fmt(dur);
  }
  syncMediaSessionState();
  syncAudioPositionState();
};
audioEl.onseeked = audioEl.onratechange = () => {
  syncAudioPositionState();
  syncMediaSessionState();
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
  if (!audioEl.paused) pauseVideoForAudio();
  updateMiniBar();
  syncMediaSessionState();
  syncAudioPositionState();
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
      syncMediaSessionState();
      drawPipLyrics();
      if (currentRoute === "m_player") highlightLyric(ni);
    }
  }
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
  if (currentRoute === "m_player" && dur) {
    const pct = (audioEl.currentTime / dur) * 100;
    const seek = $("#mSeek");
    if (seek && !seek._dragging) {
      seek.value = String(Math.round(pct * 10));
      paintRange(seek, pct, getBufferedPct(audioEl));
    }
    const curT = $("#mCurTime"), durT = $("#mDurTime");
    if (curT) curT.textContent = fmt(audioEl.currentTime || 0);
    if (durT) durT.textContent = fmt(dur);
  }
};

function syncAudioPositionState() {
  if (!("mediaSession" in navigator) || typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!curSong || !isFinite(audioEl.duration) || audioEl.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audioEl.duration,
      playbackRate: audioEl.playbackRate || 1,
      position: Math.max(0, Math.min(audioEl.duration, audioEl.currentTime || 0)),
    });
  } catch {}
}

function syncMediaSessionTitle() {
  if (!curSong) { document.title = "NovaHub · 星隅"; return; }
  const lrc = activeLrcIdx >= 0 && curLyrics[activeLrcIdx] ? curLyrics[activeLrcIdx].text.replace(/\n/g, " ") : "";
  document.title = lrc ? `${lrc} - ${curSong.name}` : `${curSong.name} - ${curSong.artist || "NovaHub"}`;
}

function syncMediaSessionState() {
  if (!curSong) return;
  const durMs = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration * 1000 : 0;
  const posMs = isFinite(audioEl.currentTime) && audioEl.currentTime > 0 ? audioEl.currentTime * 1000 : 0;
  syncNativeMedia(curSong.name || "未知歌曲", curSong.artist || "NovaHub 音乐", !audioEl.paused, "audio", {
    lyric: getCurrentLyricLine(),
    coverUrl: curSong.pic || "",
    positionMs: posMs,
    durationMs: durMs,
    speed: audioEl.playbackRate || 1,
  });
  if (!("mediaSession" in navigator)) return;
  try {
    const artUrl = curSong.pic || new URL("icon.svg", location.href).href;
    const artType = artUrl.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
    navigator.mediaSession.playbackState = audioEl.paused ? "paused" : "playing";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: curSong.name || "未知歌曲",
      artist: curSong.artist || "未知歌手",
      album: curSong.album || "NovaHub · 星隅",
      artwork: [{ src: artUrl, sizes: artUrl.endsWith(".svg") ? "any" : "512x512", type: artType }],
    });
    navigator.mediaSession.setActionHandler("play", () => audioEl.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => audioEl.pause());
    navigator.mediaSession.setActionHandler("stop", () => { audioEl.pause(); audioEl.currentTime = 0; });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      const pi = nextMusicIdx(-1); if (pi >= 0) playSongFromList(musicQueue, pi, currentRoute === "m_player");
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, currentRoute === "m_player");
    });
    navigator.mediaSession.setActionHandler("seekbackward", (d) => {
      const step = d?.seekOffset || 10;
      if (isFinite(audioEl.duration)) {
        audioEl.currentTime = Math.max(0, audioEl.currentTime - step);
        syncAudioPositionState();
      }
    });
    navigator.mediaSession.setActionHandler("seekforward", (d) => {
      const step = d?.seekOffset || 10;
      if (isFinite(audioEl.duration)) {
        audioEl.currentTime = Math.min(audioEl.duration, audioEl.currentTime + step);
        syncAudioPositionState();
      }
    });
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null && isFinite(audioEl.duration)) {
        audioEl.currentTime = d.seekTime;
        syncAudioPositionState();
      }
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
    <div class="mini-info"><div class="mini-title">${esc(curSong.name)}${audioEl.paused ? "" : `<span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i></span>`}</div><div class="mini-sub">${esc(lrcLine)}</div></div>
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
      <button class="m-dl-btn" type="button" aria-label="下载歌曲" title="下载">${ico("download")}</button>
      <button class="m-fav ${fav ? "on" : ""}" aria-label="收藏">${ico(fav ? "heartFill" : "heart")}</button>`;
    row.onclick = (e) => {
      const dlBtn = e.target.closest(".m-dl-btn");
      if (dlBtn) {
        e.stopPropagation();
        downloadMusicTrack(m);
        return;
      }
      const favBtn = e.target.closest(".m-fav");
      if (favBtn) {
        e.stopPropagation();
        favBtn.classList.remove("fav-pop");
        void favBtn.offsetWidth;
        favBtn.classList.add("fav-pop");
        toggleMusicFav(m);
        return;
      }
      playSongFromList(list, i, true);
    };
    container.appendChild(row);
  });
  applyStagger(container);
}

/** 从曲目列表提取独立歌手名并按出现频次降序排列 */
function extractArtistsFromSongs(songs, limit = 10) {
  const counts = new Map();
  (songs || []).forEach((s) => {
    String(s?.artist || "").split(/[\/,&、]+/).forEach((part) => {
      const name = part.replace(/\u00a0/g, " ").trim();
      if (!name || name === "未知歌手" || name === "群星" || name.length > 24) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map((e) => e[0]);
}

/** 选定歌手并直接搜索关于 TA 的单曲 */
function searchArtistSongs(artist) {
  const name = String(artist || "").replace(/\s*\([^)]*\)|\s*（[^）]*）/g, "").trim();
  if (!name) return;
  const inp = $("#searchInput");
  if (inp) inp.value = name;
  if (typeof syncSearchClear === "function") syncSearchClear();
  addSearchHist(name);
  searchMusic(name);
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
  // 将默认兜底的「单曲收录」固定沉底，真实专辑优先排前
  const albums = [...map.values()].sort((a, b) => {
    if (a.name === "单曲收录" && b.name !== "单曲收录") return 1;
    if (b.name === "单曲收录" && a.name !== "单曲收录") return -1;
    return b.songs.length - a.songs.length;
  });
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
  const relArtists = mIsSearch ? extractArtistsFromSongs(filtered, 8) : [];
  $("#view").innerHTML = `
    ${typeof renderTrialBannerHtml === "function" ? renderTrialBannerHtml() : ""}
    <div id="adminBannerSlot">${typeof renderAdminBannerHtml === "function" ? renderAdminBannerHtml(false) : ""}</div>
    <div class="m-chips">${MUSIC_CHARTS.map((c) => `<button class="m-chip ${!mIsSearch && curChart === c.id ? "active" : ""}" data-id="${c.id}">${c.name}</button>`).join("")}</div>
    ${mIsSearch ? `
      <div class="m-search-bar">
        <span>搜索「<strong>${esc(mSearchQuery || "")}</strong>」· 共 <strong>${filtered.length}</strong> 首</span>
        <button id="mBackChartBtn" class="btn ghost" style="padding:4px 10px;font-size:12px" type="button">返回榜单</button>
      </div>
      ${relArtists.length ? `<div class="m-artist-bar"><span class="m-artist-bar-lbl">搜歌手：</span>${relArtists.map((a) => `<button class="m-artist-chip" type="button" data-artist="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : ""}
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <button class="m-chip ${mSearchView === "track" ? "active" : ""}" data-v="track">${ico("music")} 全部单曲 (${filtered.length})</button>
        <button class="m-chip ${mSearchView === "album" ? "active" : ""}" data-v="album">${ico("disc")} 按专辑 (${albumCnt})</button>
      </div>` : ""}
    <div class="section-title" style="justify-content:space-between">
      <span>${mIsSearch ? (mSearchView === "album" ? `专辑分组 (${albumCnt})` : `单曲结果 (${filtered.length})`) : `精选曲目 (${filtered.length})`}</span>
      ${brSelectHtml()}
    </div>
    <div id="mListWrap"></div>`;
  $("#mBrSel").onchange = (e) => changeBr(e.target.value);
  if (typeof bindAdminBanners === "function") bindAdminBanners($("#view"));
  document.querySelectorAll(".m-chip[data-id]").forEach((el) => el.onclick = () => { mIsSearch = false; discoverList = []; loadChart(el.dataset.id); });
  if (mIsSearch) {
    $("#mBackChartBtn")?.addEventListener("click", () => { mIsSearch = false; discoverList = []; loadChart(curChart); });
    document.querySelectorAll(".m-artist-chip[data-artist]").forEach((el) => el.onclick = () => searchArtistSongs(el.dataset.artist));
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

/** 底部弹出当前队列 / 最近播放抽屉，支持选歌手直搜单曲 */
function openMusicQueueSheet() {
  const old = $("#mQueueMask");
  if (old) old.remove();
  const mask = document.createElement("div");
  mask.id = "mQueueMask";
  mask.className = "m-queue-mask";
  let tab = musicQueue.length ? "queue" : "hist";
  const curArtists = curSong ? extractArtistsFromSongs([curSong], 4) : [];

  const renderSheet = () => {
    const hist = get("music_hist", []);
    const activeList = tab === "queue" ? musicQueue : hist;
    mask.innerHTML = `
      <div class="m-queue-sheet">
        <div class="m-q-head">
          <div class="m-q-tabs">
            <button class="m-chip ${tab === "queue" ? "active" : ""}" data-qtab="queue" type="button">当前队列 (${musicQueue.length})</button>
            <button class="m-chip ${tab === "hist" ? "active" : ""}" data-qtab="hist" type="button">最近播放 (${hist.length})</button>
          </div>
          <button id="mQueueClose" class="btn ghost" style="padding:4px 10px;font-size:12px" type="button">关闭</button>
        </div>
        ${curArtists.length ? `<div class="m-artist-bar" style="padding:0"><span class="m-artist-bar-lbl">听 TA 的歌：</span>${curArtists.map((a) => `<button class="m-artist-chip" type="button" data-qart="${esc(a)}">${esc(a)}</button>`).join("")}</div>` : ""}
        <div class="m-q-list group" id="mQueueList"></div>
      </div>`;
    const ql = mask.querySelector("#mQueueList");
    paintMusicList(ql, activeList);
    ql.querySelectorAll(".m-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (!e.target.closest(".m-fav")) mask.remove();
      }, true);
    });
    mask.querySelector("#mQueueClose").onclick = () => mask.remove();
    mask.querySelectorAll("[data-qtab]").forEach((b) => {
      b.onclick = () => { tab = b.dataset.qtab; renderSheet(); };
    });
    mask.querySelectorAll("[data-qart]").forEach((b) => {
      b.onclick = () => { mask.remove(); searchArtistSongs(b.dataset.qart); };
    });
  };

  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  document.body.appendChild(mask);
  renderSheet();
}

function renderMusicPlayer() {
  const vEl = $("#view");
  const isMp = currentRoute === "m_player" && !!curSong;
  if (vEl) vEl.classList.toggle("view-mplayer", isMp);
  document.body.classList.toggle("in-mplayer", isMp);
  if (!curSong) {
    const hist = get("music_hist", []);
    const favs = getMusicFavs();
    const artistPool = extractArtistsFromSongs([...hist, ...favs], 8);
    DEFAULT_HOT_ARTISTS.forEach((a) => { if (artistPool.length < 8 && !artistPool.includes(a)) artistPool.push(a); });
    $("#view").innerHTML = `
      <div class="m-recent-panel">
        <div class="m-artist-bar">
          <span class="m-artist-bar-lbl">选歌手听单曲：</span>
          ${artistPool.map((a) => `<button class="m-artist-chip" type="button" data-art="${esc(a)}">${esc(a)}</button>`).join("")}
        </div>
        <div class="section-title" style="justify-content:space-between">
          <span>${ico("clock")} 最近播放 (${hist.length})</span>
          <div style="display:flex;gap:6px">
            ${hist.length ? `<button id="mClearHistBtn" class="btn ghost" style="padding:3px 9px;font-size:11.5px" type="button">清空</button>` : ""}
            <button class="btn ghost" onclick="go('m_discover')" style="padding:3px 9px;font-size:11.5px" type="button">曲库榜单</button>
          </div>
        </div>
        <div id="mRecentWrap" class="${hist.length ? "group" : ""}"></div>
      </div>`;
    $("#view").querySelectorAll(".m-artist-chip[data-art]").forEach((btn) => {
      btn.onclick = () => searchArtistSongs(btn.dataset.art);
    });
    const clearBtn = $("#mClearHistBtn");
    if (clearBtn) clearBtn.onclick = () => { set("music_hist", []); renderMusicPlayer(); toast("已清空最近播放"); };
    const rw = $("#mRecentWrap");
    if (hist.length) paintMusicList(rw, hist);
    else rw.innerHTML = `<div class="empty">暂无最近播放记录<br>可点击上方歌手快速搜单曲，或进入曲库挑选歌曲<br><br><button class="btn primary" onclick="go('m_discover')">前往精选曲库</button></div>`;
    return;
  }
  const fav = isMusicFav(curSong);
  const dur = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : 0;
  const artists = extractArtistsFromSongs([curSong], 4);
  const artistHtml = artists.length
    ? `<div class="m-artist-links">${artists.map((ar) => `<button class="m-artist-link" type="button" data-art="${esc(ar)}" title="搜索${esc(ar)}的单曲">${ico("search")} ${esc(ar)}</button>`).join("")}</div>`
    : `<div class="m-player-artist">${esc(curSong.artist || "")}</div>`;
  $("#view").innerHTML = `
    <div class="m-player">
      <div class="m-player-head">
        <button class="btn ghost" onclick="go('m_discover')" style="padding:5px 10px;font-size:12.5px;flex-shrink:0">${ico("back")} 曲库</button>
        <div class="m-player-meta">
          <div class="m-player-title">${esc(curSong.name)}</div>
          ${artistHtml}
        </div>
        <button id="mPlayerFav" class="m-fav ${fav ? "on" : ""}" style="font-size:20px;flex-shrink:0" aria-label="收藏">${ico(fav ? "heartFill" : "heart")}</button>
      </div>
      <div id="mDisc" class="m-disc ${audioEl.paused ? "" : "playing"}">
        ${curSong.pic ? `<img src="${esc(curSong.pic)}" onerror="_imgPh(this,'disc','m-disc-ph')">` : `<div class="m-disc-ph">${ico("disc")}</div>`}
      </div>
      <div id="lrcBox" class="lrc-box"></div>
      <div class="m-tools">
        <button id="mSleepBtn" class="m-tool-btn ${mSleepMode ? "active" : ""}">${ico("clock")} <span id="mSleepTxt">${sleepLabel()}</span></button>
        <button id="mPipBtn" class="m-tool-btn ${pipActive ? "active" : ""}">${ico("pip")} 悬浮歌词</button>
        <button id="mDownloadBtn" class="m-tool-btn">${ico("download")} 下载</button>
        ${brSelectHtml()}
      </div>
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
        <button id="mListBtn" aria-label="播放队列与最近播放">${ico("queue")}</button>
      </div>
    </div>`;
  renderLyricsBox();
  $("#view").querySelectorAll(".m-artist-link[data-art]").forEach((btn) => {
    btn.onclick = () => searchArtistSongs(btn.dataset.art);
  });
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
  $("#mDownloadBtn")?.addEventListener("click", () => downloadMusicTrack(curSong));
  $("#mPlayerFav").onclick = () => toggleMusicFav(curSong);
  $("#mModeBtn").onclick = () => {
    mPlayMode = M_MODES[(M_MODES.indexOf(mPlayMode) + 1) % M_MODES.length];
    set("m_mode", mPlayMode);
    $("#mModeBtn").innerHTML = renderModeBtnHtml();
  };
  $("#mPlayMain").onclick = () => { audioEl.paused ? audioEl.play().catch(() => {}) : audioEl.pause(); syncPlayerUi(); };
  $("#mPrevBtn").onclick = () => { const pi = nextMusicIdx(-1); if (pi >= 0) playSongFromList(musicQueue, pi, true); };
  $("#mNextBtn").onclick = () => { const ni = nextMusicIdx(1); if (ni >= 0) playSongFromList(musicQueue, ni, true); };
  $("#mListBtn").onclick = openMusicQueueSheet;
  const sk = $("#mSeek");
  paintRange(sk, dur ? (audioEl.currentTime / dur) * 100 : 0, getBufferedPct(audioEl));
  sk.oninput = () => {
    sk._dragging = true;
    paintRange(sk, sk.value / 10, getBufferedPct(audioEl));
    if (isFinite(audioEl.duration) && audioEl.duration > 0) $("#mCurTime").textContent = fmt((sk.value / 1000) * audioEl.duration);
  };
  sk.onchange = () => { sk._dragging = false; if (isFinite(audioEl.duration) && audioEl.duration > 0) { audioEl.currentTime = (sk.value / 1000) * audioEl.duration; syncAudioPositionState(); } };
}

let curMusicFavGroup = "全部";
function getMusicFavGroups() {
  const custom = get("music_fav_groups", []);
  const fromFavs = getMusicFavs().map((x) => x.group).filter(Boolean);
  return ["全部", "我喜欢的音乐", ...new Set([...custom, ...fromFavs].filter((g) => g && g !== "全部" && g !== "我喜欢的音乐"))];
}

function nhPrompt(title, defVal, onOk, options = null) {
  const old = document.getElementById("nhPromptMask");
  if (old) old.remove();
  const mask = document.getElementById("nhPromptMask") || document.createElement("div");
  mask.id = "nhPromptMask";
  mask.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)";
  const selHtml = Array.isArray(options) && options.length
    ? `<select id="nhPromptSel" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(212,175,55,.35);background:#0c0d11;color:#f3ead8;font-size:14px;outline:none;margin-bottom:10px">${options.map((o) => `<option value="${esc(o)}" ${o === defVal ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`
    : "";
  mask.innerHTML = `<div style="width:100%;max-width:340px;background:#14151a;border:1px solid rgba(212,175,55,.35);border-radius:14px;padding:18px;box-shadow:0 16px 40px rgba(0,0,0,.6)">
    <div style="font-size:15px;font-weight:600;color:#f3ead8;margin-bottom:12px">${esc(title)}</div>
    ${selHtml}
    <input id="nhPromptInp" type="text" value="${esc(defVal || "")}" placeholder="或输入新分组名称" style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:#0c0d11;color:#fff;font-size:14px;outline:none;margin-bottom:14px" />
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="nhPromptCancel" class="btn ghost sm" style="padding:7px 14px">取消</button>
      <button id="nhPromptOk" class="btn sm" style="padding:7px 16px;background:linear-gradient(135deg,#e7c66b,#b68928);color:#111;border:none;border-radius:8px;font-weight:600">确定</button>
    </div>
  </div>`;
  document.body.appendChild(mask);
  const inp = mask.querySelector("#nhPromptInp");
  const sel = mask.querySelector("#nhPromptSel");
  if (sel) sel.onchange = () => { inp.value = sel.value; };
  inp.focus();
  const close = () => mask.remove();
  mask.querySelector("#nhPromptCancel").onclick = close;
  mask.onclick = (e) => { if (e.target === mask) close(); };
  mask.querySelector("#nhPromptOk").onclick = () => { const v = inp.value.trim(); close(); if (v) onOk(v); };
  inp.onkeydown = (e) => { if (e.key === "Enter") mask.querySelector("#nhPromptOk").click(); };
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
    nhPrompt("新建歌单分组", "", (name) => {
      if (name === "全部") return;
      const custom = get("music_fav_groups", []);
      if (!custom.includes(name) && name !== "我喜欢的音乐") {
        custom.push(name);
        set("music_fav_groups", custom);
      }
      curMusicFavGroup = name;
      renderMusicFav();
    });
  };
  const delBtn = $("#delFavGroupBtn");
  if (delBtn) delBtn.onclick = () => {
    const g = curMusicFavGroup;
    set("music_fav_groups", get("music_fav_groups", []).filter((x) => x !== g));
    set("music_favs", getMusicFavs().map((x) => x.group === g ? { ...x, group: "我喜欢的音乐" } : x));
    curMusicFavGroup = "全部";
    renderMusicFav();
    toast(`已删除分组「${g}」，歌曲已移回默认分组`);
  };
  paintMusicList($("#mFavList"), shown);
  if (shown.length) {
    $("#mFavList").querySelectorAll(".m-row").forEach((row, idx) => {
      const btn = document.createElement("button");
      btn.className = "m-act";
      btn.title = "移动分组";
      btn.textContent = shown[idx].group === "我喜欢的音乐" ? "分组" : shown[idx].group;
      btn.style.cssText = "font-size:11px;padding:2px 6px;border-radius:6px;border:1px solid var(--line);color:var(--text-2);margin-right:4px";
      btn.onclick = (e) => {
        e.stopPropagation();
        nhPrompt(`将「${shown[idx].name}」移动到分组`, shown[idx].group, (target) => {
          if (target === "全部") return;
          const custom = get("music_fav_groups", []);
          if (!custom.includes(target) && target !== "我喜欢的音乐") { custom.push(target); set("music_fav_groups", custom); }
          const k = songKey(shown[idx]);
          set("music_favs", getMusicFavs().map((x) => songKey(x) === k ? { ...x, group: target } : x));
          renderMusicFav();
          toast(`已移入「${target}」`);
        });
      };
      row.insertBefore(btn, row.lastElementChild);
    });
  }
  paintMusicList($("#mHistList"), hist);
}

/* ============ 影视首页（5 分钟本地缓存复用 + 后台静默更新） ============ */
const HOME_CACHE_TTL = 5 * 60 * 1000;
const _homeVodCache = (() => {
  try {
    const raw = sessionStorage.getItem("nh_home_vod_cache");
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.items) && parsed.items.length) {
      return { items: parsed.items, ts: Number(parsed.ts) || 0, inflight: null };
    }
  } catch {}
  return { items: [], ts: 0, inflight: null };
})();
function saveHomeVodCache(items) {
  if (!Array.isArray(items) || !items.length) return;
  _homeVodCache.items = items.slice(0, 24);
  _homeVodCache.ts = Date.now();
  try {
    sessionStorage.setItem("nh_home_vod_cache", JSON.stringify({ items: _homeVodCache.items, ts: _homeVodCache.ts }));
  } catch {}
}
function fetchHomeVod(force = false) {
  if (!force && _homeVodCache.inflight) return _homeVodCache.inflight;
  const p = nhApi("/api/vod/home").then((d) => {
    const items = Array.isArray(d?.items) ? d.items.slice(0, 24) : [];
    if (items.length) saveHomeVodCache(items);
    return items;
  }).finally(() => {
    if (_homeVodCache.inflight === p) _homeVodCache.inflight = null;
  });
  _homeVodCache.inflight = p;
  return p;
}

function renderHome() {
  const mine=++viewRequest;
  vodClient.cancel();
  const likes=get(K.LIKE,[]);
  const rows=NovaHistory.merge({},historyState()).history.filter(x=>x.srcId && !String(x.id).startsWith('ep-'));
  const cachedItems = _homeVodCache.items;
  const hasCached = cachedItems.length > 0;
  $('#view').innerHTML=`
    ${typeof renderTrialBannerHtml === "function" ? renderTrialBannerHtml() : ""}
    <div id="adminBannerSlot">${typeof renderAdminBannerHtml === "function" ? renderAdminBannerHtml(false) : ""}</div>
    ${rows.length?`<div class="section-title" style="justify-content:space-between"><span>${ico('clock')} 继续观看</span><div><button class="btn ghost" id="manageHistory">管理</button><button class="btn ghost" id="clearHistory">清空</button></div></div><div class="grid" id="histGrid"></div>`:''}
    ${renderAdSlotHtml('home')}
    ${likes.length?`<div class="section-title">${ico('heart')} 我的片单</div><div class="grid" id="likeGrid"></div>`:''}
    <div class="section-title" style="justify-content:space-between"><span>${ico('film')} 最近更新</span><button class="btn ghost" id="refreshHomeVod" type="button" style="padding:3px 9px;font-size:11.5px">刷新</button></div>
    <div class="grid" id="homeGrid">${hasCached ? '' : renderSkeletonHtml('grid', 12, true)}</div>`;
  if (typeof bindAdminBanners === "function") bindAdminBanners($('#view'));
  if(rows.length) {
    paintGrid($('#histGrid'),rows.slice(0,12).map(x=>({...x,_fromHistory:true,remark:getProgress(NovaHistory.key(x))?`第${getProgress(NovaHistory.key(x)).idx+1}集 ${fmt(getProgress(NovaHistory.key(x)).time)}`:x.remark})));
    $('#manageHistory').onclick=()=>renderHistoryManager();
    $('#clearHistory').onclick=async()=>{if(await modal('清空观看历史','将删除全部观看历史和续播进度，收藏会保留。')){if(P.vodKey)historyBlocked.add(P.vodKey);applyHistoryState(NovaHistory.clear(historyState(),Date.now()));renderHome();}};
  }
  if(likes.length)paintGrid($('#likeGrid'),likes.slice(0,12));
  bindAdSlots($('#view'));
  if (hasCached && $('#homeGrid')) {
    paintGrid($('#homeGrid'), cachedItems);
  }
  const loadHome = (force = false) => {
    if (typeof isAccessGateEnabled === "function" && isAccessGateEnabled() && !hasActiveAccess()) return;
    const btn = $('#refreshHomeVod');
    if (btn && force) { btn.disabled = true; btn.textContent = '刷新中…'; }
    fetchHomeVod(force).then((items) => {
      if (mine !== viewRequest || !$('#homeGrid')) return;
      if (items.length) {
        paintGrid($('#homeGrid'), items);
      } else if (!_homeVodCache.items.length) {
        $('#homeGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">暂未加载到推荐影片<br><button class="btn ghost" id="retryHomeBtn" style="margin-top:10px" type="button">点击重试</button></div>';
        $('#retryHomeBtn')?.addEventListener('click', () => {
          if ($('#homeGrid')) $('#homeGrid').innerHTML = renderSkeletonHtml('grid', 12, true);
          loadHome(true);
        });
      }
    }).catch(() => {
      if (mine !== viewRequest || !$('#homeGrid')) return;
      if (!_homeVodCache.items.length) {
        $('#homeGrid').innerHTML = '<div class="empty" style="grid-column:1/-1">网络连接较慢<br><button class="btn ghost" id="retryHomeBtn" style="margin-top:10px" type="button">重新加载</button></div>';
        $('#retryHomeBtn')?.addEventListener('click', () => {
          if ($('#homeGrid')) $('#homeGrid').innerHTML = renderSkeletonHtml('grid', 12, true);
          loadHome(true);
        });
      }
    }).finally(() => {
      const b = $('#refreshHomeVod');
      if (b) { b.disabled = false; b.textContent = '刷新'; }
    });
  };
  $('#refreshHomeVod')?.addEventListener('click', () => loadHome(true));
  if (!hasCached || Date.now() - _homeVodCache.ts >= HOME_CACHE_TTL) {
    loadHome(false);
  }
}
function renderHistoryManager(_fromBack=false) {
  if(!_fromBack)pushView(()=>renderHistoryManager(true));
  ++viewRequest;vodClient.cancel();
  const rows=NovaHistory.merge({},historyState()).history;
  $('#view').innerHTML=backBar('观看历史')+'<div class="group" id="historyRows"></div>';
  const host=$('#historyRows');
  if(!rows.length)host.innerHTML='<div class="empty">暂无观看记录</div>';
  rows.forEach(item=>{
    const el=document.createElement('div');el.className='row';
    el.innerHTML=`<div class="r-main"><div class="r-title">${esc(item.name)}</div><div class="r-sub">${esc(item.remark||'')}</div></div><button class="btn ghost danger" aria-label="删除观看记录">删除</button>`;
    el.querySelector('button').onclick=()=>{const k=NovaHistory.key(item);historyBlocked.add(k);applyHistoryState(NovaHistory.remove(historyState(),k,Date.now()));renderHistoryManager(true);};
    host.appendChild(el);
  });
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
  applyStagger(el);
}

/**
 * 统一渲染电视剧/直播分段选集组件（超过 20 集自动按 20 集分页，支持正倒序切换）
 */
function renderPagedEpisodes(container, eps, activeIdx, onSelect, stateObj, showTitle = true) {
  if (!container) return;
  if (!eps || !eps.length) { container.innerHTML = ""; return; }
  const st = stateObj || { page: null, reversed: false };
  const pageSize = 20;
  const total = eps.length;
  const order = eps.map((_, idx) => idx);
  if (st.reversed) order.reverse();

  const totalPages = Math.ceil(total / pageSize);
  let curPos = activeIdx >= 0 ? order.indexOf(activeIdx) : 0;
  if (curPos < 0) curPos = 0;
  if (st.page == null || st.page < 0 || st.page >= totalPages) {
    st.page = Math.floor(curPos / pageSize);
  }
  const start = st.page * pageSize;
  const slice = order.slice(start, start + pageSize);

  const rangesHtml = totalPages > 1 ? `<div class="ep-range-bar">${Array.from({ length: totalPages }, (_, p) => {
    const sIdx = p * pageSize, eIdx = Math.min(total - 1, (p + 1) * pageSize - 1);
    const label = st.reversed ? `${order[sIdx] + 1}-${order[eIdx] + 1}` : `${sIdx + 1}-${eIdx + 1}`;
    return `<button class="m-chip ${p === st.page ? "active" : ""}" data-epage="${p}" type="button">${label}</button>`;
  }).join("")}</div>` : "";

  const headHtml = (showTitle || total > 10) ? `
    <div class="ep-head-bar">
      <div class="section-title" style="margin:0">选集 (${total})</div>
      <button class="btn ghost ep-rev-btn" style="padding:4px 10px;font-size:12px" type="button">${ico("sort")} ${st.reversed ? "倒序" : "正序"}</button>
    </div>` : "";

  container.innerHTML = `${headHtml}${rangesHtml}<div class="ep-wrap">${slice.map((origIdx) => `<div class="ep ${origIdx === activeIdx ? "active" : ""}" data-i="${origIdx}">${esc(eps[origIdx].name)}</div>`).join("")}</div>`;

  container.querySelector(".ep-rev-btn")?.addEventListener("click", () => {
    st.reversed = !st.reversed;
    st.page = 0;
    renderPagedEpisodes(container, eps, activeIdx, onSelect, st, showTitle);
  });
  container.querySelectorAll("[data-epage]").forEach((btn) => {
    btn.onclick = () => {
      st.page = +btn.dataset.epage;
      renderPagedEpisodes(container, eps, activeIdx, onSelect, st, showTitle);
    };
  });
  container.querySelectorAll(".ep").forEach((el) => {
    el.onclick = () => onSelect(+el.dataset.i);
  });
}

/* 详情 + 播放 */
async function openDetail(v, _fromBack) {
  if(!_fromBack)pushView(()=>openDetail(v,true));
  vodClient.cancel();const mine=++viewRequest;
  if(!v.srcId||!v.id)return toast('该记录缺少线路信息，请重新搜索');
  $('#view').innerHTML=backBar(v.name)+renderSearchLoadingHtml(v.name, '正在载入影片详情与分集…');
  try {
    if (NH.user && Date.now() - (_lastCloudPullAt || 0) > 10000) {
      await Promise.race([cloudSyncPull(true), new Promise((r) => setTimeout(r, 1200))]).catch(() => {});
    }
    await migrateLegacySources();
    const d=await nhApi('/api/vod/detail?source='+encodeURIComponent(v.srcId)+'&id='+encodeURIComponent(v.id));
    if(mine!==viewRequest)return;
    const item={...v,...d.item};
    // Keep the legacy key for existing bookmarks/progress even after a private alias resolves.
    const vodKey=NovaHistory.key(v);
    const eps=(d.episodes||[]).map(e=>({name:e.n,url:e.url}));
    const liked=get(K.LIKE,[]).some(x=>NovaHistory.key(x)===vodKey);
    const notifyOn = getWatchNotifyEnabled('vod', vodKey);
    $('#view').innerHTML=`${backBar(item.name)}<div class="form"><div style="display:flex;gap:12px">${item.pic?`<img src="${esc(item.pic)}" style="width:94px;aspect-ratio:3/4.2;object-fit:cover;border-radius:8px" onerror="this.style.display='none'">`:''}<div><div style="font-size:16px;font-weight:600">${esc(item.name)}</div><div class="hint">${esc([item.year,item.lang,item.typeName].filter(Boolean).join(' · '))}</div></div></div><div class="hint" style="margin-top:10px">${esc(d.description||'暂无剧情简介')}</div><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn primary" id="btnPlay0">${ico('play')} 立即播放</button><button class="btn ghost" id="btnLike">${ico(liked?'heartFill':'heart')} ${liked?'已收藏':'收藏'}</button>${NH.user ? `<button class="btn ghost ${liked?'':'hidden'}" id="btnVodNotify">${ico('bell')} ${notifyOn?'提醒开':'提醒关'}</button>` : ''}${eps.length ? `<button class="btn ghost" id="btnVodDetailDownload">${ico('download')} 下载</button>` : ''}</div></div><div id="eps" style="margin-top:12px"></div>`;
    const saved=getProgress(vodKey);
    const start=(idx,time=0)=>{
      if(!eps[idx])return toast('暂无可用播放线路');
      const playback={item,routes:v.routes||[{srcId:item.srcId,id:item.id}],ticket:d.ticket,attempts:0,tried:new Set([item.srcId+':'+item.id]),generation:0};
      play(item.name+' · '+eps[idx].name,eps[idx].url,eps,idx,vodKey,time);
      if(NH.user){P.managed=playback;historyBlocked.delete(vodKey);addHistory({...v,name:item.name,pic:item.pic,remark:item.remark});P.historyVersion={deleted_at:get('history_deleted',{})[vodKey]||0,cleared_at:get('history_cleared_at',0)};}
    };
    renderPagedEpisodes($('#eps'),eps,saved?.idx??-1,i=>start(i),{page:null,reversed:false},true);
    $('#btnPlay0').onclick=()=>start(saved&&saved.idx<eps.length?saved.idx:0,saved?.time||0);
    $('#btnVodDetailDownload')?.addEventListener('click', () => {
      const targetIdx = saved && saved.idx < eps.length ? saved.idx : 0;
      const ep = eps[targetIdx];
      if (!ep) return toast('暂无可下载的剧集');
      downloadVodEpisode(item.name, ep.name, ep.url);
    });
    $('#btnLike').onclick=()=>{
      const list=get(K.LIKE,[]);const i=list.findIndex(x=>NovaHistory.key(x)===vodKey);
      if(i<0)list.unshift({...v,name:item.name,pic:item.pic,remark:item.remark});else list.splice(i,1);
      set(K.LIKE,list);$('#btnLike').innerHTML=ico(i<0?'heartFill':'heart')+(i<0?' 已收藏':' 收藏');
      $('#btnVodNotify')?.classList.toggle('hidden', i >= 0);
    };
    $('#btnVodNotify')?.addEventListener('click', async () => {
      const cur = getWatchNotifyEnabled('vod', vodKey);
      await toggleWatchNotify('vod', vodKey, !cur, item.name, { srcId: v.srcId, id: v.id, name: item.name, pic: item.pic }, $('#btnVodNotify'));
    });
    if(v._fromHistory&&eps.length)$('#btnPlay0').click();
  } catch(e) {if(mine===viewRequest)$('#view').innerHTML=backBar(v.name)+`<div class="empty">${esc(e.message)}</div>`;}
}
function addHistory(item) {
  const state=historyState();const k=NovaHistory.key(item);
  const row={...item,at:Date.now(),deleted_at:state.history_deleted[k]||0,cleared_at:state.history_cleared_at||0};
  state.history=[row,...state.history.filter(x=>NovaHistory.key(x)!==k)].slice(0,100);
  applyHistoryState(NovaHistory.merge({},state));
}
function saveProgress(vodKey,idx,time,immediate=false) {
  if(!vodKey||!time||time<1||historyBlocked.has(vodKey))return;
  const src=(typeof isAppClient==='function'&&isAppClient())?'app':'web';
  const p=get('progress',{});p[vodKey]={idx,time:Math.floor(time),at:Date.now(),src,...(P.vodKey===vodKey?P.historyVersion||{}:{})};set('progress',p);
  if(immediate&&typeof cloudSyncPush==='function'&&typeof NH!=='undefined'&&NH.user){
    cloudSyncPush(true,typeof document!=='undefined'&&document.visibilityState==='hidden');
  }
}
function getProgress(vodKey) { return vodKey?(get('progress',{})[vodKey]||null):null; }

/* ============ 搜索（MacCMS ac=detail，多源并发 + 缓存 + 分类筛选） ============ */
const _searchCache = new Map();
const VOD_CATS = ["全部", "电影", "电视剧", "动漫", "综艺", "其他"];
function classifyVodItem(typeName, remark) {
  const t = String(typeName || "").trim();
  const r = String(remark || "").trim();
  if (/动漫|番剧|国漫|日漫|美漫|少儿/.test(t)) return "动漫";
  if (/综艺|真人秀|脱口秀|晚会|演唱会/.test(t)) return "综艺";
  if (/剧|连续剧|连续|series/i.test(t) || /全\d+集|更新至\s*\d+|第\s*\d+\s*集|连载中|集全/.test(r)) return "电视剧";
  if (/电影|影|片$/.test(t) || /正片|HD|BD|抢先|1080P|4K/i.test(r)) return "电影";
  return "其他";
}
function renderSearchResults(q) {
  const entry = _searchCache.get(q);
  if (!entry || !entry.results.length) {
    $("#view").innerHTML = `${backBar("搜索：" + q)}<div class="empty">未检索到「${esc(q)}」<br>请尝试更换关键词</div>`;
    return;
  }
  const { results } = entry;
  const counts = {};
  results.forEach((item) => {
    const c = classifyVodItem(item.typeName, item.remark);
    counts[c] = (counts[c] || 0) + 1;
  });
  const activeCat = entry.activeCat && (entry.activeCat === "全部" || counts[entry.activeCat]) ? entry.activeCat : "全部";
  entry.activeCat = activeCat;
  const shown = activeCat === "全部" ? results : results.filter((x) => classifyVodItem(x.typeName, x.remark) === activeCat);
  const catsHtml = VOD_CATS.filter((c) => c === "全部" || counts[c] > 0).map((c) => {
    const cnt = c === "全部" ? results.length : counts[c];
    return `<button class="m-chip ${activeCat === c ? "active" : ""}" data-vcat="${c}" type="button">${c} (${cnt})</button>`;
  }).join("");
  $("#view").innerHTML = `${backBar(`检索结果 (${shown.length})`)}<div class="vod-cat-bar" id="vodCatBar">${catsHtml}</div><div class="grid" id="sGrid"></div>`;
  paintGrid($("#sGrid"), shown);
  $("#vodCatBar")?.querySelectorAll(".m-chip").forEach((btn) => {
    btn.onclick = () => {
      entry.activeCat = btn.dataset.vcat || "全部";
      renderSearchResults(q);
    };
  });
}

async function doSearch(q,_fromBack) {
  if(!_fromBack)pushView(()=>doSearch(q,true));
  const mine=++viewRequest;
  if(_fromBack&&_searchCache.has(q)&&Date.now()-_searchCache.get(q).ts<120000){vodClient.cancel();setSearchLoading(false);renderSearchResults(q);return;}
  setSearchLoading(true);$('#view').innerHTML=backBar('搜索：'+q)+renderSearchLoadingHtml(q, '正在并发检索优选片源…');
  try {
    await migrateLegacySources();
    if(mine!==viewRequest)return;
    await vodClient.search(q,d=>{
      if(mine!==viewRequest)return;
      const results=d.items||[];sortByExactMatch(results,q,x=>x.name);
      if(_searchCache.size>=20)_searchCache.delete(_searchCache.keys().next().value);
      _searchCache.set(q,{ts:Date.now(),results,activeCat:'全部'});renderSearchResults(q);
    });
  }catch(e){if(mine===viewRequest)$('#view').innerHTML=backBar('搜索：'+q)+`<div class="empty">${esc(e.message)}</div>`;}
  finally{if(mine===viewRequest)setSearchLoading(false);}
}

/* ============ 视频播放器 ============ */
const P = { hls: null, flv: null, eps: [], idx: 0, title: "", vodKey: "", isLive: false, _epState: null };
function getSkipCfg(vodKey) {
  if (!vodKey) return null;
  const map = get("skip_cfg", {});
  const cfg = map && typeof map === "object" ? map[vodKey] : null;
  if (!cfg || typeof cfg !== "object") return null;
  return {
    intro: Math.max(0, Math.min(600, Math.floor(Number(cfg.intro) || 0))),
    outro: Math.max(0, Math.min(600, Math.floor(Number(cfg.outro) || 0))),
    enabled: cfg.enabled !== false,
  };
}
function saveSkipCfg(vodKey, cfg) {
  if (!vodKey) return;
  const map = { ...(get("skip_cfg", {}) || {}) };
  const intro = Math.max(0, Math.min(600, Math.floor(Number(cfg?.intro) || 0)));
  const outro = Math.max(0, Math.min(600, Math.floor(Number(cfg?.outro) || 0)));
  const enabled = !!cfg?.enabled && (intro > 0 || outro > 0);
  if (!intro && !outro) delete map[vodKey];
  else map[vodKey] = { intro, outro, enabled };
  set("skip_cfg", map);
  syncVodToolButtons();
}
async function openSkipCfgModal() {
  if (P.isLive || !P.vodKey) return toast("当前视频不支持片头片尾设置");
  const cur = getSkipCfg(P.vodKey) || { intro: 0, outro: 0, enabled: true };
  const curSec = Math.floor($("#video")?.currentTime || 0);
  const okPromise = modal("跳过片头 / 片尾（本剧记忆）", `
    <div class="form" style="margin:0;border:none;padding:0">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:8px">
        <input id="skipEnabledIn" type="checkbox" style="width:auto" ${(cur.enabled || (!cur.intro && !cur.outro)) ? "checked" : ""}>
        <span>启用本剧自动跳过片头 / 片尾</span>
      </label>
      <div class="skip-cfg-grid">
        <div class="skip-cfg-col">
          <label>跳过片头（秒）</label>
          <input id="skipIntroIn" type="number" min="0" max="600" inputmode="numeric" value="${cur.intro}">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="m-chip" data-skip-intro="${curSec}">设为当前 (${fmt(curSec)})</button>
            <button type="button" class="m-chip" data-skip-intro="90">90s</button>
            <button type="button" class="m-chip" data-skip-intro="120">120s</button>
            <button type="button" class="m-chip" data-skip-intro="0">清空</button>
          </div>
        </div>
        <div class="skip-cfg-col">
          <label>提前跳过片尾（秒，连播下一集）</label>
          <input id="skipOutroIn" type="number" min="0" max="600" inputmode="numeric" value="${cur.outro}">
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            <button type="button" class="m-chip" data-skip-outro="60">60s</button>
            <button type="button" class="m-chip" data-skip-outro="90">90s</button>
            <button type="button" class="m-chip" data-skip-outro="120">120s</button>
            <button type="button" class="m-chip" data-skip-outro="0">清空</button>
          </div>
        </div>
      </div>
      <div class="hint skip-cfg-hint">设置按剧集记忆并随账号云端同步；续播历史进度时不会覆盖你的历史断点。</div>
    </div>`);
  setTimeout(() => {
    const autoEnable = (val) => {
      const chk = $("#skipEnabledIn");
      if (chk && Number(val) > 0) chk.checked = true;
    };
    document.querySelectorAll("[data-skip-intro]").forEach((b) => {
      b.onclick = () => {
        const el = $("#skipIntroIn");
        if (el) el.value = b.dataset.skipIntro;
        autoEnable(b.dataset.skipIntro);
      };
    });
    document.querySelectorAll("[data-skip-outro]").forEach((b) => {
      b.onclick = () => {
        const el = $("#skipOutroIn");
        if (el) el.value = b.dataset.skipOutro;
        autoEnable(b.dataset.skipOutro);
      };
    });
    ["#skipIntroIn", "#skipOutroIn"].forEach((sel) => {
      $(sel)?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          $("#modalOk")?.click();
        }
      });
    });
  }, 0);
  if (!(await okPromise)) return;
  const intro = Number($("#skipIntroIn")?.value) || 0;
  const outro = Number($("#skipOutroIn")?.value) || 0;
  const enabled = !!$("#skipEnabledIn")?.checked;
  saveSkipCfg(P.vodKey, { intro, outro, enabled });
  if (NH.user && typeof cloudSyncPush === "function") cloudSyncPush(true);
  toast(enabled && (intro > 0 || outro > 0) ? `已保存片头 ${intro}s / 片尾 ${outro}s` : "已关闭本剧跳过片头片尾");
}

function syncVodToolButtons() {
  const isLive = !!P.isLive;
  const hasMulti = !!(P.eps && P.eps.length > 1);
  const hasNext = !isLive && hasMulti && P.idx + 1 < P.eps.length;
  const skipCfg = !isLive && P.vodKey ? getSkipCfg(P.vodKey) : null;
  const skipOn = !!(skipCfg && skipCfg.enabled && (skipCfg.intro > 0 || skipCfg.outro > 0));
  $("#btnFwd30")?.classList.toggle("hidden", isLive);
  $("#btnFwd60")?.classList.toggle("hidden", isLive);
  $("#btnSkipCfg")?.classList.toggle("hidden", isLive || !P.vodKey);
  $("#btnSkipCfg")?.classList.toggle("active", skipOn);
  $("#btnVodDownload")?.classList.toggle("hidden", isLive);
  $("#btnNextEp")?.classList.toggle("hidden", !hasNext);
  $("#btnFsEp")?.classList.toggle("hidden", !hasMulti);
}

function play(title, url, eps = [], idx = 0, vodKey = "", seekTime = 0, isLive = false) {
  if (!NH.user) {
    toast("请先登录账号后观看");
    if (typeof syncAccessGate === "function") syncAccessGate();
    else if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  if (typeof handleExpiredAccessAction === "function" && !handleExpiredAccessAction()) return;
  stopMusicForVideo();
  const layer = $("#playerLayer");
  const wasHidden = layer.classList.contains("hidden");
  P.managed = null;
  P.title = title; P.eps = eps; P.idx = idx; P.vodKey = vodKey; P.isLive = !!isLive; P._outroSkippedIdx = -1;
  P._epState = { page: null, reversed: false };
  $("#playerTitle").textContent = title;
  $("#seek")?.classList.toggle("hidden", P.isLive);
  $("#timeText")?.classList.toggle("hidden", P.isLive);
  $("#liveBadge")?.classList.toggle("hidden", !P.isLive);
  syncVodToolButtons();
  if (typeof openFsEpDrawer === "function") openFsEpDrawer(false);
  layer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (wasHidden) {
    _playerPushed = true;
    history.pushState({ player: true }, "");
  }
  syncModeFab();
  renderEpisodes();
  mountSource(url, seekTime);
}
function selectEpisodeIndex(i) {
  if (!P.eps || !P.eps[i]) return;
  if (P.vodKey && !P.isLive) {
    const v = $("#video");
    if (v && v.currentTime > 1) saveProgress(P.vodKey, P.idx, v.currentTime, true);
  }
  if (P.managed) P.managed.generation++;
  P.idx = i;
  P._outroSkippedIdx = -1;
  syncVodToolButtons();
  renderEpisodes();
  mountSource(P.eps[i].url);
  $("#playerTitle").textContent = P.title.replace(/ · .*$/, "") + " · " + P.eps[i].name;
  if (typeof castState !== "undefined" && castState.active && typeof syncCastEpisode === "function") {
    syncCastEpisode();
  }
}
function renderEpisodes() {
  const el = $("#epList");
  syncVodToolButtons();
  if (!P.eps || P.eps.length <= 1) { if (el) el.innerHTML = ""; return; }
  renderPagedEpisodes(el, P.eps, P.idx, selectEpisodeIndex, P._epState || (P._epState = { page: null, reversed: false }), false);
  const fsBody = $("#fsEpBody");
  if (fsBody && !$("#fsEpDrawer")?.classList.contains("hidden")) {
    renderPagedEpisodes(fsBody, P.eps, P.idx, (i) => { selectEpisodeIndex(i); openFsEpDrawer(false); }, P._epState, false);
  }
}
async function retryManagedPlayback(mountToken) {
  const ctx=P.managed;
  if(!ctx||P.isLive||ctx.retrying||mountToken!==P.mountToken||ctx.attempts>=2)return false;
  ctx.retrying=true;const generation=ctx.generation;
  const label=P.eps[P.idx]?.name;const time=$('#video').currentTime||getProgress(P.vodKey)?.time||0;
  try {
    if(ctx.ticket){nhApi('/api/vod/feedback','POST',{ticket:ctx.ticket,ok:false}).catch(()=>{});ctx.ticket='';}
    const result=await nhApi('/api/vod/search?q='+encodeURIComponent(ctx.item.name));
    const candidates=[];
    for(const item of result.items||[])if(NovaVod.compatible(ctx.item,item))candidates.push(...(item.routes||[{srcId:item.srcId,id:item.id}]));
    for(const route of candidates){
      if(ctx.attempts>=2)break;
      const key=route.srcId+':'+route.id;if(ctx.tried.has(key))continue;
      ctx.tried.add(key);ctx.attempts++;
      const d=await nhApi('/api/vod/detail?source='+encodeURIComponent(route.srcId)+'&id='+encodeURIComponent(route.id)).catch(()=>null);
      if(P.managed!==ctx||generation!==ctx.generation||mountToken!==P.mountToken||$('#playerLayer').classList.contains('hidden'))return false;
      if(!d||!NovaVod.compatible(ctx.item,d.item))continue;
      const eps=d.episodes.map(e=>({name:e.n,url:e.url}));const index=NovaVod.episodeIndex(eps,label);
      if(index<0)continue;
      P.eps=eps;P.idx=index;ctx.ticket=d.ticket;renderEpisodes();
      mountSource(eps[index].url,time);toast('已切换备用线路并保留进度');return true;
    }
    tip('暂无同一版本、同一集数的可用备用线路，请稍后重试');return false;
  }catch{return false;}finally{ctx.retrying=false;}
}

function destroyPlayers() {
  P.mountToken = (P.mountToken || 0) + 1;
  if (P.hls) { P.hls.destroy(); P.hls = null; }
  if (P.flv) { P.flv.destroy(); P.flv = null; }
  const v = $("#video"); v.removeAttribute("src"); v.load();
  if ("mediaSession" in navigator && !curSong) {
    try { navigator.mediaSession.playbackState = "none"; } catch {}
  }
  if (!curSong) clearNativeMedia();
}
function tip(msg, isHtml = false) {
  const el = $("#playerTip");
  if (isHtml) el.innerHTML = msg || "";
  else el.textContent = msg || "";
  el.style.display = msg ? "flex" : "none";
}
async function ensureHlsReady() {
  if (window.Hls) return true;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (window.Hls) return true;
  }
  return false;
}
async function mountSource(url, seekTime = 0, _proxyTried = false) {
  destroyPlayers();
  stopMusicForVideo();
  const mountToken = P.mountToken;
  const playbackTarget = new URL(url, location.href);
  const gatewayOrigin = window.__NH_API_BASE__ ? new URL(window.__NH_API_BASE__).origin : location.origin;
  if (playbackTarget.pathname === "/api/live/m3u8" && playbackTarget.origin === gatewayOrigin) {
    try {
      const result = await nhApi("/api/media/ticket");
      if (mountToken !== P.mountToken) return;
      const target = playbackTarget;
      target.searchParams.set("ticket", result.ticket);
      url = target.href;
    } catch (err) {
      if (mountToken === P.mountToken) tip("播放授权失败，请重新登录后重试");
      return;
    }
  }
  const v = $("#video");
  const skipCfg = (!P.isLive && P.vodKey) ? getSkipCfg(P.vodKey) : null;
  const introTarget = (skipCfg && skipCfg.enabled && skipCfg.intro > 0 && seekTime < skipCfg.intro) ? skipCfg.intro : 0;
  const finalSeek = introTarget > seekTime ? introTarget : seekTime;
  const isIntroSkip = introTarget > 0 && finalSeek === introTarget;
  if (finalSeek > 1 && !P.isLive) {
    let seekDone = false;
    const applySeek = () => {
      if (seekDone) return;
      if (v.duration && finalSeek < (isIntroSkip ? Math.max(0, v.duration - 10) : v.duration)) {
        seekDone = true;
        v.currentTime = finalSeek;
        toast(isIntroSkip ? "已自动跳过片头 (" + fmt(finalSeek) + ")" : ("已续播至 " + fmt(finalSeek)));
      }
    };
    v.addEventListener("loadedmetadata", applySeek, { once: true });
    v.addEventListener("canplay", applySeek, { once: true });
  }
  const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes("/api/live/m3u8");
  const isFlv = /\.flv(\?|$)/i.test(url);
  const isMp4 = /\.(mp4|mkv|webm|ts)(\?|$)/i.test(url);
  $("#qualitySel").innerHTML = "<option>自动</option>";
  paintRange($("#seek"), 0, 0);
  tip("正在缓冲视频流…");
  if (isHls) await ensureHlsReady();
  if (mountToken !== P.mountToken) return;
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
      // 直播或网络跨域错误自动切至平板 /api/live/m3u8 重写代理秒播
      if (!_proxyTried && !url.includes("/api/live/m3u8") && (P.isLive || d.type === Hls.ErrorTypes.NETWORK_ERROR || d.type === Hls.ErrorTypes.MEDIA_ERROR)) {
        const base = window.__NH_API_BASE__ || (location.protocol.startsWith("http") && !location.hostname.endsWith("github.io") ? "" : "");
        if (base || !location.hostname.endsWith("github.io")) {
          tip("直连受限，正经由节点转发直播流…");
          mountSource(`${base}/api/live/m3u8?url=${encodeURIComponent(url)}`, seekTime, true);
          return;
        }
      }
      if (!P.isLive && v.canPlayType("application/vnd.apple.mpegurl")) {
        destroyPlayers();
        v.src = url;
        v.play().catch(() => {});
        tip("");
      } else if (P.isLive) {
        tip(
          `<span>当前直播频道暂不可用 (${esc(d.details || d.type || "连接失败")})</span>` +
          (P.eps && P.eps.length > 1 ? `<button id="nextLiveChBtn" class="btn primary" style="margin-top:10px;padding:6px 14px;font-size:13px">切下一个频道</button>` : ""),
          true
        );
        $("#nextLiveChBtn")?.addEventListener("click", () => selectEpisodeIndex((P.idx + 1) % P.eps.length));
      } else {
        if(!P.managed)tip("视频流异常：" + d.type);
        else retryManagedPlayback(mountToken);
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
  v.onerror = async () => {
    if(mountToken!==P.mountToken)return;
    if(P.isLive && !_proxyTried && !url.includes("/api/live/m3u8")) {
      const base = window.__NH_API_BASE__ || (location.protocol.startsWith("http") && !location.hostname.endsWith("github.io") ? "" : "");
      if (base || !location.hostname.endsWith("github.io")) {
        tip("正在尝试节点转发直播流…");
        mountSource(`${base}/api/live/m3u8?url=${encodeURIComponent(url)}`, seekTime, true);
        return;
      }
    }
    if(P.isLive) {
      tip(
        `<span>当前直播频道暂不可用</span>` +
        (P.eps && P.eps.length > 1 ? `<button id="nextLiveChBtn" class="btn primary" style="margin-top:10px;padding:6px 14px;font-size:13px">切下一个频道</button>` : ""),
        true
      );
      $("#nextLiveChBtn")?.addEventListener("click", () => selectEpisodeIndex((P.idx + 1) % P.eps.length));
      return;
    }
    if(P.managed && await retryManagedPlayback(mountToken))return;
    const kw = (P.title || "").split(" · ")[0].trim();
    tip(
      `<span>当前线路无法播放</span>` +
      (kw ? `<button id="switchSrcBtn" class="btn primary" style="margin-top:10px;padding:6px 14px;font-size:13px">${ico("search")} 检索其他可用片源</button>` : ""),
      true
    );
    const btn = $("#switchSrcBtn");
    if (btn) btn.onclick = () => { closePlayer(); doSearch(kw); };
  };
  v.onplaying=()=>{if(mountToken===P.mountToken&&P.managed?.ticket){nhApi("/api/vod/feedback","POST",{ticket:P.managed.ticket,ok:true}).catch(()=>{});P.managed.ticket="";}};
  v.onloadedmetadata = () => {
    const rate = parseFloat($("#rateSel")?.value || "1") || 1;
    v.playbackRate = rate;
  };
  v.onended = () => {
    if (P.eps && P.idx + 1 < P.eps.length) {
      if(P.managed)P.managed.generation++;
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
  syncVideoMediaSession();
  toast(`播放倍速：${r}x`);
});
$("#qualitySel").addEventListener("change", (e) => {
  if (P.hls) { const i = +e.target.value; P.hls.currentLevel = i; P.hls.nextLevel = i; }
});
let _fsUiTimer = null;
let _lastBoxSwipeAt = 0;

function showGestureToast(msg, autoHideMs = 0) {
  const el = $("#playerGestureToast");
  if (!el) return;
  clearTimeout(showGestureToast._t);
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.classList.remove("hidden");
  if (autoHideMs > 0) {
    showGestureToast._t = setTimeout(() => el.classList.add("hidden"), autoHideMs);
  }
}

function seekByDelta(deltaSec) {
  const v = $("#video");
  if (!v || P.isLive || !isFinite(v.duration) || v.duration <= 0) return;
  const next = Math.max(0, Math.min(Math.max(0, v.duration - 0.5), (v.currentTime || 0) + deltaSec));
  v.currentTime = next;
  if (P.vodKey) saveProgress(P.vodKey, P.idx, next, false);
  showFsControls(true);
  showGestureToast(`${deltaSec >= 0 ? "快进" : "快退"} ${Math.abs(deltaSec) >= 60 ? `${Math.round(Math.abs(deltaSec) / 60)} 分钟` : `${Math.abs(deltaSec)} 秒`} (${fmt(next)})`, 1200);
}

function playNextEpisode() {
  if (!P.eps || P.isLive) return;
  if (P.idx + 1 >= P.eps.length) {
    toast("已是最后一集");
    return;
  }
  selectEpisodeIndex(P.idx + 1);
  toast(`切换至：${P.eps[P.idx].name}`);
}

function openFsEpDrawer(open) {
  const drawer = $("#fsEpDrawer");
  const body = $("#fsEpBody");
  if (!drawer || !body) return;
  const show = open === undefined ? drawer.classList.contains("hidden") : !!open;
  if (!show) {
    drawer.classList.add("hidden");
    showFsControls(true);
    return;
  }
  if (!P.eps || P.eps.length <= 1) return toast("当前影片仅单集");
  if (_fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
  renderPagedEpisodes(body, P.eps, P.idx, (i) => {
    selectEpisodeIndex(i);
    openFsEpDrawer(false);
  }, P._epState || (P._epState = { page: null, reversed: false }), false);
  drawer.classList.remove("hidden");
}

function syncFitButton() {
  const b = $("#btnFit");
  const isCover = $("#playerLayer")?.classList.contains("fs-cover");
  if (b) b.textContent = isCover ? "适应" : "铺满";
}

function showFsControls(autoHide = true) {
  const layer = $("#playerLayer");
  if (!layer) return;
  layer.classList.remove("fs-ui-hide");
  if (_fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
  if (autoHide && layer.classList.contains("is-fs") && !$("#video")?.paused) {
    _fsUiTimer = setTimeout(() => {
      if ($("#playerLayer")?.classList.contains("is-fs") && !$("#video")?.paused) {
        $("#playerLayer").classList.add("fs-ui-hide");
      }
    }, 3500);
  }
}

function toggleFsControls() {
  const layer = $("#playerLayer");
  if (!layer || !layer.classList.contains("is-fs")) return;
  if (layer.classList.contains("fs-ui-hide")) showFsControls(true);
  else {
    if (_fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
    layer.classList.add("fs-ui-hide");
  }
}

function updateFsRotate() {
  const layer = $("#playerLayer");
  if (!layer) return;
  const nativeFs = !!(window.NovaNative && typeof window.NovaNative.setFullscreen === "function");
  if (!layer.classList.contains("is-fs") || nativeFs) {
    layer.classList.remove("fs-rotate");
    return;
  }
  layer.classList.toggle("fs-rotate", window.innerHeight > window.innerWidth);
}

/** 同步视频播放至手机状态栏 / 锁屏 MediaSession 及 APK 原生通知栏 */
function syncVideoMediaSession() {
  const layer = $("#playerLayer");
  const v = $("#video");
  if (!layer || layer.classList.contains("hidden") || !P.title) return;
  const hasDur = !P.isLive && v && isFinite(v.duration) && v.duration > 0;
  syncNativeMedia(P.title, P.isLive ? "电视直播" : "NovaHub 影院", !!(v && !v.paused), "video", {
    lyric: "",
    coverUrl: "",
    positionMs: hasDur && isFinite(v.currentTime) ? v.currentTime * 1000 : 0,
    durationMs: hasDur ? v.duration * 1000 : 0,
    speed: v ? (v.playbackRate || 1) : 1,
  });
  if (!("mediaSession" in navigator)) return;
  try {
    const artUrl = new URL("icon.svg", location.href).href;
    navigator.mediaSession.playbackState = v && !v.paused ? "playing" : "paused";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: P.title,
      artist: P.isLive ? "电视直播" : "NovaHub 影院",
      album: "NovaHub · 星隅",
      artwork: [{ src: artUrl, sizes: "any", type: "image/svg+xml" }],
    });
    if (v && !P.isLive && isFinite(v.duration) && v.duration > 0 && typeof navigator.mediaSession.setPositionState === "function") {
      navigator.mediaSession.setPositionState({
        duration: v.duration,
        playbackRate: v.playbackRate || 1,
        position: Math.max(0, Math.min(v.duration, v.currentTime || 0)),
      });
    }
    navigator.mediaSession.setActionHandler("play", () => v && v.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => v && v.pause());
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (v && !P.isLive && d.seekTime != null && isFinite(v.duration)) {
        v.currentTime = d.seekTime;
        syncVideoMediaSession();
      }
    });
  } catch {}
}

$("#playerBack").onclick = requestAppBack;
$("#playerFav").onclick = () => toast("已记录至观看历史");
$("#btnPlay").onclick = () => { const v = $("#video"); v.paused ? v.play() : v.pause(); showFsControls(true); };
$("#btnFit")?.addEventListener("click", () => {
  $("#playerLayer")?.classList.toggle("fs-cover");
  syncFitButton();
  showFsControls(true);
});
function syncFsButtons(isFs) {
  const b = $("#btnFs");
  if (b) b.innerHTML = `${ico("fullscreen")} ${isFs ? "退出" : "全屏"}`;
  const bf = $("#btnBoxFs");
  if (bf) {
    bf.innerHTML = ico("fullscreen");
    bf.setAttribute("aria-label", isFs ? "退出全屏" : "全屏播放");
  }
}
async function setPlayerFullscreen(enter) {
  const layer = $("#playerLayer"), v = $("#video");
  if (!layer) return;
  syncFsButtons(!!enter);
  if (enter) {
    layer.classList.add("is-fs");
    syncFitButton();
    showFsControls(true);
    if (window.NovaNative && typeof window.NovaNative.setFullscreen === "function") {
      try { window.NovaNative.setFullscreen(true); } catch {}
      return;
    }
    const reqFs = layer.requestFullscreen || layer.webkitRequestFullscreen;
    if (reqFs) {
      try {
        await reqFs.call(layer, { navigationUI: "hide" });
      } catch {
        try { await reqFs.call(layer); } catch {}
      }
      await screen.orientation?.lock?.("landscape").catch(() => {});
      setTimeout(updateFsRotate, 220);
      return;
    }
    if (v && v.webkitEnterFullscreen) {
      try { v.webkitEnterFullscreen(); return; } catch {}
    }
    setTimeout(updateFsRotate, 120);
  } else {
    layer.classList.remove("is-fs", "fs-ui-hide", "fs-rotate", "fs-cover");
    if (typeof openFsEpDrawer === "function") openFsEpDrawer(false);
    if (_fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
    syncFitButton();
    if (window.NovaNative && typeof window.NovaNative.setFullscreen === "function") {
      try { window.NovaNative.setFullscreen(false); } catch {}
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch {}
    }
    try { screen.orientation?.unlock?.(); } catch {}
  }
}
window.__nhExitFs = () => setPlayerFullscreen(false);
window.addEventListener("resize", updateFsRotate);
window.addEventListener("orientationchange", () => setTimeout(updateFsRotate, 120));
["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => {
  document.addEventListener(ev, () => {
    syncOverlayHost($("#modal"));
    syncOverlayHost($("#toast"));
    const nativeFs = !!(window.NovaNative && typeof window.NovaNative.setFullscreen === "function");
    if (!nativeFs && !document.fullscreenElement && !document.webkitFullscreenElement) {
      $("#playerLayer")?.classList.remove("is-fs", "fs-ui-hide", "fs-rotate", "fs-cover");
      if (_fsUiTimer) { clearTimeout(_fsUiTimer); _fsUiTimer = null; }
      syncFitButton();
      syncFsButtons(false);
      try { screen.orientation?.unlock?.(); } catch {}
    }
  });
});

$("#btnFs").onclick = () => {
  const layer = $("#playerLayer");
  const isFs = !!(layer && layer.classList.contains("is-fs")) || !!(document.fullscreenElement || document.webkitFullscreenElement);
  setPlayerFullscreen(!isFs);
};
$("#btnFwd30")?.addEventListener("click", () => seekByDelta(30));
$("#btnFwd60")?.addEventListener("click", () => seekByDelta(60));
$("#btnNextEp")?.addEventListener("click", playNextEpisode);
$("#btnFsEp")?.addEventListener("click", () => openFsEpDrawer());
$("#btnSkipCfg")?.addEventListener("click", openSkipCfgModal);
$("#fsEpClose")?.addEventListener("click", () => openFsEpDrawer(false));
$("#btnVodDownload")?.addEventListener("click", () => {
  const ep = (P.eps && P.eps[P.idx]) || null;
  if (!ep || !ep.url) return toast("当前无可用下载线路");
  const title = (P.title || "视频").split(" · ")[0];
  downloadVodEpisode(title, ep.name || "正片", ep.url);
});
$("#btnCast")?.addEventListener("click", openCastModal);

/* ============ 多方式可选投屏（DLNA + 4位投屏码大屏 + 系统投屏/外部播放器/AirPlay） ============ */
const castState = {
  active: false,
  mode: "", // "dlna" | "room"
  targetName: "",
  udn: "",
  code: "",
  paused: false,
  useProxy: false,
  devices: [],
  scanning: false,
};

function getCurrentCastRawUrl() {
  const ep = (P.eps && P.eps[P.idx]) || null;
  if (ep && ep.url) return ep.url;
  const v = $("#video");
  return v?.currentSrc || v?.src || "";
}

async function resolveCastUrls() {
  const rawUrl = getCurrentCastRawUrl();
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return null;
  let gatewayBase = window.__NH_API_BASE__ || "";
  if (!gatewayBase && location.protocol.startsWith("http") && !location.hostname.endsWith("github.io")) {
    gatewayBase = location.origin;
  }
  let proxyUrl = "";
  if (gatewayBase && !rawUrl.includes("/api/live/m3u8")) {
    try {
      const t = await nhApi("/api/media/ticket");
      if (t && t.ticket) {
        proxyUrl = `${gatewayBase.replace(/\/+$/, "")}/api/live/m3u8?url=${encodeURIComponent(rawUrl)}&ticket=${encodeURIComponent(t.ticket)}`;
      }
    } catch {}
  }
  const titleParts = (P.title || "星隅视频").split(" · ");
  const title = titleParts[0] || "星隅视频";
  const episode = (P.eps && P.eps[P.idx] && P.eps[P.idx].name) || titleParts[1] || "";
  const v = $("#video");
  const position = (!P.isLive && v && isFinite(v.currentTime)) ? Math.floor(v.currentTime) : 0;
  return {
    rawUrl,
    proxyUrl,
    title,
    episode,
    position,
    is_live: !!P.isLive,
  };
}

function renderCastBar() {
  const bar = $("#castBar");
  if (!bar) return;
  if (!castState.active) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    $("#btnCast")?.classList.remove("active");
    return;
  }
  $("#btnCast")?.classList.add("active");
  const modeLabel = castState.mode === "dlna"
    ? `DLNA · ${castState.targetName || "电视"}`
    : `投屏码 ${castState.code}`;
  const hasNext = !!(P.eps && P.eps.length > 1 && !P.isLive && P.idx + 1 < P.eps.length);
  bar.classList.remove("hidden");
  bar.innerHTML = `
    <div class="cast-bar-meta">
      <span class="cast-dot"></span>
      <span>正在投屏：${esc(modeLabel)}${castState.useProxy ? "（代理流）" : ""}</span>
    </div>
    <div class="cast-bar-btns">
      <button type="button" class="cast-mini-btn accent" data-cast-act="toggle">${castState.paused ? "继续" : "暂停"}</button>
      ${!P.isLive ? `<button type="button" class="cast-mini-btn" data-cast-act="rew">-30s</button>
      <button type="button" class="cast-mini-btn" data-cast-act="fwd">+30s</button>` : ""}
      ${hasNext ? `<button type="button" class="cast-mini-btn" data-cast-act="next">下一集</button>` : ""}
      <button type="button" class="cast-mini-btn" data-cast-act="proxy">${castState.useProxy ? "切直链" : "切代理"}</button>
      <button type="button" class="cast-mini-btn danger" data-cast-act="stop">退出</button>
    </div>`;
  bar.querySelectorAll("[data-cast-act]").forEach((btn) => {
    btn.onclick = () => handleCastBarAction(btn.dataset.castAct);
  });
}

async function handleCastBarAction(act) {
  if (!castState.active) return;
  if (act === "stop") {
    await stopActiveCast(false);
    return;
  }
  if (act === "next") {
    playNextEpisode();
    return;
  }
  if (act === "proxy") {
    castState.useProxy = !castState.useProxy;
    await syncCastEpisode();
    renderCastBar();
    return;
  }
  if (act === "toggle") {
    const nextAction = castState.paused ? "play" : "pause";
    if (castState.mode === "dlna") {
      window.NovaNative?.controlDlna?.(nextAction, "");
      castState.paused = !castState.paused;
      renderCastBar();
    } else if (castState.mode === "room") {
      try {
        await nhApi("/api/cast/command", "POST", { code: castState.code, action: nextAction });
        castState.paused = !castState.paused;
        renderCastBar();
      } catch (e) { toast(e.message || "遥控失败"); }
    }
    return;
  }
  if (act === "rew" || act === "fwd") {
    const delta = act === "rew" ? -30 : 30;
    if (castState.mode === "room") {
      try {
        await nhApi("/api/cast/command", "POST", { code: castState.code, action: "seek", payload: { delta } });
        toast(delta > 0 ? "大屏已快进 30 秒" : "大屏已快退 30 秒");
      } catch (e) { toast(e.message || "大屏跳转失败"); }
    } else if (castState.mode === "dlna") {
      const v = $("#video");
      const baseSec = Math.max(0, Math.floor((v?.currentTime || 0) + delta));
      if (v) v.currentTime = baseSec;
      window.NovaNative?.controlDlna?.("seek", String(baseSec));
      toast(`已发送跳转指令（${fmt(baseSec)}）`);
    }
  }
}

async function syncCastEpisode() {
  if (!castState.active) return;
  const info = await resolveCastUrls();
  if (!info) return toast("当前播放源地址不支持投屏");
  const targetUrl = (castState.useProxy && info.proxyUrl) ? info.proxyUrl : info.rawUrl;
  if (castState.mode === "dlna" && castState.udn) {
    window.NovaNative?.castDlna?.(castState.udn, targetUrl, `${info.title} ${info.episode}`.trim());
  } else if (castState.mode === "room" && castState.code) {
    try {
      await nhApi("/api/cast/command", "POST", {
        code: castState.code,
        action: "load",
        payload: {
          url: targetUrl,
          proxy_url: info.proxyUrl || "",
          title: info.title,
          episode: info.episode,
          position: info.position,
          is_live: info.is_live,
        },
      });
      toast(`已同步推送到投屏码 ${castState.code}`);
    } catch (e) {
      toast(e.message || "同步投屏失败");
    }
  }
}

async function stopActiveCast(silent = false) {
  const prevMode = castState.mode;
  const prevCode = castState.code;
  castState.active = false;
  castState.mode = "";
  castState.paused = false;
  renderCastBar();
  if (prevMode === "dlna") {
    try { window.NovaNative?.controlDlna?.("stop", ""); } catch {}
  } else if (prevMode === "room" && prevCode) {
    try { await nhApi("/api/cast/command", "POST", { code: prevCode, action: "stop" }); } catch {}
  }
  if (!silent) toast("已退出投屏");
}

async function startDlnaCast(udn, name) {
  const info = await resolveCastUrls();
  if (!info) return toast("当前线路不支持投屏");
  const targetUrl = (castState.useProxy && info.proxyUrl) ? info.proxyUrl : info.rawUrl;
  try { $("#video")?.pause(); } catch {}
  castState.active = true;
  castState.mode = "dlna";
  castState.udn = udn;
  castState.targetName = name || "DLNA 电视";
  castState.paused = false;
  renderCastBar();
  window.NovaNative.castDlna(udn, targetUrl, `${info.title} ${info.episode}`.trim());
  toast(`正在推送至 ${castState.targetName}…`);
}

async function startRoomCast(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
    return toast("请输入 4 位大屏投屏码");
  }
  const info = await resolveCastUrls();
  if (!info) return toast("当前线路不支持投屏");
  const targetUrl = (castState.useProxy && info.proxyUrl) ? info.proxyUrl : info.rawUrl;
  await nhApi("/api/cast/command", "POST", {
    code,
    action: "load",
    payload: {
      url: targetUrl,
      proxy_url: info.proxyUrl || "",
      title: info.title,
      episode: info.episode,
      position: info.position,
      is_live: info.is_live,
    },
  });
  localStorage.setItem("nh_last_cast_code", code);
  try { $("#video")?.pause(); } catch {}
  castState.active = true;
  castState.mode = "room";
  castState.code = code;
  castState.targetName = `大屏 ${code}`;
  castState.paused = false;
  renderCastBar();
  toast(`已投屏至大屏 ${code}`);
}

function closeCastModal() {
  const m = $("#modal");
  if (m) m.classList.add("hidden");
  $("#modalOk").onclick = $("#modalCancel").onclick = null;
}

function renderCastDeviceList() {
  const box = $("#castDlnaList");
  if (!box) return;
  if (castState.scanning) {
    box.innerHTML = `<div class="hint" style="padding:6px 0">正在扫描局域网支持 DLNA 的电视/盒子…</div>`;
    return;
  }
  if (!castState.devices.length) {
    box.innerHTML = `<div class="hint" style="padding:6px 0">未发现 DLNA 电视，请确保手机与电视在同一 Wi-Fi，或改用下方投屏码/系统投屏。</div>`;
    return;
  }
  box.innerHTML = castState.devices.map((d) => `
    <button type="button" class="cast-dev-item" data-dlna-udn="${esc(d.udn)}" data-dlna-name="${esc(d.name)}">
      <span>${esc(d.name)}</span>
      <small>${esc(d.host || "DLNA")} · 点击投屏</small>
    </button>`).join("");
  box.querySelectorAll("[data-dlna-udn]").forEach((btn) => {
    btn.onclick = () => {
      closeCastModal();
      startDlnaCast(btn.dataset.dlnaUdn, btn.dataset.dlnaName);
    };
  });
}

window.__nhDlnaDevices = (res) => {
  castState.scanning = false;
  castState.devices = Array.isArray(res?.devices) ? res.devices : [];
  renderCastDeviceList();
};

window.__nhDlnaResult = (res) => {
  if (!res) return;
  if (res.message) toast(res.message);
  if (!res.ok && res.action === "cast") {
    castState.active = false;
    renderCastBar();
  }
};

function triggerDlnaScan() {
  if (!window.NovaNative || typeof window.NovaNative.scanDlnaDevices !== "function") return;
  castState.scanning = true;
  renderCastDeviceList();
  window.NovaNative.scanDlnaDevices();
}

async function openCastModal() {
  const rawUrl = getCurrentCastRawUrl();
  if (!rawUrl) return toast("当前没有可投屏的视频地址");
  const hasNativeCast = !!(window.NovaNative && typeof window.NovaNative.hasCastBridge === "function" && window.NovaNative.hasCastBridge());
  const hasAirPlay = !!(typeof $("#video")?.webkitShowPlaybackTargetPicker === "function");
  const lastCode = localStorage.getItem("nh_last_cast_code") || "";
  const tvPageUrl = new URL("tv.html", location.href).href;

  const modalPromise = modal("选择投屏方式", `
    <div style="text-align:left">
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-2);margin-bottom:10px;cursor:pointer">
        <input id="castProxyChk" type="checkbox" style="width:auto" ${castState.useProxy ? "checked" : ""}>
        <span>使用节点代理转发（直链黑屏或防盗链时勾选）</span>
      </label>

      ${hasNativeCast ? `
      <div class="cast-section">
        <div class="cast-section-head">
          <span>1. 局域网 DLNA 电视直投</span>
          <button type="button" id="btnScanDlna" class="cast-mini-btn accent">重新扫描</button>
        </div>
        <div id="castDlnaList" class="cast-dev-list"></div>
      </div>` : ""}

      <div class="cast-section">
        <div class="cast-section-head">
          <span>${hasNativeCast ? "2." : "1."} 4 位投屏码大屏投屏（跨网可用）</span>
          <button type="button" id="btnCopyTvUrl" class="cast-mini-btn">复制大屏地址</button>
        </div>
        <div class="hint" style="font-size:11.5px;word-break:break-all">电视/电脑浏览器打开：${esc(tvPageUrl)}</div>
        <div class="cast-code-row">
          <input id="castCodeIn" class="cast-code-input" maxlength="4" placeholder="4位码" value="${esc(lastCode)}">
          <button type="button" id="btnSendRoomCast" class="btn primary" style="padding:8px 14px;flex-shrink:0">推送大屏</button>
        </div>
      </div>

      <div class="cast-section" style="margin-bottom:0">
        <div class="cast-section-head">
          <span>${hasNativeCast ? "3." : "2."} 更多投屏与播放方式</span>
        </div>
        <div class="cast-more-grid">
          ${hasNativeCast ? `<button type="button" id="btnSysCast" class="cast-more-btn">系统无线投屏</button>
          <button type="button" id="btnExtPlay" class="cast-more-btn">外部播放器打开</button>` : ""}
          ${hasAirPlay ? `<button type="button" id="btnAirPlay" class="cast-more-btn">AirPlay 隔空播放</button>` : ""}
          <button type="button" id="btnCopyCastUrl" class="cast-more-btn">复制播放链接</button>
        </div>
      </div>
    </div>`);

  setTimeout(() => {
    $("#castProxyChk")?.addEventListener("change", (e) => { castState.useProxy = !!e.target.checked; });
    if (hasNativeCast) {
      $("#btnScanDlna")?.addEventListener("click", triggerDlnaScan);
      triggerDlnaScan();
      $("#btnSysCast")?.addEventListener("click", () => {
        closeCastModal();
        window.NovaNative.openSystemCastSettings();
      });
      $("#btnExtPlay")?.addEventListener("click", async () => {
        const info = await resolveCastUrls();
        if (!info) return toast("无法获取播放地址");
        const u = (castState.useProxy && info.proxyUrl) ? info.proxyUrl : info.rawUrl;
        closeCastModal();
        window.NovaNative.openExternalPlayer(u, `${info.title} ${info.episode}`.trim());
      });
    }
    $("#btnCopyTvUrl")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(tvPageUrl); toast("已复制大屏接收地址"); }
      catch { toast(tvPageUrl, 3000); }
    });
    $("#btnSendRoomCast")?.addEventListener("click", async () => {
      const code = $("#castCodeIn")?.value || "";
      try {
        await startRoomCast(code);
        closeCastModal();
      } catch (e) {
        toast(e.message || "大屏投屏失败");
      }
    });
    $("#btnAirPlay")?.addEventListener("click", () => {
      closeCastModal();
      try { $("#video")?.webkitShowPlaybackTargetPicker?.(); }
      catch { toast("当前设备暂不支持 AirPlay 弹窗"); }
    });
    $("#btnCopyCastUrl")?.addEventListener("click", async () => {
      const info = await resolveCastUrls();
      const u = info ? ((castState.useProxy && info.proxyUrl) ? info.proxyUrl : info.rawUrl) : rawUrl;
      try { await navigator.clipboard.writeText(u); toast("已复制视频播放链接"); }
      catch { toast(u, 3000); }
    });
  }, 0);

  await modalPromise;
}
["pointerdown", "input", "change"].forEach((ev) => {
  $(".player-ctrl")?.addEventListener(ev, () => showFsControls(true));
  $(".player-head")?.addEventListener(ev, () => showFsControls(true));
});
(() => {
  const v = $("#video");
  if (!v) return;
  v.addEventListener("play", () => { stopMusicForVideo(); syncVideoMediaSession(); showFsControls(true); });
  v.addEventListener("pause", () => {
    syncVideoMediaSession();
    showFsControls(false);
    if (P.vodKey && !P.isLive && v.currentTime > 1) saveProgress(P.vodKey, P.idx, v.currentTime, true);
  });
  v.addEventListener("loadedmetadata", syncVideoMediaSession);
  v.addEventListener("seeked", syncVideoMediaSession);
})();
$("#seek").addEventListener("input", (e) => {
  const v = $("#video");
  if (!v.duration || P.isLive) return;
  v.currentTime = (e.target.value / 1000) * v.duration;
  paintRange(e.target, e.target.value / 10, getBufferedPct(v));
});
let _lastPaused = null;
let _lastCloudSyncTick = 0;
setInterval(() => {
  const v = $("#video");
  if (!v) return;
  if (_lastPaused !== v.paused) {
    _lastPaused = v.paused;
    $("#btnPlay").innerHTML = ico(v.paused ? "play" : "pause");
  }
  if (!v.duration || !isFinite(v.duration) || P.isLive) return;
  const pct = (v.currentTime / v.duration) * 100;
  const sk = $("#seek");
  if (sk) {
    sk.value = String(Math.round(pct * 10));
    paintRange(sk, pct, getBufferedPct(v));
  }
  $("#timeText").textContent = fmt(v.currentTime) + " / " + fmt(v.duration);
  if (P.vodKey && Math.floor(v.currentTime) % 5 === 0) {
    const nowMs = Date.now();
    const shouldCloud = nowMs - _lastCloudSyncTick >= 10000;
    if (shouldCloud) _lastCloudSyncTick = nowMs;
    saveProgress(P.vodKey, P.idx, v.currentTime, shouldCloud);
  }
  if (!v.paused && P.vodKey && P.eps && P.idx + 1 < P.eps.length && P._outroSkippedIdx !== P.idx) {
    const sc = getSkipCfg(P.vodKey);
    if (sc && sc.enabled && sc.outro > 0 && v.duration > sc.outro + 30 && (v.duration - v.currentTime) <= sc.outro) {
      P._outroSkippedIdx = P.idx;
      toast("已自动跳过片尾，连播下一集");
      selectEpisodeIndex(P.idx + 1);
    }
  }
}, 500);
function fmt(s) {
  s = isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

/* 播放器全屏及竖屏通用手势：左半屏上下调亮度、右半屏上下调声音、左右滑调进度、双击暂停/播放、长按左快退/右3.0x快进 */
(() => {
  const box = $(".player-box");
  const v = $("#video");
  const hud = $("#playerHud");
  const dimmer = $("#playerDimmer");
  let _hudTimer = null;
  let _curBright = 1.0;
  let sx = 0, sy = 0, startTime = 0, startBright = 1.0, startVol = 1.0, targetTime = -1;
  let gestureMode = "", isLeftHalf = true;
  let _lpTimer = null, _rewTimer = null, _prevRate = 1, _wasPausedBeforeLp = false;
  let _clickTimer = null, _lastTapAt = 0, _ignoreNextDblClick = false;

  const showHud = (iconName, text, pct) => {
    if (!hud) return;
    clearTimeout(_hudTimer);
    hud.innerHTML = `<div class="player-hud-row">${ico(iconName)}<span>${esc(text)}</span></div><div class="player-hud-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div>`;
    hud.classList.remove("hidden");
  };
  const hideHudSoon = () => {
    clearTimeout(_hudTimer);
    _hudTimer = setTimeout(() => hud?.classList.add("hidden"), 700);
  };
  const clearLongPressTimers = () => {
    if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
    if (_rewTimer) { clearInterval(_rewTimer); _rewTimer = null; }
  };
  const togglePlayPause = () => {
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      showGestureToast("继续播放", 900);
    } else {
      v.pause();
      showGestureToast("已暂停", 900);
    }
    showFsControls(true);
  };

  box.addEventListener("contextmenu", (e) => e.preventDefault());
  box.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, #fsEpDrawer")) return;
    if (_ignoreNextDblClick) { _ignoreNextDblClick = false; return; }
    if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
    togglePlayPause();
  });
  box.addEventListener("click", (e) => {
    if (e.target.closest("button, #fsEpDrawer")) return;
    if (Date.now() - _lastBoxSwipeAt < 280) return;
    const now = Date.now();
    if (now - _lastTapAt <= 260) {
      _lastTapAt = 0;
      if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
      _ignoreNextDblClick = true;
      setTimeout(() => { _ignoreNextDblClick = false; }, 120);
      togglePlayPause();
      return;
    }
    _lastTapAt = now;
    if (_clickTimer) clearTimeout(_clickTimer);
    _clickTimer = setTimeout(() => {
      _clickTimer = null;
      if ($("#playerLayer")?.classList.contains("is-fs")) toggleFsControls();
    }, 260);
  });
  box.addEventListener("touchstart", (e) => {
    if (e.target.closest("button, #fsEpDrawer")) return;
    if (e.touches.length !== 1) { clearLongPressTimers(); return; }
    const t = e.touches[0];
    sx = t.clientX;
    sy = t.clientY;
    startTime = v.currentTime || 0;
    targetTime = -1;
    gestureMode = "";
    const rect = box.getBoundingClientRect();
    const rotated = $("#playerLayer")?.classList.contains("fs-rotate");
    const relX = rotated ? (t.clientY - rect.top) / Math.max(rect.height, 1) : (t.clientX - rect.left) / Math.max(rect.width, 1);
    isLeftHalf = relX < 0.5;
    if (window.NovaNative && typeof window.NovaNative.getBrightness === "function") {
      try {
        const nb = window.NovaNative.getBrightness();
        if (nb >= 0 && nb <= 1) _curBright = nb;
      } catch {}
    }
    startBright = _curBright;
    if (window.NovaNative && typeof window.NovaNative.getVolume === "function") {
      try {
        const nv = window.NovaNative.getVolume();
        startVol = nv >= 0 && nv <= 1 ? nv : (v.volume || 1);
      } catch { startVol = v.volume || 1; }
    } else {
      startVol = v.volume ?? 1;
    }
    clearLongPressTimers();
    if (!P.isLive && v.duration && isFinite(v.duration)) {
      _lpTimer = setTimeout(() => {
        _lpTimer = null;
        if (gestureMode) return;
        if (!isLeftHalf) {
          gestureMode = "longpress_fwd";
          _prevRate = parseFloat($("#rateSel")?.value || v.playbackRate || "1") || 1;
          _wasPausedBeforeLp = v.paused;
          if (v.paused) v.play().catch(() => {});
          v.playbackRate = 3.0;
          showGestureToast("⏩ 3.0x 快进中");
        } else {
          gestureMode = "longpress_rew";
          _wasPausedBeforeLp = v.paused;
          const stepBack = () => {
            if (!v || !v.duration) return;
            v.currentTime = Math.max(0, (v.currentTime || 0) - 5);
            showGestureToast(`⏪ 快退中 (${fmt(v.currentTime)})`);
          };
          stepBack();
          _rewTimer = setInterval(stepBack, 260);
        }
      }, 450);
    }
  }, { passive: true });
  box.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    if (gestureMode === "longpress_fwd" || gestureMode === "longpress_rew") {
      e.preventDefault();
      return;
    }
    const rotated = $("#playerLayer")?.classList.contains("fs-rotate");
    const rawDx = e.touches[0].clientX - sx;
    const rawDy = e.touches[0].clientY - sy;
    const dx = rotated ? rawDy : rawDx;
    const dy = rotated ? -rawDx : rawDy;

    if (!gestureMode) {
      if (Math.abs(dx) < 14 && Math.abs(dy) < 14) return;
      clearLongPressTimers();
      if (Math.abs(dx) > Math.abs(dy)) {
        if (P.isLive || !v.duration) return;
        gestureMode = "seek";
      } else {
        gestureMode = isLeftHalf ? "bright" : "vol";
      }
    }
    e.preventDefault();
    if (gestureMode === "seek") {
      const delta = Math.round((dx / Math.max(rotated ? box.clientHeight : box.clientWidth, 300)) * 120);
      targetTime = Math.max(0, Math.min(v.duration, startTime + delta));
      const diff = Math.round(targetTime - startTime);
      tip(
        `<span style="display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--accent)">${ico(diff >= 0 ? "forward" : "rewind")} ${diff >= 0 ? "+" : ""}${diff}s (${fmt(targetTime)} / ${fmt(v.duration)})</span>`,
        true
      );
    } else if (gestureMode === "bright") {
      const span = Math.max((rotated ? box.clientWidth : box.clientHeight) * 0.72, 180);
      _curBright = Math.max(0.15, Math.min(1.0, startBright - dy / span));
      if (window.NovaNative && typeof window.NovaNative.setBrightness === "function") {
        try { window.NovaNative.setBrightness(_curBright); } catch {}
      } else if (dimmer) {
        dimmer.style.opacity = ((1 - _curBright) * 0.85).toFixed(2);
      }
      showHud("sun", `亮度 ${Math.round(_curBright * 100)}%`, _curBright * 100);
    } else if (gestureMode === "vol") {
      const span = Math.max((rotated ? box.clientWidth : box.clientHeight) * 0.72, 180);
      const nextVol = Math.max(0, Math.min(1, startVol - dy / span));
      if (window.NovaNative && typeof window.NovaNative.setVolume === "function") {
        try { window.NovaNative.setVolume(nextVol); } catch {}
      } else {
        v.muted = nextVol === 0;
        v.volume = nextVol;
      }
      showHud("volume", `音量 ${Math.round(nextVol * 100)}%`, nextVol * 100);
    }
  }, { passive: false });
  const endTouchGesture = () => {
    clearLongPressTimers();
    if (gestureMode === "longpress_fwd") {
      v.playbackRate = _prevRate || 1;
      if (_wasPausedBeforeLp) v.pause();
      showGestureToast("");
      if (P.vodKey && v.currentTime > 1) saveProgress(P.vodKey, P.idx, v.currentTime, false);
      _lastBoxSwipeAt = Date.now();
    } else if (gestureMode === "longpress_rew") {
      showGestureToast("");
      if (P.vodKey && v.currentTime > 1) saveProgress(P.vodKey, P.idx, v.currentTime, false);
      _lastBoxSwipeAt = Date.now();
    } else if (gestureMode === "seek") {
      if (targetTime >= 0 && v.duration) v.currentTime = targetTime;
      tip("");
      _lastBoxSwipeAt = Date.now();
    } else if (gestureMode) {
      _lastBoxSwipeAt = Date.now();
      hideHudSoon();
    }
    gestureMode = "";
  };
  box.addEventListener("touchend", endTouchGesture);
  box.addEventListener("touchcancel", endTouchGesture);
})();

/* ============ 直播（高清 HTTPS 实测频道 + 分类 + 代理容灾） ============ */
const LIVE_CATS = ["全部", "央视纪录", "地方卫视", "新闻资讯", "电影文旅", "少儿自然", "自定义"];
const DEFAULT_CHANNELS = [
  { name: "CCTV-9 纪录", cat: "央视纪录", url: "https://xykt-fix.github.io/Y77.m3u8" },
  { name: "CCTV+ 1", cat: "央视纪录", url: "https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL1.smil/playlist.m3u8" },
  { name: "CCTV+ 2", cat: "央视纪录", url: "https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL2.smil/playlist.m3u8" },
  { name: "CCTV-4 欧洲", cat: "央视纪录", url: "https://r.eu.cdn-redge.media/livehls/oeu/mt/live/cctv_4/live.livx/playlist.m3u8" },
  { name: "发现中国 1080P", cat: "央视纪录", url: "https://fastlive.cctvplus.com/out/v1/8442c3bfd4c64a3984389328f6087879/index.m3u8" },
  { name: "行游中国 1080P", cat: "央视纪录", url: "https://fastlive.cctvplus.com/out/v1/ca6f9297b7314a63959435028af287fc/index.m3u8" },
  { name: "河北卫视 4K", cat: "地方卫视", url: "https://event.pull.hebtv.com/live/live101.m3u8" },
  { name: "广州综合", cat: "地方卫视", url: "https://tencentplaybusiness.gztv.com/live/zonghes.m3u8" },
  { name: "安徽卫视 1080P", cat: "地方卫视", url: "https://restream.pdtvhd.com/memfs/c1cd2ed0-3b2b-4c25-af98-a7fb0b1eb130.m3u8" },
  { name: "湖南经视", cat: "地方卫视", url: "https://p8.vzan.com/slowlive/415983998730568937/live.m3u8" },
  { name: "西藏汉语", cat: "地方卫视", url: "https://pili-live-hls-zdzz-tv.zzxwcm.cn/zdzz-tv/nqzh.m3u8" },
  { name: "白城综合", cat: "地方卫视", url: "https://stream2.jlntv.cn/baicheng1/sd/live.m3u8" },
  { name: "CGTN 国际 1080P", cat: "新闻资讯", url: "https://amg00405-rakutentv-cgtn-rakuten-i9tar.amagi.tv/master.m3u8" },
  { name: "CGTN 财经 1080P", cat: "新闻资讯", url: "https://fastlive.cctvplus.com/out/v1/2b3d8a0c805d437f9dc85b764c2ac599/index.m3u8" },
  { name: "兰州新闻综合", cat: "新闻资讯", url: "https://liveplus.lzr.com.cn/xwzh/HD/live.m3u8" },
  { name: "安顺新闻综合", cat: "新闻资讯", url: "https://hplayer1.juyun.tv/camera/154379194.m3u8" },
  { name: "TTV 新闻", cat: "新闻资讯", url: "https://live.wcetv.com/hls/master-ttvnews.m3u8" },
  { name: "哈尔滨影视", cat: "电影文旅", url: "https://stream.hrbtv.net/yspd/playlist.m3u8" },
  { name: "兰州文旅", cat: "电影文旅", url: "https://liveplus.lzr.com.cn/wlpd/HD/live.m3u8" },
  { name: "Love Nature 1080P", cat: "电影文旅", url: "https://mumbai-edge.smartplaytv.in/LoveNature/index.m3u8" },
  { name: "金砖中文 1080P", cat: "电影文旅", url: "https://chibrics.mediacdn.ru/cdn/brics/chinese/playlist.m3u8" },
  { name: "BabyFirst 少儿", cat: "少儿自然", url: "https://cdn.fast.jwp.services/v1/channel/1_jB6940Ei_TvhvIHDL/manifest.m3u8" },
  { name: "大爱电视 HD", cat: "少儿自然", url: "https://pull.daaiplus.com/live-DAAIPLUS/live-DAAIPLUS_HD.m3u8" },
];
const CH_VER = "20261127-v5";
const DEAD_LIVE_PATTERNS = ["live.example.com", "ivi.bupt.edu.cn", "ali-m-l.cztv.com/channels/lantian/channel10/1080p.m3u8"];
function mergeLiveChannels(rawList) {
  const customCh = (Array.isArray(rawList) ? rawList : []).filter(
    (c) => c && c.url && !DEAD_LIVE_PATTERNS.some((bad) => String(c.url).includes(bad))
  );
  const seen = new Set(DEFAULT_CHANNELS.map((c) => c.url));
  return DEFAULT_CHANNELS.concat(customCh.filter((c) => !seen.has(c.url)).map((c) => ({ ...c, cat: c.cat || "自定义" })));
}
let channels = get("channels", null);
if (!channels || !channels.length || get("ch_ver", "") !== CH_VER) {
  channels = mergeLiveChannels(channels);
  set("channels", channels);
  set("ch_ver", CH_VER);
}
const saveChannels = () => set("channels", channels);
let curLiveCat = "全部";

function parseM3uLines(txt) {
  const lines = String(txt || "").split(/\r?\n/);
  const list = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].trim();
    if (ln.startsWith("#EXTINF")) {
      const gm = ln.match(/group-title="([^"]*)"/i);
      const grp = gm ? gm[1].trim() : "";
      const nm = ln.split(",").slice(1).join(",").trim() || "频道" + (list.length + 1);
      const u = (lines[i + 1] || "").trim();
      if (u && !u.startsWith("#")) {
        list.push({ name: nm, url: u, cat: LIVE_CATS.includes(grp) ? grp : "自定义" });
        i++;
      }
    } else if (ln && !ln.startsWith("#") && /^https?:\/\//i.test(ln)) {
      list.push({ name: "频道" + (list.length + 1), url: ln, cat: "自定义" });
    }
  }
  return list;
}

function renderLive() {
  const counts = {};
  channels.forEach((c) => {
    const k = c.cat || "自定义";
    counts[k] = (counts[k] || 0) + 1;
  });
  const activeCat = curLiveCat === "全部" || counts[curLiveCat] ? curLiveCat : "全部";
  curLiveCat = activeCat;
  const shown = activeCat === "全部" ? channels : channels.filter((c) => (c.cat || "自定义") === activeCat);
  const catsHtml = LIVE_CATS.filter((cat) => cat === "全部" || counts[cat] > 0).map((cat) => {
    const n = cat === "全部" ? channels.length : counts[cat];
    return `<button class="m-chip ${activeCat === cat ? "active" : ""}" data-lcat="${cat}" type="button">${cat} (${n})</button>`;
  }).join("");
  $("#view").innerHTML = `
    <div class="section-title">${ico("tv")} 高清直播频道 (${shown.length})</div>
    <div class="live-cat-bar" id="liveCatBar">${catsHtml}</div>
    <div class="ch-grid" id="chGrid"></div>
    <button class="btn ghost block" id="addCh">${ico("plus")} 添加频道 / 导入 M3U 订阅链接</button>
    <div class="hint">已收录实测 HTTPS 频道，若遇跨域限制将自动经平板节点转发秒播；支持 M3U 订阅 URL 或文本批量导入。</div>`;
  $("#liveCatBar")?.querySelectorAll(".m-chip").forEach((b) => {
    b.onclick = () => { curLiveCat = b.dataset.lcat || "全部"; renderLive(); };
  });
  $("#chGrid").innerHTML = shown.map((c, i) => `<div class="ch" data-i="${i}"><span class="dot"></span><span>${esc(c.name)}</span></div>`).join("") || `<div class="empty">当前分类暂无频道</div>`;
  $("#chGrid").querySelectorAll(".ch").forEach((el) => el.onclick = () => {
    const c = shown[+el.dataset.i];
    play(c.name, c.url, shown.map((x) => ({ name: x.name, url: x.url })), +el.dataset.i, "", 0, true);
  });
  $("#addCh").onclick = async () => {
    if (!(await modal("添加频道 / 导入 M3U 订阅", `
      <div class="form" style="margin:0;border:none;padding:0">
        <label>M3U 订阅链接（可选，自动拉取并按分类归档）</label><input id="mSubUrl" placeholder="https://.../cn.m3u">
        <label>频道名称（单个添加）</label><input id="mName" placeholder="如 CCTV-9">
        <label>播放地址（m3u8 / flv）</label><input id="mUrl" placeholder="https://...m3u8">
        <label>或粘贴 M3U 列表文本</label><textarea id="mM3u" placeholder="#EXTINF:-1,频道名&#10;https://...m3u8"></textarea>
      </div>`))) return;
    const subUrl = $("#mSubUrl")?.value.trim(), name = $("#mName")?.value.trim(), url = $("#mUrl")?.value.trim(), m3u = $("#mM3u")?.value.trim();
    if (subUrl) {
      toast("正在拉取订阅列表…");
      try {
        const txt = await fetchText(subUrl, 10000);
        const parsed = parseM3uLines(txt);
        const seen = new Set(channels.map((x) => x.url));
        const fresh = parsed.filter((x) => !seen.has(x.url));
        channels = channels.concat(fresh);
        saveChannels(); renderLive(); toast(`已导入 ${fresh.length} 个新频道`);
      } catch (e) { toast("订阅拉取失败：" + e.message); }
    } else if (m3u) {
      const parsed = parseM3uLines(m3u);
      const seen = new Set(channels.map((x) => x.url));
      const fresh = parsed.filter((x) => !seen.has(x.url));
      channels = channels.concat(fresh);
      saveChannels(); renderLive(); toast(`已导入 ${fresh.length} 个频道`);
    } else if (name && url) {
      channels.push({ name, url, cat: "自定义" }); saveChannels(); renderLive(); toast("频道已添加");
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
    data: Object.fromEntries([K.SOURCE, ...SYNC_KEYS].map((k) => [k, get(k, null)])),
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
  const d=obj.data||obj;
  if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('备份格式无效');
  const merged=NovaHistory.merge(historyState(),d);
  try {
    _isRestoring=true;
    for(const k of SYNC_KEYS)if(d[k]!==undefined&&d[k]!==null&&!['history','progress','history_deleted','history_cleared_at'].includes(k))set(k,d[k]);
    if (d.channels !== undefined && typeof mergeLiveChannels === 'function') set('channels', mergeLiveChannels(d.channels));
    applyHistoryState(merged);
    if(d.music_fav&&!d.music_favs)set('music_favs',d.music_fav);
    if(Array.isArray(d.source)){sources=d.source;set(K.SOURCE,sources);migrateLegacySources().catch(()=>{});}
    if(typeof P!=='undefined'&&P.vodKey){const threshold=Math.max(merged.history_cleared_at||0,merged.history_deleted[P.vodKey]||0);if(threshold&&!merged.history.some(x=>NovaHistory.key(x)===P.vodKey))historyBlocked.add(P.vodKey);}
  }finally{_isRestoring=false;}
}

/* ============ 我的（NovaHub Pro 会员中心 + 源管理 + 数据设置） ============ */
function renderMe() {
  const u = NH.user;
  const pro = isProUser();
  const accStatus = getAccessStatus();
  const remainTxt = u && u.access_remain_sec ? formatAccessRemain(u.access_remain_sec) : "";
  let badgeCls = "gray";
  let badgeText = "未登录";
  let expText = "登录或注册账号，立享新用户免费体验";
  if (u) {
    if (accStatus === "active") {
      badgeCls = "";
      badgeText = "PRO 已解锁";
      expText = `Pro 会员生效中 · 剩余 ${u.remain_days} 天（免推广 + 无损音质）`;
    } else if (accStatus === "exempt") {
      badgeCls = "";
      badgeText = "永久豁免";
      expText = "老用户永久畅享版 · 兑换 Pro 卡密可额外享免推广与无损音质";
    } else if (accStatus === "trial") {
      badgeCls = "";
      badgeText = "体验中";
      expText = `新用户全功能体验中 · 剩余 ${remainTxt || (u.trial_remain_days + " 天")}（兑换卡密可叠加延长）`;
    } else {
      badgeCls = "gray";
      badgeText = "已到期";
      expText = "免费体验期已结束 · 请兑换卡密解锁全部影视、音乐与小说功能";
    }
  }

  $("#view").innerHTML = `
    <div class="vip-card">
      <div class="vip-top">
        <div class="vip-ava">${ico(pro || accStatus === "exempt" ? "crown" : "user")}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15.5px;font-weight:700;display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <span>${u ? esc(u.username) : "未登录游客"}</span>
            <span class="badge ${badgeCls}">${badgeText}</span>
            <span class="badge gray" style="font-size:10px;opacity:.85">v2.5.2</span>
          </div>
          <div class="hint" style="margin-top:3px">${esc(expText)}</div>
        </div>
      </div>
      <div class="vip-compare">
        <div class="vc-col">
          <div class="vc-head">标准免费版</div>
          <div>• 影视、阅读与系统听书</div>
          <div>• 标准 128k / 192k</div>
          <div>• 可能展示站内赞助位</div>
          <div>• 账号云同步收藏</div>
        </div>
        <div class="vc-col pro">
          <div class="vc-head">${ico("crown")} Pro 尊享版</div>
          <div>• 免站内广告</div>
          <div>• 320k / FLAC（以曲源为准）</div>
          <div>• 会员专属标识</div>
          <div>• 普通版云同步权益保留</div>
        </div>
      </div>
      <div class="vip-actions">
        ${u ? `
          <button class="btn primary" id="btnRedeem">${ico("crown")} 卡密兑换 / 续期</button>
          <button class="btn ghost" id="btnCloudPush">${ico("upload")} 云端备份</button>
          <button class="btn ghost" id="btnCloudPull">${ico("download")} 云端恢复</button>
          <button class="btn ghost" id="btnLogout" style="flex:0 0 auto">退出</button>
        ` : `
          <button class="btn primary" id="btnLoginOpen">登录 / 注册账号</button>
          <button class="btn ghost" id="btnSponsorInfo">${ico("crown")} 卡密激活 Pro</button>
        `}
      </div>
    </div>

    <div class="node-status" id="nodeStatusBox">
      <span class="node-dot" id="nodeDot"></span>
      <span id="nodeLatency">正在探测节点…</span>
      <span class="node-url" id="nodeUrlText"></span>
      <button class="node-refresh" id="btnNodeRefresh" type="button">刷新节点</button>
    </div>

    <div class="section-title">数据维护</div>
    <div class="group">
      ${window.NovaNative && typeof window.NovaNative.checkUpdate === "function" ? `<div class="row" id="checkApkUpdate"><span class="r-ico">${ico("download")}</span><div class="r-main"><div class="r-title">检查客户端 APK 更新</div><div class="r-sub" id="apkVerSub">正在读取原生壳版本…</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>` : ""}
      <div class="row" id="refreshWebHotfix"><span class="r-ico">${ico("wave")}</span><div class="r-main"><div class="r-title">刷新最新网页界面（免装 APK 热更新）</div><div class="r-sub">当前网页热更版本：${WEB_VERSION}</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
      <div class="row" id="goWebdav"><span class="r-ico">${ico("cloud")}</span><div class="r-main"><div class="r-title">WebDAV 与本地文件备份</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
      <div class="row danger" id="clearAll"><span class="r-ico">${ico("trash")}</span><div class="r-main"><div class="r-title">重置并清空本机缓存数据</div></div><span class="r-arrow">${ico("chevronRight")}</span></div>
    </div>

    <div class="section-title">版本信息</div>
    <div class="hint">NovaHub · 星隅（网页热更版 ${WEB_VERSION}）— 私人影视放映、黑胶听音与精品小说阅读终端。<br>内置高清影视片库、无损音乐曲库与流式在线小说阅读引擎。</div>`;

  $("#refreshWebHotfix")?.addEventListener("click", () => {
    toast("正在获取最新热更新…");
    location.replace(location.pathname + "?t=" + Date.now());
  });
  if ($("#checkApkUpdate") && window.NovaNative) {
    try {
      const ver = window.NovaNative.getAppVersion ? window.NovaNative.getAppVersion() : "已安装";
      $("#apkVerSub").textContent = `当前客户端壳版本：${ver}`;
    } catch {}
    $("#checkApkUpdate").onclick = () => {
      try { window.NovaNative.checkUpdate(); } catch { toast("触发更新检查失败"); }
    };
  }

  if (!u) {
    $("#btnLoginOpen").onclick = openAuthModal;
    $("#btnSponsorInfo").onclick = () => modal("赞助获取 NovaHub Pro", `<div class="hint" style="font-size:13px;line-height:1.7">${esc(NH.cfg.sponsor_tip || "请联系站长获取兑换卡密，登录后即可一键激活 Pro 会员。")}</div>`);
  } else {
    $("#btnRedeem").onclick = openRedeemModal;
    $("#btnCloudPush").onclick = () => cloudSyncPush(false);
    $("#btnCloudPull").onclick = () => cloudSyncPull(false);
    $("#btnLogout").onclick = () => {
      if (typeof sendPresenceLogout === "function") sendPresenceLogout();
      authSession.clear();
      if (typeof refreshNotifications === "function") refreshNotifications(true);
      renderMe(); toast("已退出登录");
    };
  }

  const probeNode = async () => {
    const dot = $("#nodeDot"), lat = $("#nodeLatency"), urlEl = $("#nodeUrlText");
    if (!dot || !lat) return;
    dot.className = "node-dot";
    lat.textContent = "测速中…";
    const base = window.__NH_API_BASE__ || location.origin;
    if (urlEl) urlEl.textContent = "";
    const t0 = performance.now();
    try {
      const r = await fetch("/api/config?ping=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      dot.className = "node-dot ok";
      lat.textContent = `节点在线 ${Math.round(performance.now() - t0)}ms`;
    } catch {
      dot.className = "node-dot err";
      lat.textContent = "节点连接异常";
    }
  };
  probeNode();
  const refBtn = $("#btnNodeRefresh");
  if (refBtn) refBtn.onclick = async () => {
    refBtn.disabled = true;
    try {
      if (typeof window.__NH_REFRESH_ENDPOINT__ === "function") await window.__NH_REFRESH_ENDPOINT__();
      await probeNode();
      toast("已刷新服务节点");
    } finally {
      refBtn.disabled = false;
    }
  };

  $("#goWebdav").onclick = () => go("webdav");
  $("#clearAll").onclick = async () => {
    if (await modal("清空本机数据", "将重置本机观看进度、影视片单、音乐收藏与小说书架，确定继续？")) {
      [K.SOURCE, K.LIKE, K.HISTORY, K.WEBDAV, "channels", "music_favs", "music_fav_groups", "music_hist", "progress", "novel_shelf", "novel_hist", "novel_prog", "novel_cfg"].forEach((k) => {
        delete _mem[k];
        localStorage.removeItem(k);
      });
      sources = []; channels = DEFAULT_CHANNELS.slice();
      renderMe(); toast("本机数据已重置");
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

function normalizeNovelCover(url) {
  let raw = String(url || "").trim();
  if (!raw) return "";
  raw = raw.replace(/^https?:\/\/[^/]*bytecdn\.cn\//i, "https://p6-novel.byteimg.com/");
  if (/^http:\/\/[^/]*byteimg\.com\//i.test(raw)) raw = "https://" + raw.slice(7);
  return raw;
}
window._novelCovErr = (el, mode) => {
  if (!el) return;
  const cur = String(el.getAttribute("src") || el.src || "");
  if (!el.dataset.covRetry && cur.includes("p6-novel.byteimg.com")) {
    el.dataset.covRetry = "1";
    el.src = cur.replace("p6-novel.byteimg.com", "p3-novel.byteimg.com");
    return;
  }
  if (mode === "detail") el.style.display = "none";
  else _imgPh(el, "book", mode || "novel-cov");
};

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
      cover: normalizeNovelCover(book.cover),
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
    cover: normalizeNovelCover(book.cover),
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
    const cov = normalizeNovelCover(b.cover);
    const badgeHtml = prog
      ? `<span class="badge">读至 第${prog.index}章</span>`
      : (b.score ? `<span class="novel-score">${esc(b.score)} 分</span>` : "");
    return `<div class="novel-card">
      ${cov ? `<img class="novel-cov" loading="lazy" referrerpolicy="no-referrer" src="${esc(cov)}" onerror="_novelCovErr(this,'novel-cov')">` : `<div class="novel-cov">${ico("book")}</div>`}
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
  applyStagger(container);
}

let _novelCatReq = 0;
async function loadNovelCategory(cat = curNovelCat) {
  const reqId = ++_novelCatReq;
  curNovelCat = cat;
  novelIsSearch = false;
  const cached = get("novel_cat_" + cat, null);
  novelStoreList = Array.isArray(cached) && cached.length ? cached : [];
  if (currentRoute === "n_store") renderNovelStore(true);
  try {
    const r = await fetch(`/api/novel/search?q=${encodeURIComponent(cat)}`);
    const d = await r.json();
    if (reqId !== _novelCatReq || novelIsSearch || curNovelCat !== cat) return;
    if (Array.isArray(d.items) && d.items.length) {
      novelStoreList = d.items;
      set("novel_cat_" + cat, d.items);
      if (currentRoute === "n_store") renderNovelStore(true);
      return;
    }
  } catch {}
  if (reqId === _novelCatReq && !novelStoreList.length && currentRoute === "n_store") {
    const wrap = $("#nStoreWrap");
    if (wrap) wrap.innerHTML = `<div class="empty">书城连接超时，请使用顶部搜索框直接检索书名</div>`;
  }
}

async function searchNovel(q) {
  if (!q) return;
  _novelCatReq++;
  cancelActiveSearch(true);
  const mine = ++viewRequest;
  const ac = new AbortController();
  _searchAbort = ac;
  novelIsSearch = true;
  novelSearchKw = q;
  if (currentRoute !== "n_store") {
    currentRoute = "n_store";
    viewStack.length = 0;
    renderTabbar();
  }
  setSearchLoading(true);
  $("#view").innerHTML = `<div class="section-title">${ico("search")} 搜索：${esc(q)}</div>${renderSearchLoadingHtml(q, "正在检索书城书库…")}`;
  try {
    const r = await fetch(`/api/novel/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
    const d = await r.json();
    if (mine !== viewRequest || ac.signal.aborted) return;
    novelStoreList = sortByExactMatch(Array.isArray(d.items) ? d.items : [], q, (x) => x.title || x.name, (x) => x.author);
    renderNovelStore();
  } catch (e) {
    if (mine !== viewRequest || ac.signal.aborted) return;
    $("#view").innerHTML = `<div class="empty">检索失败：${esc(e.message)}</div>`;
  } finally {
    if (_searchAbort === ac) _searchAbort = null;
    if (mine === viewRequest) setSearchLoading(false);
  }
}

function renderNovelStore(skipAutoLoad = false) {
  $("#view").innerHTML = `
    ${typeof renderTrialBannerHtml === "function" ? renderTrialBannerHtml() : ""}
    <div id="adminBannerSlot">${typeof renderAdminBannerHtml === "function" ? renderAdminBannerHtml(false) : ""}</div>
    <div class="m-chips">${NOVEL_CATS.map((c) => `<button class="m-chip ${!novelIsSearch && curNovelCat === c.id ? "active" : ""}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join("")}</div>
    ${renderAdSlotHtml('novel')}
    <div class="section-title" style="justify-content:space-between">
      <span>${ico("book")} ${novelIsSearch ? `「${esc(novelSearchKw)}」搜索结果 (${novelStoreList.length})` : `${esc(curNovelCat)} · 精选推荐 (${novelStoreList.length})`}</span>
    </div>
    <div id="nStoreWrap"></div>`;
  bindAdSlots($("#view"));
  if (typeof bindAdminBanners === "function") bindAdminBanners($("#view"));
  document.querySelectorAll(".m-chip[data-cat]").forEach((el) => {
    el.onclick = () => {
      const targetCat = el.dataset.cat;
      if (!targetCat) return;
      const inp = $("#searchInput");
      if (inp) inp.value = "";
      if (!novelIsSearch && curNovelCat === targetCat && novelStoreList.length) return;
      loadNovelCategory(targetCat);
    };
  });
  const wrap = $("#nStoreWrap");
  if (!novelStoreList.length && !novelIsSearch) {
    wrap.innerHTML = `<div class="empty">正在加载精选书单…</div>`;
    if (!skipAutoLoad) loadNovelCategory(curNovelCat);
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
  const cov = normalizeNovelCover(book.cover);
  const meta = [book.author || "未知作者", book.category, book.status, book.score ? `${book.score} 分` : ""].filter(Boolean).join(" · ");
  $("#view").innerHTML = `
    ${backBar(book.title)}
    <div class="form">
      <div style="display:flex;gap:13px">
        ${cov ? `<img referrerpolicy="no-referrer" src="${esc(cov)}" style="width:88px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--line);flex-shrink:0" onerror="_novelCovErr(this,'detail')">` : ""}
        <div style="flex:1;min-width:0">
          <div style="font-size:16px;font-weight:700;line-height:1.35">${esc(book.title)}</div>
          <div class="hint" style="margin-top:5px">${esc(meta)}</div>
          ${prog ? `<div style="margin-top:7px"><span class="badge">上次读至：${esc(prog.title || `第${prog.index}章`)}</span></div>` : ""}
        </div>
      </div>
      <div class="hint" style="margin-top:11px;white-space:pre-line;max-height:110px;overflow-y:auto">${esc(book.abstract || "暂无作品简介")}</div>
      <div style="display:flex;gap:8px;margin-top:13px;flex-wrap:wrap">
        <button class="btn primary" id="btnReadStart" style="flex:1">${ico("book")} ${prog ? `继续阅读 (第${prog.index}章)` : "立即在线阅读"}</button>
        <button class="btn ghost" id="btnShelfToggle">${ico(inShelf ? "bookmarkFill" : "bookmark")} ${inShelf ? "已在书架" : "加入书架"}</button>
        ${NH.user ? `<button class="btn ghost ${inShelf ? "" : "hidden"}" id="btnNovelNotify">${ico("bell")} ${getWatchNotifyEnabled("novel", String(book.book_id)) ? "提醒开" : "提醒关"}</button>` : ""}
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
    $("#btnNovelNotify")?.classList.toggle("hidden", !nowOn);
  };
  $("#btnNovelNotify")?.addEventListener("click", async () => {
    const cur = getWatchNotifyEnabled("novel", String(book.book_id));
    await toggleWatchNotify("novel", String(book.book_id), !cur, book.title, { book_id: String(book.book_id), title: book.title, author: book.author || "", cover: book.cover || "" }, $("#btnNovelNotify"));
  });

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

async function loadReaderChapter(index, restoreRatio = 0, fromTts = false) {
  if (!R.book || !R.chapters.length) return;
  if (!fromTts) stopNovelTts();
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
    if (myToken !== R.token) return false;

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
    return true;
  } catch (e) {
    if (myToken !== R.token) return false;
    $("#readerArticle").innerHTML = `
      <h2>${esc(chMeta ? chMeta.title : `第${index}章`)}</h2>
      <div class="empty" style="padding:36px 0">
        章节加载失败：${esc(e.message)}<br><br>
        <button class="btn primary" id="rRetryBtn">点击重试</button>
      </div>`;
    const btn = $("#rRetryBtn");
    if (btn) btn.onclick = () => loadReaderChapter(index, restoreRatio);
    return false;
  }
}

function openNovelReader(book, chapters, index = 1) {
  if (typeof handleExpiredAccessAction === "function" && !handleExpiredAccessAction()) return;
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
  $("#readerBack").innerHTML = ico("back");
  $("#readerFsBtn").innerHTML = ico("fullscreen");
  $("#rTocBtn").innerHTML = `${ico("list")} 目录`;
  $("#rTtsBtn").innerHTML = `${ico("volume")} 听书`;
  $("#rTtsBtn").onclick = toggleNovelTts;

  $("#readerBack").onclick = requestAppBack;
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
async function nhApi(path, method = "GET", body = null) {
  const headers = { "Content-Type": "application/json" };
  if (NH.token) headers["Authorization"] = "Bearer " + NH.token;
  if (typeof getDeviceId === "function") {
    headers["X-Device-Id"] = encodeURIComponent(String(getDeviceId() || ""));
    headers["X-Client-Type"] = isAppClient() ? "app" : "web";
    headers["X-Device-Info"] = encodeURIComponent(String(getDeviceInfo() || ""));
  }
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 403 && d.code === "ACCESS_EXPIRED" && NH.user) {
      NH.user = { ...NH.user, has_access: false, access_status: "expired", is_pro: false };
      set("nh_user", NH.user);
      if (typeof syncAccessGate === "function") syncAccessGate();
    }
    const err = new Error(d.error || ("HTTP " + r.status));
    err.status = r.status;
    err.code = d.code || "";
    throw err;
  }
  return d;
}

/* ============ 在线状态心跳与音乐/影视媒体下载 ============ */
let _lastCloudPullAt = 0;
async function sendPresenceHeartbeat() {
  if (!NH.user || !NH.token) return;
  try {
    const d = await nhApi("/api/auth/heartbeat", "POST", {
      device_id: getDeviceId(),
      client_type: isAppClient() ? "app" : "web",
      device_info: getDeviceInfo(),
    });
    if (d && d.notif_digest && typeof applyNotifDigest === "function") {
      applyNotifDigest(d.notif_digest);
    }
  } catch {}
}
function sendPresenceLogout() {
  if (!NH.token) return;
  try {
    fetch("/api/auth/logout", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + NH.token,
        "X-Device-Id": getDeviceId(),
      },
      body: JSON.stringify({ device_id: getDeviceId() }),
    }).catch(() => {});
  } catch {}
}
setInterval(() => {
  if (typeof document !== "undefined" && document.visibilityState === "visible" && NH.user && NH.token) {
    sendPresenceHeartbeat();
  }
}, 45000);

function sanitizeDownloadName(name, fallback = "novahub-media") {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\r\n\x00-\x1f]+/g, "_").trim();
  return cleaned || fallback;
}
function triggerBrowserFileDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function downloadViaGatewayOrNative(rawUrl, filename) {
  const safeName = sanitizeDownloadName(filename);
  const res = await nhApi("/api/media/ticket");
  const base = window.__NH_API_BASE__ || "";
  const dlUrl = `${base}/api/media/download?url=${encodeURIComponent(rawUrl)}&name=${encodeURIComponent(safeName)}&ticket=${encodeURIComponent(res.ticket)}`;
  if (window.NovaNative && typeof window.NovaNative.downloadMedia === "function") {
    try {
      const ok = window.NovaNative.downloadMedia(dlUrl, safeName);
      if (ok) { toast(`已加入系统下载：${safeName}`); return; }
    } catch {}
  }
  triggerBrowserFileDownload(dlUrl, safeName);
  toast(`已开始下载：${safeName}`);
}
async function downloadMusicTrack(song) {
  if (!NH.user) {
    toast("请先登录账号后再下载");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  if (!song) return;
  toast("正在解析音频下载链接…");
  try {
    const playUrl = ensureHttpsAudio(await resolveSongUrl(song));
    if (!playUrl) return toast("暂无可下载的音频直链");
    const extMatch = playUrl.match(/\.(flac|mp3|m4a|aac|ogg|wav)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : (mBr === "999" ? "flac" : "mp3");
    const fname = `${song.name || "歌曲"} - ${song.artist || "未知歌手"}.${ext}`;
    await downloadViaGatewayOrNative(playUrl, fname);
  } catch (e) {
    toast("音频下载失败：" + (e.message || "未知错误"), 2400);
  }
}
async function downloadVodEpisode(title, epName, rawUrl) {
  if (!NH.user) {
    toast("请先登录账号后再下载");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  if (!rawUrl) return toast("暂无可用下载链接");
  const baseName = `${title || "视频"} - ${epName || "正片"}`;
  const isHls = /\.m3u8(\?|$)/i.test(rawUrl) || rawUrl.includes("/api/live/m3u8");
  if (!isHls) {
    const extMatch = rawUrl.match(/\.(mp4|mkv|webm|flv|ts|m4v)(\?|$)/i);
    const ext = extMatch ? extMatch[1].toLowerCase() : "mp4";
    try {
      await downloadViaGatewayOrNative(rawUrl, `${baseName}.${ext}`);
    } catch (e) {
      toast("视频下载失败：" + (e.message || "未知错误"), 2400);
    }
    return;
  }

  let aborted = false;
  let ticket = "";
  try {
    const tRes = await nhApi("/api/media/ticket");
    ticket = tRes.ticket;
  } catch (e) {
    return toast("获取下载授权失败：" + (e.message || "请重试"), 2400);
  }
  const base = window.__NH_API_BASE__ || "";
  const buildProxy = (u, isM3u = false) => `${base}${isM3u ? "/api/live/m3u8" : "/api/live/seg"}?url=${encodeURIComponent(u)}&ticket=${encodeURIComponent(ticket)}`;
  const resolveM3uSegments = async (m3uProxyUrl, depth = 0) => {
    if (depth > 3) throw new Error("M3U8 嵌套层数过深");
    const r = await fetch(m3uProxyUrl);
    if (!r.ok) throw new Error("获取分片清单失败 HTTP " + r.status);
    const txt = await r.text();
    const lines = txt.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const segs = [];
    let firstSub = "";
    let prevInf = false;
    for (const ln of lines) {
      if (ln.startsWith("#EXT-X-STREAM-INF")) { prevInf = true; continue; }
      if (ln.startsWith("#")) { prevInf = false; continue; }
      const absUrl = new URL(ln, new URL(m3uProxyUrl, location.href)).href;
      if (prevInf || /\.m3u8(\?|$)/i.test(ln)) {
        if (!firstSub) firstSub = absUrl;
      } else {
        segs.push(absUrl);
      }
      prevInf = false;
    }
    if (!segs.length && firstSub) return resolveM3uSegments(firstSub, depth + 1);
    return segs;
  };

  $("#modalTitle").textContent = "下载影片：" + baseName;
  $("#modalBody").innerHTML = `
    <div style="font-size:13px;line-height:1.6">
      <div id="vodDlStatus" style="color:var(--text)">正在解析 HLS 视频分片列表…</div>
      <div style="margin:10px 0;height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden">
        <div id="vodDlBar" style="width:0%;height:100%;background:var(--accent);transition:width .15s"></div>
      </div>
      <div id="vodDlSub" class="hint">若分片过多（&gt; 150MB），建议使用外部下载器直接抓取 M3U8 链接</div>
      <button id="vodDlCopyM3u" class="btn ghost" type="button" style="margin-top:8px;width:100%">复制直链 M3U8 地址</button>
    </div>`;
  $("#modalOk").textContent = "隐藏";
  $("#modalCancel").textContent = "取消下载";
  $("#modal").classList.remove("hidden");
  $("#vodDlCopyM3u")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rawUrl); toast("已复制 M3U8 链接"); } catch { toast("复制失败，请手动复制"); }
  });
  const cleanupModal = () => {
    $("#modal").classList.add("hidden");
    $("#modalOk").textContent = "确定";
    $("#modalCancel").textContent = "取消";
    $("#modalOk").onclick = $("#modalCancel").onclick = null;
  };
  $("#modalOk").onclick = cleanupModal;
  $("#modalCancel").onclick = () => { aborted = true; cleanupModal(); toast("已取消下载"); };

  try {
    const segUrls = await resolveM3uSegments(buildProxy(rawUrl, true));
    if (aborted) return;
    if (!segUrls.length) throw new Error("未解析到可下载的视频分片");
    const total = segUrls.length;
    const chunks = new Array(total);
    let done = 0;
    let totalBytes = 0;
    let nextIdx = 0;
    const workers = Array.from({ length: Math.min(3, total) }, async () => {
      while (!aborted) {
        const cur = nextIdx++;
        if (cur >= total) return;
        let buf = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const resp = await fetch(segUrls[cur]);
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            buf = await resp.arrayBuffer();
            break;
          } catch (err) {
            if (attempt === 1) throw err;
          }
        }
        chunks[cur] = buf;
        totalBytes += buf.byteLength;
        done++;
        const stEl = $("#vodDlStatus"), barEl = $("#vodDlBar");
        if (stEl) stEl.textContent = `正在下载分片 ${done} / ${total}（已缓存 ${(totalBytes / 1048576).toFixed(1)} MB）`;
        if (barEl) barEl.style.width = `${Math.round((done / total) * 100)}%`;
        if (totalBytes > 240 * 1048576) {
          aborted = true;
          throw new Error("单集体积超过浏览器合并上限 (240MB)，请复制 M3U8 链接使用专业下载器");
        }
      }
    });
    await Promise.all(workers);
    if (aborted) return;
    const blob = new Blob(chunks, { type: "video/mp2t" });
    const blobUrl = URL.createObjectURL(blob);
    triggerBrowserFileDownload(blobUrl, sanitizeDownloadName(baseName + ".ts"));
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    cleanupModal();
    toast("下载完成：" + sanitizeDownloadName(baseName + ".ts"));
  } catch (e) {
    if (!aborted) {
      const stEl = $("#vodDlStatus");
      if (stEl) stEl.textContent = "下载失败：" + (e.message || "网络异常");
      toast("下载失败：" + (e.message || "网络异常"), 2600);
    }
  }
}

async function loadSiteConfig() {
  try {
    const cfg = await nhApi("/api/config");
    NH.cfg = cfg;
    NH.offline = false;
    set("nh_site_cfg", cfg);
    if (typeof _publicAnnouncements !== "undefined") {
      _publicAnnouncements = Array.isArray(cfg.public_announcements) ? cfg.public_announcements : [];
    }
    if (typeof syncAccessGate === "function") syncAccessGate();
    const gSlot = $("#gateNoticeSlot");
    if (gSlot && typeof renderAdminBannerHtml === "function") {
      gSlot.innerHTML = renderAdminBannerHtml(true);
      if (typeof bindAdminBanners === "function") bindAdminBanners(gSlot);
    }
    if (typeof refreshHomeAdminBanner === "function") refreshHomeAdminBanner();
    if (!viewStack.length && hasActiveAccess() && (currentRoute === "home" || currentRoute === "n_store" || currentRoute === "m_discover")) {
      routes[currentRoute]();
    }
  } catch {}
}

let _authVerifiedOnce = false;
async function refreshAuthUser() {
  if (!NH.token) {
    _authVerifiedOnce = true;
    if (typeof syncAccessGate === "function") syncAccessGate();
    return;
  }
  const result = await authSession.refresh();
  _authVerifiedOnce = true;
  if (result === 'valid') {
    if (typeof syncAccessGate === "function") syncAccessGate();
    if (typeof sendPresenceHeartbeat === 'function') sendPresenceHeartbeat();
    if (typeof refreshNotifications === 'function') refreshNotifications(true);
    await cloudSyncPull(true);
    if (!viewStack.length && hasActiveAccess() && ["me","home","n_store","m_fav","n_shelf"].includes(currentRoute)) routes[currentRoute]();
  } else if (result === 'invalid') {
    if (typeof syncAccessGate === "function") syncAccessGate();
    if (currentRoute === 'me') renderMe();
  } else if (result === 'offline' && NH.user) {
    if (typeof syncAccessGate === "function") syncAccessGate();
    toast("节点正在重连，已保持本地登录态与离线能力", 2400);
  }
}

/* ============ v2.5.0 强门禁控制（未解锁全站锁屏 + 体验倒计时引导 + 卡密解锁） ============ */
const isAccessGateEnabled = () => NH.cfg?.access_gate_enabled !== false;
function getAccessStatus() {
  const u = NH.user;
  if (!u) return "guest";
  if (u.access_status) return u.access_status;
  if (u.is_pro) return "active";
  if (u.access_exempt) return "exempt";
  return "expired";
}
function hasActiveAccess() {
  if (!NH.user) return false;
  if (!isAccessGateEnabled()) return true;
  if (typeof NH.user.has_access === "boolean") return NH.user.has_access;
  // 兼容刚从老版本升级上来的本地缓存，待首次 /api/auth/me 校验完成后再做精准锁定
  if (!_authVerifiedOnce) return true;
  return !!(NH.user.is_pro || NH.user.access_exempt);
}
function formatAccessRemain(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s >= 86400) return `${Math.ceil(s / 86400)} 天`;
  if (s >= 3600) return `${Math.max(1, Math.floor(s / 3600))} 小时`;
  return `${Math.max(1, Math.ceil(s / 60))} 分钟`;
}
function renderTrialBannerHtml() {
  if (!NH.user || !isAccessGateEnabled()) return "";
  if (getAccessStatus() !== "trial") return "";
  const remain = formatAccessRemain(NH.user.access_remain_sec || ((NH.user.trial_remain_days || 1) * 86400));
  return `<div class="trial-banner">
    <div>新用户体验期剩余 <strong>${esc(remain)}</strong> · 兑换卡密享长期畅享与免推广</div>
    <button type="button" class="trial-banner-btn" onclick="openRedeemModal()">兑换卡密</button>
  </div>`;
}
function handleExpiredAccessAction() {
  if (!hasActiveAccess()) {
    syncAccessGate();
    return false;
  }
  return true;
}

let _gateTab = "login";
let _gateRenderedMode = "";
function setGateMsg(msg, isOk = false) {
  const box = $("#gateMsg");
  if (!box) return;
  if (!msg) {
    box.classList.add("hidden");
    box.textContent = "";
    return;
  }
  box.textContent = msg;
  box.classList.toggle("ok", !!isOk);
  box.classList.remove("hidden");
}
function syncAccessGate(forceRedraw = false) {
  const layer = $("#accessGateLayer");
  if (!layer) return;
  const gateOn = isAccessGateEnabled();
  const needLock = gateOn && (!NH.user ? true : (typeof NH.user.has_access === "boolean" ? !NH.user.has_access : (_authVerifiedOnce && !hasActiveAccess())));
  if (!needLock) {
    _gateRenderedMode = "";
    layer.classList.add("hidden");
    layer.innerHTML = "";
    document.body.classList.remove("gate-locked");
    return;
  }
  // 锁定时立刻中止正在播放的视频、音频与朗读
  try {
    if (!$("#playerLayer")?.classList.contains("hidden")) closePlayer(true);
    if (!$("#readerLayer")?.classList.contains("hidden")) closeReader();
    stopMusicForVideo();
  } catch {}
  document.body.classList.add("gate-locked");
  layer.classList.remove("hidden");
  const nextMode = NH.user ? `expired:${NH.user.username || ""}` : "guest";
  if (!forceRedraw && _gateRenderedMode === nextMode && layer.firstElementChild) {
    return;
  }
  _gateRenderedMode = nextMode;
  renderAccessGate(layer);
}

function renderAccessGate(layer) {
  const trialDays = Number(NH.cfg?.trial_days ?? 3);
  if (!NH.user) {
    const prevUser = $("#gateAuthUser")?.value || "";
    const prevPwd = $("#gateAuthPwd")?.value || "";
    const isReg = _gateTab === "register";
    layer.innerHTML = `
      <div class="gate-card">
        <div id="gateNoticeSlot">${typeof renderAdminBannerHtml === "function" ? renderAdminBannerHtml(true) : ""}</div>
        <div class="gate-brand">
          <div class="gate-brand-ico">${ico("brand")}</div>
          <div>
            <div class="gate-title">NovaHub · 星隅</div>
            <div style="font-size:11.5px;color:var(--muted)">私人高清影视 · 无损音乐 · 精品小说</div>
          </div>
        </div>
        <div class="gate-sub">
          ${trialDays > 0
            ? `请登录账号使用。新用户注册立享 <strong style="color:var(--accent)">${trialDays} 天全功能免费体验</strong>（同设备限领 1 次）。`
            : "本站点已开启会员授权访问，请登录已有账号并兑换卡密解锁全部内容。"}
        </div>
        <div class="gate-tabs">
          <button type="button" class="gate-tab ${!isReg ? "active" : ""}" data-gtab="login">账号登录</button>
          <button type="button" class="gate-tab ${isReg ? "active" : ""}" data-gtab="register">新用户注册${trialDays > 0 ? ` · 送${trialDays}天` : ""}</button>
        </div>
        <div class="form" style="margin:0;border:none;padding:0">
          <label>账号（3~24 位字符）</label>
          <input id="gateAuthUser" placeholder="请输入账号" autocomplete="username" value="${esc(prevUser)}">
          <label>密码（6 位以上）</label>
          <input id="gateAuthPwd" type="password" placeholder="请输入密码" autocomplete="${isReg ? "new-password" : "current-password"}" value="${esc(prevPwd)}">
          <div id="gateMsg" class="gate-msg hidden" role="alert"></div>
          <button type="button" id="gateAuthSubmit" class="btn primary" style="width:100%;margin-top:14px">${isReg ? (trialDays > 0 ? `立即注册并开启 ${trialDays} 天体验` : "注册账号") : "立即登录"}</button>
        </div>
        <div class="gate-guide-box" style="margin-top:14px">
          ${esc(NH.cfg?.redeem_guide_tip || "已拥有卡密？请先注册或登录账号后输入卡密即可解锁。")}
        </div>
      </div>`;
    layer.querySelectorAll("[data-gtab]").forEach((btn) => {
      btn.onclick = () => { _gateTab = btn.dataset.gtab; renderAccessGate(layer); };
    });
    if (typeof bindAdminBanners === "function") bindAdminBanners(layer);
    const doSubmit = async () => {
      const username = $("#gateAuthUser")?.value.trim();
      const password = $("#gateAuthPwd")?.value.trim();
      setGateMsg("");
      if (!username || !password) {
        setGateMsg("请填写完整账号与密码");
        toast("请填写完整账号与密码");
        return;
      }
      if (isReg && (username.length < 3 || username.length > 24)) {
        setGateMsg("账号长度需为 3~24 位字符");
        toast("账号长度需为 3~24 位字符");
        return;
      }
      if (isReg && password.length < 6) {
        setGateMsg("密码长度至少需要 6 位");
        toast("密码长度至少需要 6 位");
        return;
      }
      const btn = $("#gateAuthSubmit");
      if (btn) { btn.disabled = true; btn.textContent = isReg ? "注册中…" : "登录中…"; }
      try {
        const d = await nhApi(isReg ? "/api/auth/register" : "/api/auth/login", "POST", {
          username,
          password,
          device_id: getDeviceId(),
          client_type: isAppClient() ? "app" : "web",
          device_info: getDeviceInfo(),
        });
        authSession.apply(d.token, d.user);
        _authVerifiedOnce = true;
        if (isReg) await cloudSyncPush(true).catch(() => {});
        else await cloudSyncPull(true).catch(() => {});
        if (typeof refreshNotifications === "function") refreshNotifications(true);
        syncAccessGate(true);
        if (isReg && d.user?.trial_notice) toast(d.user.trial_notice, 2800);
        else toast(isReg ? "注册并登录成功" : "登录成功");
        if (hasActiveAccess()) {
          if (typeof routes[currentRoute] === "function") routes[currentRoute]();
          else renderHome();
        }
      } catch (e) {
        const errMsg = e?.message || "网络连接失败，请确认节点在线后重试";
        setGateMsg(errMsg);
        toast(errMsg, 2600);
        if (btn) { btn.disabled = false; btn.textContent = isReg ? (trialDays > 0 ? `立即注册并开启 ${trialDays} 天体验` : "注册账号") : "立即登录"; }
      }
    };
    $("#gateAuthSubmit").onclick = doSubmit;
    $("#gateAuthPwd").onkeydown = (e) => { if (e.key === "Enter") doSubmit(); };
    return;
  }

  // 已登录但体验已到期：全屏卡密解锁锁屏
  let buyUrl = "";
  try {
    if (NH.cfg?.redeem_buy_url && new URL(NH.cfg.redeem_buy_url).protocol === "https:") buyUrl = NH.cfg.redeem_buy_url;
  } catch {}
  let qrImg = "";
  try {
    if (NH.cfg?.redeem_qr_image && new URL(NH.cfg.redeem_qr_image).protocol === "https:") qrImg = NH.cfg.redeem_qr_image;
  } catch {}

  layer.innerHTML = `
    <div class="gate-card">
      <div id="gateNoticeSlot">${typeof renderAdminBannerHtml === "function" ? renderAdminBannerHtml(true) : ""}</div>
      <div class="gate-brand">
        <div class="gate-brand-ico">${ico("crown")}</div>
        <div>
          <div class="gate-title">体验已到期 · 兑换卡密解锁</div>
          <div style="font-size:12px;color:var(--muted)">当前账号：${esc(NH.user.username)}</div>
        </div>
      </div>
      <div class="gate-sub">
        ${NH.user.trial_source === "denied_dup_device"
          ? "当前设备已使用过新用户免费体验，请输入兑换卡密后继续使用全部影视、音乐与小说功能。"
          : "您的免费体验时间已结束，输入兑换卡密即可立即解封全部内容与权益。"}
      </div>
      <div class="form" style="margin:0;border:none;padding:0">
        <label>兑换卡密</label>
        <input id="gateRedeemIn" placeholder="例如：NH-XXXX-XXXX-XXXX" style="text-transform:uppercase;letter-spacing:.08em">
        <div id="gateMsg" class="gate-msg hidden" role="alert"></div>
        <button type="button" id="gateRedeemBtn" class="btn primary" style="width:100%;margin-top:12px">立即兑换并解锁</button>
      </div>
      <div class="gate-guide-box">
        <div>${esc(NH.cfg?.redeem_guide_tip || "请联系站长获取兑换卡密后在此输入激活。")}</div>
        ${buyUrl ? `<button type="button" id="gateBuyBtn" class="btn ghost" style="width:100%;margin-top:10px">前往获取卡密 / 活动领码</button>` : ""}
        ${qrImg ? `<img class="gate-qr-img" src="${esc(qrImg)}" alt="客服或领码二维码" loading="lazy">` : ""}
      </div>
      <div class="gate-foot-actions">
        <button type="button" id="gateInboxBtn" class="btn ghost" style="flex:1">站内消息</button>
        <button type="button" id="gateRefreshBtn" class="btn ghost" style="flex:1">刷新状态</button>
        <button type="button" id="gateLogoutBtn" class="btn ghost" style="flex:1">切换账号</button>
      </div>
    </div>`;
  if (typeof bindAdminBanners === "function") bindAdminBanners(layer);
  $("#gateInboxBtn")?.addEventListener("click", () => {
    if (typeof openNotificationCenter === "function") openNotificationCenter();
  });

  $("#gateRedeemBtn").onclick = async () => {
    const code = $("#gateRedeemIn")?.value.trim();
    setGateMsg("");
    if (!code) {
      setGateMsg("请输入有效卡密");
      return toast("请输入有效卡密");
    }
    const btn = $("#gateRedeemBtn");
    if (btn) { btn.disabled = true; btn.textContent = "核销解锁中…"; }
    try {
      const d = await nhApi("/api/vip/redeem", "POST", { code });
      NH.user = d.user;
      set("nh_user", d.user);
      syncAccessGate(true);
      toast(`解锁成功！已激活 ${d.days} 天畅享权益`, 2600);
      if (typeof routes[currentRoute] === "function") routes[currentRoute]();
      else renderHome();
    } catch (e) {
      const errMsg = e?.message || "卡密无效或网络异常";
      setGateMsg(errMsg);
      toast(errMsg, 2500);
      if (btn) { btn.disabled = false; btn.textContent = "立即兑换并解锁"; }
    }
  };
  $("#gateRedeemIn").onkeydown = (e) => { if (e.key === "Enter") $("#gateRedeemBtn").click(); };
  $("#gateBuyBtn")?.addEventListener("click", () => {
    window.open(buyUrl, "_blank", "noopener,noreferrer");
  });
  $("#gateRefreshBtn").onclick = async () => {
    await refreshAuthUser();
    if (hasActiveAccess()) toast("授权状态已更新，欢迎回来");
    else toast("当前仍未解锁，请先兑换卡密");
  };
  $("#gateLogoutBtn").onclick = () => {
    if (typeof sendPresenceLogout === "function") sendPresenceLogout();
    authSession.clear();
    syncAccessGate();
  };
}

function renderAdSlotHtml(slot = 'home') {
  const cfg=NH.cfg;
  if (!cfg || !cfg.ad_enabled || !cfg.ad_title || isProUser() ||
      (cfg.ad_provider && cfg.ad_provider !== 'manual') || !Array.isArray(cfg.ad_slots) || !cfg.ad_slots.includes(slot)) return "";
  let image='';
  try{if(cfg.ad_image && new URL(cfg.ad_image).protocol==='https:')image=cfg.ad_image;}catch{}
  return `<div class="ad-card" data-ad-slot="${esc(slot)}">
    ${image?`<img class="ad-image" src="${esc(image)}" alt="" loading="lazy" onerror="this.style.display='none'">`:''}
    <div class="ad-body">
      <div class="ad-head"><span class="ad-tag">广告</span><span class="ad-title">${esc(cfg.ad_title)}</span></div>
      <div class="ad-desc">${esc(cfg.ad_desc || '')}</div>
    </div>
    <button class="ad-cta" type="button">${esc(NH.cfg.ad_btn || "了解 Pro")}</button>
  </div>`;
}

function bindAdSlots(root) {
  if (!root) return;
  root.querySelectorAll("[data-ad-slot]").forEach((el) => {
    el.onclick = () => {
      try{if(NH.cfg.ad_url && new URL(NH.cfg.ad_url).protocol==='https:')window.open(NH.cfg.ad_url,'_blank','noopener,noreferrer');}catch{}
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
    const d = await nhApi(isReg ? "/api/auth/register" : "/api/auth/login", "POST", {
      username,
      password,
      device_id: getDeviceId(),
      client_type: isAppClient() ? "app" : "web",
      device_info: getDeviceInfo(),
    });
    authSession.apply(d.token, d.user);
    if (isReg) await cloudSyncPush(true);
    else await cloudSyncPull(true);
    if (typeof refreshNotifications === "function") refreshNotifications(true);
    if (typeof syncAccessGate === "function") syncAccessGate();
    if (isReg && d.user?.trial_notice) toast(d.user.trial_notice, 2800);
    else toast(isReg ? "注册并登录成功" : "登录成功");
    if (routes[currentRoute]) routes[currentRoute](); else renderMe();
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
    if (typeof syncAccessGate === "function") syncAccessGate();
    toast(`兑换成功！已增加 ${d.days} 天畅享权益`, 2600);
    if (routes[currentRoute]) routes[currentRoute](); else renderMe();
  } catch (e) {
    toast(e.message, 2600);
  }
}

async function cloudSyncPush(silent = false, useKeepalive = false) {
  if (!NH.user) { if (!silent) toast("请先登录账号"); return; }
  clearTimeout(_syncPushTimer);
  _syncDirty = false;
  const data = Object.fromEntries(SYNC_KEYS.map((k) => [k, get(k, null)]));
  if (useKeepalive) {
    try {
      const headers = { "Content-Type": "application/json" };
      if (NH.token) headers["Authorization"] = "Bearer " + NH.token;
      fetch("/api/sync", { method: "POST", keepalive: true, headers, body: JSON.stringify({ data }) }).catch(() => {});
    } catch {}
    return;
  }
  try {
    const accountToken=NH.token;
    const result=await nhApi("/api/sync", "POST", { data });
    if(NH.token!==accountToken)return;
    if(result.sync?.data)restore(result.sync.data);
    if (!silent) toast("全站片单、书架与进度已同步至云端");
  } catch (e) {
    _syncDirty = true;
    if (!silent) toast("同步失败：" + e.message, 2400);
  }
}

async function cloudSyncPull(silent = false) {
  if (!NH.user) { if (!silent) toast("请先登录账号"); return; }
  const accountToken=NH.token;
  try {
    await migrateLegacySources();
    const d = await nhApi("/api/sync", "GET");
    if(NH.token!==accountToken)return;
    if (!d.sync || !d.sync.data) {
      if (silent) {
        const hasLocal = [K.LIKE, K.HISTORY, "music_favs", "novel_shelf", "novel_hist"].some((k) => {
          const val = get(k, null);
          return Array.isArray(val) && val.length > 0;
        });
        if (hasLocal && typeof cloudSyncPush === "function") await cloudSyncPush(true);
      } else {
        toast("云端暂无历史备份");
      }
      return;
    }
    if (typeof _lastCloudPullAt !== "undefined") _lastCloudPullAt = Date.now();
    const localProgBefore = typeof get === "function" ? (get("progress", {}) || {}) : {};
    const remoteProg = (d.sync.data && d.sync.data.progress) || {};
    restore(d.sync.data);
    // 若 App 端本地进度优先于服务端（如网页端旧进度或不一致），主动将 App 端进度同步回写服务端
    if (typeof isAppClient === "function" && isAppClient() && typeof cloudSyncPush === "function") {
      const mergedProg = get("progress", {}) || {};
      const appOverridesRemote = Object.keys(localProgBefore).some((k) => {
        const m = mergedProg[k], r = remoteProg[k];
        return m && m.src === "app" && (!r || r.src !== "app" || Number(m.time) !== Number(r.time) || Number(m.idx) !== Number(r.idx));
      });
      if (appOverridesRemote) cloudSyncPush(true).catch(() => {});
    }

    channels = typeof mergeLiveChannels === "function" ? mergeLiveChannels(get("channels", DEFAULT_CHANNELS)) : get("channels", DEFAULT_CHANNELS);
    if (typeof set === "function") set("channels", channels);
    mBr = get("m_br", "192");
    if (!isProUser() && !["128", "192"].includes(mBr)) mBr = "192";
    if (!silent) {
      toast("已从云端恢复全部片单、书架与阅读进度");
      renderMe();
    }
  } catch (e) {
    if (!silent) toast("恢复失败：" + e.message, 2400);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && _syncDirty && NH.user) cloudSyncPush(true, true);
  if (document.visibilityState === "visible" && NH.user) {
    sendPresenceHeartbeat();
    refreshNotifications(true);
    if (Date.now() - _lastCloudPullAt > 15000) cloudSyncPull(true);
  }
});
window.addEventListener("pagehide", () => {
  if (_syncDirty && NH.user) cloudSyncPush(true, true);
});

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
let _novelSpeechRun = null;
let _novelSpeechResume = null;
let _novelSpeechPending = null;
let _novelSpeechDelay = null;

function buildNovelSpeechSegments(paragraphs) {
  const segments = [];
  for (const paragraph of paragraphs) {
    const chars = Array.from(String(paragraph).trim());
    let text = "";
    const add = () => {
      const value = text.trim();
      text = "";
      if (!value) return;
      // Small punctuation-based changes; the installed voice supplies the timbre.
      const question = /[？?][”’」』"]*$/.test(value);
      const excited = /[！!][”’」』"]*$/.test(value);
      const trailing = /(?:…|\.\.\.)[”’」』"]*$/.test(value);
      segments.push({ text: value, rate: trailing ? 0.92 : question ? 0.98 : excited ? 1.06 : 1.0,
        pitch: question ? 1.04 : excited ? 1.02 : 1.0, pauseMs: trailing ? 420 : 200 });
    };
    const before = segments.length;
    for (let i = 0; i < chars.length; i++) {
      text += chars[i];
      const closing = /[”’」』"]/.test(chars[i + 1] || "");
      if (text.length >= 160 || (!closing && /[。！？!?；;…][”’」』"]*$/.test(text))) add();
    }
    add();
    if (segments.length > before) segments[segments.length - 1].pauseMs = 380;
  }
  return segments;
}

function novelSpeechKey() {
  return `${R.book?.book_id || ""}:${R.index}`;
}

function syncNovelSpeechButton() {
  const btn = $("#rTtsBtn");
  if (!btn) return;
  btn.classList[ttsSpeaking ? "add" : "remove"]("speaking");
  btn.innerHTML = `${ico(ttsSpeaking ? "pause" : "volume")} ${ttsSpeaking ? "暂停" : _novelSpeechResume ? "续听" : "听书"}`;
}

function stopNovelTts(keepPosition = false) {
  _novelSpeechResume = keepPosition && _novelSpeechRun ? { ..._novelSpeechRun } : null;
  ttsToken++;
  ttsSpeaking = false;
  _novelSpeechRun = null;
  if (_novelSpeechDelay) {
    clearTimeout(_novelSpeechDelay.timer);
    _novelSpeechDelay.resolve();
    _novelSpeechDelay = null;
  }
  if (_novelSpeechPending) _novelSpeechPending.finish(new Error("cancelled"));
  try { window.NovaNative?.stopNovelSpeech?.(); } catch {}
  try { window.speechSynthesis?.cancel(); } catch {}
  syncNovelSpeechButton();
}

window.__nhNovelTtsEvent = (id, event, detail) => {
  const pending = _novelSpeechPending;
  if (!pending || pending.id !== id) return;
  if (event === "done") pending.finish();
  else if (event === "error") pending.finish(new Error(detail || "synthesis_failed"));
};

function speakNovelSegment(segment, run) {
  return new Promise((resolve, reject) => {
    const id = `novel-${run.token}-${run.index}`;
    const timer = setTimeout(() => finish(new Error("speech_timeout")), 90000);
    const finish = (err) => {
      if (!_novelSpeechPending || _novelSpeechPending.id !== id) return;
      clearTimeout(timer);
      _novelSpeechPending = null;
      err ? reject(err) : resolve();
    };
    _novelSpeechPending = { id, finish };
    try {
      if (run.native) {
        window.NovaNative.speakNovel(segment.text, id, segment.rate, segment.pitch);
      } else {
        const utterance = new SpeechSynthesisUtterance(segment.text);
        utterance.lang = "zh-CN";
        utterance.rate = segment.rate;
        utterance.pitch = segment.pitch;
        const voice = window.speechSynthesis.getVoices?.().find(v => /^zh[-_](CN|Hans)/i.test(v.lang));
        if (voice) utterance.voice = voice;
        utterance.onend = () => finish();
        utterance.onerror = (event) => finish(new Error(event.error || "synthesis_failed"));
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) { finish(err); }
  });
}

async function runNovelSpeech(run) {
  try {
    while (ttsSpeaking && run.token === ttsToken) {
      if (run.index >= run.segments.length) {
        if (R.index >= R.chapters.length) {
          stopNovelTts();
          toast("全书朗读完毕");
          return;
        }
        const next = R.index + 1;
        const loaded = await loadReaderChapter(next, 0, true);
        if (!ttsSpeaking || run.token !== ttsToken) return;
        if (!loaded || R.index !== next) throw new Error("chapter_failed");
        run.segments = buildNovelSpeechSegments([...document.querySelectorAll("#readerArticle p")].map(p => p.textContent));
        run.key = novelSpeechKey();
        run.index = 0;
        if (!run.segments.length) throw new Error("chapter_failed");
      }
      const segment = run.segments[run.index];
      await speakNovelSegment(segment, run);
      if (!ttsSpeaking || run.token !== ttsToken) return;
      run.index++;
      await new Promise(resolve => {
        const timer = setTimeout(() => {
          _novelSpeechDelay = null;
          resolve();
        }, segment.pauseMs);
        _novelSpeechDelay = { timer, resolve };
      });
    }
  } catch (err) {
    if (run.token !== ttsToken) return;
    stopNovelTts(err.message !== "chapter_failed");
    if (err.message === "missing_voice" || err.message === "init_failed") {
      toast("系统缺少可用的离线中文语音，请在语音设置中安装中文语音包", 4000);
      if (window.NovaNative?.openTtsSettings) {
        modal("安装免费中文语音", "请在系统文字转语音设置中选择支持中文的语音引擎，并下载离线中文语音包。完成后返回本页，点击续听。确定打开系统设置？").then(ok => {
          if (ok) window.NovaNative.openTtsSettings();
        });
      }
    } else {
      toast(err.message === "chapter_failed" ? "下一章加载失败，听书已暂停，请重新加载章节" : "朗读失败，已保留位置，可点击续听重试", 3200);
    }
  }
}

function toggleNovelTts() {
  if (ttsSpeaking) {
    stopNovelTts(true);
    return;
  }
  const native = typeof window.NovaNative?.speakNovel === "function";
  if (window.NovaNative && !native) return toast("请安装支持免费原生听书的新版 APK", 3200);
  if (!native && !("speechSynthesis" in window)) {
    return toast("当前浏览器不支持语音听书");
  }
  const key = novelSpeechKey();
  const saved = _novelSpeechResume?.key === key ? _novelSpeechResume : null;
  const segments = saved ? saved.segments : buildNovelSpeechSegments([...document.querySelectorAll("#readerArticle p")].map(p => p.textContent));
  if (!segments.length) return toast("当前章节暂无可朗读正文");
  // Invalidate asynchronous song loading as well as pausing any current audio.
  mPlayToken++;
  try { audioEl.pause(); } catch {}
  try { $("#video")?.pause(); } catch {}
  try { window.NovaNative?.stopNovelSpeech?.(); } catch {}
  try { window.speechSynthesis.cancel(); } catch {}
  const run = { key, segments, index: saved ? saved.index : 0, native, token: ++ttsToken };
  _novelSpeechRun = run;
  _novelSpeechResume = null;
  ttsSpeaking = true;
  syncNovelSpeechButton();
  toast(native ? "免费系统听书已开启，读完自动续章" : "开始听书，读完自动续章");
  runNovelSpeech(run);
}

async function dismissSplash(bootAt) {
  const el = $("#nhSplash");
  if (!el) return;
  const elapsed = performance.now() - bootAt;
  if (elapsed < 450) await new Promise((r) => setTimeout(r, 450 - elapsed));
  el.classList.add("leaving");
  const anims = el.getAnimations ? el.getAnimations() : [];
  if (anims.length > 0) {
    await Promise.race([
      Promise.allSettled(anims.map((a) => a.finished)),
      new Promise((r) => setTimeout(r, 500)),
    ]);
  }
  el.remove();
}

/* ============ 站内更新消息中心 & 单作品提醒开关 ============ */
const _watchPrefs = new Map();
let _notifData = { unread_count: 0, items: [] };
function getWatchNotifyEnabled(itemType, itemKey) {
  const k = `${itemType}:${itemKey}`;
  return _watchPrefs.has(k) ? _watchPrefs.get(k) : true;
}
async function toggleWatchNotify(itemType, itemKey, nextEnabled, title = "", meta = null, btnEl = null) {
  if (!NH.user) return toast("请先登录账号");
  try {
    const res = await nhApi("/api/notifications/prefs", "POST", {
      item_type: itemType,
      item_key: String(itemKey),
      enabled: !!nextEnabled,
      title,
      meta,
    });
    const enabled = !!(res.pref ? res.pref.notify_enabled : nextEnabled);
    _watchPrefs.set(`${itemType}:${itemKey}`, enabled);
    if (btnEl) btnEl.innerHTML = `${ico("bell")} ${enabled ? "提醒开" : "提醒关"}`;
    toast(enabled ? "已开启更新提醒" : "已关闭该作品更新提醒");
  } catch (e) {
    toast("设置失败：" + (e.message || "网络异常"));
  }
}
const ADMIN_MSG_LABELS = { notice: "系统公告", activity: "活动福利", maintenance: "维护提醒", direct: "站长私信" };
const ADMIN_ACT_DEFAULTS = { redeem: "立即兑换卡密", hotfix: "立即刷新热更新", route: "立即前往", url: "查看详情" };
let _notifDigest = { unread_count: 0, latest_popup: null, banners: [] };
let _publicAnnouncements = Array.isArray(NH.cfg?.public_announcements) ? NH.cfg.public_announcements : [];
let _pendingAdminPopup = null;
const _shownAdminPopupIds = new Set();

function getAdminMsgDismissedPub() {
  const arr = get("nh_dismissed_pub_msgs", []);
  return Array.isArray(arr) ? arr.map(String) : [];
}
function dismissPubAnnouncement(id) {
  const sid = String(id || "");
  if (!sid) return;
  const list = [sid, ...getAdminMsgDismissedPub().filter((x) => x !== sid)].slice(0, 30);
  set("nh_dismissed_pub_msgs", list);
}
function markSingleNotifRead(item) {
  if (!item || !item.id || item.read || !NH.user || !NH.token) return;
  item.read = true;
  if (_notifDigest && Array.isArray(_notifDigest.banners)) {
    _notifDigest.banners = _notifDigest.banners.filter((b) => b.id !== item.id);
  }
  refreshHomeAdminBanner();
  nhApi("/api/notifications/read", "POST", { id: item.id }).then((r) => {
    const cnt = Number(r?.unread_count);
    if (Number.isFinite(cnt)) {
      _notifData.unread_count = cnt;
      _notifDigest.unread_count = cnt;
      updateNotifBadge(cnt);
    }
  }).catch(() => {});
}
function runAdminMessageAction(meta) {
  if (!meta || !meta.action_type || meta.action_type === "none") return;
  const act = meta.action_type;
  const val = String(meta.action_value || "").trim();
  if (act === "redeem") {
    if (typeof openRedeemModal === "function") openRedeemModal();
  } else if (act === "hotfix") {
    toast("正在获取最新热更新…");
    setTimeout(() => location.replace(location.pathname + "?t=" + Date.now()), 250);
  } else if (act === "route") {
    if (val === "me") {
      go("me");
    } else if (["vod", "music", "novel"].includes(val) && typeof switchMode === "function") {
      switchMode(val);
    }
  } else if (act === "url") {
    try {
      const u = new URL(val);
      if (u.protocol === "https:") window.open(val, "_blank", "noopener,noreferrer");
    } catch {}
  }
}
async function openAdminMessageDetail(item, opts = {}) {
  if (!item) return;
  const meta = item.meta || {};
  const msgType = meta.msg_type || "notice";
  const typeLbl = ADMIN_MSG_LABELS[msgType] || "官方消息";
  const imgSrc = resolveApiMediaUrl(meta.image_url || "");
  const actType = meta.action_type || "none";
  const actLabel = meta.action_label || ADMIN_ACT_DEFAULTS[actType] || "立即前往";
  const hasAction = actType !== "none";
  const bodyHtml = `
    <div style="margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span class="admin-msg-tag type-${esc(msgType)}">${esc(typeLbl)}</span>
      <span style="font-size:11.5px;color:var(--muted)">${item.created_at ? new Date(item.created_at * 1000).toLocaleString() : ""}</span>
    </div>
    <div class="admin-popup-body">${esc(item.message || "")}</div>
    ${imgSrc ? `<img class="admin-msg-img" referrerpolicy="no-referrer" src="${esc(imgSrc)}" alt="推送配图" onclick="window.open(this.src,'_blank','noopener,noreferrer')" onerror="this.style.display='none'">` : ""}`;
  const p = modal(item.title || typeLbl, bodyHtml);
  if ($("#modalOk")) $("#modalOk").textContent = hasAction ? actLabel : "知道了";
  if ($("#modalCancel")) {
    if (hasAction) {
      $("#modalCancel").textContent = "关闭";
      $("#modalCancel").style.display = "";
    } else {
      $("#modalCancel").style.display = "none";
    }
  }
  const confirmed = await p;
  if (opts.markRead !== false) {
    if (item._isPublicGuest) dismissPubAnnouncement(item.id);
    else markSingleNotifRead(item);
  }
  if (confirmed && hasAction) runAdminMessageAction(meta);
}
function isBlockingOverlayOpen() {
  const vis = (sel) => {
    const el = $(sel);
    return !!(el && !el.classList.contains("hidden"));
  };
  return vis("#playerLayer") || vis("#readerLayer") || vis("#accessGateLayer") || vis("#modal");
}
function maybeShowAdminPopup(item) {
  if (!item || !item.id || _shownAdminPopupIds.has(item.id)) return;
  if (isBlockingOverlayOpen()) {
    _pendingAdminPopup = item;
    return;
  }
  _pendingAdminPopup = null;
  _shownAdminPopupIds.add(item.id);
  openAdminMessageDetail(item, { markRead: true });
}
function flushPendingAdminPopup() {
  if (!_pendingAdminPopup) return;
  if (isBlockingOverlayOpen()) return;
  const item = _pendingAdminPopup;
  _pendingAdminPopup = null;
  maybeShowAdminPopup(item);
}
function getActiveBanners(forGuest = false) {
  const list = [];
  const seenKey = new Set();
  if (NH.user && Array.isArray(_notifDigest.banners)) {
    for (const b of _notifDigest.banners) {
      const m = b.meta || {};
      const k = String(m.msg_id || b.id);
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      list.push(b);
    }
  }
  if (forGuest || !NH.user) {
    const dismissed = new Set(getAdminMsgDismissedPub());
    for (const p of (_publicAnnouncements || [])) {
      const k = String(p.id);
      if (dismissed.has(k) || seenKey.has(k)) continue;
      seenKey.add(k);
      list.push({
        id: p.id,
        item_type: "admin",
        title: p.title,
        message: p.message,
        created_at: p.created_at,
        _isPublicGuest: true,
        meta: {
          msg_id: p.id,
          msg_type: p.msg_type || "notice",
          display_mode: p.display_mode || "banner",
          image_url: p.image_url || "",
          action_type: p.action_type || "none",
          action_label: p.action_label || "",
          action_value: p.action_value || "",
        },
      });
    }
  }
  return list.slice(0, 2);
}
function renderAdminBannerHtml(forGuest = false) {
  const list = getActiveBanners(forGuest);
  if (!list.length) return "";
  return list.map((b, idx) => {
    const m = b.meta || {};
    const t = m.msg_type || "notice";
    const tName = ADMIN_MSG_LABELS[t] || "公告";
    const imgSrc = resolveApiMediaUrl(m.image_url || "");
    const hasAct = m.action_type && m.action_type !== "none";
    const actLbl = m.action_label || ADMIN_ACT_DEFAULTS[m.action_type] || "查看";
    return `<div class="admin-banner type-${esc(t)}" data-ab-idx="${idx}" data-ab-guest="${forGuest ? "1" : "0"}">
      ${imgSrc ? `<img class="admin-banner-thumb" referrerpolicy="no-referrer" src="${esc(imgSrc)}" alt="公告图" onerror="this.style.display='none'">` : ""}
      <div class="admin-banner-main">
        <div class="admin-banner-title-row">
          <span class="admin-msg-tag type-${esc(t)}">${esc(tName)}</span>
          <span class="admin-banner-title">${esc(b.title || "通知")}</span>
        </div>
        <div class="admin-banner-desc">${esc(b.message || "")}</div>
      </div>
      <div class="admin-banner-actions">
        ${hasAct ? `<button type="button" class="admin-banner-act" data-ab-act="1">${esc(actLbl)}</button>` : ""}
        <button type="button" class="admin-banner-close" data-ab-close="1" aria-label="关闭通知">×</button>
      </div>
    </div>`;
  }).join("");
}
function bindAdminBanners(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll(".admin-banner[data-ab-idx]").forEach((el) => {
    const forGuest = el.dataset.abGuest === "1";
    const list = getActiveBanners(forGuest);
    const item = list[Number(el.dataset.abIdx)];
    if (!item) return;
    const dismissOnly = () => {
      if (item._isPublicGuest) dismissPubAnnouncement(item.id);
      else markSingleNotifRead(item);
      el.remove();
    };
    el.querySelector("[data-ab-close]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissOnly();
    });
    el.querySelector("[data-ab-act]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissOnly();
      runAdminMessageAction(item.meta || {});
    });
    const openDetail = () => openAdminMessageDetail(item, { markRead: true });
    el.querySelector(".admin-banner-main")?.addEventListener("click", openDetail);
    el.querySelector(".admin-banner-thumb")?.addEventListener("click", openDetail);
  });
}
function refreshHomeAdminBanner() {
  const slot = $("#adminBannerSlot");
  if (slot) {
    slot.innerHTML = renderAdminBannerHtml(false);
    bindAdminBanners(slot);
  }
}
function applyNotifDigest(digest) {
  if (!digest || typeof digest !== "object") return;
  _notifDigest = {
    unread_count: Math.max(0, Number(digest.unread_count) || 0),
    latest_popup: digest.latest_popup || null,
    banners: Array.isArray(digest.banners) ? digest.banners : [],
  };
  _notifData.unread_count = _notifDigest.unread_count;
  updateNotifBadge(_notifDigest.unread_count);
  refreshHomeAdminBanner();
  const gSlot = $("#gateNoticeSlot");
  if (gSlot) {
    gSlot.innerHTML = renderAdminBannerHtml(true);
    bindAdminBanners(gSlot);
  }
  if (_notifDigest.latest_popup) {
    maybeShowAdminPopup(_notifDigest.latest_popup);
  }
}
function updateNotifBadge(unreadCount) {
  const btn = $("#btnNotif"), badge = $("#notifBadge");
  if (!btn) return;
  btn.classList.toggle("hidden", !NH.user);
  if (!badge) return;
  const n = Math.max(0, Number(unreadCount) || 0);
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.classList.toggle("hidden", !NH.user || n <= 0);
}
async function refreshNotifications(silent = true) {
  updateNotifBadge(_notifData.unread_count);
  if (!NH.user || !NH.token) {
    _notifData = { unread_count: 0, items: [] };
    _notifDigest = { unread_count: 0, latest_popup: null, banners: [] };
    updateNotifBadge(0);
    refreshHomeAdminBanner();
    return _notifData;
  }
  try {
    const [notifRes, prefsRes] = await Promise.all([
      nhApi("/api/notifications?limit=50"),
      nhApi("/api/notifications/prefs").catch(() => null),
    ]);
    _notifData = {
      unread_count: Number(notifRes?.unread_count) || 0,
      items: Array.isArray(notifRes?.items) ? notifRes.items : [],
    };
    if (prefsRes && Array.isArray(prefsRes.items)) {
      _watchPrefs.clear();
      prefsRes.items.forEach((x) => _watchPrefs.set(`${x.item_type}:${x.item_key}`, !!x.notify_enabled));
    }
    if (notifRes && notifRes.digest) {
      applyNotifDigest(notifRes.digest);
    } else {
      updateNotifBadge(_notifData.unread_count);
    }
  } catch (e) {
    if (!silent) toast("获取通知失败：" + (e.message || "网络异常"));
  }
  return _notifData;
}
async function openNotificationCenter() {
  if (!NH.user) {
    toast("请先登录账号查看消息通知");
    if (typeof openAuthModal === "function") openAuthModal("login");
    return;
  }
  await refreshNotifications(true);
  let curFilter = "all"; // all | admin | watch
  const renderModalHtml = () => {
    const rawItems = _notifData.items || [];
    const items = rawItems.filter((n) => curFilter === "all" ? true : (curFilter === "admin" ? n.item_type === "admin" : n.item_type !== "admin"));
    const listHtml = items.length
      ? items.map((n) => {
          const origIdx = rawItems.indexOf(n);
          const m = n.meta || {};
          const isAdmin = n.item_type === "admin";
          const tagCls = isAdmin ? `admin-msg-tag type-${esc(m.msg_type || "notice")}` : `badge ${n.item_type === "vod" ? "" : "gray"}`;
          const tagText = isAdmin ? (ADMIN_MSG_LABELS[m.msg_type] || "官方消息") : (n.item_type === "vod" ? "影视" : "小说");
          const imgSrc = isAdmin ? resolveApiMediaUrl(m.image_url || "") : "";
          return `<button type="button" class="notif-item ${n.read ? "" : "unread"}" data-nidx="${origIdx}">
            <div class="notif-item-head">
              <span>${esc(n.title || "通知消息")}</span>
              <span class="${tagCls}">${esc(tagText)}</span>
            </div>
            <div class="notif-item-msg" style="${isAdmin ? "color:var(--text-2);white-space:pre-line" : ""}">${esc(n.message || "有新内容更新")}</div>
            ${imgSrc ? `<img class="notif-item-thumb" referrerpolicy="no-referrer" src="${esc(imgSrc)}" alt="配图" onerror="this.style.display='none'">` : ""}
            <div class="notif-item-sub">${n.created_at ? new Date(n.created_at * 1000).toLocaleString() : ""}${n.read ? " · 已读" : " · 未读"}</div>
          </button>`;
        }).join("")
      : `<div class="empty" style="padding:26px 10px">暂无相关消息<br>站内公告、专属通知与追更提醒都会显示在这里</div>`;
    return `
      <div style="display:flex;gap:8px;justify-content:space-between;margin-bottom:8px">
        <button id="notifCheckNowBtn" class="btn primary" type="button" style="flex:1;padding:7px 10px;font-size:12.5px">检查追剧更新</button>
        <button id="notifReadAllBtn" class="btn ghost" type="button" style="padding:7px 10px;font-size:12.5px">全部已读</button>
      </div>
      <div class="notif-tabs">
        <button type="button" class="notif-tab ${curFilter === "all" ? "active" : ""}" data-nfilter="all">全部 (${rawItems.length})</button>
        <button type="button" class="notif-tab ${curFilter === "admin" ? "active" : ""}" data-nfilter="admin">官方消息 (${rawItems.filter((x) => x.item_type === "admin").length})</button>
        <button type="button" class="notif-tab ${curFilter === "watch" ? "active" : ""}" data-nfilter="watch">追更提醒 (${rawItems.filter((x) => x.item_type !== "admin").length})</button>
      </div>
      <div id="notifModalList" class="notif-list">${listHtml}</div>`;
  };

  const p = modal("消息与更新中心", renderModalHtml());
  const bindEvents = () => {
    document.querySelectorAll("[data-nfilter]").forEach((btn) => {
      btn.onclick = () => {
        curFilter = btn.dataset.nfilter || "all";
        $("#modalBody").innerHTML = renderModalHtml();
        bindEvents();
      };
    });
    $("#notifReadAllBtn")?.addEventListener("click", async () => {
      try {
        const res = await nhApi("/api/notifications/read", "POST", { id: 0 });
        _notifData.unread_count = Number(res.unread_count) || 0;
        _notifData.items = (_notifData.items || []).map((x) => ({ ...x, read: true }));
        _notifDigest.unread_count = _notifData.unread_count;
        _notifDigest.banners = [];
        updateNotifBadge(_notifData.unread_count);
        refreshHomeAdminBanner();
        $("#modalBody").innerHTML = renderModalHtml();
        bindEvents();
        toast("已全部标记为已读");
      } catch (e) { toast(e.message || "操作失败"); }
    });
    $("#notifCheckNowBtn")?.addEventListener("click", async () => {
      const btn = $("#notifCheckNowBtn");
      if (btn) { btn.disabled = true; btn.textContent = "检查中…"; }
      try {
        const res = await nhApi("/api/notifications/check", "POST", {});
        _notifData = { unread_count: Number(res.unread_count) || 0, items: Array.isArray(res.items) ? res.items : [] };
        updateNotifBadge(_notifData.unread_count);
        $("#modalBody").innerHTML = renderModalHtml();
        bindEvents();
        toast(`已检查 ${res.checked || 0} 部作品，发现 ${res.updated || 0} 项更新`);
      } catch (e) {
        toast(e.message || "检查失败");
        if (btn) { btn.disabled = false; btn.textContent = "检查追剧更新"; }
      }
    });
    $("#notifModalList")?.querySelectorAll("[data-nidx]").forEach((el) => {
      el.onclick = () => {
        const item = _notifData.items[+el.dataset.nidx];
        if (!item) return;
        markSingleNotifRead(item);
        $("#modalOk")?.click();
        const meta = item.meta || {};
        if (item.item_type === "admin") {
          setTimeout(() => openAdminMessageDetail(item, { markRead: false }), 35);
          return;
        }
        if (!hasActiveAccess()) {
          toast("体验已到期，请先兑换卡密解锁后再观看", 2400);
          return;
        }
        if (item.item_type === "vod" && meta.srcId && meta.id) {
          if (appMode !== "vod") switchMode("vod", "home");
          openDetail({ srcId: meta.srcId, id: meta.id, name: meta.name || item.title, pic: meta.pic || "" });
        } else if (item.item_type === "novel" && (meta.book_id || item.item_key)) {
          if (appMode !== "novel") switchMode("novel", "n_shelf");
          openNovelDetail({ book_id: String(meta.book_id || item.item_key), title: meta.title || item.title, author: meta.author || "", cover: meta.cover || "" });
        }
      };
    });
  };
  setTimeout(bindEvents, 0);
  await p;
}
window.__nhOpenNotifications = openNotificationCenter;

/* ============ 初始化固定控件矢量图标与启动 ============ */
const _bootAt = performance.now();
$("#topSearchIco").innerHTML = ico("search");
if ($("#notifIco")) $("#notifIco").innerHTML = ico("bell");
$("#btnNotif")?.addEventListener("click", openNotificationCenter);
$("#playerBack").innerHTML = ico("back");
$("#playerFav").innerHTML = `${ico("heart")} 记录`;
$("#btnPlay").innerHTML = ico("play");
syncFsButtons(false);
if ($("#btnBoxFs")) $("#btnBoxFs").onclick = $("#btnFs").onclick;
updateTopbar();
syncSearchClear();
syncModeFab();
bindHomeSwipeNavigation();
go(appMode === "music" ? "m_discover" : appMode === "novel" ? "n_store" : "home");
_bootDone = true;
_bootReady = true;
dismissSplash(_bootAt);
loadSiteConfig();
refreshAuthUser();
if (typeof syncAccessGate === "function") syncAccessGate();
