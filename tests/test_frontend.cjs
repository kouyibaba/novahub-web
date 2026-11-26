const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const code = fs.readFileSync('app.js', 'utf8');
const prefix = code.slice(0, code.indexOf('const SYNC_KEYS'));
const calls = [];
const ctx = {
  URL, Headers,
  location: { href: 'https://kouyibaba.github.io/novahub-web/', origin: 'https://kouyibaba.github.io' },
  localStorage: { getItem: key => key === 'nh_token' ? JSON.stringify('fixture-token') : null },
  window: { __NH_API_BASE__: 'https://fixture.trycloudflare.com', fetch: (url, init) => { calls.push([url, init]); return Promise.resolve({}); } },
};
vm.createContext(ctx);
vm.runInContext(prefix, ctx);
ctx.window.fetch('/kw?act=url&id=1&br=192');
assert.equal(calls.at(-1)[1].headers.get('Authorization'), 'Bearer fixture-token');
ctx.window.fetch('//untrusted.example/kw?act=url');
assert.equal(calls.at(-1)[1].headers, undefined);
ctx.window.fetch('https://untrusted.example/api/live/seg');
assert.equal(calls.at(-1)[1].headers, undefined);
ctx.window.fetch('https://fixture.trycloudflare.com/api/live/seg');
assert.equal(calls.at(-1)[1].headers.get('Authorization'), 'Bearer fixture-token');
for (const file of ['index.html', 'app.js', 'admin.html', 'style.css', 'manifest.json', 'icon.svg']) {
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync('docs/' + file, 'utf8'), `${file} differs from docs`);
}
const defaults = vm.runInNewContext(code.match(/const DEFAULT_SOURCES = (\[[\s\S]*?\n\]);/)[1]);
assert.equal(JSON.stringify(defaults), JSON.stringify(JSON.parse(fs.readFileSync('sources.json', 'utf8'))));
async function verifyMediaTicketOrigins() {
  const start = code.indexOf('async function mountSource(');
  const end = code.indexOf('  const v = $("#video");', start);
  const ticketCalls = [];
  const playback = {
    URL,
    location: ctx.location,
    window: { __NH_API_BASE__: 'https://fixture.trycloudflare.com' },
    P: { mountToken: 1 },
    destroyPlayers() {}, stopMusicForVideo() {}, tip() {},
    nhApi: async path => { ticketCalls.push(path); return { ticket: 'fixture-ticket' }; },
  };
  vm.createContext(playback);
  vm.runInContext(code.slice(start, end) + '\n}', playback);
  await vm.runInContext('mountSource("https://untrusted.example/api/live/m3u8?url=stream")', playback);
  assert.equal(ticketCalls.length, 0, 'media ticket requested for an untrusted origin');
  await vm.runInContext('mountSource("https://fixture.trycloudflare.com/api/live/m3u8?url=stream")', playback);
  assert.equal(ticketCalls.length, 1, 'gateway playlist did not receive media authorization');
}
verifyMediaTicketOrigins().then(() => console.log('Frontend authorization, ticket origins, source configuration and asset consistency OK')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
