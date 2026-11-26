const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function moduleUnderTest() {
  const ctx = { module: { exports: {} } }; vm.createContext(ctx);
  const file = 'history_state.js';
  assert.ok(fs.existsSync(file), 'history state module is missing');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx); return ctx.module.exports;
}
test('delete removes matching resume only and preserves collection', () => {
  const H = moduleUnderTest();
  const state = {history:[{srcId:'a',id:'1',at:10},{srcId:'b',id:'1',at:10}],progress:{'a:1':{time:10},'b:1':{time:20}},like:[{id:'1',srcId:'a'}]};
  const next = H.remove(state, 'a:1', 100);
  assert.equal(next.history.length,1); assert.equal(next.history[0].srcId,'b');
  assert.equal(next.progress['a:1'], undefined); assert.equal(next.progress['b:1'].time,20);
  assert.equal(next.like.length,1); assert.equal(next.history_deleted['a:1'],100);
});
test('stale cloud snapshot cannot resurrect deleted history or progress', () => {
  const H = moduleUnderTest();
  const deleted = H.remove({history:[{srcId:'a',id:'1',at:10}]}, 'a:1', 100);
  const next = H.merge(deleted,{history:[{srcId:'a',id:'1',at:10}],progress:{'a:1':{time:20}}});
  assert.equal(next.history.length,0); assert.equal(next.progress['a:1'],undefined);
  const watched = H.merge(next,{history:[{srcId:'a',id:'1',at:101,deleted_at:100}],progress:{'a:1':{time:30,at:101,deleted_at:100}}});
  assert.equal(watched.history.length,1);
});
test('clear blocks legacy undated snapshots while keeping favorites', () => {
  const H = moduleUnderTest(); const next=H.clear({history:[{srcId:'a',id:'1'}],like:[1]},100);
  const merged=H.merge(next,{history:[{srcId:'b',id:'2'}],progress:{'b:2':{time:1}}});
  assert.equal(merged.history.length,0); assert.equal(Object.keys(merged.progress).length,0); assert.equal(merged.like.length,1);
});
test('newer offline timestamps without observing deletion stay deleted',()=>{
  const H=moduleUnderTest();const state={history_deleted:{'a:1':100}};
  const next=H.merge(state,{history:[{srcId:'a',id:'1',at:999}],progress:{'a:1':{time:42,at:999}}});
  assert.equal(next.history.length,0);assert.equal(next.progress['a:1'],undefined);
});
