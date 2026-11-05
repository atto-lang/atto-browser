/** Capture only bounded JSON-like manifest values before any async Wasm work.
 * Never call JSON.stringify on an unbounded caller-owned object: a huge
 * nested tree, getters or toJSON hooks can run arbitrary code or exhaust
 * memory before admission. This snapshot accepts data descriptors only.
 */
export function snapshotCoreManifest(original) {
  const invalid=()=>{throw new Error('invalid browser core Wasm manifest serialization')};
  const seen=new WeakSet();
  const encoder=new TextEncoder();
  const wellFormed=value=>{
    for(let i=0;i<value.length;i++){
      const ch=value.charCodeAt(i);
      if(ch>=0xd800&&ch<=0xdbff){
        const next=value.charCodeAt(++i);
        if(!(next>=0xdc00&&next<=0xdfff))invalid();
      }else if(ch>=0xdc00&&ch<=0xdfff)invalid();
    }
  };
  let nodes=0,textBytes=0;
  const walk=(value,depth)=>{
    if(++nodes>128||depth>5)invalid();
    if(typeof value==='string'){
      if(value.length>4096)invalid(); // Avoid unbounded encoding work.
      wellFormed(value);
      textBytes+=encoder.encode(value).length;
      if(textBytes>4096)invalid();
      return value;
    }
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='number'&&Number.isFinite(value)) {
      // JSON.stringify would silently normalize -0 to 0 and round unsafe
      // integers; reject noncanonical numeric authority before snapshotting.
      if(Object.is(value,-0)||(Number.isInteger(value)&&!Number.isSafeInteger(value)))invalid();
      return value;
    }
    if(typeof value!=='object'||seen.has(value))invalid();
    seen.add(value);
    const proto=Object.getPrototypeOf(value);
    const isArray=Array.isArray(value);
    if(isArray){
      const lengthDescriptor=Object.getOwnPropertyDescriptor(value,'length');
      const length=lengthDescriptor?.value;
      if(proto!==Array.prototype||!Number.isSafeInteger(length)||length>32||length<0)invalid();
      const keys=Reflect.ownKeys(value);
      if(keys.length!==length+1)invalid();
      const copy=[];
      for(let i=0;i<length;i++){
        const entry=Object.getOwnPropertyDescriptor(value,String(i));
        if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable)invalid();
        copy.push(walk(entry.value,depth+1));
      }
      return Object.freeze(copy);
    }
    if(proto!==Object.prototype&&proto!==null)invalid();
    const keys=Reflect.ownKeys(value);
    if(keys.length>32)invalid();
    const copy=Object.create(null);
    for(const key of keys){
      // A downstream JSON consumer might Object.assign parsed manifest keys.
      // Refuse prototype-magic names even though this local snapshot is null-proto.
      if(typeof key!=='string'||key.length>128||
         /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u.test(key)||
         key==='__proto__'||key==='prototype'||key==='constructor')invalid();
      wellFormed(key);
      textBytes+=encoder.encode(key).length;
      if(textBytes>4096)invalid();
      const entry=Object.getOwnPropertyDescriptor(value,key);
      if(!entry||!Object.hasOwn(entry,'value')||!entry.enumerable)invalid();
      copy[key]=walk(entry.value,depth+1);
    }
    return Object.freeze(copy);
  };
  return walk(original,0);
}
