export const PROTOCOL = 'atto.browser.tenants.v1';
export const MAX_TENANTS = 16;
export const MAX_ACTORS_PER_TENANT = 64;
export const MAX_MAIL_PER_ACTOR = 1024;
export const MAX_STDOUT_BYTES = 1 << 20;

export function assert_tenant_id(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new Error('E_TENANT_ID');
  return id;
}
export function assert_entry_url(entry, origin) {
  if (typeof entry !== 'string' || entry.length > 2048) throw new Error('E_ENTRY_URL');
  const url = new URL(entry, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error('E_ENTRY_ORIGIN');
  return url.href;
}
export function assert_request(message) {
  if (!message || Object.getPrototypeOf(message) !== Object.prototype ||
      message.protocol !== PROTOCOL || !Number.isSafeInteger(message.id) || message.id < 1) throw new Error('E_PROTOCOL');
  if (!['spawn', 'call', 'stop', 'list'].includes(message.op)) throw new Error('E_OPERATION');
  if (message.op !== 'list') assert_tenant_id(message.tenant);
  return message;
}
export function error_text(e) { return e instanceof Error ? e.message : String(e); }
