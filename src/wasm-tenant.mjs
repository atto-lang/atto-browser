import { MAX_ACTORS_PER_TENANT, MAX_MAIL_PER_ACTOR, MAX_STDOUT_BYTES } from './protocol.mjs';
import { fixed_memory_pages, actor_names, MAX_WASM_BYTES } from './wasm-profile.mjs';

async function read_bounded(response) {
  const declared=Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared>MAX_WASM_BYTES) throw new Error('E_WASM_SIZE');
  if (response.body?.getReader) {
    const reader=response.body.getReader(), chunks=[];
    let total=0;
    try {
      for (;;) {
        const {done,value}=await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new Error('E_WASM_STREAM');
        total+=value.byteLength;
        if (total>MAX_WASM_BYTES) throw new Error('E_WASM_SIZE');
        chunks.push(value);
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
  const response=await fetch(entry,{credentials:'omit'});
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

  function instantiate() {
    let instance;
    const append=text=>{
      const bytes=text_encoder.encode(text).length;
      if (stdout_bytes+bytes>MAX_STDOUT_BYTES) throw new Error('E_STDOUT_LIMIT');
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
        const actor={type,instance:null,mailbox:[],sequence:0n};
        actors.set(id,actor);
        try {
          actor.instance=instantiate();
          actor.instance.exports.actor_init(type);
          return id;
        } catch (e) { actors.delete(id); throw e; }
      },
      actor_send:(ref,value)=>{
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
  return {
    async on_message(){
      if(executions++!==0)throw new Error('E_MAIN_ALREADY_CALLED');
      stdout_chunks=[]; stdout_bytes=0;
      let value;
      try {
        value=main.exports.main();
        if (typeof value!=='bigint') throw new Error('E_GUEST_SIGNATURE');
        let cursor=0, steps=0;
        while(cursor<queued.length) {
          if(++steps>65536) throw new Error('E_DISPATCH_BUDGET');
          const id=queued[cursor++],actor=actors.get(id);
          if(!actor || !actor.instance)throw new Error('E_ACTOR_REF');
          const payload=actor.mailbox.shift();
          actor.instance.exports.actor_receive(actor.type,payload,++actor.sequence);
          // Release processed admission slots before more messages arrive.
          // Keep a separate total-step limit to stop self-mailbox loops.
          if(cursor>=1024) { queued.splice(0,cursor);cursor=0; }
        }
        queued.length=0;
      }catch(e){
        const code=main.exports.panic_code?.value;
        throw new Error(code ? `E_GUEST_PANIC_${code}` : 'E_GUEST_TRAP: '+String(e?.message||e));
      }
      return {value:String(value),stdout:stdout_chunks.join(''),actors:actors.size};
    },
    async dispose(){actors.clear(); queued.length=0;}
  };
}
