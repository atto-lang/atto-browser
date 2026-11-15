// Restricted execution of the opt-in atto-source.rs #144 actor receiver ABI.
// This module runs ONLY in a dedicated tenant Worker. It does not load a
// production actor scheduler, lease-bearing methods, or arbitrary JS guests.
import {MAX_WASM_BYTES, fixed_memory_pages} from './wasm-profile.mjs';
import {read_bounded} from './wasm-tenant.mjs';

const IDENT=/^[A-Za-z_][A-Za-z_0-9]*$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_I64=(1n<<63n)-1n,MIN_I64=-(1n<<63n);

function secure_token() {
  if(!globalThis.crypto?.getRandomValues)throw new Error('E_RECEIVER_RANDOM');
  const data=new Uint32Array(2);
  do {crypto.getRandomValues(data)} while(data[0]===0 && data[1]===0);
  return BigInt.asIntN(64,(BigInt(data[0])<<32n)|BigInt(data[1]));
}

function require_args(args) {
  if(!Array.isArray(args) || args.length>8 ||
      args.some(v=>typeof v!=='bigint'||v<MIN_I64||v>MAX_I64))
    throw new Error('E_RECEIVER_ARGS');
  return args;
}

export async function open_receiver_tenant(entry, owner, expected_sha256) {
  if(typeof owner!=='string' || !IDENT.test(owner))throw new Error('E_RECEIVER_OWNER');
  if(typeof expected_sha256!=='string' || !SHA.test(expected_sha256))
    throw new Error('E_RECEIVER_DIGEST');
  const response=await fetch(entry,{credentials:'omit',mode:'same-origin',redirect:'error'});
  if(!response.ok)throw new Error('E_WASM_FETCH');
  if(response.redirected || (response.url && new URL(response.url).origin!==new URL(entry).origin))
    throw new Error('E_WASM_REDIRECT');
  const bytes=await read_bounded(response);
  if(bytes.byteLength>MAX_WASM_BYTES)throw new Error('E_WASM_SIZE');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const actual=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==expected_sha256)throw new Error('E_RECEIVER_DIGEST_MISMATCH');
  if(fixed_memory_pages(bytes)!==0 || !WebAssembly.validate(bytes))
    throw new Error('E_RECEIVER_WASM_PROFILE');
  const module=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(module).length!==0)
    throw new Error('E_RECEIVER_IMPORT');
  const exports=WebAssembly.Module.exports(module);
  const kinds=new Map(exports.map(x=>[x.name,x.kind]));
  if(kinds.get('panic_code')!=='global' ||
     kinds.get('atto.actor_close')!=='function' ||
     kinds.get('atto.bind.'+owner)!=='function')
    throw new Error('E_RECEIVER_ABI');
  const methods=exports.filter(e=>e.name.startsWith('atto.receiver.'));
  if(methods.length<1 || methods.length>32 ||
     !methods.some(e=>e.name.startsWith('atto.receiver.'+owner+'.')))
    throw new Error('E_RECEIVER_ABI');
  if(exports.some(e=>e.kind!=='function' && e.name!=='panic_code') ||
     methods.some(e=>e.kind!=='function' ||
       !/^atto\.receiver\.[A-Za-z_][A-Za-z_0-9]*\.[A-Za-z_][A-Za-z_0-9]*\.[0-8]$/.test(e.name)) ||
     exports.some(e=>e.name.startsWith('atto.bind.') &&
       (e.kind!=='function' || !IDENT.test(e.name.slice('atto.bind.'.length)))))
    throw new Error('E_RECEIVER_ABI');

  // Module was SHA-pinned and verified before instantiation. This preview has
  // no Wasm start section (checked in fixed_memory_pages).
  const inst=new WebAssembly.Instance(module,{}).exports;
  const bind=inst['atto.bind.'+owner];
  if(bind.length!==1 || inst['atto.actor_close'].length!==1 ||
     typeof inst.panic_code?.value!=='number')
    throw new Error('E_RECEIVER_SIGNATURE');
  for(const entry of methods) {
    const arity=Number(entry.name.at(-1));
    if(inst[entry.name].length!==arity+1)throw new Error('E_RECEIVER_SIGNATURE');
  }
  const token=secure_token();
  if(bind(token)!==1)throw new Error('E_RECEIVER_BIND');
  let closed=false;
  return Object.freeze({
    on_receiver(method,args) {
      if(closed)throw new Error('E_RECEIVER_CLOSED');
      if(typeof method!=='string' || !IDENT.test(method))throw new Error('E_RECEIVER_METHOD');
      require_args(args);
      const fn=inst['atto.receiver.'+owner+'.'+method+'.'+args.length];
      if(typeof fn!=='function')throw new Error('E_RECEIVER_METHOD');
      try {
        const value=fn(token,...args);
        if(typeof value!=='bigint')throw new Error('E_RECEIVER_RETURN');
        return {value:String(value),stdout:'',actors:1};
      }catch(error) {
        if(!(error instanceof WebAssembly.RuntimeError))throw error;
        const code=inst.panic_code.value;
        closed=true;
        try {inst['atto.actor_close'](token)}catch{}
        const failure=new Error(code ? 'E_GUEST_PANIC_'+code : 'E_GUEST_TRAP');
        failure.actor_failure={kind:'panic',actor_id:1,parent_id:0,
          actor_type:owner,reason:failure.message};
        throw failure;
      }
    },
    dispose() {
      if(closed)return;
      closed=true;
      if(inst['atto.actor_close'](token)!==1)throw new Error('E_RECEIVER_CLOSE');
    }
  });
}
