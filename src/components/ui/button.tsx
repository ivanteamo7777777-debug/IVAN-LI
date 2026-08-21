import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-soft)]",
        secondary:
          "border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-strong)]",
        ghost:
          "text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]",
        danger:
          "border border-[var(--danger-line)] bg-[var(--danger-wash)] text-[var(--danger)] hover:border-[var(--danger)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 px-5",
        icon: "size-10 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
