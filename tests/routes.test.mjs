import test from 'node:test';
import assert from 'node:assert/strict';
import { TenantSupervisor } from '../src/supervisor-core.mjs';
import { PROTOCOL } from '../src/protocol.mjs';
import { assert_route_buffer } from '../src/route-protocol.mjs';

function fixture(){
  const workers=[],replies=[],events=[];
  const supervisor=new TenantSupervisor({origin:'https://app.test',restart_limit:1,
    boot_timeout_ms:500,call_timeout_ms:500,
    create_worker:()=>{
      const worker={messages:[],terminated:false,postMessage(data,transfer=[]){
        // Mimics the real browser structured-clone boundary and ownership move.
        this.messages.push(structuredClone(data,{transfer}));
      },terminate(){this.terminated=true},
      emit(data){this.onmessage({data:{protocol:PROTOCOL,...data}})}};
      workers.push(worker);return worker;
    },
    reply:x=>replies.push(x),event:x=>events.push(x)});
  let next=0;
  const send=(op,fields={})=>{const id=++next;supervisor.handle({protocol:PROTOCOL,op,id,...fields});return id};
  const answer=id=>replies.find(x=>x.id===id);
  const spawn=(tenant,backend='wasm')=>{
    const id=send('spawn',{tenant,backend,entry:'/guest',trusted:backend==='js'});
    workers.at(-1).emit({op:'ready',tenant,generation:workers.at(-1).messages[0].generation});
    return answer(id).result;
  };
  return {workers,replies,events,send,answer,spawn,supervisor};
}
function grant(h,from,to,actor_id=1,wire_type='i64'){
  return h.answer(h.send('grant_route',{...from,target:to,actor_id,wire_type})).result;
}
test('route grants enforce both incarnation authorities and never expose handles to workers',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b');
  let denied=h.send('grant_route',{...a,target:{...b,capability:crypto.randomUUID()},
    actor_id:1,wire_type:'i64'});
  assert.equal(h.answer(denied).error,'E_STALE_TENANT_HANDLE');
  const route=grant(h,a,b);
  assert.equal(route.wire_type,'i64');
  assert.notEqual(route.route_capability,a.capability);
  assert.notEqual(route.route_capability,b.capability);
  const buffer=new ArrayBuffer(8);new DataView(buffer).setBigInt64(0,45n,true);
  denied=h.send('send_route',{...a,route_id:route.route_id,
    route_capability:'00000000-0000-4000-8000-000000000000',wire_type:'i64',buffer});
  assert.equal(h.answer(denied).error,'E_ROUTE_INVALID');
  assert.equal(buffer.byteLength,8);
  const id=h.send('send_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,wire_type:'i64',buffer});
  assert.equal(buffer.byteLength,0,'ownership moved by structured clone');
  const mail=h.workers[1].messages.at(-1);
  assert.equal(mail.op,'route');
  assert.equal(mail.actor_id,1);
  assert.equal(new DataView(mail.buffer).getBigInt64(0,true),45n);
  assert.equal(mail.capability,undefined);
  assert.equal(mail.route_capability,undefined);
  assert.equal(mail.source_capability,undefined);
  h.workers[1].emit({op:'route_result',id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'45\n',actors:1}});
  assert.equal(h.answer(id).result.stdout,'45\n');
  assert.equal(h.supervisor.active_route_sends,0);
  const revoke=h.send('revoke_route',{...a,route_id:route.route_id,route_capability:route.route_capability});
  assert.equal(h.answer(revoke).result.revoked,true);
  const replay=h.send('send_route',{...a,route_id:route.route_id,route_capability:route.route_capability,
    wire_type:'i64',buffer:new ArrayBuffer(8)});
  assert.equal(h.answer(replay).error,'E_ROUTE_INVALID');
});
test('backpressure and cross-generation replay are fail-closed',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b'),route=grant(h,a,b);
  const first=h.send('send_route',{...a,...{route_id:route.route_id,route_capability:route.route_capability,
    wire_type:'i64',buffer:new ArrayBuffer(8)}});
  const second=h.send('send_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,wire_type:'i64',buffer:new ArrayBuffer(8)});
  assert.equal(h.answer(second).error,'E_TENANT_BUSY');
  h.workers[1].emit({op:'route_result',id:first,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'ok'}});
  assert.equal(h.answer(first).ok,true);
  h.send('stop',b);
  const next=h.spawn('b');
  assert.notEqual(next.generation,b.generation);
  const old=h.send('send_route',{...a,route_id:route.route_id,route_capability:route.route_capability,
    wire_type:'i64',buffer:new ArrayBuffer(8)});
  assert.equal(h.answer(old).error,'E_ROUTE_INVALID');
  const staleSource=h.send('grant_route',{...b,target:a,actor_id:1,wire_type:'i64'});
  assert.equal(h.answer(staleSource).error,'E_STALE_TENANT_HANDLE');
});
test('route buffers reject oversize, empty, views and unsupported wire length',()=>{
  assert.throws(()=>assert_route_buffer(new ArrayBuffer(0),'bytes'),/E_ROUTE_SIZE/);
  assert.throws(()=>assert_route_buffer(new ArrayBuffer(65537),'bytes'),/E_ROUTE_SIZE/);
  assert.throws(()=>assert_route_buffer(new Uint8Array(8),'i64'),/E_ROUTE_BUFFER/);
  assert.throws(()=>assert_route_buffer(new ArrayBuffer(9),'i64'),/E_ROUTE_WIRE/);
  assert.equal(assert_route_buffer(new ArrayBuffer(65536),'bytes').byteLength,65536);
});
test('same-tenant grants, unsupported wire and too many grants are rejected',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b');
  let id=h.send('grant_route',{...a,target:a,actor_id:1,wire_type:'i64'});
  assert.equal(h.answer(id).error,'E_ROUTE_SELF');
  id=h.send('grant_route',{...a,target:b,actor_id:0,wire_type:'bytes'});
  assert.equal(h.answer(id).error,'E_ROUTE_WIRE');
  for(let i=0;i<64;i++)assert.ok(grant(h,a,b).route_id);
  id=h.send('grant_route',{...a,target:b,actor_id:1,wire_type:'i64'});
  assert.equal(h.answer(id).error,'E_ROUTE_LIMIT');
});

