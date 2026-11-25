import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialOwnedActor} from '../src/owned-message/serial-actor-reference.mjs';

const receive=async(_message,self)=>self.done();
test('serial mailbox limits are enforced before any message can enter',async()=>{
 for(const invalid of [0,-1,1.5,4097,NaN,'1']){
  assert.throws(()=>createSerialOwnedActor({receive,maxPending:invalid}),/invalid maxPending/);
 }
 for(const invalid of [43,1048577,0,-1,1.25,Infinity,'44']){
  assert.throws(()=>createSerialOwnedActor({receive,maxBytes:invalid}),/invalid maxBytes/);
 }
 for(const [maxPending,maxBytes] of [[1,44],[4096,1048576]]){
  const actor=createSerialOwnedActor({receive,maxPending,maxBytes});
  assert.equal(actor.pending,0);
  assert.equal(actor.idle,true);
  assert.equal(Object.isFrozen(actor),true);
  actor.close();
  await assert.rejects(actor.request({variant:'unused'}),/actor closed/);
 }
});
test('reject forged route functions and malformed reply-variant declarations',()=>{
 assert.throws(()=>createSerialOwnedActor({}),/receive callback required/);
 for(const field of ['routeSend','routeForward']){
  assert.throws(()=>createSerialOwnedActor({receive,[field]:42}),/invalid .* route/);
 }
 for(const replyVariants of [[],{request:[]},{request:['ok','ok']},{request:[1]}]){
  assert.throws(()=>createSerialOwnedActor({receive,replyVariants}),/invalid reply/);
 }
 const actor=createSerialOwnedActor({receive,replyVariants:{request:['ok']}});
 actor.close();
});