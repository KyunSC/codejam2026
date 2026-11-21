"use client";

import { useMemo, useState } from "react";
import { buildSrcdoc, validateParams } from "@/lib/bridge";
import type { BridgeMessage } from "@/lib/types";
import { SimFrame } from "./SimFrame";

type HarnessState = "mounting" | "ready" | "error";

export function FixtureHarness({ name, code }: { name: string; code: string }) {
  const srcdoc = useMemo(() => buildSrcdoc(code), [code]);
  const [state, setState] = useState<HarnessState>("mounting");
  const [log, setLog] = useState<string[]>([]);

  function onMessage(msg: BridgeMessage) {
    if (msg.type === "ready") {
      const checked = validateParams(msg.params);
      if (!checked.ok) {
        setState("error");
        setLog((l) => [...l, `error: ${checked.reason}`]);
        return;
      }
      setState((s) => (s === "error" ? s : "ready"));
      setLog((l) => [...l, `ready: ${String(msg.title)}`]);
    } else if (msg.type === "error") {
      setState("error");
      setLog((l) => [...l, `error: ${msg.message}`]);
    } else {
      setLog((l) => [...l, "applied"]);
    }
  }

  return (
    <main className="flex h-screen flex-col gap-3 p-4">
      <h1 className="text-2xl font-bold">Fixture: {name}</h1>
      <div className="flex-1" data-testid="sim-panel" data-state={state}>
        <SimFrame srcdoc={srcdoc} onMessage={onMessage} title={name} />
      </div>
      <ol className="text-lg" data-testid="bridge-log">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ol>
    </main>
  );
}
