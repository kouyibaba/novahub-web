(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NovaHistory = api;
})(typeof window === 'object' ? window : globalThis, function() {
  const key = x => String(x.srcId || '') + ':' + String(x.id || '');
  const stamp = x => Math.max(0, Number(x) || 0);
  function merge(a = {}, b = {}) {
    const out = {...a, ...b};
    const cleared = Math.max(stamp(a.history_cleared_at), stamp(b.history_cleared_at));
    const deleted = Object.create(null);
    for (const obj of [a.history_deleted, b.history_deleted]) {
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k,v] of Object.entries(obj)) deleted[k] = Math.max(deleted[k] || 0, stamp(v));
    }
    // A new write must have observed the deletion; a later offline wall clock
    // alone cannot grant an old playback session permission to recreate it.
    const allowed = (k, value) => (!cleared || stamp(value.cleared_at) >= cleared) && (!deleted[k] || stamp(value.deleted_at) >= deleted[k]);
    const rows = new Map();
    for (const list of [a.history, b.history]) if (Array.isArray(list)) for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const k = key(item);
      if (allowed(k,item) && (!rows.has(k) || stamp(item.at) >= stamp(rows.get(k).at))) rows.set(k,item);
    }
    const preferProgress = (prev, next) => {
      if (!prev) return next;
      const prevApp = prev.src === 'app';
      const nextApp = next.src === 'app';
      if (prevApp !== nextApp) return nextApp ? next : prev;
      return stamp(next.at) >= stamp(prev.at) ? next : prev;
    };
    const progress = Object.create(null);
    for (const obj of [a.progress, b.progress]) if (obj && typeof obj === 'object' && !Array.isArray(obj)) for (const [k,v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && allowed(k,v)) progress[k] = preferProgress(progress[k], v);
    }
    return {...out, history:[...rows.values()].sort((x,y)=>stamp(y.at)-stamp(x.at)).slice(0,100), progress, history_deleted:deleted, history_cleared_at:cleared};
  }
  function remove(state, id, now) {
    return merge(state,{history_deleted:{[id]:stamp(now)}});
  }
  function clear(state, now) { return merge(state,{history_cleared_at:stamp(now)}); }
  return {key, merge, remove, clear};
});
