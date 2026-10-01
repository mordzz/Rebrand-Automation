"use client";

import dynamic from "next/dynamic";

import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { cn } from "@/lib/utils";

const CharacterCanvas = dynamic(
  () =>
    import("@/components/dashboard/character-canvas").then(
      (m) => m.CharacterCanvas
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Waking the automaton…
      </div>
    ),
  }
);

/** Renders any deployable character - the built-in 3D automaton, or an
 * image/GIF that reacts to the bot's mood with motion instead of rigging. */
export function CharacterAvatar({
  kind,
  src,
  mood,
}: {
  kind: "3d" | "image" | "gif";
  src?: string | null;
  mood: CharacterMood;
}) {
  if (kind === "3d") {
    return <CharacterCanvas mood={mood} />;
  }
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      {/* Arbitrary user-supplied URLs - next/image would need a remote-host
          allowlist, so a plain img is the right tool here. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src ?? ""}
        alt="Your automaton"
        className={cn(
          "max-h-full max-w-full object-contain",
          mood === "thinking" && "animate-pulse",
          mood === "talking" && "animate-float"
        )}
      />
    </div>
  );
}
