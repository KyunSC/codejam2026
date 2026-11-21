/** localStorage key for the theme the user picked with the header toggle. */
export const THEME_KEY = "brim-theme";

export type Theme = "light" | "dark";

/**
 * Runs in <head> before first paint: applies a remembered theme so the page never flashes the
 * wrong one. With nothing stored, <html> has no data-theme and CSS follows prefers-color-scheme.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
