// Atto browser transport v1: application-authorized worker-to-worker route.
// A route is bound to both tenant incarnations and one receiver actor/endpoint.
// No route capability or tenant control capability is sent to a tenant worker.
export const MAX_ROUTES=64;
export const MAX_ROUTE_BYTES=64*1024;
export const MAX_ROUTE_INFLIGHT=16;

export function assert_route_id(id) {
  if (!Number.isSafeInteger(id) || id<1) throw new Error('E_ROUTE_ID');
  return id;
}
export function assert_route_capability(value) {
  if (typeof value!=='string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('E_ROUTE_CAPABILITY');
  return value;
}
export function assert_route_buffer(buffer,wire_type) {
  if (!(buffer instanceof ArrayBuffer))
    throw new Error('E_ROUTE_BUFFER');
  if (!buffer.byteLength || buffer.byteLength>MAX_ROUTE_BYTES)
    throw new Error('E_ROUTE_SIZE');
  if (wire_type==='i64' && buffer.byteLength!==8) throw new Error('E_ROUTE_WIRE');
  return buffer;
}
export function assert_route_target(target) {
  if (!target || typeof target!=='object' || Array.isArray(target) ||
      typeof target.tenant!=='string' ||
      !Number.isSafeInteger(target.generation) || target.generation<1 ||
      typeof target.capability!=='string') throw new Error('E_ROUTE_TARGET');
  return target;
}
