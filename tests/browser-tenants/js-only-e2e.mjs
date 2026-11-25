// Actual Chromium integration: three dedicated tenant workers under a Worker supervisor.
// The fixture is a snapshot of AttoLang's restricted JS actor compiler output.
import { BrowserTenantClient } from '/src/client.mjs';

const report={status:'running',steps:[],events:[]};
window.__jsWorkerReport=report;
const check=(ok,label)=>{
  if(!ok)throw new Error('E_ASSERT: '+label);
  report.steps.push(label);
};
const until=async(predicate,label)=>{
  const deadline=performance.now()+15000;
  while(performance.now()<deadline){
    const value=predicate();
    if(value)return value;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('E_TIMEOUT: '+label);
};
const client=new BrowserTenantClient();
const off=client.on_event(event=>report.events.push(event));
const wire=value=>{
  const buffer=new ArrayBuffer(8);
  new DataView(buffer).setBigInt64(0,value,true);
  return buffer;
};
const send=(source,route,value)=>client.send_route(source,route,wire(value),{mode:'take'});
(async()=>{
  try {
    const entry='/tests/browser-tenants/js-counter.mjs';
    const [sender,receiver,neighbor]=await Promise.all([
      client.spawn('js_sender',{backend:'js',entry,trusted:true}),
      client.spawn('js_receiver',{backend:'js',entry,trusted:true}),
      client.spawn('js_neighbor',{backend:'js',entry,trusted:true})
    ]);
    check(new Set([sender.worker_instance,receiver.worker_instance,neighbor.worker_instance]).size===3,
      'three distinct dedicated browser Web Workers created');
    check(new Set([sender.generation,receiver.generation,neighbor.generation]).size===3,
      'three independent tenant generations');
    const [sender_start,receiver_start,neighbor_start]=await Promise.all([
      client.call(sender),client.call(receiver),client.call(neighbor)
    ]);
    check([sender_start,receiver_start,neighbor_start].every(x=>x.value==='0' && x.actors===1),
      'each tenant independently boots its compiled JS actor');
    const to_receiver=await client.grant_route(sender,receiver,{actor_id:1,wire_type:'i64'});
    const to_neighbor=await client.grant_route(sender,neighbor,{actor_id:1,wire_type:'i64'});
    const first=await send(sender,to_receiver,40n);
    const second=await send(sender,to_receiver,2n);
    check(first.stdout==='40\n' && second.stdout==='42\n',
      'ordered typed i64 messages update state in the recipient worker');
    check(first.receipt?.outcome==='processed' && second.receipt?.outcome==='processed',
      'supervisor sends processed receipts only after actor completion');
    const independent=await send(sender,to_neighbor,7n);
    check(independent.stdout==='7\n','neighboring actor state is independent');
    const maximum=await send(sender,to_receiver,9223372036854775765n);
    check(maximum.stdout==='9223372036854775807\n','checked i64 reaches signed maximum exactly');
    let failure;
    try {await send(sender,to_receiver,1n)}catch(error){failure=error}
    check(failure?.message==='E_GUEST_PANIC_1' && failure.failure?.outcome==='unknown',
      'actor overflow is a failed uncertain delivery, never a processed ack');
    const panic=await until(()=>report.events.find(x=>x.event==='actor_panic' &&
      x.tenant==='js_receiver' && x.generation===receiver.generation),'actor CONTROL');
    check(panic.priority==='CONTROL' && panic.actor_id===1 && panic.parent_id===0 &&
      panic.actor_type==='Counter' && panic.reason==='E_GUEST_PANIC_1',
      'trusted compiler actor panic reaches dedicated supervisor CONTROL lane');
    const down=await until(()=>report.events.find(x=>x.event==='tenant_down' &&
      x.tenant==='js_receiver' && x.generation===receiver.generation),'tenant down');
    check(report.events.indexOf(panic)<report.events.indexOf(down),
      'CONTROL panic notice delivered before tenant-down event');
    const ready=await until(()=>report.events.find(x=>x.event==='tenant_ready' &&
      x.tenant==='js_receiver' && x.generation>receiver.generation),'receiver restart');
    check(ready.capability!==receiver.capability && ready.generation>receiver.generation,
      'restarted worker has fresh generation and authority');
    let stale;
    try {await client.call(receiver)}catch(error){stale=error}
    check(stale?.message==='E_STALE_TENANT_HANDLE','replay of old tenant capability is rejected');
    const alive=await send(sender,to_neighbor,2n);
    check(alive.stdout==='9\n','neighbor survives crash with unchanged actor state');
    check((await client.list()).filter(x=>x.ready).length===3,
      'supervisor preserves the surviving tenants after restart');
    await client.stop(sender);
    await client.stop(neighbor);
    await client.stop({tenant:ready.tenant,generation:ready.generation,capability:ready.capability});
    check((await client.list()).length===0,'all three tenant workers shut down');
    report.status='ok';
  }catch(error){report.status='error';report.error=String(error?.stack||error)}
  finally{off();client.close()}
})();
