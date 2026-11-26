const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
function setup(){
  const data={progress:{}};const calls=[];const item={name:'剧',year:'2026',typeName:'剧集',lang:'国语',season:'1'};
  const ctx={module:{exports:{}},P:{managed:{item,attempts:0,tried:new Set(['a:1']),generation:0},eps:[{name:'第2集'}],idx:0,vodKey:'a:1',mountToken:1},historyBlocked:new Set(),get:(k,d)=>data[k]??d,set:(k,v)=>data[k]=v,
    $:q=>q==='#video'?{currentTime:37}:{classList:{contains:()=>false}},renderEpisodes(){},tip(){},toast(){},mountSource:(url,time)=>calls.push({url,time}),encodeURIComponent};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('vod_client.js','utf8'),ctx);ctx.NovaVod=ctx.module.exports;
  vm.runInContext(source.slice(source.indexOf('function saveProgress('),source.indexOf('/* ============ 搜索',source.indexOf('function saveProgress('))),ctx);
  vm.runInContext(source.slice(source.indexOf('async function retryManagedPlayback('),source.indexOf('function destroyPlayers()')),ctx);
  return {ctx,data,calls,item};
}
test('automatic alternate keeps exact episode and current playback position',async()=>{
  const s=setup();s.ctx.nhApi=async path=>path.includes('/search')?{items:[{...s.item,routes:[{srcId:'b',id:'2'}]}]}:{item:s.item,episodes:[{n:'第1集',url:'one'},{n:'第2集',url:'two'}],ticket:'valid'};
  assert.equal(await s.ctx.retryManagedPlayback(1),true);assert.deepEqual(s.calls,[{url:'two',time:37}]);assert.equal(s.ctx.P.vodKey,'a:1');
});
test('alternates stop after two and never jump from episode to trailer',async()=>{
  const s=setup();let details=0;
  s.ctx.nhApi=async path=>path.includes('/search')?{items:[{...s.item,routes:[{srcId:'b',id:'2'},{srcId:'c',id:'3'},{srcId:'d',id:'4'}]}]}:(details++,{item:s.item,episodes:[{n:'预告',url:'trailer'}]});
  assert.equal(await s.ctx.retryManagedPlayback(1),false);assert.equal(details,2);assert.equal(s.calls.length,0);
});
test('deleted active video does not recreate resume progress',()=>{
  const s=setup();s.ctx.historyBlocked.add('a:1');s.ctx.saveProgress('a:1',1,44);assert.equal(s.data.progress['a:1'],undefined);
  s.ctx.saveProgress('b:1',0,20);assert.equal(s.data.progress['b:1'].time,20);
});
test('cloud response for previous account is ignored',async()=>{
  let resolve;let restored=0;
  const ctx={NH:{token:'old',user:{id:1}},migrateLegacySources:async()=>{},nhApi:()=>new Promise(r=>resolve=r),restore:()=>restored++,toast(){},get(){return[]},K:{LIKE:'like',HISTORY:'history'}};
  vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function cloudSyncPull('),source.indexOf('document.addEventListener("visibilitychange"')),ctx);
  const pending=ctx.cloudSyncPull(true);await new Promise(setImmediate);ctx.NH.token='new';resolve({sync:{data:{history:[1]}}});await pending;assert.equal(restored,0);
});
