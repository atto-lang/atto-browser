import {BrowserTenantClient} from '/src/client.mjs';

// Pin is supplied from the test harness build manifest, not calculated by the
// untrusted guest download. Real deployments must pin SHA at build/release.
const {sha256}=await import('/fixtures/receiver-pin.mjs');
const client=new BrowserTenantClient();
const report={status:'running',steps:[],events:[]};
window.__receiverReport=report;
const check=(ok,why)=>{if(!ok)throw new Error(why);report.steps.push(why)};
const rejects=async(p,msg)=>{let error;try{await p}catch(e){error=e}
  check(error?.message===msg,'reject '+msg);
};
client.on_event(e=>report.events.push(e));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait_for(fn,name) {
  for(let i=0;i<200;i++){let x=fn();if(x)return x;await sleep(25)}
  throw new Error('timeout '+name);
}
(async()=>{
  try{
    await rejects(client.spawn('bad_pin',{backend:'receiver',
      entry:'/fixtures/receiver-worker.wasm',owner:'Worker',sha256:'0'.repeat(64)}),
      'E_RECEIVER_DIGEST_MISMATCH');
    check(!(await client.list()).some(x=>x.tenant==='bad_pin'),
      'SHA mismatch cannot reach ready actor worker');
    const alpha=await client.spawn('rx_alpha',{backend:'receiver',
      entry:'/fixtures/receiver-worker.wasm',owner:'Worker',sha256});
    const sibling=await client.spawn('rx_sibling',{backend:'receiver',
      entry:'/fixtures/receiver-worker.wasm',owner:'Other',sha256});
    check(alpha.generation!==sibling.generation,'tenant generations are independent');
    check((await client.call_receiver(alpha,'double',21n)).value==='42',
      'compiled Worker.double executes in dedicated Chromium worker');
    check((await client.call_receiver(sibling,'triple',14n)).value==='42',
      'compiled Other.triple executes in independent Chromium worker');
    check((await client.call_receiver(alpha,'add',19n,23n)).value==='42',
      'compiled multiple-argument receiver dispatch runs');
    await rejects(client.call_receiver(alpha,'triple',21n),'E_RECEIVER_METHOD');
    await rejects(client.call_receiver(alpha,'double',21),'E_RECEIVER_ARGS');
    await rejects(client.call(alpha),'E_RECEIVER_OP');
    check((await client.call_receiver(alpha,'double',1n)).value==='2',
      'invalid method/call arguments are nonfatal pre-dispatch errors');
    const fake={...alpha,capability:'00000000-0000-4000-8000-000000000000'};
    await rejects(client.call_receiver(fake,'double',21n),'E_STALE_TENANT_HANDLE');
    await rejects(client.call_receiver(sibling,'double',21n),'E_RECEIVER_METHOD');
    check((await client.call_receiver(sibling,'triple',21n)).value==='63',
      'wrong nominal owner never crosses dispatch boundary');
    await rejects(client.call_receiver(alpha,'double',9223372036854775807n),
      'E_GUEST_PANIC_1');
    const notice=await wait_for(()=>report.events.find(e=>e.event==='actor_panic'
      && e.tenant==='rx_alpha' && e.generation===alpha.generation),
      'receiver panic CONTROL');
    check(notice.priority==='CONTROL' && notice.actor_id===1 &&
      notice.parent_id===0 && notice.actor_type==='Worker' &&
      notice.reason==='E_GUEST_PANIC_1',
      'supervisor receives authentic receiver panic on CONTROL lane');
    const down=await wait_for(()=>report.events.find(e=>e.event==='tenant_down'
      && e.tenant==='rx_alpha' && e.generation===alpha.generation),
      'receiver down');
    check(report.events.indexOf(notice)<report.events.indexOf(down),
      'CONTROL precedes tenant_down');
    check((await client.call_receiver(sibling,'triple',14n)).value==='42',
      'healthy sibling survives receiver panic');
    const ready=await wait_for(()=>report.events.find(e=>e.event==='tenant_ready'
      && e.tenant==='rx_alpha' && e.generation>alpha.generation),
      'receiver automatic restart');
    const replacement={tenant:ready.tenant,generation:ready.generation,
      capability:ready.capability};
    check(replacement.capability!==alpha.capability,'restart rotates capability');
    await rejects(client.call_receiver(alpha,'double',21n),'E_STALE_TENANT_HANDLE');
    check((await client.call_receiver(replacement,'double',21n)).value==='42',
      'new instance executes verified method after restart');
    await client.stop(replacement);
    await client.stop(sibling);
    check((await client.list()).length===0,'no tenant workers leaked on shutdown');
    report.status='ok';
  }catch(error){report.status='error';report.error=String(error?.stack||error)}
  finally{client.close()}
})();
