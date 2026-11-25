import { TenantSupervisor } from './supervisor-core.mjs';
const supervisor = new TenantSupervisor({
  create_worker: () => new Worker(new URL('./tenant.worker.mjs', import.meta.url), {type:'module'}),
  origin: self.location.origin,
  reply: message => self.postMessage(message),
  event: message => self.postMessage(message),
});
self.onmessage = ({data}) => supervisor.handle(data);
