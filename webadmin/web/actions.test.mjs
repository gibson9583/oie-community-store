import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';

const temporary = await mkdtemp(path.join(tmpdir(), 'community-store-tests-'));
const bundle = path.join(temporary,'store.mjs');
await build({entryPoints:[fileURLToPath(new URL('./plugin.jsx',import.meta.url))],outfile:bundle,bundle:true,format:'esm',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',plugins:[{
    name:'test-shell',setup(build){build.onResolve({filter:/^@oie\/web-shell$/},()=>({path:'shell',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const platform = globalThis.storeTestPlatform;'}));}
}]});
let sequence=0;
const sample = (extra={}) => ({id:'sample',name:'Sample template',description:'Example content',type:'code-template',version:'2.0.0',tag:'v2.0.0',installedVersion:'1.0.0',expectedContentHash:'reviewed-state',compatible:true,installable:true,updateAvailable:true,repo:'owner/sample',authors:['Community'],...extra});
async function fixture(entries, options={}) {
    const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://engine.test/'});
    globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.localStorage=dom.window.localStorage;
    globalThis.Event=dom.window.Event; globalThis.IS_REACT_ACT_ENVIRONMENT=true;
    const calls=[]; let Component;
    const catalog={engineVersion:'4.6.0',generatedAt:Date.now(),entries,errors:options.errors||[]};
    globalThis.storeTestPlatform={React,checkTask:()=>!options.readOnly,ui:{toast(){}},reactView:c=>c,registerNavItem(){},registerView(_p,c){Component=c;},api:{
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
    return {calls,click,button,buttons,catalog,async close(){await act(async()=>root.unmount());dom.window.close();}};
}
try {
await test('package modal shows documentation and restores row focus on close',async()=>{
 const f=await fixture([sample()],{closed:true,get:async(p,catalog)=>p.endsWith('/docs')?{found:true,markdown:'# Publisher guide',repo:'owner/sample',tag:'v2'}:catalog});
 try{assert.equal(document.querySelector('[role="dialog"]'),null);const opener=document.querySelector('.cs-package');opener.focus();await f.click('Sample template');assert.equal(f.button('Hide publisher documentation').getAttribute('aria-expanded'),'true');const dialog=document.querySelector('[role="dialog"]');assert.match(dialog.textContent,/Publisher guide/);await f.click('Close');assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(document.activeElement,opener);}finally{await f.close();}
});
await test('type filtering, grouping and sorting retain access to details',async()=>{
 const f=await fixture([sample(),sample({id:'connector',name:'Z connector',type:'connector'})],{closed:true});
 const select=async(label,value)=>{const el=document.querySelector(`[aria-label="${label}"]`);await act(async()=>{el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));});};
 try{await select('Group packages','none');await select('Sort packages','type');assert.match(document.querySelector('.cs-package').textContent,/Z connector/);await select('Group packages','type');assert.equal(document.querySelectorAll('.cs-group').length,2);await select('Package type','connector');assert.equal(document.querySelectorAll('.cs-package').length,1);await f.click('Z connector');assert.match(document.querySelector('[role="dialog"]').textContent,/Z connector/);}finally{await f.close();}
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
} finally { await rm(temporary,{recursive:true,force:true}); }
