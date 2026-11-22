import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { withParams } from "./components/ui";

export function useListFilter() {
  const [sp, setParams] = useSearchParams();
  const search = sp.get("q") ?? "";
  const [draft, setDraft] = useState(search);
  const pendingSearch = useRef<string | null>(null);
  useLayoutEffect(() => {
    // A URL update from our timer can arrive after the next keystroke.
    if (pendingSearch.current !== search) setDraft(search);
    pendingSearch.current = null;
  }, [search]);
  const term = draft.trim();
  useEffect(() => {
    if (term === search) return;
    const timer = setTimeout(() => {
      pendingSearch.current = term;
      setParams(withParams(sp, { q: term || null, page: null }), { replace: true });
    }, term ? 200 : 0);
    return () => clearTimeout(timer);
  }, [term, search, sp, setParams]);
  return { sp, search, draft, setDraft, term };
}
