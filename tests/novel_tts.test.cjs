const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the real reader speech controller without starting the whole SPA.
const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
const speech = app.slice(app.indexOf('/* ============ 小说 Web Speech TTS'), app.indexOf('async function dismissSplash'));

function reader({ native = true, browser = false, paragraphs = ['第一句。第二句！'], chapters = 1, nextParagraphs = null } = {}) {
  const calls = [], messages = [], pendingTimers = [];
  const button = { classList: { add() {}, remove() {} }, innerHTML: '' };
  const audio = { paused: false, pause() { this.paused = true; } };
  const video = { paused: false, pause() { this.paused = true; } };
  const ctx = {
    console, Promise, Error, Math, Date, String, Array, Set,
    $: (sel) => sel === '#rTtsBtn' ? button : sel === '#video' ? video : null,
    document: { querySelectorAll: () => paragraphs.map(textContent => ({ textContent })) },
    ico: (key) => key, toast: (msg) => messages.push(msg),
    R: { book: { book_id: 'book-1' }, index: 1, token: 1, chapters: Array(chapters).fill({}) },
    audioEl: audio, mPlayToken: 0,
    loadReaderChapter: async () => false,
    modal: async () => false,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cancelled: false }; pendingTimers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
  };
  ctx.window = ctx;
  if (nextParagraphs) ctx.loadReaderChapter = async (index) => {
    ctx.R.index = index;
    paragraphs = nextParagraphs;
    return true;
  };
  if (native) ctx.NovaNative = {
    speakNovel: (...args) => calls.push(args),
    stopNovelSpeech: () => calls.push(['stop']),
    openTtsSettings: () => calls.push(['settings']),
  };
  if (browser) {
    ctx.speechSynthesis = { cancel() {}, getVoices: () => [], speak: (utterance) => calls.push(utterance) };
    ctx.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
  vm.createContext(ctx);
  vm.runInContext(speech, ctx);
  return {
    ctx, calls, messages, audio, video,
    eval: (code) => vm.runInContext(code, ctx),
    async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
    async advance() {
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const timer = pendingTimers.find(t => !t.cancelled && t.ms < 1000);
      if (timer) { timer.cancelled = true; timer.fn(); }
      for (let i = 0; i < 8; i++) await Promise.resolve();
    },
  };
}

test('Android speech works without browser speechSynthesis and pauses other audio', async () => {
  const r = reader();
  r.ctx.toggleNovelTts();
  await r.flush();
  assert.equal(r.calls.filter(c => c[0] !== 'stop').length, 1);
  assert.equal(r.calls.find(c => c[0] !== 'stop')[0], '第一句。');
  assert.equal(r.audio.paused, true);
  assert.equal(r.video.paused, true);
});

test('completed native sentence advances; stale callbacks cannot restart speech after stop', async () => {
  const r = reader();
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  assert.ok(first, 'native speech request must be sent');
  r.ctx.__nhNovelTtsEvent(first[1], 'done', '');
  await r.advance();
  const utterances = r.calls.filter(c => c[0] !== 'stop');
  assert.equal(utterances[1][0], '第二句！');
  r.ctx.stopNovelTts();
  r.ctx.__nhNovelTtsEvent(utterances[1][1], 'done', '');
  await r.advance();
  assert.equal(r.eval('ttsSpeaking'), false);
  assert.equal(r.calls.filter(c => c[0] !== 'stop').length, 2);
});

test('pause resumes at the current sentence instead of the start of the chapter', async () => {
  const r = reader();
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  assert.ok(first, 'native speech request must be sent');
  r.ctx.__nhNovelTtsEvent(first[1], 'done', '');
  await r.advance();
  r.ctx.toggleNovelTts();
  r.ctx.toggleNovelTts();
  await r.flush();
  assert.equal(r.calls.filter(c => c[0] !== 'stop').at(-1)[0], '第二句！');
});

test('missing Chinese voice stops with an actionable message rather than skipping the chapter', async () => {
  const r = reader();
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  assert.ok(first, 'native speech request must be sent');
  r.ctx.__nhNovelTtsEvent(first[1], 'error', 'missing_voice');
  await r.flush();
  assert.equal(r.eval('ttsSpeaking'), false);
  assert.ok(r.messages.some(msg => /中文.*语音|语音.*中文/.test(msg)));
});

test('failed next chapter load stops and never reads the previous chapter again', async () => {
  const r = reader({ paragraphs: ['这一章结束。'], chapters: 2 });
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  assert.ok(first, 'native speech request must be sent');
  r.ctx.__nhNovelTtsEvent(first[1], 'done', '');
  await r.advance();
  await r.advance();
  assert.equal(r.eval('ttsSpeaking'), false);
  assert.equal(r.calls.filter(c => c[0] !== 'stop').length, 1);
});

test('successful chapter load continues with the next chapter text', async () => {
  const r = reader({ paragraphs: ['上一章结束。'], chapters: 2, nextParagraphs: ['下一章开始。'] });
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  r.ctx.__nhNovelTtsEvent(first[1], 'done', '');
  await r.advance();
  assert.equal(r.ctx.R.index, 2);
  assert.equal(r.calls.filter(c => c[0] !== 'stop').at(-1)[0], '下一章开始。');
});

test('stopping during a sentence gap cancels the delayed next sentence', async () => {
  const r = reader();
  r.ctx.toggleNovelTts();
  await r.flush();
  const first = r.calls.find(c => c[0] !== 'stop');
  r.ctx.__nhNovelTtsEvent(first[1], 'done', '');
  await r.flush();
  r.ctx.stopNovelTts();
  await r.advance();
  assert.equal(r.calls.filter(c => c[0] !== 'stop').length, 1);
});

test('long text is bounded and question/exclamation delivery differs gently', () => {
  const r = reader();
  const parts = r.eval('buildNovelSpeechSegments(["你去哪儿？回来！", "长".repeat(1000)])');
  assert.ok(parts.length > 3);
  assert.ok(parts.every(p => p.text.length <= 180));
  assert.notEqual(parts[0].rate, parts[1].rate);
  assert.equal(parts.slice(2).map(p => p.text).join(''), '长'.repeat(1000));
});

test('browser speech remains supported and synthesis errors stop cleanly', async () => {
  const r = reader({ native: false, browser: true });
  r.ctx.toggleNovelTts();
  await r.flush();
  assert.equal(r.calls[0].lang, 'zh-CN');
  r.calls[0].onerror({ error: 'voice-unavailable' });
  await r.flush();
  assert.equal(r.eval('ttsSpeaking'), false);
  assert.equal(r.calls.length, 1);
});

test('older APK gets an upgrade message instead of using the unsupported WebView speech path', async () => {
  const r = reader({ native: false, browser: true });
  r.ctx.NovaNative = { getAppVersion: () => 'v2.4.2' };
  r.ctx.toggleNovelTts();
  await r.flush();
  assert.equal(r.calls.length, 0);
  assert.ok(r.messages.some(msg => /新版 APK/.test(msg)));
});
