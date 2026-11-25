// Exact SHA-pinned executable stateful AttoLang mtd *preview*, one actor
// instance/one mutable int field/one critical-write increment callback.
// The guest-private flag is NOT the supervisor-owned lease authority.
import {MAX_WASM_BYTES,fixed_memory_pages} from './wasm-profile.mjs';
import {read_bounded} from './wasm-tenant.mjs';
import {assert_receiver_identifier} from './protocol.mjs';

const SHA=/^[0-9a-f]{64}$/;
const I64MIN=-(1n<<63n),I64MAX=(1n<<63n)-1n;
export async function open_stateful_tenant(entry,owner,expected_sha256){
  assert_receiver_identifier(owner,'E_STATE_OWNER');
  if(typeof expected_sha256!=='string'||!SHA.test(expected_sha256))
    throw new Error('E_STATE_DIGEST');
  const response=await fetch(entry,{credentials:'omit',mode:'same-origin',redirect:'error'});
  if(!response.ok)throw new Error('E_WASM_FETCH');
  if(response.redirected||(response.url &&
    new URL(response.url).origin!==new URL(entry).origin))
    throw new Error('E_WASM_REDIRECT');
  const bytes=await read_bounded(response);
  if(bytes.byteLength>MAX_WASM_BYTES)throw new Error('E_WASM_SIZE');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const actual=Array.from(digest,v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==expected_sha256)throw new Error('E_STATE_DIGEST_MISMATCH');
  if(fixed_memory_pages(bytes)!==0||!WebAssembly.validate(bytes))
    throw new Error('E_STATE_WASM_PROFILE');
  const mod=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(mod).length!==0)throw new Error('E_STATE_IMPORT');
  const specs=WebAssembly.Module.exports(mod);
  const exact=new Set(['panic_code','lease_active','release_count',
    'acquire_count','close_witness']);
  const method_prefix='atto.state.'+owner+'.';
  const method_exports=specs.filter(e=>e.name.startsWith(method_prefix) &&
    /\.1$/.test(e.name));
  const state_exports=specs.filter(e=>e.name.startsWith(method_prefix) &&
    !/\.1$/.test(e.name));
  if(method_exports.length!==1||state_exports.length!==1||
     specs.length!==7||new Set(specs.map(e=>e.name)).size!==7 ||
     method_exports[0].kind!=='function'||state_exports[0].kind!=='function' ||
     !/^atto\.state\.[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*\.1$/.test(method_exports[0].name) ||
     !/^atto\.state\.[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*$/.test(state_exports[0].name) ||
     specs.some(e=>(e.name==='panic_code'&&e.kind!=='global')||
       (e.name!=='panic_code'&&e.kind!=='function')||
       (!exact.has(e.name)&&e!==method_exports[0]&&e!==state_exports[0])))
    throw new Error('E_STATE_ABI');
  const method=method_exports[0].name.slice(method_prefix.length,-2);
  const field=state_exports[0].name.slice(method_prefix.length);
  assert_receiver_identifier(method,'E_STATE_ABI');
  assert_receiver_identifier(field,'E_STATE_ABI');
  const x=new WebAssembly.Instance(mod,{}).exports;
  const run=x[method_exports[0].name],read=x[state_exports[0].name];
  if(run.length!==2||read.length!==0||x.lease_active.length!==0||
     x.release_count.length!==0||x.acquire_count.length!==0||
     x.close_witness.length!==0||typeof x.panic_code?.value!=='number' ||
     typeof read()!=='bigint'||x.lease_active()!==0 ||
     x.release_count()!==0||x.acquire_count()!==0)
    throw new Error('E_STATE_SIGNATURE');
  let closed=false;
  const check_release=(acquires,releases)=>{
    if(x.lease_active()!==0||x.acquire_count()!==acquires+1||
       x.release_count()!==releases+1)
      throw new Error('E_STATE_GUEST_RELEASE');
  };
  return Object.freeze({
    on_receiver(requested,args){
      if(closed)throw new Error('E_STATE_CLOSED');
      if(requested!==method)throw new Error('E_RECEIVER_METHOD');
      if(!Array.isArray(args)||args.length!==1||
         typeof args[0]!=='bigint'||args[0]<I64MIN||args[0]>I64MAX)
        throw new Error('E_RECEIVER_ARGS');
      if(x.lease_active()!==0)throw new Error('E_STATE_GUEST_LEASE');
      const prev=read(),acquires=x.acquire_count(),releases=x.release_count();
      try {
        const result=run(args[0],0);
        check_release(acquires,releases);
        if(typeof result!=='bigint'||read()!==result)
          throw new Error('E_STATE_GUEST_RESULT');
        return {value:String(result),stdout:'',actors:1};
      }catch(error){
        if(!(error instanceof WebAssembly.RuntimeError))throw error;
        const code=x.panic_code.value;
        closed=true;
        // The guest must have released before checked overflow. The
        // supervisor also independently revokes its host-owned lease.
        if(code===1 && (x.lease_active()!==0||
           x.acquire_count()!==acquires+1||x.release_count()!==releases+1||
           read()!==prev))
          throw new Error('E_STATE_GUEST_RELEASE');
        const failure=new Error(code?'E_GUEST_PANIC_'+code:'E_GUEST_TRAP');
        failure.actor_failure={kind:'panic',actor_id:1,parent_id:0,
          actor_type:owner,reason:failure.message};
        throw failure;
      }
    },
    dispose(){
      if(closed)return;
      closed=true;
      if(x.close_witness()!==1)throw new Error('E_STATE_GUEST_CLOSE');
    }
  });
}
