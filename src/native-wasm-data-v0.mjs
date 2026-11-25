/**
 * Browser/Node host adapter for the native/WASM DATA tuple v0 wire.
 *
 * Exact canonical MessagePack v2 bytes, schema IDs and shape digest match
 * oreslang-source.wasm/src/native-wasm-wire-v0.mjs. Host-only: this is not
 * ActorRef capability transport, CONTROL, guest source lowering, or an
 * authenticated remote protocol. WebCrypto is required by the shared codec.
 */
import {encodeActorMessageV2, decodeActorMessageV2} from './messagepack-v2.mjs';

export const NATIVE_WASM_REQUEST_SCHEMA = 'oreslang.native_wasm.data.request.v0';
export const NATIVE_WASM_RESPONSE_SCHEMA = 'oreslang.native_wasm.data.response.v0';
export const NATIVE_WASM_ACK_SCHEMA = 'oreslang.native_wasm.data.ack.v0';
export const NATIVE_WASM_DATA_MAX_BYTES = 4096;

const SHAPE = 'T[I,I]';
const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;
const allowed = new Set([
  NATIVE_WASM_REQUEST_SCHEMA, NATIVE_WASM_RESPONSE_SCHEMA, NATIVE_WASM_ACK_SCHEMA
]);

function requireSchema(value) {
  if (typeof value !== 'string' || !allowed.has(value))
    throw new TypeError('unregistered native/WASM DATA schema');
}
function requireI64(value, name) {
  if (typeof value !== 'bigint' || value < MIN || value > MAX)
    throw new TypeError(name + ' must be signed i64');
}

/** Serialize a positive DATA ticket and signed i64 payload, never CONTROL. */
export async function encodeNativeWasmDataV0(schema, ticket, value) {
  requireSchema(schema);
  requireI64(ticket, 'DATA ticket');
  requireI64(value, 'DATA payload');
  if (ticket <= 0n) throw new RangeError('DATA ticket must be positive');
  return encodeActorMessageV2({
    schemaId: schema, descriptor: SHAPE, value: [ticket, value],
    maxBytes: NATIVE_WASM_DATA_MAX_BYTES
  });
}

/** Decode the bounded canonical frame to a frozen host-owned scalar pair. */
export async function decodeNativeWasmDataV0(schema, bytes) {
  requireSchema(schema);
  const tuple = await decodeActorMessageV2({
    schemaId: schema, descriptor: SHAPE, bytes,
    maxBytes: NATIVE_WASM_DATA_MAX_BYTES
  });
  if (!Array.isArray(tuple) || tuple.length !== 2 ||
      typeof tuple[0] !== 'bigint' || tuple[0] <= 0n ||
      typeof tuple[1] !== 'bigint')
    throw new TypeError('invalid native/WASM DATA tuple');
  return Object.freeze({ticket: tuple[0], value: tuple[1]});
}
