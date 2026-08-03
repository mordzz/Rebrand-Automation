"use client";

import { useEffect, useState } from "react";

import { DEFAULT_FEE_SPLIT, type FeeSplitConfig } from "@/lib/perps/perpspad-types";

/**
 * The live fee split, from /api/perps/config.
 *
 * One hook rather than a fetch copy-pasted into each consumer: the split
 * is rendered in four places on this page (the flow diagram, the
 * create-form preview bar, the create-form's copy, and the how-it-works
 * steps), and every one of them drifting independently is precisely the
 * failure the Perpspad plan called out. `DEFAULT_FEE_SPLIT` is the
 * fallback while in flight or if the request fails — never a separately
 * typed-out literal.
 */
export function useFeeSplit(): FeeSplitConfig {
  const [feeSplit, setFeeSplit] = useState<FeeSplitConfig>(DEFAULT_FEE_SPLIT);

  useEffect(() => {
    let disposed = false;
    fetch("/api/perps/config")
      .then((res) => res.json())
      .then((json: { feeSplit?: FeeSplitConfig }) => {
        if (!disposed && json.feeSplit) setFeeSplit(json.feeSplit);
      })
      .catch(() => {
        // keep the default
      });
    return () => {
      disposed = true;
    };
  }, []);

  return feeSplit;
}
