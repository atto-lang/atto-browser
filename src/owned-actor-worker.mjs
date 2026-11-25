/**
 * Experimental real isolated Worker running the JS Compute -> Result reference
 * handler. This is NOT an Oreslang-compiled Wasm actor or a supervisor.
 */
import {encodeMessage,decodeMessage} from "./owned-message/owned-envelope.mjs";
import {createSerialOwnedActor} from "./owned-message/serial-actor-reference.mjs";

let phase="initial",actor=null,schema=null,maxBytes=1048576,lastId=0;
let ingress=Promise.resolve(),outstanding=0,maxPending=16;
const report=(id,ok,bytes)=>{
 try{self.postMessage({kind:"oreslang-owned-actor-reply-v1",id,ok,...(ok?{bytes}:{code:"delivery-rejected"})})}
 catch{/* host termination is the final failure boundary */}
};
self.addEventListener("message",async event=>{
 const data=event.data;
 if(data?.kind==="oreslang-owned-actor-init-v1"){
  if(phase!=="initial")return;
  phase="initializing";
  try{
   schema=data.schema;maxBytes=data.maxBytes;maxPending=data.maxPending;
   // Admit the *exact* typed Compute/Result schema before reporting ready.
   await encodeMessage(schema,{variant:"Compute",fields:{text:"",n:0n}},{maxBytes});
   await encodeMessage(schema,{variant:"Result",fields:{text:"",n:0n}},{maxBytes});
   actor=createSerialOwnedActor({
    schema,maxPending:data.maxPending,maxBytes,replyVariants:{Compute:["Result"]},
    receive:async(mail,self)=>{
     if(mail.variant!=="Compute")throw Error("unadmitted actor message");
     await self.respond({variant:"Result",fields:{
      text:mail.fields.text,n:mail.fields.n+1n
     }});
     self.done();
    }
   });
   phase="ready";
   self.postMessage({kind:"oreslang-owned-actor-ready-v1",ok:true});
  }catch{
   phase="failed";
   self.postMessage({kind:"oreslang-owned-actor-ready-v1",ok:false});
  }
  return;
 }
 if(data?.kind!=="oreslang-owned-actor-request-v1"||phase!=="ready")return;
 const id=data.id;
 if(!Number.isSafeInteger(id)||id<1||id<=lastId)return;
 lastId=id;
 if(outstanding>=maxPending){report(id,false);return;}
 outstanding++;
 // Worker message events arrive in sequence, but asynchronous WebCrypto
 // decode can otherwise reorder actor admissions. Keep an explicit FIFO
 // chain, bounded independently of the reference actor's own mailbox.
 ingress=ingress.then(async()=>{
  try{
   if(data.maxBytes!==maxBytes)throw Error("resource policy mismatch");
   const mail=await decodeMessage(schema,data.bytes,{maxBytes});
   const reply=await actor.request(mail);
   const bytes=await encodeMessage(schema,reply,{maxBytes});
   report(id,true,bytes);
  }catch{
   report(id,false);
  }finally{outstanding--;}
 });
});
