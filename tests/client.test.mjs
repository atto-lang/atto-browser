import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTenantClient } from '../src/client.mjs';
import { PROTOCOL } from '../src/protocol.mjs';

const workers=[];
class FakeWorker {
  constructor(){this.messages=[];this.terminated=false;workers.push(this)}
  postMessage(message){this.messages.push(message)}
  terminate(){this.terminated=true}
  emit(data){this.onmessage({data:{protocol:PROTOCOL,...data}})}
}
test('client bounds unacknowledged requests and releases them on shutdown',async()=>{
  const client=new BrowserTenantClient('https://example.test/supervisor.mjs',FakeWorker);
  const worker=workers.at(-1);
  const requests=Array.from({length:BrowserTenantClient.MAX_PENDING},()=>client.list());
  assert.equal(worker.messages.length,BrowserTenantClient.MAX_PENDING);
  await assert.rejects(client.list(),/E_CLIENT_PENDING_LIMIT/);
  assert.equal(worker.messages.length,BrowserTenantClient.MAX_PENDING);
  worker.emit({id:1,ok:true,result:[]});
  assert.deepEqual(await requests[0],[]);
  const last=client.list();
  assert.equal(worker.messages.length,BrowserTenantClient.MAX_PENDING+1);
  client.close();
  await assert.rejects(last,/E_CLIENT_CLOSED/);
  const settled=await Promise.allSettled(requests.slice(1));
  assert.ok(settled.every(s=>s.status==='rejected' && s.reason.message==='E_CLIENT_CLOSED'));
  assert.equal(worker.terminated,true);
  await assert.rejects(client.list(),/E_CLIENT_CLOSED/);
});
test('throwing event subscribers never swallow messages or other subscriptions',async()=>{
  const client=new BrowserTenantClient('https://example.test/supervisor.mjs',FakeWorker);
  const worker=workers.at(-1);
  let got=0,logged=0;
  const old=console.error;
  console.error=()=>{logged++};
  try {
    client.on_event(()=>{throw new Error('listener panic')});
    client.on_event(()=>{got++});
    worker.emit({event:'actor_panic',tenant:'a',generation:1,actor_id:1});
    assert.equal(logged,1);
    assert.equal(got,1);
    const pending=client.list();
    const id=worker.messages.at(-1).id;
    worker.emit({id,ok:true,result:[]});
    assert.deepEqual(await pending,[]);
  }finally{console.error=old;client.close()}
});
