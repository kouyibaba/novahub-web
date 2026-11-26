const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function load(){const ctx={module:{exports:{}}};vm.createContext(ctx);assert.ok(fs.existsSync('vod_client.js'),'managed client missing');vm.runInContext(fs.readFileSync('vod_client.js','utf8'),ctx);return ctx.module.exports;}
test('late search cannot replace newer results',async()=>{
  const V=load();const pending={};const client=V.create(q=>new Promise(r=>pending[q]=r));const shown=[];
  const a=client.search('old',x=>shown.push(x));const b=client.search('new',x=>shown.push(x));
  pending.new('new');await b;pending.old('old');await a;assert.deepEqual(shown,['new']);
});
test('episode mapping requires exact label and matching version fingerprint',()=>{
  const V=load();const a={name:'测试',year:'2026',typeName:'剧',lang:'国语',season:'1'};
  assert.equal(V.compatible(a,{...a,season:'2'}),false);assert.equal(V.compatible(a,{...a,year:''}),false);
  assert.equal(V.compatible(a,{...a}),true);assert.equal(V.episodeIndex([{name:'第1集'},{name:'第2集'}],'第2集'),1);
  assert.equal(V.episodeIndex([{name:'预告'}],'第2集'),-1);
});
