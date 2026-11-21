/** Always dark, in both themes. */
export function AppFooter() {
  return (
    <footer className="border-t-2 border-border" style={{ background: "#121314", color: "#c6d0da" }}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-3 px-4 py-7 text-sm sm:px-5">
        <span className="label" style={{ color: "#e9edf1" }}>
          Brim · CodeJam 16
        </span>
        <span>Harborline Logistics is fictional. Payments are simulated.</span>
      </div>
    </footer>
  );
}
