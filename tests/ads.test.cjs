const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('app.js','utf8');
function setup(cfg,pro=false){const ctx={NH:{cfg},isProUser:()=>pro,esc:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),URL};vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function renderAdSlotHtml('),code.indexOf('function bindAdSlots(')),ctx);return ctx;}
test('off, empty, nonmatching slot and Pro ads have no placeholder',()=>{
  for(const [cfg,pro] of [[{ad_enabled:false},false],[{ad_enabled:true,ad_title:''},false],[{ad_enabled:true,ad_title:'广告',ad_slots:['novel']},false],[{ad_enabled:true,ad_title:'广告',ad_slots:['home']},true]])assert.equal(setup(cfg,pro).renderAdSlotHtml('home'),'');
});
test('manual ad escapes copy and uses only configured HTTPS image',()=>{
 const ctx=setup({ad_enabled:true,ad_title:'<script>',ad_desc:'描述',ad_image:'https://cdn.example/a.png',ad_provider:'manual',ad_slots:['home']});
 const html=ctx.renderAdSlotHtml('home');assert.ok(html.includes('&lt;script>'));assert.ok(html.includes('https://cdn.example/a.png'));assert.ok(!html.includes('<script>'));
});
