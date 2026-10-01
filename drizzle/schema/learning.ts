/** Post-mortem lessons, model usage and agent chat history. */
import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { userBots } from "./bots";
import { trades } from "./trading";

export const lessons = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  tradeId: uuid("trade_id").references(() => trades.id, {
    onDelete: "cascade",
  }),
  cause: text("cause").notNull(),
  lesson: text("lesson").notNull(),
  status: text("status").notNull().default("learning"), // learning | applied
  model: text("model").notNull().default("claude-opus-4-8"),
  /* A partial SniperConfig diff Claude proposes alongside the lesson text -
     null when no concrete config change applies. Applied via
     POST /api/lessons/:id/apply, which sets status to "applied". */
  suggestedConfig: jsonb("suggested_config"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * One row per real model call (from ElizaOS's MODEL_USED event) or per
 * real chat turn (modelType: "chat_turn", written directly by
 * app/api/chat/route.ts to carry an accurate round-trip latency - the
 * event payload itself doesn't include timing). Backs the "Model
 * connections" panel's real requests-per-provider chart and latency stat.
 */
export const modelRequests = pgTable("model_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(), // openrouter | anthropic | openai
  modelType: text("model_type").notNull(), // e.g. TEXT_LARGE, TEXT_EMBEDDING, or "chat_turn"
  totalTokens: numeric("total_tokens"),
  latencyMs: numeric("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * UNUSED - nothing reads or writes this table any more.
 *
 * It held the /atelier chat as one shared, durable thread per agent. That
 * was the wrong shape: /atelier has no visitor login, so a single thread
 * meant every visitor read and appended to the same transcript, each
 * person seeing the last person's questions. The chat is now ephemeral
 * per browser tab (app/api/atelier/chat is stateless; the modal holds the
 * conversation in component state and discards it on close).
 *
 * What an agent actually remembers is unaffected and lives elsewhere: its
 * post-mortems in `lessons` and its record in `trades`/`positions`. That
 * is what grounds its replies and gives it an identity.
 *
 * Kept, not dropped, so existing rows aren't destroyed by a schema push.
 * Safe to remove along with its rows once you no longer want them.
 */
export const agentChatMessages = pgTable(
  "agent_chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    botId: uuid("bot_id")
      .notNull()
      .references(() => userBots.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant
    text: text("text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("agent_chat_messages_bot_created_idx").on(table.botId, table.createdAt),
  ]
);

export type Lesson = typeof lessons.$inferSelect;
export type ModelRequest = typeof modelRequests.$inferSelect;
export type AgentChatMessageRow = typeof agentChatMessages.$inferSelect;
