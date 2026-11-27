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

test('v2.5.5 fixes novel covers, adds home horizontal swipe mode switching, landscape skip modal, and admin message push with images', () => {
  const cssSource = fs.readFileSync('style.css', 'utf8');
  const htmlIdx = fs.readFileSync('index.html', 'utf8');
  assert.ok(appSource.includes('const WEB_VERSION = "v2.5.5"'));
  assert.ok(htmlIdx.includes('?v=20261127-v255'));
  assert.ok(appSource.includes('function syncOverlayHost('));
  assert.ok(appSource.includes('function bindHomeSwipeNavigation('));
  assert.ok(appSource.includes('function resolveApiMediaUrl('));
  assert.ok(appSource.includes('function runAdminMessageAction('));
  assert.ok(appSource.includes('function maybeShowAdminPopup('));
  assert.ok(appSource.includes('function renderAdminBannerHtml('));
  assert.ok(appSource.includes('if (okBtn) okBtn.textContent = "确定"'));
  assert.ok(appSource.includes('referrerpolicy="no-referrer"'));
  assert.ok(appSource.includes('window._novelCovErr'));
  assert.ok(cssSource.includes('#modalBody'));
  assert.ok(cssSource.includes('.admin-banner'));
  assert.ok(cssSource.includes('.admin-msg-img'));
  assert.ok(cssSource.includes('@media (max-height: 520px)'));
  assert.ok(cssSource.includes('.skip-cfg-grid'));

  // admin.html script parses cleanly and exposes message push + image upload UI
  const adminScripts = [...adminSource.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(adminScripts.length >= 2);
  for (const s of adminScripts) assert.doesNotThrow(() => new vm.Script(s[1]));
  for (const id of ['panel-messages', 'msgAudience', 'msgImageFile', 'msgImageUrl', 'msgImagePreview', 'btnSendAdminMsg', 'adminMsgTbody']) {
    assert.ok(adminSource.includes(id), `admin.html missing ${id}`);
  }
  assert.ok(adminSource.includes('function syncMsgFormUi('));

  // vm test resolveApiMediaUrl
  const mediaStart = appSource.indexOf('function resolveApiMediaUrl(');
  const mediaEnd = appSource.indexOf('function syncOverlayHost(', mediaStart);
  const mediaCtx = { URL, window: { __NH_API_BASE__: 'https://node.example' } };
  vm.createContext(mediaCtx);
  vm.runInContext(appSource.slice(mediaStart, mediaEnd), mediaCtx);
  assert.equal(mediaCtx.resolveApiMediaUrl('/api/messages/image/abcdef1234567890'), 'https://node.example/api/messages/image/abcdef1234567890');
  assert.equal(mediaCtx.resolveApiMediaUrl('https://cdn.example/banner.png'), 'https://cdn.example/banner.png');
  assert.equal(mediaCtx.resolveApiMediaUrl('javascript:alert(1)'), '');
  assert.equal(mediaCtx.resolveApiMediaUrl('http://insecure.example/a.png'), '');

  const normStart = appSource.indexOf('function normalizeNovelCover(');
  const normEnd = appSource.indexOf('window._novelCovErr =', normStart);
  assert.ok(normStart >= 0 && normEnd > normStart);
  const normCtx = {};
  vm.createContext(normCtx);
  vm.runInContext(appSource.slice(normStart, normEnd), normCtx);
  assert.equal(
    normCtx.normalizeNovelCover('https://p6-tt.bytecdn.cn/novel-pic/abc~tplv-shrink:640:0.image'),
    'https://p6-novel.byteimg.com/novel-pic/abc~tplv-shrink:640:0.image'
  );
  assert.equal(
    normCtx.normalizeNovelCover('http://p3-novel.byteimg.com/novel-pic/abc.image'),
    'https://p3-novel.byteimg.com/novel-pic/abc.image'
  );

  const swStart = appSource.indexOf('const HOME_SWIPE_ORDER =');
  const swEnd = appSource.indexOf('function bindHomeSwipeNavigation(', swStart);
  assert.ok(swStart >= 0 && swEnd > swStart);
  const swCtx = {};
  vm.createContext(swCtx);
  vm.runInContext(appSource.slice(swStart, swEnd), swCtx);
  assert.equal(swCtx.resolveHomeSwipeMode('vod', -110, 10, 220), 'music');
  assert.equal(swCtx.resolveHomeSwipeMode('music', -110, 12, 220), 'novel');
  assert.equal(swCtx.resolveHomeSwipeMode('novel', -110, 8, 220), '');
  assert.equal(swCtx.resolveHomeSwipeMode('novel', 110, 8, 220), 'music');
  assert.equal(swCtx.resolveHomeSwipeMode('music', 110, 8, 220), 'vod');
  assert.equal(swCtx.resolveHomeSwipeMode('vod', 110, 8, 220), '');
  assert.equal(swCtx.resolveHomeSwipeMode('vod', -40, 2, 180), '');
  assert.equal(swCtx.resolveHomeSwipeMode('vod', -100, 90, 200), '');
  assert.equal(swCtx.resolveHomeSwipeMode('vod', -120, 5, 1200), '');
});

test('novel category switches on a single tap and ignores stale category responses', async () => {
  const start = appSource.indexOf('let _novelCatReq = 0;');
  const end = appSource.indexOf('function renderNovelShelf()', start);
  assert.ok(start >= 0 && end > start);
  const store = { novel_cat_悬疑脑洞: [{ book_id: '1', title: 'OldCached' }] };
  const fetches = [];
  let chips = [];
  const viewEl = { innerHTML: '' };
  const wrapEl = { innerHTML: '' };
  const searchEl = { value: '' };
  const ctx = {
    NOVEL_CATS: [{ id: '悬疑脑洞', name: '悬疑脑洞' }, { id: '玄幻', name: '玄幻' }],
    curNovelCat: '悬疑脑洞',
    novelStoreList: store.novel_cat_悬疑脑洞,
    novelIsSearch: false,
    novelSearchKw: '',
    currentRoute: 'n_store',
    viewRequest: 0,
    _searchAbort: null,
    viewStack: [],
    AbortController,
    get: (k, d) => (k in store ? store[k] : d),
    set: (k, v) => { store[k] = v; },
    esc: String,
    ico: () => '',
    renderTrialBannerHtml: () => '',
    renderAdSlotHtml: () => '',
    bindAdSlots() {},
    paintNovelList(el, list) { el.painted = list.map((x) => x.title); },
    setSearchLoading() {},
    renderTabbar() {},
    cancelActiveSearch() {},
    sortByExactMatch: (xs) => xs,
    renderSearchLoadingHtml: () => '',
    $: (sel) => (sel === '#view' ? viewEl : sel === '#nStoreWrap' ? wrapEl : sel === '#searchInput' ? searchEl : null),
    document: {
      querySelectorAll: (sel) => (sel === '.m-chip[data-cat]' ? chips : []),
    },
    fetch: (url) => {
      fetches.push(url);
      return new Promise((resolve) => {
        const isFirst = fetches.length === 1;
        setTimeout(() => {
          resolve({
            json: async () => ({
              items: isFirst
                ? [{ book_id: '2', title: 'XuanhuanBook' }]
                : [{ book_id: '9', title: 'ShouldNotHappen' }],
            }),
          });
        }, isFirst ? 20 : 5);
      });
    },
  };
  const rebuildChips = () => {
    chips = [{ dataset: { cat: '悬疑脑洞' } }, { dataset: { cat: '玄幻' } }];
  };
  ctx.$ = (sel) => {
    if (sel === '#view') {
      rebuildChips();
      return viewEl;
    }
    if (sel === '#nStoreWrap') return wrapEl;
    if (sel === '#searchInput') return searchEl;
    return null;
  };
  vm.createContext(ctx);
  vm.runInContext(appSource.slice(start, end), ctx);

  ctx.renderNovelStore();
  assert.equal(fetches.length, 0);
  // Single tap on the second category chip ("玄幻")
  chips[1].onclick();
  assert.equal(ctx.curNovelCat, '玄幻');
  assert.equal(fetches.length, 1);
  assert.equal(decodeURIComponent(fetches[0]).includes('q=玄幻'), true);

  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(wrapEl.painted, ['XuanhuanBook']);
  assert.equal(fetches.length, 1);
});
