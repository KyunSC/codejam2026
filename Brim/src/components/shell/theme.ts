/** localStorage key for the theme picked with the header toggle. */
export const THEME_KEY = "brim-theme";

export type Theme = "light" | "dark";

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/**
 * Runs before first paint: applies a remembered theme so the page never flashes the wrong one.
 * With nothing stored, <html> has no data-theme and CSS follows prefers-color-scheme.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
