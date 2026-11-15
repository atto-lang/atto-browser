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

    // An authenticated application-level route from Tenant A to the live
    // Rust-compiled Counter actor in Tenant B. The actor state persists.
    const route=await client.grant_route(alpha,beta,{actor_id:1,wire_type:'i64'});
    const take_buffer=new ArrayBuffer(8);
    new DataView(take_buffer).setBigInt64(0,3n,true);
    const moved=await client.send_route(alpha,route,take_buffer,{mode:'take'});
    check(take_buffer.byteLength===0,'rt take detaches sender ArrayBuffer');
    check(moved.value==='delivered' && moved.stdout==='45\n',
      'cross-worker typed i64 message reaches Rust-compiled actor state');
    const copy_buffer=new ArrayBuffer(8);
    new DataView(copy_buffer).setBigInt64(0,2n,true);
    const copied=await client.send_route(alpha,route,copy_buffer,{mode:'copy'});
    check(copied.receipt?.protocol==='atto.browser.send-receipt.v1' &&
      copied.receipt.outcome==='processed' && copied.receipt.code==='OK',
      'direct transferred message returns validated processed receipt');
    check(copy_buffer.byteLength===8 && copied.stdout==='47\n',
      'rt copy retains sender bytes and preserves FIFO actor state');
    const fake_route={...route,route_capability:'00000000-0000-4000-8000-000000000000'};
    await rejects(client.send_route(alpha,fake_route,new ArrayBuffer(8),{mode:'copy'}),'E_ROUTE_INVALID');
    const revoked=await client.revoke_route(alpha,route);
    check(revoked.revoked===true,'application explicitly revokes route capability');
    await rejects(client.send_route(alpha,route,new ArrayBuffer(8),{mode:'copy'}),'E_ROUTE_INVALID');

    // A different trusted tenant receives a full 64 KiB transferred buffer.
    const bytes_tenant=await client.spawn('tenant_bytes',{backend:'js',
      entry:'/tests/browser-tenants/byte-receiver.mjs',trusted:true});
    const bytes_route=await client.grant_route(alpha,bytes_tenant,{actor_id:0,wire_type:'bytes'});
    const large=new ArrayBuffer(65536);new Uint8Array(large).fill(1);
    const bytes_ack=await client.send_route(alpha,bytes_route,large,{mode:'take'});
    check(bytes_ack.receipt?.outcome==='processed' &&
      bytes_ack.receipt.actor_id===0 && bytes_ack.receipt.route_id===bytes_route.route_id,
      'trusted transferable receiver acknowledges on versioned receipt');
    check(large.byteLength===0 && bytes_ack.value==='bytes:65536' &&
      bytes_ack.stdout==='checksum=65536\n',
      '64KiB zero-copy transfer delivered to a separate trusted worker');
    await rejects(client.send_route(alpha,bytes_route,new ArrayBuffer(65537),{mode:'take'}),
      'E_ROUTE_SIZE');
    await client.stop(bytes_tenant);
    await rejects(client.send_route(alpha,bytes_route,new ArrayBuffer(8),{mode:'copy'}),
      'E_ROUTE_INVALID');


    // Source-level AttoLang remote_actor(Counter,1).send(...) is compiled
    // into Wasm; neither message is initiated by JavaScript send_route().
    const compiledReceiver=await client.spawn('compiled_receiver',{backend:'wasm',
      entry:'/fixtures/remote-receiver.wasm'});
    const receiverReady=await client.call(compiledReceiver);
    check(receiverReady.actors===1 && receiverReady.value==='0',
      'compiled receiver actor is ready in an isolated tenant');
    const compiledSender=await client.spawn('compiled_sender',{backend:'wasm',
      entry:'/fixtures/remote-sender.wasm'});
    const compiledRoute=await client.grant_route(compiledSender,compiledReceiver,
      {actor_id:1,wire_type:'i64'});
    const binding=await client.bind_route(compiledSender,compiledRoute,1);
    check(binding.bound===true && binding.slot===1,
      'supervisor authorizes typed source-level route slot without exposing capability to Wasm');
    const compiledResult=await client.call(compiledSender);
    check(compiledResult.value==='0' && compiledResult.actors===1,
      'compiled Sender actor executed remote ActorRef.send twice');
    check(compiledResult.remote_receipts?.length===2 &&
      compiledResult.remote_receipts.every(r=>r.outcome==='processed' &&
        r.code==='OK' && r.protocol==='atto.browser.send-receipt.v1') &&
      compiledResult.remote_receipts[0].receipt_id <
        compiledResult.remote_receipts[1].receipt_id,
      'compiled sender returns separate ordered typed processed receipts');
    check(compiledResult.remote_acks?.length===2 &&
      JSON.stringify(compiledResult.remote_acks.map(x=>x.stdout))===
        JSON.stringify(['40\n','42\n']),
      'compiled remote sends deliver 40 then 2 and wait for ordered receiver acknowledgments');

    // A revoked slot cannot dispatch compiler-originated mail even when the
    // guest still holds its opaque (negative) actor reference.
    const revokedSender=await client.spawn('compiled_revoked',{backend:'wasm',
      entry:'/fixtures/remote-sender.wasm'});
    const revokedRoute=await client.grant_route(revokedSender,compiledReceiver,
      {actor_id:1,wire_type:'i64'});
    await client.bind_route(revokedSender,revokedRoute,1);
    await client.revoke_route(revokedSender,revokedRoute);
    let revokedError;
    try {await client.call(revokedSender)}
    catch(e){revokedError=e}
    check(revokedError?.message==='E_REMOTE_ROUTE_STALE' &&
      revokedError.failure?.outcome==='rejected' &&
      revokedError.failure?.code==='E_ROUTE_STALE' &&
      revokedError.failure?.receipt===null,
      'revoked pre-dispatch send reports typed rejected outcome, never processed');
    const replacementRevoked=await wait_for(()=>report.events.find(e=>
      e.event==='tenant_ready' && e.tenant==='compiled_revoked' &&
      e.generation>revokedSender.generation),'revoked compiled sender restart');
    await client.stop({tenant:replacementRevoked.tenant,generation:replacementRevoked.generation,
      capability:replacementRevoked.capability});
    await client.stop(compiledSender);
    await client.stop(compiledReceiver);
    check((await client.list()).filter(x=>x.ready).length===2,
      'compiled cross-tenant sender and receiver shut down without leaked workers');

    const hung=await client.spawn('tenant_hung',{backend:'wasm',entry:'/fixtures/hung.wasm'});
    const hung_call=client.call(hung);
    // Exercise a healthy tenant while an unrelated guest blocks its worker.
    const healthy=await client.spawn('tenant_healthy',{backend:'wasm',entry:'/fixtures/two-actors.wasm'});
    const healthy_result=await client.call(healthy);
    check(healthy_result.actors===2 && healthy_result.value==='0',
      'uncooperative Wasm tenant cannot block neighboring worker');
    await rejects(hung_call,'E_CALL_TIMEOUT');
    const hung_down=await wait_for(()=>report.events.find(x=>x.tenant==='tenant_hung' &&
      x.event==='tenant_down' && x.generation===hung.generation),'watchdog tenant_down');
    check(hung_down.reason==='E_CALL_TIMEOUT','watchdog terminates infinite-loop Wasm');
    const hung_ready=await wait_for(()=>report.events.find(x=>x.tenant==='tenant_hung' &&
      x.event==='tenant_ready' && x.generation>hung.generation),'watchdog restart');
    const replacement={tenant:hung_ready.tenant,generation:hung_ready.generation,
      capability:hung_ready.capability};
    check(replacement.capability!==hung.capability,'watchdog restart rotates capability');
    await rejects(client.stop(hung),'E_STALE_TENANT_HANDLE');
    await client.stop(replacement);
    await client.stop(healthy);
    check((await client.list()).filter(x=>x.ready).length===2,
      'watchdog and cleanup leave original tenants healthy');

    const failed=await client.spawn('tenant_fault',{backend:'wasm',entry:'/fixtures/actor-overflow.wasm'});
    await rejects(client.call(failed),'E_GUEST_PANIC_1');
    const notice=await wait_for(()=>report.events.find(x=>x.event==='actor_panic' &&
      x.tenant==='tenant_fault' && x.generation===failed.generation),'actor CONTROL panic');
    check(notice.priority==='CONTROL' && notice.actor_id===1 && notice.parent_id===0 &&
      notice.actor_type==='W' && notice.reason==='E_GUEST_PANIC_1',
      'supervisor receives typed actor panic metadata on CONTROL lane');
    await wait_for(()=>report.events.find(x=>x.event==='tenant_down' &&
      x.tenant==='tenant_fault' && x.generation===failed.generation),'tenant_down after actor panic');
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
    check(report.events.filter(x=>x.event==='tenant_stopped').length===9,
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
