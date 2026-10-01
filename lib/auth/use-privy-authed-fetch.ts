"use client";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";

/**
 * `fetch` that attaches the caller's Privy access token as
 * `Authorization: Bearer …` - required by every mutating /api/my-bot route
 * (verified server-side in lib/auth/privy-server.ts).
 *
 * Must render under PrivyProvider. If no token is available (logged out /
 * session expired) no request is sent; callers get a synthetic 401 whose
 * JSON `error` their existing error handling already displays.
 */
export function usePrivyAuthedFetch(): typeof fetch {
  const { getAccessToken } = usePrivy();

  return useCallback<typeof fetch>(
    async (input, init) => {
      const token = await getAccessToken();
      if (!token) {
        return Response.json(
          { error: "Your session expired - reconnect your wallet and try again." },
          { status: 401 },
        );
      }
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    },
    [getAccessToken],
  );
}

/** Authed fetch for components that may render with or without Privy
 * (PR17). Inside PrivyProvider, <AuthedFetchBridge> supplies the token-
 * attaching fetch; without Privy the default is plain fetch, which every
 * protected route refuses - fail closed, never a bypass. */
export const AuthedFetchContext = createContext<typeof fetch>((input, init) => fetch(input, init));

export function useAuthedFetch(): typeof fetch {
  return useContext(AuthedFetchContext);
}

export function AuthedFetchBridge({ children }: { children: ReactNode }) {
  const authedFetch = usePrivyAuthedFetch();
  return createElement(AuthedFetchContext.Provider, { value: authedFetch }, children);
}
