import { MAX_ACTORS_PER_TENANT, MAX_MAIL_PER_ACTOR, MAX_STDOUT_BYTES } from './protocol.mjs';

// A tenant has its own Worker. Actors inside it have distinct Wasm instances,
// linear memories and globals; this is not one browser thread per actor.
export async function open_wasm_tenant(entry) {
  const response=await fetch(entry,{credentials:'omit'});
  if(!response.ok)throw new Error('E_WASM_FETCH');
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength > 4 * 1024 * 1024)throw new Error('E_WASM_SIZE');
  if(!WebAssembly.validate(buffer))throw new Error('E_WASM_INVALID');
  const module=await WebAssembly.compile(buffer);
  const allowed=new Set(['print_i64','print_bool','print_str','print_newline','print_f64','actor_spawn','actor_send']);
  for(const imp of WebAssembly.Module.imports(module)) {
    if(imp.module !== 'atto' || !allowed.has(imp.name) || imp.kind !== 'function') throw new Error('E_WASM_IMPORT');
  }
  const exported=new Set(WebAssembly.Module.exports(module).map(x=>x.name));
  if(!exported.has('main'))throw new Error('E_WASM_MAIN');
  const actor_enabled=exported.has('actor_init') && exported.has('actor_receive');
  if(exported.has('actor_init')!==exported.has('actor_receive'))throw new Error('E_WASM_ACTOR_ABI');
  const actors=new Map();let next_actor_id=1;
  let stdout='';
  const queued=[];
  const text_decoder=new TextDecoder('utf-8',{fatal:true});
  let executions=0;

  function instantiate() {
    let instance;
    const append=text=>{
      if(stdout.length+text.length > MAX_STDOUT_BYTES)throw new Error('E_STDOUT_LIMIT');
      stdout+=text;
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
        if(actors.size>=MAX_ACTORS_PER_TENANT)throw new Error('E_ACTOR_LIMIT');
        const actor_instance=instantiate();
        const id=next_actor_id++;
        actor_instance.exports.actor_init(type);
        actors.set(id,{type,instance:actor_instance,mailbox:[],sequence:0n});
        return id;
      },
      actor_send:(ref,value)=>{
        const actor=actors.get(ref);
        if(!actor)throw new Error('E_ACTOR_REF');
        if(actor.mailbox.length >= MAX_MAIL_PER_ACTOR)throw new Error('E_MAILBOX_FULL');
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
      stdout='';
      let value;
      try {
        value=main.exports.main();
        let count=0;
        while(queued.length){
          if(++count>65536)throw new Error('E_DISPATCH_BUDGET');
          const id=queued.shift(),actor=actors.get(id);
          if(!actor)throw new Error('E_ACTOR_REF');
          const payload=actor.mailbox.shift();
          actor.instance.exports.actor_receive(actor.type,payload,++actor.sequence);
        }
      }catch(e){
        const code=main.exports.panic_code?.value;
        throw new Error(code ? `E_GUEST_PANIC_${code}` : 'E_GUEST_TRAP: '+String(e?.message||e));
      }
      return {value:String(value),stdout,actors:actors.size};
    },
    async dispose(){actors.clear(); queued.length=0;}
  };
}
