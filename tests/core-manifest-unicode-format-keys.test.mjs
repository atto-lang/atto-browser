import test from "node:test";
import assert from "node:assert/strict";
import {snapshotCoreManifest} from "../src/core-manifest-snapshot.mjs";

test("manifest keys containing Unicode Cf format characters are rejected at every depth",()=>{
  for(const format of ["\u200b","\u00ad","\u2060","\u061c","\ufeff","\u202e"]){
    for(const make of [
      key=>({[key]:1}),
      key=>({nested:[{[key]:1}]}),
      key=>Object.assign(Object.create(null),{[key]:1})
    ]){
      assert.throws(()=>snapshotCoreManifest(make("key"+format+"x")),
        /invalid browser core Wasm manifest serialization/);
    }
  }
});

test("visible Unicode keys and hidden-character string data stay distinguishable",()=>{
  const raw={"météo":{name:"a\u200bvalue"},list:["🚀","é"]};
  const snap=snapshotCoreManifest(raw);
  assert.equal(snap["météo"].name,"a\u200bvalue");
  assert.deepEqual(snap.list,["🚀","é"]);
  assert.equal(Object.isFrozen(snap),true);
  assert.equal(Object.isFrozen(snap["météo"]),true);
});
