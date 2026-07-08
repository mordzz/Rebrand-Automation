import {
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const trades = pgTable("trades", {
  id: uuid("id").defaultRandom().primaryKey(),
  token: text("token").notNull(),
  strategy: text("strategy").notNull(),
  entryPrice: numeric("entry_price"),
  exitPrice: numeric("exit_price"),
  sizeSol: numeric("size_sol"),
  pnlSol: numeric("pnl_sol").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /* Anything the strategy engine knew at close time: hold duration,
     slippage, liquidity, stop distance, leader wallet, etc. */
  context: jsonb("context"),
});

export const lessons = pgTable("lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  tradeId: uuid("trade_id").references(() => trades.id, {
    onDelete: "cascade",
  }),
  cause: text("cause").notNull(),
  lesson: text("lesson").notNull(),
  status: text("status").notNull().default("learning"), // learning | applied
  model: text("model").notNull().default("claude-opus-4-8"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Trade = typeof trades.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
