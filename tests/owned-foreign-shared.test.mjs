import test from "node:test";
import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {encodeMessage,decodeMessage} from "../src/owned-message/owned-envelope.mjs";
test("owned-envelope decoding rejects shared buffers from another realm",async()=>{
 const schema={schemaVersion:1,ownership:"copy",variants:[{id:1,name:"Message",fields:[{name:"flag",type:"bool"}]}]};
 const bytes=await encodeMessage(schema,{variant:"Message",fields:{flag:true}});
 const foreign=runInNewContext("new Uint8Array(new SharedArrayBuffer("+bytes.length+"))");
 foreign.set(bytes);
 assert.equal(foreign.buffer instanceof SharedArrayBuffer,false);
 await assert.rejects(decodeMessage(schema,foreign),/shared memory not admitted/);
});
