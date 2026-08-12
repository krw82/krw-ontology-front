import { describe, expect, it, vi } from "vitest";

vi.mock("@krw-agent/host", () => ({
  loadPinnedReleaseArtifact: vi.fn(),
}));

import { loadPinnedReleaseArtifact } from "@krw-agent/host";
import { checkAgentV1Readiness, getResearchAdmissionMode } from "./readiness";

describe("research admission", () => {
  it("defaults production to closed and local development to open", () => {
    expect(getResearchAdmissionMode({ KRW_RUNTIME_ENVIRONMENT: "prod" })).toBe("closed");
    expect(getResearchAdmissionMode({ KRW_RUNTIME_ENVIRONMENT: "dev" })).toBe("open");
  });

  it("accepts only the explicit bounded states", () => {
    expect(getResearchAdmissionMode({ KRW_AGENT_ADMISSION_MODE: "drain" })).toBe("drain");
    expect(getResearchAdmissionMode({ KRW_AGENT_ADMISSION_MODE: "closed" })).toBe("closed");
    expect(getResearchAdmissionMode({ KRW_AGENT_ADMISSION_MODE: "unexpected" })).toBe("open");
  });

  it("recovers a missing provider pin from the sealed descriptor in development", async () => {
    vi.mocked(loadPinnedReleaseArtifact).mockResolvedValue({
      descriptor: {
        entries: [{ execution: { resolved_model: "glm-5.2" } }],
      },
      release_set_hash: "sha256:release",
    } as never);
    const result = await checkAgentV1Readiness({
      KRW_RUNTIME_ENVIRONMENT: "dev",
      KRW_AGENT_RELEASE_DESCRIPTOR_PATH: "/tmp/public-release.json",
      KRW_AGENT_RELEASE_ARTIFACT_HASH: "sha256:artifact",
      KRW_AGENT_RELEASE_SET_HASH: "sha256:release",
      KRW_AGENT_TENANT_ID: "local_tenant",
      AGENT_V1_DATABASE_URL: "postgresql://local",
    });
    expect(result.provider).toBe("glm");
    expect(result.model).toBe("glm-5.2");
    expect(result.descriptor_valid).toBe(true);
  });

  it("does not infer a missing provider pin in production", async () => {
    vi.mocked(loadPinnedReleaseArtifact).mockResolvedValue({
      descriptor: {
        entries: [{ execution: { resolved_model: "glm-5.2" } }],
      },
      release_set_hash: "sha256:release",
    } as never);
    const result = await checkAgentV1Readiness({
      NODE_ENV: "production",
      KRW_RUNTIME_ENVIRONMENT: "prod",
      KRW_AGENT_RELEASE_DESCRIPTOR_PATH: "/tmp/public-release.json",
      KRW_AGENT_RELEASE_ARTIFACT_HASH: "sha256:artifact",
      KRW_AGENT_RELEASE_SET_HASH: "sha256:release",
      KRW_AGENT_TENANT_ID: "prod_tenant",
      AGENT_V1_DATABASE_URL: "postgresql://prod",
    });
    expect(result.provider).toBeNull();
    expect(result.ok).toBe(false);
  });

  it("does not replace an explicitly invalid provider with descriptor inference", async () => {
    vi.mocked(loadPinnedReleaseArtifact).mockResolvedValue({
      descriptor: {
        entries: [{ execution: { resolved_model: "glm-5.2" } }],
      },
      release_set_hash: "sha256:release",
    } as never);
    const result = await checkAgentV1Readiness({
      KRW_RUNTIME_ENVIRONMENT: "dev",
      KRW_AGENT_PROVIDER: "deepseekk",
      KRW_AGENT_RELEASE_DESCRIPTOR_PATH: "/tmp/public-release.json",
      KRW_AGENT_RELEASE_ARTIFACT_HASH: "sha256:artifact",
      KRW_AGENT_RELEASE_SET_HASH: "sha256:release",
      KRW_AGENT_TENANT_ID: "local_tenant",
      AGENT_V1_DATABASE_URL: "postgresql://local",
    });
    expect(result.provider).toBeNull();
    expect(result.model).toBeNull();
    expect(result.descriptor_valid).toBe(false);
    expect(result.ok).toBe(false);
  });
});
