import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
// react-dom picks its input-event strategy when it loads, so give it a DOM first.
const bootstrap=new JSDOM('<!doctype html>');globalThis.window=bootstrap.window;globalThis.document=bootstrap.window.document;
const {createRoot}=await import('react-dom/client');

const temporary = await mkdtemp(path.join(tmpdir(), 'community-store-tests-'));
const bundle = path.join(temporary,'store.mjs');
await build({entryPoints:[fileURLToPath(new URL('./plugin.jsx',import.meta.url))],outfile:bundle,bundle:true,format:'esm',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',plugins:[{
    name:'test-shell',setup(build){build.onResolve({filter:/^@oie\/web-shell$/},()=>({path:'shell',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const platform = globalThis.storeTestPlatform;'}));}
}]});
let sequence=0;
// In-memory stand-in for the host's platform.columns.createColumnManager (same interface).
const columnManager=(key,defaults,defaultHidden=[])=>{let order=null,widths={},hidden=new Set(defaultHidden);return{
    order(present){if(!order)return present.slice();const out=order.filter(k=>present.includes(k));for(const k of present)if(!out.includes(k))out.push(k);return out;},
    width:k=>widths[k]??defaults[k]??120,setWidth(k,w){widths[k]=Math.max(40,Math.round(w));},setOrder(keys){order=keys.slice();},
    isHidden:k=>hidden.has(k),setHidden(k,v){if(v)hidden.add(k);else hidden.delete(k);},reset(){order=null;widths={};hidden=new Set(defaultHidden);}};};
const sample = (extra={}) => ({id:'sample',name:'Sample template',description:'Example content',type:'code-template',version:'2.0.0',tag:'v2.0.0',installedVersion:'1.0.0',expectedContentHash:'reviewed-state',compatible:true,installable:true,updateAvailable:true,repo:'owner/sample',authors:['Community'],...extra});
async function fixture(entries, options={}) {
    const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://engine.test/'});
    globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.localStorage=dom.window.localStorage;
    globalThis.Event=dom.window.Event; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    const calls=[]; let Component;
    const catalog={engineVersion:'4.6.0',generatedAt:Date.now(),entries,errors:options.errors||[]};
    const menus=[];
    globalThis.storeTestPlatform={React,checkTask:()=>!options.readOnly,ui:{toast(){},contextMenu(x,y,items){menus.push(items);}},columns:{createColumnManager:columnManager},reactView:c=>c,registerNavItem(){},registerView(_p,c){Component=c;},api:{
        get:async p=>options.get?options.get(p,catalog):p.includes('/catalog')?catalog:{list:{codeTemplateLibrary:[{id:'lib',name:'Existing library'}]}},
        post:async(p,b)=>{calls.push({p,b});return options.post?options.post(p,b):{restartRequired:options.restart||false};},put:async()=>({})
    }};
    const {register}=await import(pathToFileURL(bundle).href+'?case='+sequence++); register();
    const root=createRoot(document.getElementById('root'));
    await act(async()=>{root.render(React.createElement(Component));});
    const buttons=()=>[...document.querySelectorAll('button')];
    const button=text=>buttons().find(b=>b.textContent.trim()===text)||buttons().find(b=>b.textContent.includes(text));
    const click=async text=>{const b=button(text);assert.ok(b,`button ${text} exists`);await act(async()=>b.click());return b;};
    if (!options.closed && document.querySelector('.cs-package')) await act(async()=>document.querySelector('.cs-package').click());
    const headers=()=>[...document.querySelectorAll('thead th')].map(th=>th.firstChild.textContent);
    const header=async label=>{const th=[...document.querySelectorAll('thead th')].find(t=>t.firstChild.textContent===label);assert.ok(th,`header ${label} exists`);await act(async()=>th.click());return th;};
    const cell=(column,row=0)=>document.querySelectorAll(`.cs-package-row td[data-column="${column}"]`)[row];
    return {calls,click,button,buttons,catalog,menus,headers,header,cell,async close(){await act(async()=>root.unmount());dom.window.close();}};
}
try {
await test('package modal shows documentation and restores row focus on close',async()=>{
 const f=await fixture([sample()],{closed:true,get:async(p,catalog)=>p.endsWith('/docs')?{found:true,markdown:'# Publisher guide',repo:'owner/sample',tag:'v2'}:catalog});
 try{assert.equal(document.querySelector('[role="dialog"]'),null);const opener=document.querySelector('.cs-package');opener.focus();await f.click('Sample template');assert.equal(f.button('Hide publisher documentation').getAttribute('aria-expanded'),'true');const dialog=document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/Publisher guide/);await f.click('Close');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,opener);}finally{await f.close();}
});
await test('type filtering, grouping and sorting retain access to details',async()=>{
 const f=await fixture([sample(),sample({id:'connector',name:'Z connector',type:'connector'})],{closed:true});
 const select=async(label,value)=>{const el=document.querySelector(`[aria-label="${label}"]`);await act(async()=>{el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));});};
 try{await f.click('No grouping');await f.header('Type');assert.match(document.querySelector('.cs-package').textContent,/Z connector/);await f.click('By type');assert.equal(document.querySelectorAll('.cs-group').length,2);await select('Package type','connector');assert.equal(document.querySelectorAll('.cs-package').length,1);await f.click('Z connector');assert.match(document.querySelector('[role="dialog"]').textContent,/Z connector/);}finally{await f.close();}
});
await test('all-version downloads appear in table and details, including genuine zero',async()=>{
 for (const count of [0,12345]) {
  const f=await fixture([sample({statistics:{downloads:{status:'available',count},stars:{status:'available',count:0}}})],{get:async(p,catalog)=>{assert.ok(!p.endsWith('/downloads'));return catalog;}});
  try {assert.equal(f.cell('downloads').textContent,count.toLocaleString());const fact=[...document.querySelectorAll('.cs-fact')].find(e=>e.textContent.includes('Downloads · all versions'));assert.equal(fact.querySelector('dd span').textContent,count.toLocaleString());assert.match(fact.querySelector('[title]').title,/not an installation or user count/);} finally {await f.close();}
 }
});
await test('download lookup failure leaves package browsing and actions available',async()=>{
 const f=await fixture([sample()],{get:async(p,catalog)=>{if(p.endsWith('/downloads'))throw Error('Rate limited');return catalog;}});
 try{assert.equal(f.cell('downloads').textContent,'—');assert.ok(f.button('Review update'));assert.equal(document.querySelector('[role="alert"]'),null);}finally{await f.close();}
});
await test('rate-limit reason is visible in download tooltip and details',async()=>{
 const f=await fixture([sample({statistics:{downloads:{status:'unavailable',reason:'rate_limit_or_access_denied'}}})]);
 try {assert.match(f.cell('downloads').querySelector('span').title,/GitHub rate limit/);assert.match(document.querySelector('.cs-detail').textContent,/GitHub rate limit/);}finally{await f.close();}
});
await test('catalog stars and stale timestamps remain visible without statistics requests',async()=>{
 const f=await fixture([sample({statistics:{stars:{status:'available',count:42,stale:true,checkedAt:'2026-09-22T10:00:00Z'}}})],{get:async(p,catalog)=>{assert.ok(!p.endsWith('/downloads'));return catalog;}});
 try {assert.equal(f.cell('stars').textContent,'42 (stale)');assert.match(f.cell('stars').querySelector('span').title,/last successful count/);assert.match(document.querySelector('.cs-detail').textContent,/GitHub stars/);}finally{await f.close();}
});
await test('type is default; numeric column headers toggle and keep missing counts last',async()=>{
 const metric=count=>({status:'available',count});
 const f=await fixture([sample({id:'low',name:'Low',statistics:{downloads:metric(2),stars:metric(30)}}),sample({id:'high',name:'High',statistics:{downloads:metric(100),stars:metric(1)}}),sample({id:'zero',name:'Zero',statistics:{downloads:metric(0)}}),sample({id:'missing',name:'Missing'})],{closed:true});
 try {
  assert.equal(document.querySelector('[aria-label="Group packages"] [aria-pressed="true"]').textContent,'By type');
  const names=()=>[...document.querySelectorAll('.cs-name')].map(e=>e.textContent);
  const downloads=await f.header('Downloads');assert.deepEqual(names(),['High','Low','Zero','Missing']);assert.equal(downloads.getAttribute('aria-sort'),'descending');
  await f.header('Downloads');assert.deepEqual(names(),['Zero','Low','High','Missing']);
  await f.header('Stars');assert.deepEqual(names(),['Low','High','Missing','Zero']);
  await f.header('Package');assert.deepEqual(names(),['High','Low','Missing','Zero']);
  assert.equal(localStorage.getItem('communitystore.sortBy'),'name');
 }finally{await f.close();}
});
await test('version columns sort numerically and grouping can be disabled for global ordering',async()=>{
 const f=await fixture([sample({id:'two',name:'Two',version:'2.0.0',installedVersion:'2.0.0',type:'plugin'}),sample({id:'ten',name:'Ten',version:'10.0.0',installedVersion:'10.0.0',type:'connector'})],{closed:true});
 try {await f.click('No grouping');
 for(const label of ['Installed','Offered']){await f.header(label);assert.equal(document.querySelector('.cs-name').textContent,'Ten');await f.header(label);assert.equal(document.querySelector('.cs-name').textContent,'Two');}
 }finally{await f.close();}
});
await test('real Remove click uses removal endpoint and never install',async()=>{
 const f=await fixture([sample()]);try{await f.click('Remove from engine…');await f.click('Remove');assert.deepEqual(f.calls,[{p:'/extensions/communitystore/_removeContent',b:{id:'sample'}}]);}finally{await f.close();}
});
await test('pristine update sends reviewed state without overwrite consent',async()=>{
 const f=await fixture([sample()]);try{await f.click('Review update');await f.click('Update to v2.0.0');assert.equal(f.calls[0].b.expectedContentHash,'reviewed-state');assert.equal(f.calls[0].b.overwrite,false);assert.equal(f.calls[0].b.mode,'upgrade');}finally{await f.close();}
});
await test('modified update requires explicit overwrite or copy',async()=>{
 const f=await fixture([sample({modified:true})]);try{await f.click('Review update');assert.equal(f.calls.length,0);await f.click('Overwrite');assert.equal(f.calls[0].b.overwrite,true);assert.equal(f.calls[0].b.expectedContentHash,'reviewed-state');}finally{await f.close();}
});
await test('copy preserves canonical content and asks for placement',async()=>{
 const f=await fixture([sample({modified:true})]);try{await f.click('Review update');await f.click('Install as new copy');await f.click('Install as copy');assert.equal(f.calls[0].b.mode,'copy');assert.equal(f.calls[0].b.expectedContentHash,undefined);assert.equal(f.calls[0].b.newLibrary,'Sample template');}finally{await f.close();}
});
await test('installed channel only offers copy, never removal or upgrade',async()=>{
 const f=await fixture([sample({type:'channel',updateAvailable:false})]);try{assert.equal(f.button('Remove from engine…'),undefined);await f.click('Import as copy');await f.click('Install as copy');assert.equal(f.calls[0].b.mode,'copy');}finally{await f.close();}
});
await test('failed stale-content request retains error and original consent token',async()=>{
 const f=await fixture([sample()],{post:async()=>{throw Error('Content changed since you reviewed it.');}});try{await f.click('Review update');await f.click('Update to v2.0.0');assert.match(document.querySelector('[role="dialog"]').textContent,/Content changed/);assert.equal(f.calls[0].b.expectedContentHash,'reviewed-state');}finally{await f.close();}
});
await test('duplicate confirmation while pending sends one request',async()=>{
 let resolve;const f=await fixture([sample()],{post:()=>new Promise(r=>resolve=r)});try{await f.click('Review update');const b=f.button('Update to v2.0.0');await act(async()=>{b.click();b.click();});assert.equal(f.calls.length,1);await act(async()=>resolve({}));}finally{await f.close();}
});
await test('dialog Escape cancels and restores focus',async()=>{
 const f=await fixture([sample()]);try{const opener=f.button('Review update');opener.focus();await f.click('Review update');const dialog=document.querySelector('[role="dialog"]');assert.equal(document.activeElement,dialog);await act(async()=>dialog.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(document.querySelectorAll('[role="dialog"]').length,1);assert.equal(document.activeElement,opener);assert.equal(f.calls.length,0);}finally{await f.close();}
});
await test('staged binary stays visible and cannot be repeatedly installed',async()=>{
 const f=await fixture([sample({type:'plugin',installedVersion:'',updateAvailable:false})],{restart:true});try{await f.click('Review installation');await f.click('Install 2.0.0');assert.match(document.body.textContent,/Restart pending/);assert.equal(f.button('Review installation'),undefined);await f.click('Close');await f.click('Installed');assert.equal(document.querySelectorAll('.cs-package').length,1);}finally{await f.close();}
});
await test('read-only and incompatible views expose no mutation controls',async()=>{
 for(const options of [{readOnly:true},{}]){const f=await fixture([sample({compatible:!!options.readOnly,installedVersion:'',updateAvailable:false})],options);try{assert.equal(f.button('Review installation'),undefined);assert.equal(f.button('Review import'),undefined);assert.equal(f.button('Remove from engine…'),undefined);}finally{await f.close();}}
});
await test('revoked installed packages remain visible in Installed',async()=>{
 const f=await fixture([sample({revoked:true,compatible:false,installable:false,updateAvailable:false})]);try{assert.equal(document.querySelectorAll('.cs-package').length,0);await f.click('Installed');assert.equal(document.querySelectorAll('.cs-package').length,1);assert.match(document.body.textContent,/Removed from source/);}finally{await f.close();}
});
await test('update filter only lists packages with updates',async()=>{
 const f=await fixture([sample(),sample({id:'other',name:'Other',updateAvailable:false})],{closed:true});try{await f.click('Updates');assert.equal(document.querySelectorAll('.cs-package').length,1);await f.click('Sample template');assert.equal(document.querySelector('.cs-detail h2').textContent,'Sample template');}finally{await f.close();}
});
await test('a newer installed version is marked apart from an up-to-date install',async()=>{
 const f=await fixture([sample({id:'newer',name:'Newer build',type:'plugin',installedVersion:'2.1.0',updateAvailable:false,installedNewer:true}),sample({id:'current',name:'Current build',type:'plugin',installedVersion:'2.0.0',updateAvailable:false})],{closed:true});try{const newer=document.querySelector('.cs-package-row .tag.accent');assert.ok(newer,'newer install uses the update (blue) pill');assert.equal(newer.textContent,'Installed (newer)');assert.match(newer.title,/2\.1\.0 is newer than the offered 2\.0\.0/);assert.equal(document.querySelectorAll('.cs-package-row .tag.ok').length,1,'the up-to-date install keeps the green pill');}finally{await f.close();}
});
await test('downloads and stars are shown by default; the column menu hides, adds and restores columns',async()=>{
 const f=await fixture([sample({publishedAt:'2026-11-01T00:00:00Z'})],{closed:true});
 try{
  assert.deepEqual(f.headers(),['Package','Type','Installed','Offered','Downloads','Stars','Status']);
  await act(async()=>document.querySelector('thead tr').dispatchEvent(new window.MouseEvent('contextmenu',{bubbles:true,clientX:5,clientY:5})));
  const menu=f.menus.at(-1);const item=label=>menu.find(i=>i.label?.trim().endsWith(label));
  assert.ok(item('Downloads').label.startsWith('✓'));assert.ok(!item('Author').label.startsWith('✓'));assert.equal(item('Package'),undefined,'the package column cannot be hidden');
  await act(async()=>item('Downloads').onClick());await act(async()=>item('Author').onClick());
  assert.deepEqual(f.headers(),['Package','Type','Author','Installed','Offered','Stars','Status']);
  assert.equal(f.cell('author').textContent,'Community');
  await f.click('Columns');await act(async()=>f.menus.at(-1).find(i=>i.label==='Restore Default').onClick());
  assert.deepEqual(f.headers(),['Package','Type','Installed','Offered','Downloads','Stars','Status']);
 }finally{await f.close();}
});
await test('dragging a header reorders data columns and keeps Package first',async()=>{
 const f=await fixture([sample()],{closed:true});
 const drop=async(from,to)=>{const th=[...document.querySelectorAll('thead th')].find(t=>t.firstChild.textContent===to);const event=new window.Event('drop',{bubbles:true,cancelable:true});event.dataTransfer={getData:()=>from};await act(async()=>th.dispatchEvent(event));};
 try{
  assert.equal(document.querySelector('thead th').draggable,false);
  await drop('stars','Type');assert.deepEqual(f.headers(),['Package','Stars','Type','Installed','Offered','Downloads','Status']);
  await drop('status','Package');assert.deepEqual(f.headers(),['Package','Status','Stars','Type','Installed','Offered','Downloads']);
  await drop('name','Status');assert.equal(f.headers()[0],'Package');
 }finally{await f.close();}
});
await test('status lists every applicable state, not just the first',async()=>{
 const f=await fixture([sample({modified:true})],{closed:true});
 try{assert.deepEqual([...f.cell('status').querySelectorAll('.tag')].map(t=>t.textContent),['Locally modified','Update available']);}finally{await f.close();}
});
await test('search matches authors and the clear button resets it',async()=>{
 const f=await fixture([sample(),sample({id:'other',name:'Other',authors:['Someone Else']})],{closed:true});
 const input=document.querySelector('[aria-label="Search packages"]');
 try{
  await act(async()=>{const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(input,'someone');input.dispatchEvent(new window.Event('input',{bubbles:true}));});
  assert.deepEqual([...document.querySelectorAll('.cs-name')].map(e=>e.textContent),['Other']);
  await act(async()=>document.querySelector('[aria-label="Clear search"]').click());assert.equal(document.querySelectorAll('.cs-name').length,2);
 }finally{await f.close();}
});
} finally { await rm(temporary,{recursive:true,force:true}); }
