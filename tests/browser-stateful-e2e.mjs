// Node 22+ driver for *real* Chromium, module workers, compiled guest Wasm.
// Rust compiler fixture path is passed by the exact-tree alternate CI harness.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const fixtures=process.env.ATTO_BROWSER_FIXTURE_DIR;
if(!fixtures)throw new Error('E_FIXTURES_REQUIRED: compile actual AttoLang guests first');
const root=new URL('../',import.meta.url);
const sha256=createHash('sha256').update(
  await readFile(join(fixtures,'stateful-counter.wasm'))).digest('hex');
const statefulBytes=await readFile(join(fixtures,'stateful-counter.wasm'));
const hungBody=Uint8Array.from([0,0x03,0x40,0x0c,0,0x0b,0x00,0x0b]);
function encode_uleb(n){
  const bytes=[];do{let c=n&127;n=Math.floor(n/128);
    if(n)c|=128;bytes.push(c)}while(n);return Uint8Array.from(bytes);
}
function read_uleb(bytes,offset){
  let value=0,shift=0;for(let i=0;i<5;i++){
    const v=bytes[offset++];if(v===undefined)throw new Error('E_WASM_TEST_LEB');
    value+=(v&127)*2**shift;
    if(!(v&128))return{value,offset};
    shift+=7;
  }
  throw new Error('E_WASM_TEST_LEB');
}
function join_bytes(...blocks){return Buffer.concat(blocks.map(x=>Buffer.from(x)))}
function make_noncooperating_state_guest(bytes) {
  let offset=8;
  while(offset<bytes.length) {
    const begin=offset,id=bytes[offset++];
    const len=read_uleb(bytes,offset);offset=len.offset;
    const end=offset+len.value;
    if(id===10) {
      const count=read_uleb(bytes,offset);
      assert.equal(count.value,6,'exact compiler emitted six bounded guest functions');
      const original=read_uleb(bytes,count.offset);
      const restStart=original.offset+original.value;
      assert.ok(restStart<end);
      const section=join_bytes(encode_uleb(count.value),
        encode_uleb(hungBody.length),hungBody,bytes.subarray(restStart,end));
      const mutant=join_bytes(bytes.subarray(0,begin),Uint8Array.of(10),
        encode_uleb(section.length),section,bytes.subarray(end));
      assert.equal(WebAssembly.validate(mutant),true,
        'malicious guest keeps valid Wasm ABI yet cannot cooperate');
      return mutant;
    }
    offset=end;
  }
  throw new Error('E_WASM_TEST_NO_CODE');
}
const noncooperating=make_noncooperating_state_guest(statefulBytes);
const hungSha=createHash('sha256').update(noncooperating).digest('hex');
// Valid 42-byte Wasm module whose main() loops forever; validates the
// worker watchdog without relying on a JS busy-loop or mock worker.
const hung_guest=Buffer.from('0061736d010000000105016000017e03020100070801046d61696e00000a0b01090003400c000b42000b','hex');
assert.equal(WebAssembly.validate(hung_guest),true);
const files=new Map([
  ['/index.html',[new URL('./browser-tenants/stateful.html',import.meta.url),'text/html; charset=utf-8']],
  ['/tests/browser-tenants/stateful-e2e.mjs',[new URL('./browser-tenants/stateful-e2e.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ['/tests/browser-tenants/byte-receiver.mjs',
    [new URL('./browser-tenants/byte-receiver.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ['/tests/browser-tenants/js-counter.mjs',
    [new URL('./browser-tenants/js-counter.mjs',import.meta.url),'text/javascript; charset=utf-8']],
  ...['client','protocol','supervisor-core','supervisor.worker','tenant.worker',
      'wasm-profile','wasm-tenant','receiver-tenant','lease-registry','stateful-tenant','route-protocol','send-receipt'].map(name=>
    ['/src/'+name+'.mjs',[new URL('../src/'+name+'.mjs',import.meta.url),'text/javascript; charset=utf-8']]),
  ['/src/guest-import-abi.js',[new URL('../src/guest-import-abi.js',import.meta.url),'text/javascript; charset=utf-8']],
  ...['two-actors','actor-state','actor-overflow','remote-sender','remote-receiver'].map(name=>
    ['/fixtures/'+name+'.wasm',[new URL('file://'+join(fixtures,name+'.wasm')),'application/wasm']]),
  ['/fixtures/hung.wasm',[hung_guest,'application/wasm']],
  ['/fixtures/stateful-counter.wasm',[new URL('file://'+join(fixtures,'stateful-counter.wasm')),'application/wasm']],
  ['/fixtures/stateful-pin.mjs',[Buffer.from('export const sha256='+JSON.stringify(sha256)+';'),'text/javascript; charset=utf-8']],
  ['/fixtures/stateful-noncooperating.wasm',[noncooperating,'application/wasm']],
  ['/fixtures/stateful-noncooperating-pin.mjs',
    [Buffer.from('export const hungSha='+JSON.stringify(hungSha)+';'),'text/javascript; charset=utf-8']],
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
    const value=await evaluate('window.__statefulReport || null');
    return value?.status==='ok'||value?.status==='error'?value:null;
  },'compiled real stateful worker E2E');
  if(result.status!=='ok')throw new Error('Browser stateful E2E failed: '+result.error+
    '\ncompleted: '+JSON.stringify(result.steps)+'\nevents: '+JSON.stringify(result.events));
  assert.ok(result.steps.length>=18,'all browser milestones must execute');
  assert.ok(requests.some(x=>x.path==='/fixtures/stateful-counter.wasm'),'actual stateful source compiler guest downloaded');
  assert.ok(requests.every(x=>x.method==='GET'),'no source upload or server compilation');
  console.log('PASS real Chromium compiled stateful actor Web Workers: '+result.steps.length+' integration assertions');
  for(const step of result.steps)console.log('PASS stateful actor: '+step);
}finally{
  try{ws?.close()}catch{}
  if(chrome?.exitCode===null){chrome.kill('SIGKILL');await sleep(200)}
  await new Promise(resolve=>server.close(resolve));
  await rm(userdir,{recursive:true,force:true,maxRetries:5,retryDelay:50});
}
