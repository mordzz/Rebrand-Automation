"use client";

import { Layers, Target, TrendingUp, Wallet } from "lucide-react";
import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import type { CharacterMood } from "@/components/dashboard/character-canvas";
import { ChatPanel, type ChatMessage } from "@/components/dashboard/chat-panel";
import { LiveMints } from "@/components/dashboard/live-mints";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const STATS = [
  {
    icon: Wallet,
    label: "Wallet balance",
    value: "42.7 SOL",
    hint: "+2.3 SOL today",
    positive: true,
  },
  {
    icon: Layers,
    label: "Open positions",
    value: "8",
    hint: "5 in profit",
    positive: true,
  },
  {
    icon: TrendingUp,
    label: "PnL · 24h",
    value: "+5.4 SOL",
    hint: "+12.6% on deployed",
    positive: true,
  },
  {
    icon: Target,
    label: "Win rate · 30d",
    value: "63%",
    hint: "141 of 224 trades",
    positive: true,
  },
];

const POSITIONS = [
  { token: "WIF", strategy: "The Sniper", entry: "0.084", mark: "0.132", size: "2.0 SOL", pnl: "+57.1%", up: true },
  { token: "BONK", strategy: "The Shadow", entry: "0.0000112", mark: "0.0000148", size: "1.5 SOL", pnl: "+32.1%", up: true },
  { token: "POPCAT", strategy: "The Sniper", entry: "0.310", mark: "0.288", size: "1.0 SOL", pnl: "-7.1%", up: false },
  { token: "MEW", strategy: "The Clockwork", entry: "0.0041", mark: "0.0052", size: "3.2 SOL", pnl: "+26.8%", up: true },
  { token: "GIGA", strategy: "The Shadow", entry: "0.021", mark: "0.019", size: "0.8 SOL", pnl: "-9.5%", up: false },
];

const HISTORY = [
  { date: "Jul 8, 04:12", token: "SLERF", strategy: "The Sniper", result: "+3.1 SOL", up: true, note: "TP hit, 2 tranches" },
  { date: "Jul 7, 22:40", token: "BODEN", strategy: "The Sentry", result: "-0.4 SOL", up: false, note: "Stop-loss honoured" },
  { date: "Jul 7, 15:03", token: "WIF", strategy: "The Clockwork", result: "+0.9 SOL", up: true, note: "Ladder buy filled" },
  { date: "Jul 7, 09:27", token: "MYRO", strategy: "The Shadow", result: "+1.7 SOL", up: true, note: "Mirrored exit" },
  { date: "Jul 6, 23:55", token: "PONKE", strategy: "The Sentry", result: "-0.2 SOL", up: false, note: "Liquidity-drain exit" },
];

const STRATEGIES = [
  { name: "The Sniper", status: "Active", detail: "Watching Pump.fun & Raydium · max 2 SOL per entry", trades: "12 trades this week" },
  { name: "The Shadow", status: "Active", detail: "Mirroring 6 wallets · proportional sizing", trades: "9 trades this week" },
  { name: "The Sentry", status: "Active", detail: "Guarding 8 positions · trailing 12%", trades: "3 exits this week" },
  { name: "The Clockwork", status: "Paused", detail: "Daily WIF ladder · resumes on -8% dip", trades: "4 buys this week" },
];

const REPLIES: [RegExp, string][] = [
  [/balance|saldo|wallet/i, "Your wallet holds 42.7 SOL — up 2.3 SOL since this morning. 8.5 SOL is deployed across open positions, the rest rests in reserve."],
  [/posisi|position/i, "You have 8 open positions; 5 are in profit. The finest is WIF at +57.1% — the Sentry trails it at 12%. Shall I read you the rest?"],
  [/strategi|strategy|automaton/i, "Three automatons are on duty: the Sniper, the Shadow, and the Sentry. The Clockwork is paused, waiting politely for an 8% dip."],
  [/rug|bahaya|risk/i, "The Sentry watches every pool's liquidity in real time. At the first sign of a drain, it files an emergency exit — no hesitation, no negotiation."],
  [/history|riwayat/i, "This week the house closed 29 trades: 19 wins, 10 losses, net +11.2 SOL. The ledger is in the History panel to your right."],
  [/halo|hello|hi|gm|hai/i, "Good day to you. The machines are humming, the charts are behaving — mostly. What may I fetch for you?"],
];

const FALLBACK =
  "A fine question. I keep the books on balances, positions, strategies, and history — ask me about any of them.";

