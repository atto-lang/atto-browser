import { MAX_ACTORS_PER_TENANT, MAX_MAIL_PER_ACTOR, MAX_STDOUT_BYTES } from './protocol.mjs';
import { fixed_memory_pages, actor_names, MAX_WASM_BYTES } from './wasm-profile.mjs';

async function read_bounded(response) {
  const declared=Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared>MAX_WASM_BYTES) throw new Error('E_WASM_SIZE');
  if (response.body?.getReader) {
    const reader=response.body.getReader(), chunks=[];
    let total=0, received_chunks=0;
    try {
      for (;;) {
        const {done,value}=await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('E_WASM_STREAM');
        if (++received_chunks>8192) throw new Error('E_WASM_STREAM_CHUNKS');
        total+=value.byteLength;
        if (total>MAX_WASM_BYTES) throw new Error('E_WASM_SIZE');
        if(value.byteLength) chunks.push(value);
      }
    } catch(e) { try { await reader.cancel(); } catch {} throw e; }
    const bytes=new Uint8Array(total);
    let offset=0;
    for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
    return bytes;
  }
  const buffer=await response.arrayBuffer();
  if (buffer.byteLength>MAX_WASM_BYTES) throw new Error('E_WASM_SIZE');
  return new Uint8Array(buffer);
}

