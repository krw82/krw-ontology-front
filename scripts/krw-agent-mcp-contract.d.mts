export function resolveMcpOrigin(registryText: string): string;
export function resolveMcpSessionReuse(bindingText: string): Record<
  "krw-ontology-local" | "krw-feed-local" | "krw-filings-local",
  "run-scoped" | "attested-stateless-v1"
>;
