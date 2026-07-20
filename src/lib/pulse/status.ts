import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPulseFeedRevision } from "@/lib/pulse/revision";
import type { PulseFeedStatusResponse } from "@/types/api-contracts";
import type { Database } from "@/types/database";

interface PulseStatusOptions {
  supabase: SupabaseClient<Database>;
  userId: string;
  revision: string | null;
  now?: Date;
}

/**
 * V3 status is intentionally a revision comparison only. In particular it
 * must not scan filing candidates, chat sessions, or a user's whole feed.
 */
export async function getPulseFeedStatus({
  supabase,
  userId,
  revision,
  now = new Date(),
}: PulseStatusOptions): Promise<PulseFeedStatusResponse> {
  const current = await getPulseFeedRevision(supabase, userId, now);
  return {
    generated_at: now.toISOString(),
    revision: current.value,
    changed: !revision || revision !== current.value,
  };
}

export function summarizePulseFeedStatus(input: {
  now: Date;
  revision: string;
  knownRevision: string | null;
}): PulseFeedStatusResponse {
  return {
    generated_at: input.now.toISOString(),
    revision: input.revision,
    changed: !input.knownRevision || input.knownRevision !== input.revision,
  };
}