// A tenant has its own Worker. Actors inside it have distinct Wasm instances,
// linear memories and globals; this is not one browser thread per actor.
export async function open_wasm_tenant(entry) {
  // Reject redirects before following them: a same-origin URL must not
  // cause a cross-origin request or load a different guest artifact.
  const response=await fetch(entry,{credentials:'omit',mode:'same-origin',redirect:'error'});
  if(!response.ok)throw new Error('E_WASM_FETCH');
  if (response.redirected || (response.url && new URL(response.url).origin!==new URL(entry).origin)) throw new Error('E_WASM_REDIRECT');
  const buffer=await read_bounded(response);
  if(!WebAssembly.validate(buffer))throw new Error('E_WASM_INVALID');
  const pages=fixed_memory_pages(buffer);
  const module=await WebAssembly.compile(buffer);
  const allowed=new Set(['print_i64','print_bool','print_str','print_newline','print_f64','actor_spawn','actor_send']);
  for(const imp of WebAssembly.Module.imports(module)) {
    if(imp.module !== 'atto' || !allowed.has(imp.name) || imp.kind !== 'function') throw new Error('E_WASM_IMPORT');
  }
  const exports=WebAssembly.Module.exports(module);
  const kind=name=>exports.find(x=>x.name===name)?.kind;
  if(kind('main')!=='function')throw new Error('E_WASM_MAIN');
  const actor_enabled=kind('actor_init')==='function' && kind('actor_receive')==='function';
  if((kind('actor_init')==='function')!==(kind('actor_receive')==='function'))throw new Error('E_WASM_ACTOR_ABI');
  const types=actor_names(module);
  if (actor_enabled !== (types.length>0)) throw new Error('E_WASM_ACTORS');
  if (pages>0 && kind('memory')!=='memory') throw new Error('E_WASM_MEMORY_EXPORT');
  if (actor_enabled && !pages) throw new Error('E_WASM_ACTOR_MEMORY');
  const actors=new Map();let next_actor_id=1;
  let stdout_chunks=[], stdout_bytes=0;
  const text_encoder=new TextEncoder();
  const queued=[];
  const MAX_TOTAL_MAIL=8192;
  const text_decoder=new TextDecoder('utf-8',{fatal:true});
  let executions=0;
  // Tracks the instance whose current guest entrypoint failed. A panic in an
  // actor must not be misreported using the main instance's panic_code.
  let active_guest=null;
  let active_actor=null; // null means the main entrypoint, not an actor
  const remote_slots=new Set();
  const outbound=[];
  const MAX_GUEST_REMOTE_SENDS=16; // bounded until host confirms their delivery

  function instantiate() {
    let instance;
    const append=text=>{
      const bytes=text_encoder.encode(text).length;
      if (stdout_bytes+bytes>MAX_STDOUT_BYTES) throw new Error('E_STDOUT_LIMIT');
      if (!bytes) return; // zero-byte prints may not allocate unlimited slots
      if (stdout_chunks.length>=8192) throw new Error('E_STDOUT_CHUNKS');
      stdout_bytes+=bytes;
      stdout_chunks.push(text);
    };
    const imports={atto:{
      print_i64: value=>append(String(value)),
      print_bool: value=>append(value ? 'true' : 'false'),
      print_f64: value=>append(String(value)),
      print_newline:()=>append('\n'),
      print_str:(ptr,len)=>{
        const mem=instance.exports.memory;
        if(!mem || !Number.isInteger(ptr) || !Number.isInteger(len) || ptr<0 || len<0 || ptr+len>mem.buffer.byteLength)throw new Error('E_PRINT_BOUNDS');
        append(text_decoder.decode(new Uint8Array(mem.buffer,ptr,len)));
      },
      actor_spawn:type=>{
        if(!actor_enabled)throw new Error('E_ACTOR_ABI');
        if(!Number.isInteger(type) || type<0 || type>=types.length) throw new Error('E_ACTOR_TYPE');
        if(actors.size>=MAX_ACTORS_PER_TENANT)throw new Error('E_ACTOR_LIMIT');
        // Reserve before running any guest init to prevent recursive spawn
        // from bypassing the actor limit.
        const id=next_actor_id++;
        const actor={id,type,parent_id:active_actor?.id ?? 0,instance:null,mailbox:[],sequence:0n};
        actors.set(id,actor);
        try {
          actor.instance=instantiate();
          const caller=active_guest, parent_actor=active_actor;
          active_guest=actor.instance;
          active_actor=actor;
          actor.instance.exports.actor_init(type);
          // A trap retains the failing actor's identity and panic code.
          active_guest=caller;
          active_actor=parent_actor;
          return id;
        } catch (e) { actors.delete(id); throw e; }
      },
      actor_send:(ref,value)=>{
        if (Number.isInteger(ref) && ref<0) {
          const slot=-ref;
          if(!remote_slots.has(slot))throw new Error('E_ROUTE_UNBOUND');
          if(outbound.length>=MAX_GUEST_REMOTE_SENDS)throw new Error('E_ROUTE_BACKPRESSURE');
          outbound.push({slot,value:BigInt(value)});
          return;
        }
        const actor=actors.get(ref);
        if(!actor)throw new Error('E_ACTOR_REF');
        if(!actor.instance)throw new Error('E_ACTOR_NOT_READY');
        if(actor.mailbox.length >= MAX_MAIL_PER_ACTOR || queued.length >= MAX_TOTAL_MAIL)throw new Error('E_MAILBOX_FULL');
        actor.mailbox.push(BigInt(value));
        queued.push(ref);
      }
    }};
    instance=new WebAssembly.Instance(module,imports);
    return instance;
  }
  const main=instantiate();
  function drain_mail() {
    let cursor=0,steps=0;
    while(cursor<queued.length) {
      if(++steps>65536)throw new Error('E_DISPATCH_BUDGET');
      const id=queued[cursor++],actor=actors.get(id);
      if(!actor || !actor.instance)throw new Error('E_ACTOR_REF');
      const payload=actor.mailbox.shift();
      active_guest=actor.instance;
      active_actor=actor;
      actor.instance.exports.actor_receive(actor.type,payload,++actor.sequence);
      active_guest=main;
      active_actor=null;
      if(cursor>=1024){queued.splice(0,cursor);cursor=0;}
    }
    queued.length=0;
  }
  function make_guest_error(error) {
    const code=active_guest?.exports.panic_code?.value;
    const failure=new Error(code ? `E_GUEST_PANIC_${code}` :
      'E_GUEST_TRAP: '+String(error?.message||error));
    if(active_actor) {
      failure.actor_failure={kind:'panic',actor_id:active_actor.id,
        parent_id:active_actor.parent_id,actor_type:types[active_actor.type],
        reason:failure.message.slice(0,256)};
    }
    return failure;
  }
  return {
    async on_message(){
      if(executions++!==0)throw new Error('E_MAIN_ALREADY_CALLED');
      stdout_chunks=[]; stdout_bytes=0;
      let value;
      try {
        active_guest=main;
        active_actor=null;
        value=main.exports.main();
        if (typeof value!=='bigint') throw new Error('E_GUEST_SIGNATURE');
        drain_mail();
      }catch(e){throw make_guest_error(e);}
      return {value:String(value),stdout:stdout_chunks.join(''),actors:actors.size};
    },
    // Only the supervisor may install a host-owned slot. Guest Wasm has no
    // route token, tenant generation, or authority to bind new routes.
    bind_route(slot){
      if(!Number.isSafeInteger(slot) || slot<1 || slot>16)throw new Error('E_ROUTE_SLOT');
      remote_slots.add(slot);
    },
    take_remote_sends(){
      const messages=outbound.splice(0,outbound.length);
      return messages;
    },
    async on_route({actor_id,wire_type,buffer}) {
      if(executions!==1)throw new Error('E_GUEST_NOT_READY');
      if(wire_type!=='i64' || !(buffer instanceof ArrayBuffer) || buffer.byteLength!==8)
        throw new Error('E_ROUTE_WIRE');
      const actor=actors.get(actor_id);
      if(!actor || !actor.instance)throw new Error('E_ACTOR_REF');
      const payload=new DataView(buffer).getBigInt64(0,true);
      stdout_chunks=[];stdout_bytes=0;
      try {
        active_guest=actor.instance;
        active_actor=actor;
        actor.instance.exports.actor_receive(actor.type,payload,++actor.sequence);
        active_guest=main;
        active_actor=null;
        drain_mail();
      }catch(e){throw make_guest_error(e)}
      return {value:'delivered',stdout:stdout_chunks.join(''),actors:actors.size};
    },
    async dispose(){actors.clear(); queued.length=0;}
  };
}
