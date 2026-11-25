// Supervisor-owned, generation-fenced actor-state lease registry.
// This runs OUTSIDE the tenant Worker. A hard Worker termination never has to
// execute a guest release: the supervisor revokes the whole dead generation.
// The registry is an opt-in preview authority, not a distributed lock service.
import {MAX_TENANTS,assert_tenant_id} from './protocol.mjs';

const valid_generation=g=>Number.isSafeInteger(g)&&g>0;
const fail=code=>{throw new Error(code)};
export class ActorLeaseRegistry {
  #incarnations=new Map();
  #max_per_actor=64;

  begin(tenant,generation) {
    assert_tenant_id(tenant);
    if(!valid_generation(generation))fail('E_LEASE_GENERATION');
    const old=this.#incarnations.get(tenant);
    if(old && generation<=old.generation)fail('E_STALE_LEASE_GENERATION');
    if(!old && this.#incarnations.size>=MAX_TENANTS)fail('E_LEASE_TENANTS');
    this.#incarnations.set(tenant,{generation,writer:null,readers:new Map(),
      granted:0,released:0,revoked:old?.revoked??0});
  }
  #state(tenant,generation) {
    const state=this.#incarnations.get(tenant);
    if(!state || state.generation!==generation)fail('E_STALE_LEASE_GENERATION');
    return state;
  }
  acquire(tenant,generation,mode) {
    if(mode!=='read' && mode!=='write')fail('E_LEASE_MODE');
    const s=this.#state(tenant,generation);
    if(mode==='write'?(s.writer!==null||s.readers.size!==0)
        :(s.writer!==null||s.readers.size>=this.#max_per_actor))
      fail('E_LEASE_BUSY');
    if(!globalThis.crypto?.randomUUID)fail('E_LEASE_RANDOM');
    const lease=Object.freeze({tenant,generation,mode,id:crypto.randomUUID()});
    if(mode==='write')s.writer=lease;
    else s.readers.set(lease.id,lease);
    s.granted++;
    return lease;
  }
  release(lease) {
    if(!lease || typeof lease!=='object')return false;
    const s=this.#incarnations.get(lease.tenant);
    if(!s || s.generation!==lease.generation)return false;
    let matched=false;
    if(lease.mode==='write') {
      matched=s.writer===lease;
      if(matched)s.writer=null;
    }else if(lease.mode==='read') {
      matched=s.readers.get(lease.id)===lease;
      if(matched)s.readers.delete(lease.id);
    }
    if(matched)s.released++;
    return matched;
  }
  // Called BEFORE terminating/restarting/retiring a tenant worker.
  // Safe even if a completion reply races with a timeout or crash.
  revoke(tenant,generation) {
    const s=this.#incarnations.get(tenant);
    if(!s || s.generation!==generation)return 0;
    const count=Number(s.writer!==null)+s.readers.size;
    s.writer=null;s.readers.clear();
    s.revoked+=count;
    return count;
  }
  retire(tenant,generation) {
    const s=this.#incarnations.get(tenant);
    if(!s||s.generation!==generation)return false;
    this.revoke(tenant,generation);
    this.#incarnations.delete(tenant);
    return true;
  }
  snapshot(tenant,generation) {
    const s=this.#state(tenant,generation);
    return Object.freeze({tenant,generation,active:Number(s.writer!==null)+s.readers.size,
      readers:s.readers.size,writers:Number(s.writer!==null),
      granted:s.granted,released:s.released,revoked:s.revoked});
  }
}
