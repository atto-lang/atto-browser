import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantSupervisor } from '../src/supervisor-core.mjs';
import { PROTOCOL, assert_entry_url } from '../src/protocol.mjs';
const mk = () => {
  const workers=[],replies=[],events=[];
  const supervisor=new TenantSupervisor({origin:'https://app.example',restart_limit:1,
    boot_timeout_ms:80,call_timeout_ms:50,create_worker:()=>{
      const w={terminated:false,messages:[],postMessage(x){this.messages.push(x)},terminate(){this.terminated=true},
        respond(x){this.onmessage({data:{protocol:PROTOCOL,...x}})}};
      workers.push(w);return w;
    },reply:x=>replies.push(x),event:x=>events.push(x)});
  let id=0;
  const send=(op,data={})=>{
    if ((op==='call'||op==='stop') && typeof data.tenant==='string' && data.capability===undefined) {
      const last=events.filter(x=>x.event==='tenant_ready' && x.tenant===data.tenant).at(-1);
      if(last) data={...data,generation:last.generation,capability:last.capability};
    }
    supervisor.handle({protocol:PROTOCOL,id:++id,op,...data});return id;
  };
  return {workers,replies,events,send,supervisor};
};
const spawn=(h,tenant='t1',backend='wasm',trusted=false)=>h.send('spawn',{tenant,entry:'/guest.wasm',backend,trusted});
const ready=w=>w.respond({op:'ready',tenant:w.messages[0].tenant,generation:w.messages[0].generation});
const err=(h,id)=>h.replies.find(x=>x.id===id)?.error;
test('one worker per tenant; old generations are fenced',()=>{
  const h=mk();const one=spawn(h);const two=spawn(h,'t2');
  assert.equal(h.workers.length,2);ready(h.workers[0]);ready(h.workers[1]);
  assert.equal(h.replies.find(x=>x.id===one).result.generation,1);
  assert.equal(h.replies.find(x=>x.id===two).result.generation,2);
  const call=h.send('call',{tenant:'t1'});
  h.workers[0].respond({op:'result',id:call,generation:1,ok:true,result:{value:'42'}});
  assert.equal(h.replies.find(x=>x.id===call).result.value,'42');
  h.send('stop',{tenant:'t1'});
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.workers[1].terminated,false);
  const again=spawn(h);ready(h.workers[2]);
  assert.equal(h.replies.find(x=>x.id===again).result.generation,3);
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
  assert.equal(err(h,before),'E_STALE_TENANT_HANDLE');
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
  h.workers[1].respond({op:'result',id:good,generation:2,ok:true,result:{value:'7'}});
  assert.equal(h.replies.find(x=>x.id===good).result.value,'7');
});
test('second crash retires tenant after restart budget',()=>{
  const h=mk();spawn(h);ready(h.workers[0]);h.workers[0].onerror();
  ready(h.workers[1]);h.workers[1].onerror();
  const id=h.send('call',{tenant:'t1'});
  assert.equal(err(h,id),'E_NO_TENANT');
  assert.equal(h.events.at(-1).event,'tenant_failed');
});

test('in-browser compiler blob URLs must carry the same origin',()=>{
  assert.equal(assert_entry_url('blob:https://app.example/fake-id','https://app.example'),'blob:https://app.example/fake-id');
  assert.throws(()=>assert_entry_url('blob:https://evil.example/id','https://app.example'),/E_ENTRY_ORIGIN/);
  assert.throws(()=>assert_entry_url('data:text/javascript,alert(1)','https://app.example'),/E_ENTRY_ORIGIN/);
});

