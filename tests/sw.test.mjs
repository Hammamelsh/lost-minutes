/* The service worker decides what a browser sees when we are unreachable, so its rules are
 * tested directly: public/sw.js is evaluated in a sandbox with stub caches and fetch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const SOURCE=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const ORIGIN='https://example.test';

function load({networkFails=false,cached={},networkBody='{"state":"live"}'}={}){
 const listeners={},store=new Map(Object.entries(cached));
 const cache={
  addAll:async()=>{},
  put:async(request,response)=>{store.set(new URL(request.url??request,ORIGIN).pathname,await response.text())},
  match:async request=>{
   const key=new URL(request.url??request,ORIGIN).pathname;
   return store.has(key)?new Response(store.get(key),{headers:{'Content-Type':'application/json'}}):undefined;
  },
 };
 const self={
  location:new URL(ORIGIN+'/sw.js'),
  addEventListener:(type,fn)=>{listeners[type]=fn},
  skipWaiting:async()=>{},
  clients:{claim:async()=>{}},
  caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true,
          match:(request,options)=>cache.match(request,options)},
  fetch:async()=>{if(networkFails)throw Error('offline');return new Response(networkBody,{status:200,headers:{'Content-Type':'application/json'}})},
 };
 const context={self,caches:self.caches,fetch:self.fetch,Response,Request,Headers,URL,console};
 vm.createContext(context);
 vm.runInContext(SOURCE,context);
 return {listeners,store};
}

async function handle(listeners,request){
 let responded;
 await listeners.fetch({request,respondWith:value=>{responded=value}});
 return responded?await responded:undefined;
}

const dataRequest=(path='/data/live.json')=>new Request(ORIGIN+path,{method:'GET'});

test('published data is network-first: a fresh response is used and cached',async()=>{
 const {listeners,store}=load({networkBody:'{"state":"live","vehicles":[]}'});
 const response=await handle(listeners,dataRequest());
 assert.equal(response.status,200);
 assert.equal(response.headers.get('X-Lost-Minutes-From-Cache'),null,'a live response is not marked as cached');
 assert.equal(await response.text(),'{"state":"live","vehicles":[]}');
 await new Promise(r=>setImmediate(r));
 assert.equal(store.get('/data/live.json'),'{"state":"live","vehicles":[]}');
});

test('when we are unreachable the cached copy is served, marked, and unaltered',async()=>{
 // The original observation timestamps must survive being served from the cache.
 const saved='{"publishedAtMs":1000,"vehicles":[{"recordedAt":"2026-09-12T21:33:39+00:00"}]}';
 const {listeners}=load({networkFails:true,cached:{'/data/live.json':saved}});
 const response=await handle(listeners,dataRequest());
 assert.equal(response.status,200);
 assert.equal(response.headers.get('X-Lost-Minutes-From-Cache'),'1',
  'the page must be told the data came from the device, not from us');
 assert.equal(await response.text(),saved,'cached data keeps its original timestamps byte for byte');
});

test('offline with nothing cached says so, rather than looking empty',async()=>{
 const {listeners}=load({networkFails:true});
 const response=await handle(listeners,dataRequest());
 assert.equal(response.status,503);
 assert.equal(JSON.parse(await response.text()).error,'offline');
});

test('a navigation offline falls back to the cached shell',async()=>{
 const {listeners}=load({networkFails:true,cached:{'/':'<!doctype html>cached shell'}});
 const request=new Request(ORIGIN+'/',{method:'GET'});
 Object.defineProperty(request,'mode',{value:'navigate'});
 const response=await handle(listeners,request);
 assert.match(await response.text(),/cached shell/);
});

test('the worker never touches other origins or non-GET requests',async()=>{
 const {listeners}=load();
 assert.equal(await handle(listeners,new Request('https://elsewhere.test/data/live.json')),undefined);
 assert.equal(await handle(listeners,new Request(ORIGIN+'/data/live.json',{method:'POST'})),undefined);
});
