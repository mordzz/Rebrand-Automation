/** Built-in characters a user can pick for their automaton. "3d" renders
 * the live CharacterCanvas; "image" (and user-supplied GIF URLs) render an
 * <img> that animates with the bot's mood. */
export type RosterEntry = {
  id: string;
  name: string;
  kind: "3d" | "image";
  src: string | null;
  blurb: string;
};

export const CHARACTER_ROSTER: RosterEntry[] = [
  {
    id: "noah",
    name: "Noah",
    kind: "3d",
    src: null,
    blurb: "The house automaton — brass manners, machine reflexes.",
  },
  {
    id: "duchess",
    name: "The Duchess",
    kind: "image",
    src: "/characters/duchess.svg",
    blurb: "Porcelain poise. Never once has she chased a chart.",
  },
  {
    id: "hound",
    name: "The Hound",
    kind: "image",
    src: "/characters/hound.svg",
    blurb: "Loyal to the stop-loss, with a nose for rugs.",
  },
];

/** GIF URLs get their own stored type so future renderers can treat them
 * differently; both render as <img> today. */
export function characterTypeForSrc(src: string): "image" | "gif" {
  return /\.gif(\?.*)?$/i.test(src) ? "gif" : "image";
}
