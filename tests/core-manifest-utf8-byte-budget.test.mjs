import test from "node:test";
import assert from "node:assert/strict";
import {snapshotCoreManifest} from "../src/core-manifest-snapshot.mjs";

test("manifest string budget counts UTF-8 bytes, not UTF-16 code units",()=>{
 const ok=snapshotCoreManifest({x:"🚀".repeat(1023)});
 assert.equal(ok.x,"🚀".repeat(1023));
 assert.equal(Buffer.byteLength("x"+ok.x,"utf8"),4093);
 assert.throws(()=>snapshotCoreManifest({x:"🚀".repeat(1024)}),
   /invalid browser core Wasm manifest serialization/);
 assert.throws(()=>snapshotCoreManifest({x:"é".repeat(2048)}),
   /invalid browser core Wasm manifest serialization/);
});

test("manifest cumulative UTF-8 budget accounts for key bytes and values before copying",()=>{
 const exact=snapshotCoreManifest({x:"a".repeat(4095)});
 assert.equal(exact.x.length,4095);
 assert.throws(()=>snapshotCoreManifest({x:"a".repeat(4096)}),
   /invalid browser core Wasm manifest serialization/);
 const mixed=snapshotCoreManifest({é:"a".repeat(4094)});
 assert.equal(mixed.é.length,4094); // two-byte key
 assert.throws(()=>snapshotCoreManifest({é:"a".repeat(4095)}),
   /invalid browser core Wasm manifest serialization/);
});
