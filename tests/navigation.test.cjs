const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const navigation = source.slice(source.indexOf('let currentRoute = "home";'), source.indexOf('function renderTabbar()'));
function setup() {
  const elements = new Map();
  const classes = (...initial) => {
    const values = new Set(initial);
    return { contains: x => values.has(x), add: (...xs) => xs.forEach(x => values.add(x)),
      remove: (...xs) => xs.forEach(x => values.delete(x)), toggle: (x, on) => on ? values.add(x) : values.delete(x) };
  };
  for (const id of ['modal', 'tocMask', 'readerLayer', 'playerLayer', 'searchHistPop']) elements.set('#' + id, { classList: classes('hidden') });
  const events = {};
  const calls = { back: 0, stopped: 0, destroyed: 0, root: 0, previous: 0, cancelled: 0, exitedFullscreen: 0 };
  const history = { state: null, pushState(value) { this.state = value; }, back() { calls.back++; } };
  const document = { body: { classList: classes(), style: {} }, fullscreenElement: null,
    exitFullscreen() { calls.exitedFullscreen++; return Promise.resolve(); } };
  const context = { $, document, history, setTimeout: () => 1, clearTimeout() {},
    window: { addEventListener: (event, fn) => { events[event] = fn; }, scrollTo() {} },
    routes: { home: () => calls.root++ },
    stopNovelTts: () => calls.stopped++, saveCurrentReaderScroll() {}, syncModeFab() {},
    destroyPlayers: () => calls.destroyed++,
    setPlayerFullscreen: () => $('#playerLayer').classList.remove('is-fs'),
    hideSearchHistPop: () => $('#searchHistPop').classList.add('hidden'),
    ico: () => '<svg></svg>', esc: String };
  function $(id) { return elements.get(id); }
  elements.set('#modalCancel', { click() { calls.cancelled++; $('#modal').classList.add('hidden'); } });
  vm.createContext(context);
  vm.runInContext(navigation, context);
  return { context, calls, history, document, events, $, run: text => vm.runInContext(text, context), show: id => $(id).classList.remove('hidden') };
}
test('root delegates exit to Android even when stale browser entries exist', () => {
  const s = setup(); s.history.state = { depth: 9 };
  assert.equal(s.context.window.__nhHandleBack(), false);
  assert.equal(s.calls.back, 0);
});
test('system back cancels an open confirmation without navigating', () => {
  const s = setup(); s.show('#modal'); s.show('#readerLayer');
  assert.equal(s.context.requestAppBack(), true);
  assert.equal(s.calls.cancelled, 1); assert.equal(s.calls.back, 0);
});
test('directory closes first and preserves the reader history entry', () => {
  const s = setup(); s.show('#tocMask'); s.show('#readerLayer'); s.history.state = { reader: true };
  s.context.requestAppBack();
  assert.equal(s.$('#tocMask').classList.contains('hidden'), true);
  assert.equal(s.$('#readerLayer').classList.contains('hidden'), false);
  assert.equal(s.calls.back, 0);
  s.context.requestAppBack(); assert.equal(s.calls.back, 1);
  s.events.popstate(); assert.equal(s.calls.stopped, 1);
  assert.equal(s.$('#readerLayer').classList.contains('hidden'), true);
});
test('fullscreen back exits fullscreen before closing content', () => {
  const s = setup(); s.show('#readerLayer'); s.document.fullscreenElement = {};
  s.context.requestAppBack();
  assert.equal(s.calls.exitedFullscreen, 1); assert.equal(s.calls.stopped, 0); assert.equal(s.calls.back, 0);
});
test('repeated presses consume only one pending history entry', () => {
  const s = setup(); s.show('#readerLayer'); s.history.state = { reader: true };
  s.context.requestAppBack(); s.context.requestAppBack();
  assert.equal(s.calls.back, 1);
  s.events.popstate(); assert.equal(s.context.requestAppBack(), false);
});
test('reader without its own history state closes locally', () => {
  const s = setup(); s.show('#readerLayer'); s.history.state = { depth: 1 };
  s.context.requestAppBack();
  assert.equal(s.calls.back, 0); assert.equal(s.calls.stopped, 1);
});
test('player closes and destroys playback without a second history pop', () => {
  const s = setup(); s.show('#playerLayer'); s.history.state = { player: true };
  s.run('_playerPushed = true'); s.context.requestAppBack(); s.events.popstate();
  assert.equal(s.calls.back, 1); assert.equal(s.calls.destroyed, 1);
  assert.equal(s.$('#playerLayer').classList.contains('hidden'), true);
});
test('nested detail back restores its parent and then the selected tab', () => {
  const s = setup(); s.context.previous = () => s.calls.previous++;
  s.run('pushView(previous); pushView(() => {})');
  s.context.requestAppBack(); s.events.popstate();
  assert.equal(s.calls.previous, 1); assert.equal(s.document.body.classList.contains('detail-view'), true);
  s.history.state = { depth: 1 }; s.context.requestAppBack(); s.events.popstate();
  assert.equal(s.calls.root, 1); assert.equal(s.document.body.classList.contains('detail-view'), false);
});
test('missing detail history entry cannot navigate out of the application', () => {
  const s = setup(); s.run('pushView(() => {})'); s.history.state = null;
  s.context.requestAppBack(); assert.equal(s.calls.back, 0); assert.equal(s.calls.root, 1);
});