export function DashboardShell() {
  const [mood, setMood] = useState<CharacterMood>("idle");
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: "Welcome back, operator. Your automatons kept watch through the night — 3 trades closed, +2.3 SOL. How may I assist?",
    },
  ]);
  const idRef = useRef(1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function send(text: string) {
    const userMsg: ChatMessage = { id: idRef.current++, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setThinking(true);
    setMood("thinking");

    const reply = REPLIES.find(([re]) => re.test(text))?.[1] ?? FALLBACK;
    timers.current.push(
      setTimeout(() => {
        setMessages((m) => [
          ...m,
          { id: idRef.current++, role: "assistant", text: reply },
        ]);
        setThinking(false);
        setMood("talking");
        timers.current.push(setTimeout(() => setMood("idle"), 2200));
      }, 1100)
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      {/* Left column: character + chat */}
      <div className="flex flex-col gap-5 lg:col-span-2">
        <div className="relative aspect-[4/3] overflow-hidden rounded-xl border bg-card">
          <div className="absolute top-3 left-4 z-10">
            <p className="text-sm font-medium">Fable</p>
            <p className="text-xs text-muted-foreground">House automaton</p>
          </div>
          <Badge
            variant="secondary"
            className="absolute top-3 right-3 z-10 rounded-full capitalize"
          >
            <span
              className={cn(
                "mr-1 inline-block size-1.5 rounded-full",
                mood === "idle" ? "bg-emerald-600" : "bg-accent animate-blink"
              )}
            />
            {mood}
          </Badge>
          <CharacterCanvas mood={mood} />
        </div>
        <div className="flex h-[26rem] flex-col lg:min-h-0 lg:flex-1">
          <ChatPanel messages={messages} onSend={send} thinking={thinking} />
        </div>
      </div>

      {/* Right column: stats + panels */}
      <div className="flex flex-col gap-5 lg:col-span-3">
        <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <stat.icon className="size-4" />
                <p className="text-xs">{stat.label}</p>
              </div>
              <p className="mt-2 font-display text-2xl font-medium">
                {stat.value}
              </p>
              <p
                className={cn(
                  "mt-1 text-xs",
                  stat.positive ? "text-emerald-700" : "text-destructive"
                )}
              >
                {stat.hint}
              </p>
            </div>
          ))}
        </div>

        <Tabs defaultValue="positions" className="flex-1 gap-4">
          <TabsList className="rounded-full p-1">
            <TabsTrigger value="positions" className="rounded-full px-4">
              Positions
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-full px-4">
              History
            </TabsTrigger>
            <TabsTrigger value="strategies" className="rounded-full px-4">
              Strategies
            </TabsTrigger>
            <TabsTrigger value="mints" className="rounded-full px-4">
              <span className="mr-1.5 inline-block size-1.5 animate-blink rounded-full bg-accent" />
              Live Mints
            </TabsTrigger>
          </TabsList>

          <TabsContent value="positions">
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium">Strategy</th>
                    <th className="px-4 py-3 font-medium">Entry</th>
                    <th className="px-4 py-3 font-medium">Mark</th>
                    <th className="px-4 py-3 font-medium">Size</th>
                    <th className="px-4 py-3 text-right font-medium">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {POSITIONS.map((p) => (
                    <tr key={p.token} className="border-b last:border-b-0">
                      <td className="px-4 py-3 font-medium">${p.token}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.strategy}
                      </td>
                      <td className="px-4 py-3">{p.entry}</td>
                      <td className="px-4 py-3">{p.mark}</td>
                      <td className="px-4 py-3">{p.size}</td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-medium",
                          p.up ? "text-emerald-700" : "text-destructive"
                        )}
                      >
                        {p.pnl}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="history">
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Closed</th>
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium">Strategy</th>
                    <th className="px-4 py-3 font-medium">Note</th>
                    <th className="px-4 py-3 text-right font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {HISTORY.map((h) => (
                    <tr
                      key={h.date + h.token}
                      className="border-b last:border-b-0"
                    >
                      <td className="px-4 py-3 text-muted-foreground">
                        {h.date}
                      </td>
                      <td className="px-4 py-3 font-medium">${h.token}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {h.strategy}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {h.note}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-medium",
                          h.up ? "text-emerald-700" : "text-destructive"
                        )}
                      >
                        {h.result}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="strategies">
            <div className="grid gap-4 sm:grid-cols-2">
              {STRATEGIES.map((s) => (
                <div key={s.name} className="rounded-xl border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <p className="font-display text-lg font-medium">{s.name}</p>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "rounded-full",
                        s.status === "Active"
                          ? "bg-accent/10 text-accent"
                          : "text-muted-foreground"
                      )}
                    >
                      {s.status}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {s.detail}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {s.trades}
                  </p>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="mints">
            <LiveMints />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
