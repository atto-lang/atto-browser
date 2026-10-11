export interface OreslangBrowserOptions {
  requestedCapabilities?: Array<"clock">;
  grantedCapabilities?: Array<"clock">;
  host?: { clockMs?: () => number };
  /** Defaults to true; false is for testing foreign bare wasm modules only. */
  requireRuntimeABI?: boolean;
  /** Byte-size limit (default 1 MiB). */
  maxModuleBytes?: number;
  /** Required explicit maximum linear-memory pages (default 32 x 64 KiB). */
  maxMemoryPages?: number;
}
export interface OreslangBrowserResult {
  readonly instance: WebAssembly.Instance;
  readonly module: WebAssembly.Module;
  readonly hostClockCalls: number;
}
export declare function loadOreslangWasm(
  bytes: ArrayBuffer | ArrayBufferView,
  options?: OreslangBrowserOptions
): Promise<OreslangBrowserResult>;