test('compiled ActorRef.send emits ordered opaque route mail; caller waits for both acks',()=>{
  const h=fixture(),sender=h.spawn('sender'),receiver=h.spawn('receiver');
  const route=grant(h,sender,receiver);
  const bound=h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  assert.deepEqual(h.answer(bound).result,{slot:1,bound:true});
  const binding=h.workers[0].messages.at(-1);
  assert.equal(binding.op,'bind_route');
  assert.equal(binding.slot,1);
  assert.equal(binding.route_capability,undefined,'capability remains in supervisor');
  assert.equal(binding.route_id,undefined,'opaque route ID remains in supervisor');
  const call=h.send('call',sender);
  h.workers[0].emit({op:'result',tenant:'sender',generation:sender.generation,
    id:call,ok:true,result:{value:'0',actors:1,stdout:''},
    remote_sends:[{slot:1,value:40n},{slot:1,value:2n}]});
  assert.equal(h.answer(call),undefined,'call must not ack before recipient settles');
  let mail=h.workers[1].messages.at(-1);
  assert.equal(mail.op,'route');
  assert.equal(new DataView(mail.buffer).getBigInt64(0,true),40n);
  h.workers[1].emit({op:'route_result',tenant:'receiver',generation:receiver.generation,
    id:mail.id,route_id:route.route_id,ok:true,
    result:{value:'delivered',stdout:'40\n',actors:1}});
  assert.equal(h.answer(call),undefined,'first ack is not a batch completion');
  mail=h.workers[1].messages.at(-1);
  assert.equal(new DataView(mail.buffer).getBigInt64(0,true),2n);
  h.workers[1].emit({op:'route_result',tenant:'receiver',generation:receiver.generation,
    id:mail.id,route_id:route.route_id,ok:true,
    result:{value:'delivered',stdout:'42\n',actors:1}});
  const reply=h.answer(call);
  assert.equal(reply.ok,true);
  assert.deepEqual(reply.result.remote_acks.map(x=>x.stdout),['40\n','42\n']);
  assert.equal(h.supervisor.active_route_sends,0);
});
test('revocation fences compiled sends even with a previously bound slot',()=>{
  const h=fixture(),sender=h.spawn('sender'),receiver=h.spawn('receiver');
  const route=grant(h,sender,receiver);
  h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  h.send('revoke_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability});
  const id=h.send('call',sender);
  h.workers[0].emit({op:'result',tenant:'sender',generation:sender.generation,
    id,ok:true,result:{value:'0'},remote_sends:[{slot:1,value:42n}]});
  assert.equal(h.answer(id).error,'E_REMOTE_ROUTE_STALE');
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.workers[1].terminated,false);
});
test('unbound or malformed compiler guest outbox cannot forge delivery',()=>{
  const h=fixture(),sender=h.spawn('sender'),receiver=h.spawn('receiver');
  const id=h.send('call',sender);
  h.workers[0].emit({op:'result',tenant:'sender',generation:sender.generation,
    id,ok:true,result:{value:'0'},remote_sends:[{slot:17,value:42n}]});
  assert.equal(h.answer(id).error,'E_REMOTE_PROTOCOL');
  assert.equal(h.workers[1].messages.length,1,'receiver never saw malformed mail');
  assert.equal(h.workers[0].terminated,true);
});

