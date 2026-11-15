import { BrowserTenantClient } from '/src/client.mjs';

const report={status:'running',steps:[],events:[]};
window.__tenantReport=report;
const check=(value,label)=>{if(!value)throw new Error('E_ASSERT: '+label);report.steps.push(label);};
const wait_for=async(predicate,label)=>{
  const deadline=performance.now()+15000;
  while(performance.now()<deadline) {
    const match=predicate();
    if(match)return match;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('E_TIMEOUT: '+label);
};
const rejects=async(promise,expected)=>{
  try {await promise}
  catch(error) {check(error?.message===expected,'rejected: '+expected);return;}
  throw new Error('E_EXPECTED_REJECTION: '+expected);
};
const client=new BrowserTenantClient();
const off=client.on_event(event=>{report.events.push(event)});
(async()=>{
  try{
    const [alpha,beta]=await Promise.all([
      client.spawn('tenant_a',{backend:'wasm',entry:'/fixtures/two-actors.wasm'}),
      client.spawn('tenant_b',{backend:'wasm',entry:'/fixtures/actor-state.wasm'}),
    ]);
    check(alpha.tenant==='tenant_a' && beta.tenant==='tenant_b','two browser tenants spawned');
    check(alpha.generation!==beta.generation,'distinct tenant generations');
    check(typeof alpha.worker_instance==='string' && typeof beta.worker_instance==='string' &&
      alpha.worker_instance!==beta.worker_instance,'distinct dedicated Web Worker identities');
    check((await client.list()).filter(x=>x.ready).length===2,'supervisor tracks two independent live tenants');

    const [result_a,result_b]=await Promise.all([client.call(alpha),client.call(beta)]);
    check(result_a.value==='0' && result_a.actors===2,'Rust-compiled two-actor guest executed');
    check(JSON.stringify(result_a.stdout.trim().split('\n').sort())===JSON.stringify(['1','2']),
      'two actor instances retain independent state');
    check(result_b.value==='0' && result_b.actors===1,'separate Rust-compiled tenant guest executed');
    check(result_b.stdout.trim()==='main done\n40\n42','actor mailbox FIFO and main-to-actor ordering');

    const failed=await client.spawn('tenant_fault',{backend:'wasm',entry:'/fixtures/actor-overflow.wasm'});
    await rejects(client.call(failed),'E_GUEST_PANIC_1');
    const notice=await wait_for(()=>report.events.find(x=>x.event==='actor_panic' &&
      x.tenant==='tenant_fault' && x.generation===failed.generation),'actor CONTROL panic');
    check(notice.priority==='CONTROL' && notice.actor_id===1 && notice.parent_id===0 &&
      notice.actor_type==='W' && notice.reason==='E_GUEST_PANIC_1',
      'supervisor receives typed actor panic metadata on CONTROL lane');
    const panic_index=report.events.indexOf(notice);
    const down_index=report.events.findIndex(x=>x.event==='tenant_down' &&
      x.tenant==='tenant_fault' && x.generation===failed.generation);
    check(down_index>panic_index,'actor CONTROL notice precedes tenant_down');

    const ready=await wait_for(()=>report.events.find(x=>x.event==='tenant_ready' &&
      x.tenant==='tenant_fault' && x.generation>failed.generation),'tenant restart');
    const next={tenant:ready.tenant,generation:ready.generation,capability:ready.capability};
    check(next.capability!==failed.capability,'restart rotates tenant authority');
    await rejects(client.call(failed),'E_STALE_TENANT_HANDLE');
    await rejects(client.stop(failed),'E_STALE_TENANT_HANDLE');
    check((await client.list()).filter(x=>x.ready).length===3,
      'actor crash does not terminate neighboring tenants');

    await client.stop(next);
    await client.stop(alpha);
    await client.stop(beta);
    check((await client.list()).length===0,'all tenant workers terminated and removed');
    await rejects(client.call(alpha),'E_NO_TENANT');
    check(report.events.filter(x=>x.event==='tenant_stopped').length===3,
      'supervisor confirms each tenant shutdown');
    report.status='ok';
  }catch(error){
    report.status='error';
    report.error=String(error?.stack||error);
  }finally{
    off();
    client.close();
  }
})();
