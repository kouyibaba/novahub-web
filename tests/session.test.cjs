const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function controller(state, request) {
  const exports = {};
  const file = 'auth_session.js';
  assert.ok(fs.existsSync(file), 'session controller must be present');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: { exports }, Error, Number });
  const writes = {};
  const value = exports.create(state, { request, write: (k,v) => writes[k] = v });
  return { value, writes };
}
const user = { id: 3, username: 'fixture', is_pro: false };
test('a late invalid response cannot log out a newly signed-in session', async () => {
  let reject;
  const state = { token: 'old', user };
  const { value } = controller(state, () => new Promise((_, r) => { reject = r; }));
  const refresh = value.refresh();
  value.apply('new', user);
  reject(Object.assign(new Error('invalid'), { status: 401 }));
  await refresh;
  assert.equal(state.token, 'new');
  assert.equal(state.user.id, 3);
});
test('network and malformed successful responses preserve the session', async () => {
  for (const result of [() => Promise.reject(new Error('network')), () => Promise.resolve({}), () => Promise.resolve({ user: null })]) {
    const state = { token: 'valid', user };
    const { value } = controller(state, result);
    await value.refresh();
    assert.equal(state.token, 'valid');
    assert.equal(state.offline, true);
  }
});
test('explicit invalid credentials clear local and native sessions', async () => {
  const state = { token: 'old', user };
  const { value, writes } = controller(state, () => Promise.reject(Object.assign(new Error('invalid'), { status: 401 })));
  let saved;
  value.nativeReady({}, payload => { saved = payload; });
  await value.refresh();
  assert.equal(state.token, '');
  assert.equal(writes.nh_token, '');
  assert.equal(saved.token, '');
});
test('native session restores missing WebView storage and accepts server renewal', async () => {
  const state = { token: '', user: null };
  const { value, writes } = controller(state, async token => {
    assert.equal(token, 'saved');
    return { user, token: 'renewed' };
  });
  let saved;
  assert.equal(value.nativeReady({ token: 'saved', user }, payload => { saved = payload; }), true);
  assert.equal(state.token, 'saved');
  await value.refresh();
  assert.equal(writes.nh_token, 'renewed');
  assert.equal(saved.token, 'renewed');
});
test('logout before native hydration cannot restore an old saved account', () => {
  const state = { token: 'old', user };
  const { value } = controller(state, async () => ({ user }));
  value.clear();
  let saved;
  value.nativeReady({ token: 'old', user }, payload => { saved = payload; });
  assert.equal(state.token, '');
  assert.equal(saved.token, '');
});
