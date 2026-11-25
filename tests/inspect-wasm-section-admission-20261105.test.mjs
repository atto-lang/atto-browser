import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWasmBytes} from '../src/inspect.mjs';

const header=[0,97,115,109,1,0,0,0];
const section=(id,body)=>Uint8Array.from([...header,id,body.length,...body]);
const fixed=(initial=1,maximum=1)=>section(5,[1,1,initial,maximum]);

test('fixed bounded memory is admitted as an owned snapshot at exact page limit',()=>{
 const raw=fixed(1,2),result=inspectWasmBytes(raw,{maxMemoryPages:2});
 assert.equal(result.memoryCount,1);
 assert.equal(result.hasMemoryMaximum,true);
 assert.equal(result.memoryInitial,1);
 assert.equal(result.memoryMaximum,2);
 raw[0]=255;
 assert.equal(result.bytes[0],0);
 assert.notEqual(result.bytes.buffer,raw.buffer);
});

test('start section, tables, shared memory and page budget violations are denied before execution',()=>{
 assert.throws(()=>inspectWasmBytes(section(8,[0])),/start section is forbidden/);
 assert.throws(()=>inspectWasmBytes(section(4,[0])),/table section is not yet admitted/);
 assert.throws(()=>inspectWasmBytes(section(5,[1,3,1,1])),/shared\/memory64 forbidden/);
 assert.throws(()=>inspectWasmBytes(fixed(2,1)),/linear memory exceeds host budget/);
 assert.throws(()=>inspectWasmBytes(fixed(1,33)),/linear memory exceeds host budget/);
});

test('truncated oversized and malformed memory-section records fail closed',()=>{
 assert.throws(()=>inspectWasmBytes(Uint8Array.from([...header,5,99,1])),/section extends beyond module/);
 assert.throws(()=>inspectWasmBytes(section(5,[1,1,1])),/truncated unsigned integer/);
 assert.throws(()=>inspectWasmBytes(section(5,[2])),/more than one memory/);
 assert.throws(()=>inspectWasmBytes(section(5,[1,1,1,1,0])),/malformed memory section/);
});
