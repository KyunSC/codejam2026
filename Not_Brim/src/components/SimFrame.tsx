"use client";

import { useEffect, useRef, type RefObject } from "react";
import { asBridgeMessage } from "@/lib/bridge";
import type { BridgeMessage } from "@/lib/types";

/**
 * The sandboxed sim. `allow-scripts` only: never `allow-same-origin`, so the
 * generated code gets an opaque origin and can't reach the app.
 */
export function SimFrame({
  srcdoc,
  onMessage,
  frameRef,
  title,
}: {
  srcdoc: string;
  onMessage: (msg: BridgeMessage) => void;
  frameRef?: RefObject<HTMLIFrameElement | null>;
  title?: string;
}) {
  const local = useRef<HTMLIFrameElement | null>(null);
  const handler = useRef(onMessage);

  useEffect(() => {
    handler.current = onMessage;
  });

  useEffect(() => {
    function listen(e: MessageEvent) {
      const win = local.current?.contentWindow;
      if (!win || e.source !== win) return;
      const msg = asBridgeMessage(e.data);
      if (msg) handler.current(msg);
    }
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  return (
    <iframe
      ref={(el) => {
        local.current = el;
        if (frameRef) frameRef.current = el;
      }}
      data-testid="sim-frame"
      title={title || "Simulation"}
      sandbox="allow-scripts"
      srcDoc={srcdoc}
      className="block h-full w-full border-0 bg-[#f8fafc]"
    />
  );
}
