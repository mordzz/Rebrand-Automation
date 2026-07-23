import type { Provider } from "@elizaos/core";
import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { lessons } from "@/lib/db/schema";

/**
 * Surfaces applied trading lessons (rules learned from past losses) into
 * the concierge's context — the piece the learning-loop memory note
 * flagged as never wired up.
 */
export const lessonsProvider: Provider = {
  name: "APPLIED_LESSONS",
  description: "Rules learned from past losing trades that are now enforced.",
  position: 50,
  // See wallet-provider.ts for why this is needed — without it the
  // context-routing classifier can silently exclude this provider on
  // turns not classified into whatever context "APPLIED_LESSONS" defaults to.
  alwaysInResponseState: true,
  get: async () => {
    const db = getDb();
    if (!db) return { text: "", values: {}, data: {} };

    const rows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.status, "applied"))
      .orderBy(desc(lessons.createdAt))
      .limit(20);

    if (!rows.length) return { text: "", values: {}, data: {} };

    const text =
      "Applied trading lessons (enforced rules from past losses):\n" +
      rows.map((r) => `- ${r.lesson}`).join("\n");

    return { text, values: { appliedLessonCount: rows.length }, data: { rows } };
  },
};
