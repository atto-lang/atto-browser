// Trusted same-origin JS receiver for transport ownership tests.
// This is NOT a sandbox for untrusted JavaScript.
export async function create_tenant(){
  const lengths=[];
  return {
    async on_message(){return {value:'ready',stdout:'',actors:0}},
    async on_route({wire_type,actor_id,buffer}){
      if(wire_type!=='bytes' || actor_id!==0 || !(buffer instanceof ArrayBuffer))
        throw new Error('E_ROUTE_WIRE');
      lengths.push(buffer.byteLength);
      const bytes=new Uint8Array(buffer);
      let checksum=0;
      for(const value of bytes)checksum=(checksum+value)>>>0;
      return {value:'bytes:'+buffer.byteLength,stdout:'checksum='+checksum+'\n',actors:0};
    }
  };
}
