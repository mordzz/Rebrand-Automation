"use client";

import { Bot, RotateCcw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type SliderField = {
  type: "slider";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  hint?: string;
};

type SelectField = {
  type: "select";
  key: string;
  label: string;
  options: string[];
  default: string;
  hint?: string;
};

type SwitchField = {
  type: "switch";
  key: string;
  label: string;
  default: boolean;
  hint?: string;
};

type Field = SliderField | SelectField | SwitchField;

type StrategyConfigSchema = {
  fields: Field[];
  /** Builds a one-line agent briefing from the current values. */
  briefing: (v: Record<string, number | string | boolean>) => string;
};

/**
 * Per-strategy configuration lives here (client-side) so the briefing
 * closures never cross the server → client boundary.
 */
const CONFIGS: Record<string, StrategyConfigSchema> = {
  sniper: {
    fields: [
      { type: "slider", key: "size", label: "Position size per entry", min: 0.1, max: 10, step: 0.1, default: 1, unit: "SOL" },
      { type: "slider", key: "slippage", label: "Max slippage", min: 1, max: 50, step: 1, default: 15, unit: "%" },
      { type: "select", key: "priority", label: "Priority fee", options: ["Standard", "Turbo", "Max"], default: "Turbo", hint: "Higher fees win the race but cost more per fill." },
      { type: "select", key: "lp", label: "Minimum LP lock", options: ["Any", "Over 50%", "Locked or burned"], default: "Locked or burned" },
      { type: "slider", key: "tp", label: "Take-profit target", min: 20, max: 500, step: 10, default: 80, unit: "%" },
      { type: "slider", key: "sl", label: "Stop-loss", min: 5, max: 90, step: 5, default: 30, unit: "%" },
      { type: "switch", key: "safety", label: "Honeypot & mint-authority checks", default: true, hint: "Reject tokens that fail on-chain safety inspection." },
    ],
    briefing: (v) =>
      `The Raven enters new pools with ${v.size} SOL at up to ${v.slippage}% slippage and ${String(v.priority).toLowerCase()} priority fees, only when liquidity is ${String(v.lp).toLowerCase()}${v.safety ? " and safety checks pass" : ""}, then targets +${v.tp}% with a ${v.sl}% stop.`,
  },
  shadow: {
    fields: [
      { type: "slider", key: "wallets", label: "Wallets followed", min: 1, max: 25, step: 1, default: 6 },
      { type: "slider", key: "alloc", label: "Allocation per wallet", min: 1, max: 20, step: 1, default: 5, unit: "%" },
      { type: "slider", key: "concurrent", label: "Max concurrent positions", min: 1, max: 20, step: 1, default: 8 },
      { type: "select", key: "minliq", label: "Minimum liquidity", options: ["No floor", "10 SOL", "50 SOL", "100 SOL"], default: "50 SOL" },
      { type: "switch", key: "mirrorSells", label: "Mirror the leader's exits", default: true, hint: "Sell when they sell instead of using your own rules." },
    ],
    briefing: (v) =>
      `The Wake mirrors ${v.wallets} wallets at ${v.alloc}% of bankroll each, up to ${v.concurrent} positions at once, only on tokens above ${String(v.minliq).toLowerCase()} liquidity, and ${v.mirrorSells ? "exits when they exit" : "runs your own exit rules"}.`,
  },
  sentry: {
    fields: [
      { type: "slider", key: "sl", label: "Stop-loss", min: 5, max: 90, step: 5, default: 25, unit: "%" },
      { type: "slider", key: "tp", label: "Take-profit", min: 20, max: 500, step: 10, default: 120, unit: "%" },
      { type: "slider", key: "trail", label: "Trailing stop", min: 3, max: 40, step: 1, default: 12, unit: "%" },
      { type: "slider", key: "tranches", label: "Laddered exit tranches", min: 1, max: 5, step: 1, default: 3 },
      { type: "switch", key: "rug", label: "Rug emergency exit", default: true, hint: "Bail instantly on detected liquidity drain, ahead of your stop." },
    ],
    briefing: (v) =>
      `The Ark guards every position with a ${v.sl}% stop, a +${v.tp}% target laddered across ${v.tranches} tranches, and a ${v.trail}% trailing stop${v.rug ? ", firing an emergency exit the moment liquidity starts to drain" : ""}.`,
  },
  clockwork: {
    fields: [
      { type: "select", key: "cadence", label: "Cadence", options: ["Hourly", "Daily", "Weekly", "Dip-triggered"], default: "Daily" },
      { type: "slider", key: "amount", label: "Amount per buy", min: 0.1, max: 20, step: 0.1, default: 2, unit: "SOL" },
      { type: "slider", key: "dip", label: "Dip trigger", min: 3, max: 50, step: 1, default: 8, unit: "%" },
      { type: "slider", key: "tranches", label: "Order tranches (TWAP)", min: 1, max: 10, step: 1, default: 4 },
      { type: "slider", key: "pause", label: "Pause on drawdown", min: 10, max: 80, step: 5, default: 25, unit: "%" },
    ],
    briefing: (v) =>
      `The Tide accumulates ${v.amount} SOL on a ${String(v.cadence).toLowerCase()} schedule${v.cadence === "Dip-triggered" ? ` whenever price falls ${v.dip}% from its local high` : ""}, splitting each buy into ${v.tranches} tranches and pausing if drawdown passes ${v.pause}%.`,
  },
};

const MODELS = ["Auto (house router)", "Claude Fable 5", "GPT-5", "Gemini 3 Pro"];

function defaultsFor(fields: Field[]): Record<string, number | string | boolean> {
  const v: Record<string, number | string | boolean> = {};
  for (const f of fields) v[f.key] = f.default;
  return v;
}

export function StrategyConfig({
  strategyId,
  strategyName,
}: {
  strategyId: string;
  strategyName: string;
}) {
  const schema = CONFIGS[strategyId];
  const [values, setValues] = useState(() => defaultsFor(schema.fields));
  const [model, setModel] = useState(MODELS[0]);
  const [aggression, setAggression] = useState(45);
  const [learn, setLearn] = useState(true);
  const [directive, setDirective] = useState("");

  const dirty = useMemo(() => {
    const base = defaultsFor(schema.fields);
    const paramsChanged = schema.fields.some((f) => values[f.key] !== base[f.key]);
    return (
      paramsChanged ||
      model !== MODELS[0] ||
      aggression !== 45 ||
      !learn ||
      directive.trim() !== ""
    );
  }, [values, model, aggression, learn, directive, schema.fields]);

  function reset() {
    setValues(defaultsFor(schema.fields));
    setModel(MODELS[0]);
    setAggression(45);
    setLearn(true);
    setDirective("");
  }

  const aggressionLabel =
    aggression < 33 ? "Cautious" : aggression < 66 ? "Balanced" : "Aggressive";

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/40 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Bot className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">Configure the agent</p>
            <p className="text-xs text-muted-foreground">
              Tune how {strategyName} behaves in the trenches.
            </p>
          </div>
        </div>
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-xs text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        )}
      </div>

      <div className="grid gap-8 p-6 lg:grid-cols-2">
        {/* Trade parameters */}
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Trade parameters
          </p>
          <div className="mt-5 space-y-6">
            {schema.fields.map((field) => (
              <FieldControl
                key={field.key}
                field={field}
                value={values[field.key]}
                onChange={(next) =>
                  setValues((prev) => ({ ...prev, [field.key]: next }))
                }
              />
            ))}
          </div>
        </div>

        {/* AI agent */}
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            AI agent
          </p>
          <div className="mt-5 space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-normal">Reasoning model</Label>
              <Select value={model} onValueChange={(v) => setModel(v as string)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label className="text-sm font-normal">Aggressiveness</Label>
                <span className="text-sm font-medium text-accent">
                  {aggressionLabel}
                </span>
              </div>
              <Slider
                value={[aggression]}
                onValueChange={(v) =>
                  setAggression(Array.isArray(v) ? v[0] : v)
                }
                min={0}
                max={100}
                step={1}
              />
              <p className="text-xs text-muted-foreground">
                How readily the agent takes marginal setups versus waiting for
                conviction.
              </p>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm font-normal">Learn from losses</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Feed every losing trade into agent memory and apply the lesson
                  on the next decision.
                </p>
              </div>
              <Switch checked={learn} onCheckedChange={setLearn} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="directive" className="text-sm font-normal">
                Custom directive{" "}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <textarea
                id="directive"
                value={directive}
                onChange={(e) => setDirective(e.target.value)}
                rows={3}
                placeholder="e.g. Avoid tokens with animal names; never hold through a US market open."
                className="w-full resize-none rounded-lg border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Live agent briefing */}
      <div className="border-t bg-muted/40 px-6 py-5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-accent" />
          <p className="text-xs font-semibold tracking-[0.2em] uppercase text-muted-foreground">
            Agent briefing
          </p>
        </div>
        <p className="mt-3 text-sm leading-relaxed">
          {schema.briefing(values)}{" "}
          {`It reasons with ${model}, trades ${aggressionLabel.toLowerCase()}, and ${
            learn
              ? "learns from every loss"
              : "does not update its memory from losses"
          }.`}
          {directive.trim() && (
            <span className="text-muted-foreground">
              {" "}
              Standing directive: “{directive.trim()}”.
            </span>
          )}
        </p>
        <Button className="mt-5 h-10">Deploy this configuration</Button>
      </div>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: number | string | boolean;
  onChange: (next: number | string | boolean) => void;
}) {
  if (field.type === "slider") {
    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label className="text-sm font-normal">{field.label}</Label>
          <span className="text-sm font-medium">
            {value}
            {field.unit ? ` ${field.unit}` : ""}
          </span>
        </div>
        <Slider
          value={[value as number]}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
          min={field.min}
          max={field.max}
          step={field.step}
        />
        {field.hint && (
          <p className="text-xs text-muted-foreground">{field.hint}</p>
        )}
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-normal">{field.label}</Label>
        <Select
          value={value as string}
          onValueChange={(v) => onChange(v as string)}
        >
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.hint && (
          <p className="text-xs text-muted-foreground">{field.hint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label className="text-sm font-normal">{field.label}</Label>
        {field.hint && (
          <p className={cn("mt-1 text-xs text-muted-foreground")}>{field.hint}</p>
        )}
      </div>
      <Switch
        checked={value as boolean}
        onCheckedChange={(c) => onChange(c)}
      />
    </div>
  );
}