test('old incarnation capability cannot call or stop replacement tenant',()=>{
  const h=mk();const id=spawn(h);ready(h.workers[0]);
  const old=h.replies.find(x=>x.id===id).result;
  h.send('stop',{tenant:old.tenant,generation:old.generation,capability:old.capability});
  const id2=spawn(h);ready(h.workers[1]);
  const current=h.replies.find(x=>x.id===id2).result;
  assert.notEqual(old.capability,current.capability);
  assert.notEqual(old.generation,current.generation);
  const replay=h.send('call',old);
  assert.equal(err(h,replay),'E_STALE_TENANT_HANDLE');
  const stop=h.send('stop',old);
  assert.equal(err(h,stop),'E_STALE_TENANT_HANDLE');
  const allowed=h.send('call',current);
  h.workers[1].respond({op:'result',id:allowed,generation:current.generation,ok:true,result:{value:'42'}});
  assert.equal(h.replies.find(x=>x.id===allowed).result.value,'42');
});
test('guest cannot spoof trusted tenant or generation fields',()=>{
  const h=mk();const id=spawn(h);ready(h.workers[0]);
  const handle=h.replies.find(x=>x.id===id).result;
  const call=h.send('call',handle);
  h.workers[0].respond({op:'result',id:call,generation:handle.generation,ok:true,
    result:{tenant:'t2',generation:999,capability:'injected',value:'42',stdout:'',actors:0}});
  const result=h.replies.find(x=>x.id===call).result;
  assert.equal(result.tenant,'t1');
  assert.equal(result.generation,handle.generation);
  assert.equal(result.capability,undefined);
  const bad=h.send('call',handle);
  h.workers[0].respond({op:'result',id:bad,generation:handle.generation,ok:true,
    result:{value:'42',stdout:'X'.repeat((1<<20)+1)}});
  assert.equal(err(h,bad),'E_GUEST_RESULT');
  assert.equal(h.workers[0].terminated,true);
});

test('Wasm actor CONTROL panic is surfaced before tenant_down, without exposing authority',()=>{
  const h=mk();const spawned=spawn(h);ready(h.workers[0]);
  const handle=h.replies.find(x=>x.id===spawned).result;
  const id=h.send('call',handle);
  const control={kind:'panic',actor_id:1,parent_id:0,actor_type:'W',reason:'E_GUEST_PANIC_1'};
  h.workers[0].respond({op:'control',id,tenant:'t1',generation:handle.generation,control});
  h.workers[0].respond({op:'control',id,tenant:'t1',generation:handle.generation,control});
  assert.equal(h.events.filter(e=>e.event==='actor_panic').length,1,'duplicate CONTROL notice must be fenced');
  h.workers[0].respond({op:'result',id,generation:handle.generation,ok:false,error:'E_GUEST_PANIC_1'});
  assert.equal(err(h,id),'E_GUEST_PANIC_1');
  const panic_index=h.events.findIndex(e=>e.event==='actor_panic');
  const down_index=h.events.findIndex(e=>e.event==='tenant_down');
  assert.ok(panic_index>=0 && panic_index<down_index,'CONTROL must precede tenant failure');
  const evt=h.events[panic_index];
  assert.equal(evt.priority,'CONTROL');
  assert.equal(evt.actor_id,1);
  assert.equal(evt.parent_id,0);
  assert.equal(evt.actor_type,'W');
  assert.equal(evt.capability,undefined);
  assert.equal(h.workers[0].terminated,true);
});
test('malformed CONTROL notices fail closed and never become supervisor events',()=>{
  const h=mk();spawn(h);ready(h.workers[0]);
  const id=h.send('call',{tenant:'t1'});
  h.workers[0].respond({op:'control',id,tenant:'t1',generation:1,
    control:{kind:'panic',actor_id:999,parent_id:0,actor_type:'W',reason:'E_GUEST_PANIC_1'}});
  assert.equal(err(h,id),'E_CONTROL_PROTOCOL');
  assert.equal(h.events.some(e=>e.event==='actor_panic'),false);
  assert.equal(h.workers[0].terminated,true);
});

test('foreign tenant ready reply fails closed, never grants a capability',()=>{
  const h=mk();const requested=spawn(h);
  h.workers[0].respond({op:'ready',tenant:'tenant_b',generation:1});
  assert.equal(h.replies.find(x=>x.id===requested),undefined);
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.events.some(x=>x.event==='tenant_ready'),false);
  ready(h.workers[1]);
  assert.equal(h.replies.find(x=>x.id===requested).result.tenant,'t1');
});
test('boot failure reason is bounded and rejected worker is terminated',()=>{
  const h=mk();const requested=spawn(h);
  h.workers[0].respond({op:'boot_failed',tenant:'t1',generation:1,error:'E_BOOT_'+('x'.repeat(2000))});
  assert.equal(h.workers[0].terminated,true);
  const down=h.events.find(x=>x.event==='tenant_down');
  assert.equal(down.reason.length,512);
  ready(h.workers[1]);
  assert.ok(h.replies.find(x=>x.id===requested)?.ok);
});
