import "server-only";
// Aliased: the spec names it useStandIn, which the React hooks lint rule mistakes for a hook.
import { useStandIn as standInActive } from "../config";
import type { SimModel } from "../types";
import { RealModel } from "./real";
import { StandInModel } from "./standin";

let standIn: StandInModel | null = null;
let real: RealModel | null = null;

/** The stand-in when there's no key (or FAKE_MODEL=1), Claude otherwise. */
export function getModel(): SimModel {
  if (standInActive()) return (standIn ??= new StandInModel());
  return (real ??= new RealModel());
}
