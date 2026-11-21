"use client";

import { useRef } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { THEME_SCRIPT } from "./theme";

/**
 * Inserts THEME_SCRIPT into the initial HTML so the saved theme applies before first paint.
 * useServerInsertedHTML keeps the <script> out of the React tree, which avoids React 19's
 * script-tag warning. It only runs on the initial document; data-theme on <html> survives
 * client-side navigation.
 */
export function ThemeScript() {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
  });
  return null;
}
