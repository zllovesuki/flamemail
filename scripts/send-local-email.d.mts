export interface DetectLocalEmailEndpointOptions {
  candidatePorts?: number[];
  fetchImpl?: typeof fetch;
  host?: string;
  timeoutMs?: number;
}

export interface ResolveEndpointOptions {
  dryRun: boolean;
  endpoint?: string;
}

export interface ResolveEndpointDependencies {
  detectEndpoint?: () => Promise<string>;
}

export function detectLocalEmailEndpoint(options?: DetectLocalEmailEndpointOptions): Promise<string>;

export function resolveEndpoint(
  options: ResolveEndpointOptions,
  dependencies?: ResolveEndpointDependencies,
): Promise<string | null>;
