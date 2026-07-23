import { cn } from "@/lib/utils";

const DEFAULT_ITEMS = [
  "Snipe filled in 400ms",
  "Copy-trade engaged",
  "Stop-loss honoured",
  "No sleep required",
  "Est. in the trenches",
  "Priority fees tuned",
  "Rugs detected & dodged",
  "24 hrs a day · 7 days a week",
];

export function Ticker({
  items = DEFAULT_ITEMS,
  className,
}: {
  items?: string[];
  className?: string;
}) {
  const tape = [...items, ...items];
  return (
    <div
      aria-hidden
      className={cn("overflow-hidden bg-sol-green text-primary-foreground", className)}
    >
      <div className="flex w-max animate-marquee py-2.5">
        {tape.map((item, i) => (
          <span
            key={i}
            className="flex items-center gap-6 pr-6 text-xs font-medium tracking-wide"
          >
            {item}
            <span className="text-primary-foreground/40">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}
