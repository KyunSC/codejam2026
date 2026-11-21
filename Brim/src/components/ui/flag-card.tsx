import type { ReactNode } from "react";
import type { EvidenceItem } from "@/lib/types";
import { Card } from "./card";
import { Chip } from "./chip";
import { FLAG_KIND_COLOR, type FlagKind } from "./flag-kind";

/**
 * One flag: its chip, the plain-English sentence from the checks engine, the evidence behind it
 * (each number with its source), and the actions that resolve it. The card's shadow takes the
 * flag's colour.
 */
export function FlagCard({
  kind,
  title,
  message,
  evidence,
  actions,
}: {
  kind: FlagKind;
  /** Chip text, e.g. "Wrong tax for province". */
  title: string;
  message: ReactNode;
  evidence?: EvidenceItem[];
  actions?: ReactNode;
}) {
  return (
    <Card shadow={FLAG_KIND_COLOR[kind]} className="p-5 sm:p-[22px]">
      <div className="mb-2.5 flex items-center gap-3">
        <Chip kind={kind}>{title}</Chip>
      </div>
      <p className="m-0 mb-4 text-[17px] leading-[1.45] sm:text-lg">{message}</p>
      {evidence && evidence.length > 0 && (
        <dl className="m-0 mb-4 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
          {evidence.map((e, i) => (
            <div key={i} className="contents">
              <dt className="muted">{e.label}</dt>
              <dd className="m-0 max-sm:mb-1.5">
                <b className="num">{e.value}</b> <span className="muted">· {e.source}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </Card>
  );
}