test('receiver crash during compiled remote delivery fails sender and fences old route',()=>{
  const h=fixture(),sender=h.spawn('sender'),receiver=h.spawn('receiver'),
    neighbor=h.spawn('neighbor');
  const route=grant(h,sender,receiver);
  h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  const call=h.send('call',sender);
  h.workers[0].emit({op:'result',tenant:'sender',generation:sender.generation,
    id:call,ok:true,result:{value:'0'},remote_sends:[{slot:1,value:40n}]});
  assert.equal(h.answer(call),undefined);
  h.workers[1].onerror();
  assert.equal(h.answer(call).error,'E_REMOTE_DELIVERY: E_WORKER_CRASH');
  assert.equal(h.workers[0].terminated,true);
  assert.equal(h.workers[1].terminated,true);
  assert.equal(h.workers[2].terminated,false,'unrelated tenant survives both failures');
  const stale=h.send('send_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,wire_type:'i64',buffer:new ArrayBuffer(8)});
  assert.equal(h.answer(stale).error,'E_STALE_TENANT_HANDLE');
  const alive=h.send('call',neighbor);
  h.workers[2].emit({op:'result',tenant:'neighbor',generation:neighbor.generation,
    id:alive,ok:true,result:{value:'7'}});
  assert.equal(h.answer(alive).result.value,'7');
});
test('compiled route slots cannot be rebound or forged with stale route authority',()=>{
  const h=fixture(),sender=h.spawn('sender'),receiver=h.spawn('receiver');
  const route=grant(h,sender,receiver);
  let id=h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:'00000000-0000-4000-8000-000000000000',slot:1});
  assert.equal(h.answer(id).error,'E_ROUTE_INVALID');
  id=h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:17});
  assert.equal(h.answer(id).error,'E_ROUTE_SLOT');
  id=h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  assert.equal(h.answer(id).result.bound,true);
  id=h.send('bind_route',{...sender,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  assert.equal(h.answer(id).error,'E_ROUTE_SLOT_IN_USE');
});

