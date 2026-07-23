import type { CSSProperties, ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<"span"> {
  shimmerWidth?: number;
}

/** Magic UI AnimatedShinyText — a light sheen periodically sweeping across
 * the text. Base text color comes from the caller's className. */
export function AnimatedShinyText({
  children,
  className,
  shimmerWidth = 100,
  ...props
}: AnimatedShinyTextProps) {
  return (
    <span
      style={
        {
          "--shiny-width": `${shimmerWidth}px`,
        } as CSSProperties
      }
      className={cn(
        "animate-shiny-text bg-clip-text bg-no-repeat [background-position:0_0] [background-size:var(--shiny-width)_100%]",
        "bg-gradient-to-r from-transparent via-white/90 via-50% to-transparent",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
