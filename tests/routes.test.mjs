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
