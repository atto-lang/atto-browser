// Snapshot of atto-source.js strict actor-subset output for remote-actor-receiver.atto.
// Generated JS is trusted same-origin code; Worker is not an untrusted-JS sandbox.
const MAX=9223372036854775807n,MIN=-9223372036854775808n;
function checked(n){if(n<MIN||n>MAX)throw new Error('E_GUEST_PANIC_1');return n;}
export async function create_tenant({tenant,generation}){
 let initialized=false;
 let total=0n;
 return {
  async on_message(){
   if(initialized)throw new Error('E_MAIN_ALREADY_CALLED');
   initialized=true;
   return {value:'0',stdout:'',actors:1};
  },
  async on_route({actor_id,wire_type,buffer}){
   if(!initialized)throw new Error('E_GUEST_NOT_READY');
   if(actor_id!==1)throw new Error('E_ACTOR_REF');
   if(wire_type!=='i64'||!(buffer instanceof ArrayBuffer)||buffer.byteLength!==8)
    throw new Error('E_ROUTE_WIRE');
   try {
    const next=checked(total+new DataView(buffer).getBigInt64(0,true));
    total=next;
    return {value:'delivered',stdout:String(total)+'\n',actors:1};
   } catch(error) {
    if(error?.message==='E_GUEST_PANIC_1')
     error.actor_failure={kind:'panic',actor_id:1,parent_id:0,actor_type:'Counter',reason:'E_GUEST_PANIC_1'};
    throw error;
   }
  }
 };
}
