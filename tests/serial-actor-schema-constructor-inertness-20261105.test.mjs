import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialOwnedActor} from '../src/owned-message/serial-actor-reference.mjs';

test('well-formed null-prototype reply map and boundary capacities remain inert',async()=>{
  let received=0;
  const receive=async(_message,self)=>{received++;self.done();};
  const replyVariants=Object.assign(Object.create(null),{request:['accepted']});
  const actor=createSerialOwnedActor({
    receive,replyVariants,maxPending:1,maxBytes:44,
    routeSend:()=>undefined,routeForward:()=>undefined
  });
  assert.equal(actor.pending,0);
  assert.equal(actor.idle,true);
  assert.equal(received,0);
  assert.equal(Object.isFrozen(actor),true);
  actor.close();
  await assert.rejects(actor.tell({variant:'request'}),/actor closed/);
  await assert.rejects(actor.request({variant:'request'}),/actor closed/);
  assert.equal(received,0);
});

test('invalid reply declarations and route identities cannot construct a live actor',()=>{
  let received=0;
  const receive=async(_message,self)=>{received++;self.done();};
  for(const replyVariants of [null,[],{request:[]},{request:['accepted','accepted']},{request:[1]},42]){
    assert.throws(()=>createSerialOwnedActor({receive,replyVariants}),/invalid reply/);
  }
  for(const [key,value] of [['routeSend',{}],['routeForward',false]]){
    assert.throws(()=>createSerialOwnedActor({receive,[key]:value}),/invalid .* route/);
  }
  assert.equal(received,0);
});
