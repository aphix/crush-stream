import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[opacity,transform,background-color,color,box-shadow] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]";

const VARIANTS = {
  default: "bg-accent text-accent-fg shadow-[var(--shadow-border)] hover:opacity-90",
  secondary: "bg-surface-2 text-fg shadow-[var(--shadow-border)] hover:bg-surface",
  ghost: "text-fg hover:bg-surface-2",
  outline: "bg-transparent text-fg shadow-[var(--shadow-border)] hover:bg-surface-2",
};

const SIZES = {
  default: "h-11 min-w-11 px-4",
  sm: "h-9 min-w-9 px-3 text-xs",
  icon: "h-11 w-11",
};

export type ButtonProps = ComponentProps<"button"> & { variant?: keyof typeof VARIANTS; size?: keyof typeof SIZES };

export function Button({ className, variant = "default", size = "default", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props} />;
}
