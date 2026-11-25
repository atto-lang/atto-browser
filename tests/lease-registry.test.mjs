import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorLeaseRegistry} from '../src/lease-registry.mjs';

test('reader leases coexist while writers exclude all other readers and writers',()=>{
 const leases=new ActorLeaseRegistry();
 leases.begin('state_counter',1);
 const r1=leases.acquire('state_counter',1,'read');
 const r2=leases.acquire('state_counter',1,'read');
 assert.equal(leases.snapshot('state_counter',1).readers,2);
 assert.throws(()=>leases.acquire('state_counter',1,'write'),/E_LEASE_BUSY/);
 assert.equal(leases.release(r1),true);
 assert.equal(leases.release(r1),false,'reader may release only once');
 assert.throws(()=>leases.acquire('state_counter',1,'write'),/E_LEASE_BUSY/);
 assert.equal(leases.release(r2),true);
 const w=leases.acquire('state_counter',1,'write');
 assert.throws(()=>leases.acquire('state_counter',1,'read'),/E_LEASE_BUSY/);
 assert.throws(()=>leases.acquire('state_counter',1,'write'),/E_LEASE_BUSY/);
 assert.equal(leases.release({...w}),false,'cloned token cannot claim an owned lease');
 assert.equal(leases.release(w),true);
 assert.equal(leases.snapshot('state_counter',1).active,0);
 assert.equal(leases.snapshot('state_counter',1).granted,3);
 assert.equal(leases.snapshot('state_counter',1).released,3);
});

test('supervisor revokes dead generation without a cooperating worker',()=>{
 const leases=new ActorLeaseRegistry();
 leases.begin('state_counter',8);
 const dead=leases.acquire('state_counter',8,'write');
 assert.equal(leases.revoke('state_counter',7),0,'old generation cannot revoke current lease');
 assert.equal(leases.revoke('state_counter',8),1);
 assert.equal(leases.revoke('state_counter',8),0,'double revoke never counts twice');
 assert.equal(leases.release(dead),false,'revoked release is not counted twice');
 assert.equal(leases.snapshot('state_counter',8).revoked,1);
 leases.begin('state_counter',9);
 const fresh=leases.acquire('state_counter',9,'write');
 assert.equal(leases.release(dead),false,'stale generation cannot release successor');
 assert.equal(leases.revoke('state_counter',8),0);
 assert.throws(()=>leases.acquire('state_counter',8,'write'),/E_STALE_LEASE_GENERATION/);
 assert.equal(leases.snapshot('state_counter',9).active,1);
 assert.equal(leases.release(fresh),true);
 assert.equal(leases.retire('state_counter',8),false);
 assert.equal(leases.retire('state_counter',9),true);
 assert.equal(leases.retire('state_counter',9),false);
 assert.throws(()=>leases.snapshot('state_counter',9),/E_STALE_LEASE_GENERATION/);
});

test('retirement revokes all active readers and never transfers ownership',()=>{
 const leases=new ActorLeaseRegistry();
 leases.begin('target',100);
 const readers=Array.from({length:64},()=>leases.acquire('target',100,'read'));
 assert.throws(()=>leases.acquire('target',100,'read'),/E_LEASE_BUSY/);
 assert.equal(leases.revoke('target',100),64);
 for(const x of readers)assert.equal(leases.release(x),false);
 assert.equal(leases.snapshot('target',100).revoked,64);
 assert.equal(leases.snapshot('target',100).active,0);
});
