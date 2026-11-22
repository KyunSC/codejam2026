import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { withParams } from "./components/ui";

// A typed filter kept in the URL. `param` and `pageParam` let several lists on one page each keep their own.
export function useListFilter(param = "q", pageParam = "page") {
  const [sp, setParams] = useSearchParams();
  const search = sp.get(param) ?? "";
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
      setParams(withParams(sp, { [param]: term || null, [pageParam]: null }), { replace: true });
    }, term ? 200 : 0);
    return () => clearTimeout(timer);
  }, [term, search, sp, setParams, param, pageParam]);
  return { sp, search, draft, setDraft, term };
}
