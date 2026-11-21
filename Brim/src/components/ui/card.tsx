import type { ComponentProps } from "react";

/** 2px border, 6px radius, hard 6px offset shadow. `shadow` recolours it (flag cards). */
export function Card({
  shadow,
  className,
  style,
  ...rest
}: ComponentProps<"div"> & { shadow?: string }) {
  return (
    <div
      className={["card", className].filter(Boolean).join(" ")}
      style={shadow ? { ...style, ["--card-shadow" as string]: shadow } : style}
      {...rest}
    />
  );
}
