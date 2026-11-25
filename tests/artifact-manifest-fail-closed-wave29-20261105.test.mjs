import test from 'node:test';
import assert from 'node:assert/strict';
import {loadVerifiedCoreGuest} from '../src/artifact.mjs';

const sha = '0'.repeat(64);
const manifest = () => ({
  schemaVersion: 1,
  artifactType: 'oreslang.core-wasm.i64-v1',
  target: 'wasm32',
  environment: 'browser',
  backend: 'wasm',
  entry: 'main',
  wasmSha256: sha,
  wasmBytes: 8,
  requiredCapabilities: [],
  imports: [],
  memory: {maximumPages: 1},
  producer: {compilerSha256: sha, sourceSha256: sha, llvmIrSha256: sha},
});

// Deliberately invalid Wasm: exact manifest denial must precede byte inspection
// or instantiation, and cannot be confused with guest execution evidence.
const notWasm = new Uint8Array([1, 2, 3]);

test('rejects an invalid export identifier before Wasm parsing', async () => {
  const m = manifest();
  m.entry = '../main';
  await assert.rejects(loadVerifiedCoreGuest(notWasm, m), /invalid core Wasm entry export/);
});

test('rejects imports and forged producer SHA before Wasm parsing', async () => {
  const imported = manifest();
  imported.imports = ['env'];
  await assert.rejects(loadVerifiedCoreGuest(notWasm, imported), /imports or capabilities/);

  const forged = manifest();
  forged.producer.compilerSha256 = sha.toUpperCase().replace(/0/g, 'A');
  await assert.rejects(loadVerifiedCoreGuest(notWasm, forged), /invalid producer provenance/);
});

test('rejects accessor authority without reading getter or rounding negative zero', async () => {
  let hits = 0;
  const getter = manifest();
  Object.defineProperty(getter, 'entry', {enumerable: true, get() { hits++; return 'main'; }});
  await assert.rejects(loadVerifiedCoreGuest(notWasm, getter), /invalid browser core Wasm manifest serialization/);
  assert.equal(hits, 0);

  const negativeZero = manifest();
  negativeZero.memory.maximumPages = -0;
  await assert.rejects(loadVerifiedCoreGuest(notWasm, negativeZero), /invalid browser core Wasm manifest serialization/);
});
