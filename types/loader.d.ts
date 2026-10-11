export interface OreslangBrowserOptions {
  requestedCapabilities?: Array<"clock">;
  grantedCapabilities?: Array<"clock">;
  host?: { clockMs?: () => number };
  /** Defaults to true; false is for testing foreign bare wasm modules only. */
  requireRuntimeABI?: boolean;
}
export interface OreslangBrowserResult {
  readonly instance: WebAssembly.Instance;
  readonly module: WebAssembly.Module;
  readonly hostClockCalls: number;
}
export declare function loadOreslangWasm(
  bytes: ArrayBuffer | ArrayBufferView | WebAssembly.Module,
  options?: OreslangBrowserOptions
): Promise<OreslangBrowserResult>;
