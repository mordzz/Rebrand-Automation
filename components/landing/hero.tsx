"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { FlickeringGrid } from "@/components/ui/flickering-grid";

const NAV_LINKS = [
  { label: "PROJECTS", href: "/strategies" },
  { label: "BLOG", href: "/#insights" },
  { label: "ABOUT", href: "/#about" },
  { label: "RESUME", href: "/deploy" },
];

export function Hero() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <section className="relative flex min-h-screen flex-col overflow-hidden bg-white">
      {/* ─── Background: flickering grid ─── */}
      <FlickeringGrid
        className="absolute inset-0 z-0 size-full"
        squareSize={4}
        gridGap={6}
        color="#6B7280"
        maxOpacity={0.5}
        flickerChance={0.1}
      />

      {/* ─── Overlays ─── */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white via-white/40 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-white via-white/60 to-transparent" />

      {/* ─── Grid lines ─── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden lg:block">
        <div className="absolute inset-y-0 left-1/4 w-px bg-black/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-black/10" />
        <div className="absolute inset-y-0 left-3/4 w-px bg-black/10" />
      </div>

      {/* ─── Navigation ─── */}
      <header className="absolute inset-x-0 top-0 z-30">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5 text-black">
            <svg
              aria-hidden
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 6 2.5 11 7 16" />
              <path d="m15 6 4.5 5-4.5 5" />
            </svg>
            <span className="text-lg font-semibold tracking-tight">CodeNest</span>
          </Link>

          <div className="hidden items-center gap-10 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="font-sans text-base text-black transition-colors hover:text-[#1d7a63]"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
            className="text-black md:hidden"
          >
            <Menu size={26} />
          </button>
        </nav>
      </header>

      {/* ─── Mobile menu overlay ─── */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white md:hidden">
          <div className="flex items-center justify-between px-6 py-6">
            <span className="text-lg font-semibold text-black">CodeNest</span>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="text-black"
            >
              <X size={26} />
            </button>
          </div>
          <nav className="flex flex-1 flex-col items-center justify-center gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="font-sans text-2xl font-semibold text-black transition-colors hover:text-[#1d7a63]"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* ─── Hero content ─── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-36 text-center">
        {/* Liquid glass card */}
        <div className="liquid-glass flex h-[200px] w-[200px] translate-y-[-50px] flex-col justify-between rounded-2xl p-5 text-left">
          <span className="text-sm text-black/60">[ 2025 ]</span>
          <p className="text-lg leading-snug text-black">
            Taught by{" "}
            <em className="font-instrument italic text-[#1d7a63]">Industry</em>{" "}
            Professionals
          </p>
          <p className="text-[11px] leading-relaxed text-black/50">
            Live cohorts led by engineers shipping at top companies.
          </p>
        </div>

        <p className="font-jakarta text-[11px] font-bold uppercase tracking-[0.3em] text-[#1d7a63]">
          Career-Ready Curriculum
        </p>

        <h1 className="mt-4 font-sans text-[40px] font-extrabold uppercase leading-[0.95] tracking-tight text-black md:text-[72px]">
          Launch your
          <br />
          Coding Career<span className="text-[#1d7a63]">.</span>
        </h1>

        <p className="mt-6 max-w-[512px] font-sans text-sm leading-relaxed text-black/70">
          Master in-demand coding skills through project-based courses,
          mentorship from senior engineers, and a curriculum built around what
          companies actually hire for.
        </p>

        <Link
          href="#get-started"
          className="mt-9 inline-flex items-center gap-2 rounded-full bg-black px-8 py-4 font-sans text-xs font-bold uppercase tracking-widest text-white transition-transform hover:scale-105"
        >
          Get Started
          <ArrowRight size={16} />
        </Link>
      </div>
    </section>
  );
}
