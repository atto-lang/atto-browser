import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActorMessageV2Contract, MESSAGEPACK_V2_LIMITS} from '../src/messagepack-v2.mjs';

const accept = descriptor => validateActorMessageV2Contract({schemaId:'actor.event',descriptor});

test('well-formed scalar and nested MessagePack v2 descriptors admit at INIT', () => {
  for (const desc of ['B','I','F','S','T[I,S]','A[I]','L[S]','FA[B,F]','T[A[I],L[S]]']) {
    assert.equal(accept(desc), true, desc);
  }
});

test('malformed shape syntax never receives an affirmative contract', () => {
  for (const desc of ['', 'X', 'Igarbage', 'T[I', 'T[I,]', 'A[]', 'A[I,S]', 'T[I,,S]', 'I,S']) {
    assert.throws(() => accept(desc), TypeError, desc);
  }
});

test('schema identity and bounded grammar are checked synchronously', () => {
  for (const schemaId of ['', '\n', 'é', 'a'.repeat(257)]) {
    assert.throws(() => validateActorMessageV2Contract({schemaId,descriptor:'I'}), TypeError);
  }
  assert.equal(MESSAGEPACK_V2_LIMITS.maxDepth, 64);
  const tooDeep = 'A['.repeat(66) + 'I' + ']'.repeat(66);
  assert.throws(() => accept(tooDeep), /complexity/);
  assert.throws(() => accept('A['.repeat(2000) + 'I' + ']'.repeat(2000)), TypeError);
});