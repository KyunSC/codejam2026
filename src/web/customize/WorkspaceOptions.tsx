import { useState } from "react";
import { ACCENTS, DENSITIES, TEXT_SIZES, THEMES, type StoredPreferences } from "@/lib/preferences";
import { usePreferences } from "../preferences";

const LABEL: Record<string, string> = {
  system: "System", light: "Light", dark: "Dark", comfortable: "Comfortable", compact: "Compact", normal: "Normal", large: "Large",
};
const SWATCH: Record<(typeof ACCENTS)[number], string> = { red: "var(--red)", blue: "var(--blue)", green: "var(--green)", purple: "var(--purple)", gold: "var(--gold)" };

// The Workspace options panel under the edit bar: start page and appearance, plus "Reset all customizations".
export function WorkspaceOptions({ startPage }: { startPage: boolean }) {
  const { prefs, update, resetAll } = usePreferences();
  const [confirm, setConfirm] = useState(false);
  const set = <K extends keyof StoredPreferences>(k: K, v: StoredPreferences[K]) => update((s) => ({ ...s, [k]: v }));

  const seg = <K extends "theme" | "density" | "textSize">(k: K, label: string, values: readonly string[]) => (
    <div className="field">
      <span id={`opt-${k}`}>{label}</span>
      <div className="seg" role="group" aria-labelledby={`opt-${k}`}>
        {values.map((v) => (
          <button key={v} type="button" aria-pressed={prefs[k] === v} onClick={() => set(k, v as StoredPreferences[K])}>{LABEL[v]}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="options" role="group" aria-label="Workspace options">
      {startPage && (
        <label className="field" htmlFor="opt-start">
          Open on this page when I sign in
          <select id="opt-start" className="input" value={prefs.landingPage} onChange={(e) => set("landingPage", e.target.value as StoredPreferences["landingPage"])}>
            {prefs.tabs.filter((t) => t.visible).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <span className="muted text-xs font-normal">Marked with a house on its tab.</span>
        </label>
      )}
      {seg("theme", "Theme", THEMES)}
      {seg("density", "Density", DENSITIES)}
      {seg("textSize", "Text size", TEXT_SIZES)}
      <div className="field">
        <span id="opt-accent">Accent</span>
        <div className="swatches" role="group" aria-labelledby="opt-accent">
          {ACCENTS.map((a) => (
            <button key={a} type="button" className="swatch" style={{ background: SWATCH[a] }} aria-pressed={prefs.accent === a} aria-label={a} title={a} onClick={() => set("accent", a)} />
          ))}
        </div>
      </div>
      <div className="options__foot">
        <button
          type="button"
          className="btn btn--danger btn--sm"
          onClick={() => {
            if (!confirm) return setConfirm(true);
            setConfirm(false);
            void resetAll();
          }}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? "Click again to reset everything" : "Reset all customizations"}
        </button>
      </div>
    </div>
  );
}
