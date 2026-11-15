import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantSupervisor } from '../src/supervisor-core.mjs';
import { PROTOCOL } from '../src/protocol.mjs';
const mk = () => {
  const workers=[],replies=[],events=[];
  const supervisor=new TenantSupervisor({origin:'https://app.example',restart_limit:1,
    boot_timeout_ms:80,call_timeout_ms:50,create_worker:()=>{
      const w={terminated:false,messages:[],postMessage(x){this.messages.push(x)},terminate(){this.terminated=true},
        respond(x){this.onmessage({data:{protocol:PROTOCOL,...x}})}};
      workers.push(w);return w;
    },reply:x=>replies.push(x),event:x=>events.push(x)});
  let id=0;
  const send=(op,data={})=>{supervisor.handle({protocol:PROTOCOL,id:++id,op,...data});return id};
  return {workers,replies,events,send,supervisor};
};
const spawn=(h,tenant='t1',backend='wasm',trusted=false)=>h.send('spawn',{tenant,entry:'/guest.wasm',backend,trusted});
const ready=w=>w.respond({op:'ready',tenant:w.messages[0].tenant,generation:w.messages[0].generation});
const err=(h,id)=>h.replies.find(x=>x.id===id)?.error;
test('one worker per tenant; old generations are fenced',()=>{
  const h=mk();const one=spawn(h);const two=spawn(h,'t2');
  assert.equal(h.workers.length,2);ready(h.workers[0]);ready(h.workers[1]);
  assert.equal(h.replies.find(x=>x.id===one).result.generation,1);
  assert.equal(h.replies.find(x=>x.id===two).result.generation,1);
  const call=h.send('call',{tenant:'t1'});
  h.workers[0].respond({op:'result',id:call,generation:1,ok:true,result:{value:'42'}});
  assert.equal(h.replies.find(x=>x.id===call).result.value,'42');
  h.send('stop',{tenant:'t1'});
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.workers[1].terminated,false);
  const again=spawn(h);ready(h.workers[2]);
  assert.equal(h.replies.find(x=>x.id===again).result.generation,2);
  h.workers[0].respond({op:'result',id:999,generation:1,ok:true,result:{value:'bad'}});
  assert.equal(h.replies.some(x=>x.id===999),false);
});
test('deny foreign origins, JS without trust, and duplicate tenant',()=>{
  const h=mk();
  const a=h.send('spawn',{tenant:'t1',backend:'wasm',entry:'https://evil.example/x.wasm'});
  assert.equal(err(h,a),'E_ENTRY_ORIGIN');
  const b=spawn(h,'t1','js',false);assert.equal(err(h,b),'E_JS_REQUIRES_TRUST');
  spawn(h);ready(h.workers[0]);const d=spawn(h);
  assert.equal(err(h,d),'E_TENANT_EXISTS');
});
test('panic terminates worker and restarts generation',()=>{
  const h=mk();spawn(h);ready(h.workers[0]);
  const call=h.send('call',{tenant:'t1'});
  h.workers[0].respond({op:'result',id:call,generation:1,ok:false,error:'E_GUEST_PANIC_1'});
  assert.equal(err(h,call),'E_GUEST_PANIC_1');
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.workers.length,2);
  const before=h.send('call',{tenant:'t1'});
  assert.equal(err(h,before),'E_TENANT_NOT_READY');
  ready(h.workers[1]);
  assert.equal(h.events.filter(x=>x.event==='tenant_ready').length,2);
});
test('timeout kills hung tenant but not neighbor',async()=>{
  const h=mk();spawn(h);spawn(h,'t2');ready(h.workers[0]);ready(h.workers[1]);
  const hung=h.send('call',{tenant:'t1'});
  await new Promise(r=>setTimeout(r,70));
  assert.equal(err(h,hung),'E_CALL_TIMEOUT');
  assert.equal(h.workers[0].terminated,true);
  const good=h.send('call',{tenant:'t2'});
  h.workers[1].respond({op:'result',id:good,generation:1,ok:true,result:{value:'7'}});
  assert.equal(h.replies.find(x=>x.id===good).result.value,'7');
});
test('second crash retires tenant after restart budget',()=>{
  const h=mk();spawn(h);ready(h.workers[0]);h.workers[0].onerror();
  ready(h.workers[1]);h.workers[1].onerror();
  const id=h.send('call',{tenant:'t1'});
  assert.equal(err(h,id),'E_NO_TENANT');
  assert.equal(h.events.at(-1).event,'tenant_failed');
});
