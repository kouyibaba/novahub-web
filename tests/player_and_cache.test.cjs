const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('app.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');
const adminSource = fs.readFileSync('admin.html', 'utf8');

test('app.js removes misleading library updating notice and fixes bare skeleton grid', () => {
  assert.equal(appSource.includes('片库正在更新'), false);
  const bareIdx = appSource.indexOf('function renderSkeletonHtml(');
  const endIdx = appSource.indexOf('function applyStagger(', bareIdx);
  const bareSlice = appSource.slice(bareIdx, endIdx);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(bareSlice, ctx);
  const bareHtml = ctx.renderSkeletonHtml('grid', 12, true);
  assert.equal(bareHtml.startsWith('<div class="sk-card">'), true);
  assert.equal(bareHtml.includes('sk-grid'), false);
  assert.equal((bareHtml.match(/class="sk-card"/g) || []).length, 12);
});

test('mergeLiveChannels filters known dead channels and keeps defaults + custom channels', () => {
  const start = appSource.indexOf('const DEFAULT_CHANNELS = [');
  const end = appSource.indexOf('const saveChannels =', start);
  const snippet = appSource.slice(start, end);
  const store = {};
  const ctx = {
    get: (k, d) => (k in store ? store[k] : d),
    set: (k, v) => { store[k] = v; },
  };
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx);
  const merged = ctx.mergeLiveChannels([
    { name: 'Dead', url: 'https://live.example.com/1.m3u8' },
    { name: 'DeadCZTV', url: 'https://ali-m-l.cztv.com/channels/lantian/channel10/1080p.m3u8' },
    { name: 'CustomOK', url: 'https://my-custom.example/live.m3u8' },
  ]);
  assert.equal(merged.some((x) => x.url.includes('live.example.com')), false);
  assert.equal(merged.some((x) => x.url.includes('cztv.com')), false);
  assert.equal(merged.some((x) => x.name === 'CustomOK'), true);
  assert.ok(merged.length >= 24);
});

test('player UI includes +30s, +1m, next episode, fullscreen episode drawer, skip intro/outro, and download controls', () => {
  for (const id of ['btnFwd30', 'btnFwd60', 'btnNextEp', 'btnFsEp', 'btnSkipCfg', 'btnVodDownload', 'fsEpDrawer', 'playerGestureToast']) {
    assert.ok(htmlSource.includes(`id="${id}"`), `index.html missing #${id}`);
  }
  for (const id of ['btnNotif', 'notifBadge']) {
    assert.ok(htmlSource.includes(`id="${id}"`), `index.html missing #${id}`);
  }
  assert.ok(appSource.includes('longpress_fwd'));
  assert.ok(appSource.includes('longpress_rew'));
  assert.ok(appSource.includes('downloadMusicTrack'));
  assert.ok(appSource.includes('downloadVodEpisode'));
  assert.ok(appSource.includes('function getSkipCfg('));
  assert.ok(appSource.includes('function openSkipCfgModal('));
  assert.ok(appSource.includes('function openNotificationCenter('));
  assert.ok(appSource.includes('btnVodNotify'));
  assert.ok(appSource.includes('btnNovelNotify'));
  assert.ok(htmlSource.includes('id="btnCast"'));
  assert.ok(htmlSource.includes('id="castBar"'));
  assert.ok(htmlSource.includes('x-webkit-airplay="allow"'));
  assert.ok(appSource.includes('function openCastModal('));
  assert.ok(appSource.includes('/api/cast/command'));
  assert.ok(appSource.includes('function cancelActiveSearch('));
  assert.ok(appSource.includes('data-cancel-search="1"'));
  assert.ok(appSource.includes('&name=${encodeURIComponent(songName)}&artist=${encodeURIComponent(songArtist)}'));
  assert.ok(htmlSource.includes('id="accessGateLayer"'));
  assert.ok(appSource.includes('function syncAccessGate('));
  assert.ok(appSource.includes('getDeviceFingerprint'));
  assert.ok(appSource.includes('setGateMsg('));
  const cssSource = fs.readFileSync('style.css', 'utf8');
  const toastZ = Number((cssSource.match(/\.toast\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
  const gateZ = Number((cssSource.match(/\.access-gate-layer\s*\{[^}]*z-index:\s*(\d+)/) || [])[1] || 0);
  assert.ok(toastZ > gateZ, '.toast z-index must exceed .access-gate-layer');
  const devCtx = {
    window: {},
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36' },
    localStorage: { getItem: () => null, setItem() {} },
    get: (_k, d) => d,
  };
  vm.createContext(devCtx);
  const devStart = appSource.indexOf('const isAppClient =');
  const devEnd = appSource.indexOf('// Media API requests', devStart);
  vm.runInContext(appSource.slice(devStart, devEnd), devCtx);
  const info = vm.runInContext('getDeviceInfo()', devCtx);
  assert.equal(/^[\x00-\xff]+$/.test(info), true, 'getDeviceInfo header must stay ISO-8859-1 safe');
  assert.ok(appSource.includes('headers["X-Device-Info"] = encodeURIComponent('));
});

test('tv.html big-screen cast receiver parses cleanly', () => {
  const tvHtml = fs.readFileSync('tv.html', 'utf8');
  assert.ok(tvHtml.includes('/api/cast/room'));
  assert.ok(tvHtml.includes('/api/cast/poll'));
  const scripts = [...tvHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  for (const s of scripts) {
    assert.doesNotThrow(() => new vm.Script(s[1]));
  }
});

test('admin.html inline script parses cleanly and exposes online presence UI', () => {
  const matches = [...adminSource.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 2);
  for (const m of matches) {
    assert.doesNotThrow(() => new vm.Script(m[1]));
  }
  assert.ok(adminSource.includes('id="onlineTbody"'));
  assert.ok(adminSource.includes('/api/admin/online'));
  assert.ok(adminSource.includes('id="accessGateEnabled"'));
  assert.ok(adminSource.includes('id="btnSaveGate"'));
});
