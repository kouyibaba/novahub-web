/* Session lifecycle shared by browser storage and trusted Android recovery. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) factory(module.exports);
  else { root.NovaSession = {}; factory(root.NovaSession); }
})(typeof window === 'undefined' ? globalThis : window, function (exports) {
  'use strict';
  exports.create = function (state, options) {
    let generation = 0, nativePersist = null, explicitlyCleared = false;
    function persist() {
      options.write('nh_token', state.token);
      options.write('nh_user', state.user);
      if (nativePersist) {
        try { nativePersist({ token: state.token, user: state.user }); } catch {}
      }
    }
    function apply(token, user) {
      if (typeof token !== 'string' || !token || token.length > 8192 || !user || !Number.isInteger(user.id)) {
        throw new Error('Invalid session response');
      }
      generation++;
      state.token = token; state.user = user; state.offline = false;
      explicitlyCleared = false;
      persist();
    }
    function clear() {
      generation++; explicitlyCleared = true;
      state.token = ''; state.user = null; state.offline = false;
      persist();
    }
    async function refresh() {
      const token = state.token, started = generation;
      if (!token) return 'empty';
      try {
        const data = await options.request(token);
        if (generation !== started || token !== state.token) return 'stale';
        // Only an explicit HTTP 401 revokes local state. A proxy's HTML/empty
        // 200 response is a transport failure, not proof the account is gone.
        if (!data || !data.user || !Number.isInteger(data.user.id)) throw new Error('Invalid session response');
        apply(data.token || token, data.user);
        return 'valid';
      } catch (error) {
        if (generation !== started || token !== state.token) return 'stale';
        if (error && error.status === 401) { clear(); return 'invalid'; }
        state.offline = true;
        return 'offline';
      }
    }
    function nativeReady(saved, persistCallback) {
      nativePersist = typeof persistCallback === 'function' ? persistCallback : null;
      if (!state.token && !explicitlyCleared && saved && typeof saved.token === 'string' &&
          saved.token && saved.token.length <= 8192 && saved.user && Number.isInteger(saved.user.id)) {
        apply(saved.token, saved.user);
        return true;
      }
      persist();
      return false;
    }
    return { apply, clear, refresh, nativeReady };
  };
});
