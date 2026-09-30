import { AgentRuntime, ChannelType, EventType, type Plugin } from "@elizaos/core";
import pluginAnthropic from "@elizaos/plugin-anthropic";
import pluginOpenai from "@elizaos/plugin-openai";
import pluginOpenrouter from "@elizaos/plugin-openrouter";
import pluginSql from "@elizaos/plugin-sql";

import { recordModelUsage } from "@/lib/model-usage";

import { noahCharacter } from "./character";
import { getProviderStatuses } from "./model-providers";
import { lessonsProvider } from "./providers/lessons-provider";
import { buildElizaSettings } from "./settings";

// No auth/session system exists yet: one fixed room/entity pair means every
// dashboard visitor shares a single concierge conversation, matching the
// old mock chat's behavior. UUID-shaped because plugin-sql's Postgres
// tables use real uuid columns for these.
export const DASHBOARD_ROOM_ID = "5b1e2b0a-2222-4a11-9d00-000000000001";
export const DASHBOARD_ENTITY_ID = "5b1e2b0a-1111-4a11-9d00-000000000002";
export const DASHBOARD_WORLD_ID = "5b1e2b0a-3333-4a11-9d00-000000000003";

const g = globalThis as unknown as {
  __elizaRuntime?: Promise<AgentRuntime>;
};

/**
 * Lazy singleton, mirroring lib/db/index.ts's getDb(). Stores the *promise*
 * (not the resolved runtime) so concurrent first requests during Next dev
 * hot-reload dedupe onto the same in-flight construction instead of racing
 * two AgentRuntime instances.
 */
// Same [id]: pluginModule map the character/plugins array below indexes into.
const PLUGIN_BY_PROVIDER: Record<string, Plugin> = {
  openrouter: pluginOpenrouter,
  anthropic: pluginAnthropic,
  openai: pluginOpenai,
};

export function getElizaRuntime(): Promise<AgentRuntime> | null {
  const providerStatuses = getProviderStatuses();
  if (!providerStatuses.some((p) => p.enabled)) {
    return null;
  }
  if (!g.__elizaRuntime) {
    g.__elizaRuntime = (async () => {
      // Real, env-driven connection: only enabled providers' plugins are
      // ever constructed — "connected" in the dashboard's Model connections
      // panel means exactly this, not a UI toggle with no backing behavior.
      const modelPlugins = providerStatuses
        .filter((p) => p.enabled)
        .map((p) => PLUGIN_BY_PROVIDER[p.id]);

      const runtime = new AgentRuntime({
        character: noahCharacter,
        plugins: [pluginSql, ...modelPlugins],
        settings: buildElizaSettings(),
        // "useful for direct chat interfaces" per core's own doc comment —
        // the dashboard always expects a reply, never silent non-response.
        checkShouldRespond: false,
      });
      await runtime.initialize();
      runtime.registerProvider(lessonsProvider);

      // Real usage tracking for the dashboard's Model connections chart —
      // the event doesn't say which provider served the call (see
      // lib/eliza/model-providers.ts's primaryEnabledProvider), but tokens
      // and model type are real.
      runtime.registerEvent(EventType.MODEL_USED, async (payload) => {
        await recordModelUsage({
          modelType: payload.type,
          totalTokens: payload.tokens?.total ?? null,
        });
      });

      // Required before handleMessage: creates the entity/room/world/
      // participant rows handleMessage assumes already exist. Without this,
      // plugin-sql's own internal logging fails on a foreign-key violation
      // (room_id/entity_id referencing rows that were never created) and
      // the whole request throws.
      await runtime.ensureConnection({
        entityId: DASHBOARD_ENTITY_ID,
        roomId: DASHBOARD_ROOM_ID,
        worldId: DASHBOARD_WORLD_ID,
        worldName: "Noah EngineX dashboard",
        source: "web",
        type: ChannelType.API,
        name: "Dashboard operator",
      });

      console.log(
        "[eliza] registered actions:",
        runtime.actions.map((a) => a.name)
      );

      return runtime;
    })();
  }
  return g.__elizaRuntime;
}
