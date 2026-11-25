// Node 22+ driver for *real* Chromium, module workers, compiled guest Wasm.
// Rust compiler fixture path is passed by the exact-tree alternate CI harness.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root=new URL('../',import.meta.url);
// Valid 42-byte Wasm module whose main() loops forever; validates the
// worker watchdog without relying on a JS busy-loop or mock worker.
const hung_guest=Buffer.from('0061736d010000000105016000017e03020100070801046d61696e00000a0b01090003400c000b42000b','hex');
assert.equal(WebAssembly.validate(hung_guest),true);
const files=new Map([
  ['/index.html',[new URL('./browser-tenants/js-only.html',import.meta.url),'text/html; charset=utf-8']],
  ['/tests/browser-tenants/js-only-e2e.mjs',[new URL('./browser-tenants/js-only-e2e.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ['/tests/browser-tenants/byte-receiver.mjs',
    [new URL('./browser-tenants/byte-receiver.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ['/tests/browser-tenants/js-counter.mjs',
    [new URL('./browser-tenants/js-counter.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ['/tests/browser-tenants/js-counter.mjs',
    [new URL('./browser-tenants/js-counter.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ...['client','protocol','supervisor-core','supervisor.worker','tenant.worker',
      'wasm-profile','wasm-tenant','receiver-tenant','route-protocol','send-receipt'].map(name=>
    ['/src/'+name+'.mjs',[new URL('../src/'+name+'.mjs',import.meta.url),'text/javascript; charset=utf-8']]),
  ['/fixtures/hung.wasm',[hung_guest,'application/wasm']],
]);
const requests=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  requests.push({method:req.method,path:url.pathname});
  const item=files.get(url.pathname);
  if(req.method!=='GET' || !item) {res.writeHead(404);res.end('Not found');return}
  try {
    const bytes=Buffer.isBuffer(item[0]) ? item[0] : await readFile(item[0]);
    res.writeHead(200,{'content-type':item[1],'x-content-type-options':'nosniff','cache-control':'no-store'});
    res.end(bytes);
  } catch {res.writeHead(404);res.end('Missing fixture or module')}
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label,limit=45000)=>{
  const deadline=Date.now()+limit;
  let last;
  while(Date.now()<deadline) {
    try {const x=await fn();if(x)return x;last=x}
    catch(error){last=error.message}
    await sleep(50);
  }
  throw new Error('E_BROWSER_TIMEOUT: '+label+' '+String(last));
};
const userdir=await mkdtemp(join(tmpdir(),'atto-browser-tenants-'));
let chrome,ws;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=process.env.CHROME_BIN||'/usr/bin/google-chrome';
  chrome=spawn(browser,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--no-first-run','--no-proxy-server','--disable-background-networking',
    '--remote-debugging-port=0','--user-data-dir='+userdir,'about:blank'],
    {stdio:['ignore','ignore','pipe']});
  let stderr='';
  chrome.stderr.on('data',x=>stderr=(stderr+x.toString()).slice(-4000));
  const port=await until(async()=>{
    if(chrome.exitCode!==null)throw new Error('Chrome exited: '+stderr);
    try {const n=Number((await readFile(join(userdir,'DevToolsActivePort'),'utf8')).split('\n')[0]);return n>0?n:null}
    catch{return null}
  },'DevTools port');
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const page=targets.find(t=>t.type==='page' && t.webSocketDebuggerUrl);
  assert.ok(page,'Chrome page target required');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
  });
  const pending=new Map();let next=0;
  ws.addEventListener('message',e=>{
    const msg=JSON.parse(e.data);
    const entry=pending.get(msg.id);if(!entry)return;
    pending.delete(msg.id);
    if(msg.error)entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result);
  });
  const command=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next;pending.set(id,{resolve,reject});
    ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const answer=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(answer.exceptionDetails)throw new Error(answer.exceptionDetails.text);
    return answer.result?.value;
  };
  await command('Page.enable');await command('Runtime.enable');
  const nav=await command('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/index.html'});
  assert.ok(!nav.errorText,nav.errorText||'navigation completed');
  const result=await until(async()=>{
    const value=await evaluate('window.__jsWorkerReport || null');
    return value?.status==='ok'||value?.status==='error'?value:null;
  },'Atto JS actor Web Worker E2E');
  if(result.status!=='ok')throw new Error('Browser tenant E2E failed: '+result.error+
    '\ncompleted: '+JSON.stringify(result.steps)+'\nevents: '+JSON.stringify(result.events));
  assert.ok(result.steps.length>=15,'all Chromium JS actor milestones must execute');
  assert.ok(requests.some(x=>x.path==='/tests/browser-tenants/js-counter.mjs'),'trusted JS actor module loaded');
  assert.ok(requests.every(x=>x.method==='GET'),'no source upload or server compilation');
  console.log('PASS real Chromium dedicated JS actor Workers: '+result.steps.length+' integration assertions');
  for(const step of result.steps)console.log('PASS browser tenant: '+step);
}finally{
  try{ws?.close()}catch{}
  if(chrome?.exitCode===null){chrome.kill('SIGKILL');await sleep(200)}
  await new Promise(resolve=>server.close(resolve));
  await rm(userdir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}
