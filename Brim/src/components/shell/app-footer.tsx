import Link from "next/link";

/** Always dark, in both themes. Holds the Brim staff login, apart from the customer login. */
export function AppFooter() {
  return (
    <footer className="border-t-2 border-border" style={{ background: "#121314", color: "#c6d0da" }}>
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-4 py-7 text-sm sm:px-5">
        <span className="label" style={{ color: "#e9edf1" }}>
          Brim · CodeJam 16
        </span>
        <span>Organizations and people are fictional. Payments are simulated.</span>
        <Link href="/admin/login" className="underline underline-offset-4" style={{ color: "#e9edf1" }}>
          Brim staff login
        </Link>
      </div>
    </footer>
  );
}
