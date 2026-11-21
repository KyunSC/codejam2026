/** The 3×3 pixel mark: ink squares, one red, one gap. */
const CELLS = ["ink", "red", "ink", "ink", "ink", "gap", "ink", "ink", "ink"] as const;

export function PixelLogo() {
  return (
    <span aria-hidden="true" className="grid grid-cols-[repeat(3,8px)] gap-[2px]">
      {CELLS.map((c, i) => (
        <span
          key={i}
          className="size-2"
          style={{ background: c === "ink" ? "var(--text)" : c === "red" ? "var(--red)" : "transparent" }}
        />
      ))}
    </span>
  );
}