test('direct routed send returns authoritative processed receipt and rejects duplicate reply',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b'),route=grant(h,a,b);
  const id=h.send('send_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,wire_type:'i64',buffer:new ArrayBuffer(8)});
  const mail=h.workers[1].messages.at(-1);
  h.workers[1].emit({op:'route_result',id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'1\n',actors:1}});
  const ack=h.answer(id).result;
  assert.equal(ack.receipt.protocol,'atto.browser.send-receipt.v1');
  assert.equal(ack.receipt.outcome,'processed');
  assert.equal(ack.receipt.code,'OK');
  assert.equal(ack.receipt.source,'a');
  assert.equal(ack.receipt.target,'b');
  assert.equal(ack.receipt.actor_id,1);
  assert.equal(ack.receipt.capability,undefined);
  assert.equal(h.supervisor.active_route_sends,0);
  h.workers[1].emit({op:'route_result',id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'DUPLICATE'}});
  assert.equal(h.replies.filter(x=>x.id===id).length,1);
  assert.equal(h.supervisor.active_route_sends,0);
});
test('compiled remote batch returns receipt for each processed message',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b'),route=grant(h,a,b);
  h.send('bind_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  const id=h.send('call',a);
  h.workers[0].emit({op:'result',tenant:'a',generation:a.generation,id,
    ok:true,result:{value:'0'},remote_sends:[{slot:1,value:40n},{slot:1,value:2n}]});
  const first=h.workers[1].messages.at(-1);
  h.workers[1].emit({op:'route_result',id:first.id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'40\n'}});
  const second=h.workers[1].messages.at(-1);
  h.workers[1].emit({op:'route_result',id:second.id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'42\n'}});
  const final=h.answer(id).result;
  assert.deepEqual(final.remote_receipts.map(r=>r.outcome),['processed','processed']);
  assert.equal(final.remote_receipts[0].receipt_id+1,final.remote_receipts[1].receipt_id);
  assert.deepEqual(final.remote_acks.map(x=>x.receipt),final.remote_receipts);
});
test('receiver crash after first ack yields unknown receipt and preserved confirmed history',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b'),route=grant(h,a,b);
  h.send('bind_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  const id=h.send('call',a);
  h.workers[0].emit({op:'result',tenant:'a',generation:a.generation,id,
    ok:true,result:{value:'0'},remote_sends:[{slot:1,value:40n},{slot:1,value:2n}]});
  const first=h.workers[1].messages.at(-1);
  h.workers[1].emit({op:'route_result',id:first.id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'40\n'}});
  h.workers[1].onerror();
  const failure=h.answer(id);
  assert.equal(failure.ok,false);
  assert.equal(failure.failure.protocol,'atto.browser.send-receipt.v1');
  assert.equal(failure.failure.outcome,'unknown');
  assert.equal(failure.failure.code,'E_ROUTE_CRASH');
  assert.equal(failure.failure.receipt.outcome,'unknown');
  assert.equal(failure.failure.prior_receipts.length,1);
  assert.equal(failure.failure.prior_receipts[0].outcome,'processed');
  assert.equal(h.workers[2].terminated,true,'source worker restarted rather than treating unknown as success');
});
test('rejected next send after revocation is not mislabeled processed',()=>{
  const h=fixture(),a=h.spawn('a'),b=h.spawn('b'),route=grant(h,a,b);
  h.send('bind_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability,slot:1});
  const id=h.send('call',a);
  h.workers[0].emit({op:'result',tenant:'a',generation:a.generation,id,
    ok:true,result:{value:'0'},remote_sends:[{slot:1,value:40n},{slot:1,value:2n}]});
  const first=h.workers[1].messages.at(-1);
  h.send('revoke_route',{...a,route_id:route.route_id,
    route_capability:route.route_capability});
  h.workers[1].emit({op:'route_result',id:first.id,tenant:'b',generation:b.generation,
    route_id:route.route_id,ok:true,result:{value:'delivered',stdout:'40\n'}});
  const result=h.answer(id);
  assert.equal(result.error,'E_REMOTE_ROUTE_STALE');
  assert.equal(result.failure.outcome,'rejected');
  assert.equal(result.failure.code,'E_ROUTE_STALE');
  assert.equal(result.failure.receipt,null);
  assert.equal(result.failure.prior_receipts.length,1);
  assert.equal(result.failure.prior_receipts[0].outcome,'processed');
});
