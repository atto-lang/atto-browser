import test from "node:test";
import assert from "node:assert/strict";
import {snapshotCoreManifest} from "../src/core-manifest-snapshot.mjs";

test("malformed UTF-16 cannot be admitted as manifest keys or data strings",()=>{
 for(const bad of ["bad\ud800","bad\udc00","\ud800x","\ud800\ud800","\udc00\udc00"]){
   for(const input of [
    {label:bad},
    {[bad]:"valid"},
    {nested:[{label:bad}]},
    {nested:[{[bad]:true}]}
   ])assert.throws(()=>snapshotCoreManifest(input),
     /invalid browser core Wasm manifest serialization/);
 }
});
test("well-formed surrogate pairs and visible Unicode keys survive without normalizing identity",()=>{
 const input={"clé🚀":"ready🚀",nested:["🚀","é","e\u0301"]};
 const snapshot=snapshotCoreManifest(input);
 assert.deepEqual(snapshot,input);
 assert.equal(Object.isFrozen(snapshot),true);
 assert.equal(Object.isFrozen(snapshot.nested),true);
 assert.equal(snapshot.nested[2],"e\u0301");
});
