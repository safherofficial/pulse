import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
  "tap inline-flex h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "btn-primary sweep",
        quiet: "btn-quiet border border-line bg-surface/50 text-fg",
        ghost: "bg-transparent text-muted hover:text-fg",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export const fieldClass =
  "h-11 w-full rounded-sm border border-line bg-bg px-3 text-sm text-fg outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
