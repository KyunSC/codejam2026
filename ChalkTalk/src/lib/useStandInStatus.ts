"use client";

import { useEffect, useState } from "react";

/** Asks the server whether the offline stand-in is active. null while loading. */
export function useStandInStatus(): boolean | null {
  const [standIn, setStandIn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ standIn: boolean }>)
      .then((j) => live && setStandIn(Boolean(j.standIn)))
      .catch(() => live && setStandIn(null));
    return () => {
      live = false;
    };
  }, []);
  return standIn;
}
