import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "solid" | "ghost";

function classes(variant: Variant, size: "md" | "sm", extra?: string) {
  return ["btn", `btn--${variant}`, size === "sm" && "btn--sm", extra].filter(Boolean).join(" ");
}

/** Solid = the primary action (red offset shadow, lifts on hover). Ghost = outlined. */
export function Button({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: "md" | "sm" }) {
  return <button type={type} className={classes(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "ghost",
  size = "md",
  className,
  arrow,
  children,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: "md" | "sm"; arrow?: boolean; children: ReactNode }) {
  return (
    <Link className={classes(variant, size, className)} {...rest}>
      {children}
      {arrow && <span aria-hidden="true">→</span>}
    </Link>
  );
}
