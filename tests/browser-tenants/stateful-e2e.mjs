import {BrowserTenantClient} from '/src/client.mjs';
const {sha256}=await import('/fixtures/stateful-pin.mjs');
const client=new BrowserTenantClient();
const report={status:'running',steps:[],events:[]};
window.__statefulReport=report;
const check=(condition,message)=>{
  if(!condition)throw new Error(message);
  report.steps.push(message);
};
client.on_event(e=>report.events.push(e));
const rejects=async(p,error)=>{
  let caught;try{await p}catch(e){caught=e}
  check(caught?.message===error,'reject '+error);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,what){
  for(let i=0;i<200;i++){
    const match=fn();if(match)return match;
    await sleep(25);
  }
  throw new Error('timeout '+what);
}
(async()=>{
try{
  const entry='/fixtures/stateful-counter.wasm';
  const opts={backend:'stateful-preview',entry,owner:'Counter',sha256};
  await rejects(client.spawn('bad_pin',{...opts,sha256:'0'.repeat(64)}),
    'E_STATE_DIGEST_MISMATCH');
  await rejects(client.spawn('wrong_owner',{...opts,owner:'Other'}),'E_STATE_ABI');
  await rejects(client.spawn('overlong_owner',{...opts,owner:'X'.repeat(257)}),
    'E_RECEIVER_ADMISSION');
  const alpha=await client.spawn('counter_alpha',opts);
  const sibling=await client.spawn('counter_beta',opts);
  check(alpha.generation!==sibling.generation,'independent generations');
  check((await client.call_receiver(alpha,'increment',25n)).value==='42',
    'Rust-compiled actual count=17 + 25 executes inside Chromium Worker');
  check((await client.call_receiver(alpha,'increment',1n)).value==='43',
    'persistent actor state is 43 on second call');
  check((await client.call_receiver(sibling,'increment',1n)).value==='18',
    'other actor instance has independent initial state 17');
  await rejects(client.call(alpha),'E_RECEIVER_OP');
  await rejects(client.call_receiver(alpha,'missing',1n),'E_RECEIVER_METHOD');
  await rejects(client.call_receiver(alpha,'increment',1n,2n),'E_RECEIVER_ARGS');
  await rejects(client.call_receiver(alpha,'increment',1),'E_RECEIVER_ARGS');
  const invalid={...alpha,capability:'00000000-0000-4000-8000-000000000000'};
  await rejects(client.call_receiver(invalid,'increment',1n),'E_STALE_TENANT_HANDLE');
  check((await client.call_receiver(alpha,'increment',-1n)).value==='42',
    'invalid commands do not mutate guest state');
  await rejects(client.call_receiver(alpha,'increment',9223372036854775807n),
    'E_GUEST_PANIC_1');
  const notice=await until(()=>report.events.find(e=>e.event==='actor_panic' &&
    e.tenant==='counter_alpha' && e.generation===alpha.generation),'stateful CONTROL');
  check(notice.actor_id===1 && notice.parent_id===0 &&
    notice.actor_type==='Counter' && notice.reason==='E_GUEST_PANIC_1' &&
    notice.priority==='CONTROL','authentic checked-state overflow CONTROL');
  const down=await until(()=>report.events.find(e=>e.event==='tenant_down' &&
    e.tenant==='counter_alpha' && e.generation===alpha.generation),'stateful down');
  check(report.events.indexOf(notice)<report.events.indexOf(down),
    'CONTROL precedes hard actor retirement');
  check((await client.call_receiver(sibling,'increment',1n)).value==='19',
    'sibling remains healthy after actor overflow');
  const ready=await until(()=>report.events.find(e=>e.event==='tenant_ready' &&
    e.tenant==='counter_alpha' && e.generation>alpha.generation),'restart');
  const replacement={tenant:ready.tenant,generation:ready.generation,
    capability:ready.capability};
  check(replacement.capability!==alpha.capability,'restart rotates authority');
  await rejects(client.call_receiver(alpha,'increment',1n),'E_STALE_TENANT_HANDLE');
  check((await client.call_receiver(replacement,'increment',1n)).value==='18',
    'fresh generation starts at declared state initializer 17');
  await client.stop(replacement);await client.stop(sibling);
  check((await client.list()).length===0,'no worker generations leaked after stop');
  report.status='ok';
}catch(error){report.status='error';report.error=String(error?.stack||error)}
finally{client.close()}
})();
