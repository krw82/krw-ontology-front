import { loadPinnedReleaseArtifact } from "@krw-agent/host";

export type ResearchAdmissionMode = "open" | "drain" | "closed";

const PROVIDER_MODELS = {
  glm: "glm-5.2",
  deepseek: "deepseek-v4-flash",
} as const;
type Provider = keyof typeof PROVIDER_MODELS;

export interface AgentV1Readiness {
  readonly ok: boolean;
  readonly provider: keyof typeof PROVIDER_MODELS | null;
  readonly model: string | null;
  readonly descriptor_valid: boolean;
  readonly database_configured: boolean;
  readonly tenant_configured: boolean;
  readonly admission: ResearchAdmissionMode;
  readonly release_set_hash: string | null;
}

export function getResearchAdmissionMode(
  env: Record<string, string | undefined> = process.env,
): ResearchAdmissionMode {
  const value = env.KRW_AGENT_ADMISSION_MODE?.trim().toLowerCase();
  if (value === "open" || value === "drain" || value === "closed") return value;
  return env.KRW_RUNTIME_ENVIRONMENT === "prod" || env.NODE_ENV === "production"
    ? "closed"
    : "open";
}

export async function checkAgentV1Readiness(
  env: Record<string, string | undefined> = process.env,
): Promise<AgentV1Readiness> {
  const configuredProvider = env.KRW_AGENT_PROVIDER?.trim() ?? "";
  const providerWasConfigured = configuredProvider.length > 0;
  let provider: Provider | null = configuredProvider === "glm" || configuredProvider === "deepseek"
    ? configuredProvider
    : null;
  let model = provider ? PROVIDER_MODELS[provider] : null;
  const databaseConfigured = Boolean(firstNonEmpty(
    env.AGENT_V1_DATABASE_URL,
    env.SUPABASE_DB_URL,
    env.DATABASE_URL,
    env.POSTGRES_URL,
  ));
  const tenantConfigured = Boolean(firstNonEmpty(env.KRW_AGENT_TENANT_ID));
  const descriptorPath = firstNonEmpty(env.KRW_AGENT_RELEASE_DESCRIPTOR_PATH);
  const descriptorHash = firstNonEmpty(env.KRW_AGENT_RELEASE_ARTIFACT_HASH);
  const releaseSetHash = firstNonEmpty(env.KRW_AGENT_RELEASE_SET_HASH);

  let descriptorValid = false;
  let observedReleaseSetHash: string | null = null;
  if (descriptorPath && descriptorHash && releaseSetHash) {
    try {
      const artifact = await loadPinnedReleaseArtifact({
        path: descriptorPath,
        expectedArtifactHash: descriptorHash as `sha256:${string}`,
        expectedReleaseSetHash: releaseSetHash as `sha256:${string}`,
      });
      const entries = artifact.descriptor.entries;
      // Older local stacks did not write KRW_AGENT_PROVIDER into the generated
      // env file. In development only, recover that non-secret label from the
      // already pinned descriptor instead of making the user restart the web
      // process. Production still requires the explicit provider pin.
      if (
        !provider
        && !providerWasConfigured
        && env.NODE_ENV !== "production"
        && env.KRW_RUNTIME_ENVIRONMENT !== "prod"
      ) {
        const resolvedModels = new Set(entries.map((entry) => entry.execution.resolved_model));
        const inferred = resolvedModels.size === 1
          ? (Object.entries(PROVIDER_MODELS).find(([, candidate]) => candidate === [...resolvedModels][0])?.[0] as Provider | undefined)
          : undefined;
        if (inferred) {
          provider = inferred;
          model = PROVIDER_MODELS[inferred];
        }
      }
      descriptorValid = Boolean(
        model &&
        entries.length > 0 &&
        entries.every((entry) => entry.execution.resolved_model === model),
      );
      observedReleaseSetHash = artifact.release_set_hash;
    } catch {
      descriptorValid = false;
    }
  }

  const admission = getResearchAdmissionMode(env);
  return {
    ok: Boolean(
      provider &&
      model &&
      descriptorValid &&
      databaseConfigured &&
      tenantConfigured,
    ),
    provider,
    model,
    descriptor_valid: descriptorValid,
    database_configured: databaseConfigured,
    tenant_configured: tenantConfigured,
    admission,
    release_set_hash: observedReleaseSetHash,
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}
