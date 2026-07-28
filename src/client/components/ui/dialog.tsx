import { cn } from "@/lib/utils";
import { createContext, useContext, type HTMLAttributes, type ReactNode } from "react";

const DialogCtx = createContext<{ open: boolean; onOpenChange: (v: boolean) => void }>({
  open: false,
  onOpenChange: () => {},
});

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return <DialogCtx.Provider value={{ open, onOpenChange }}>{children}</DialogCtx.Provider>;
}

export function DialogTrigger({ children }: { children: ReactNode; asChild?: boolean }) {
  const { onOpenChange } = useContext(DialogCtx);
  return <span onClick={() => onOpenChange(true)}>{children}</span>;
}

export function DialogContent({ className, children }: HTMLAttributes<HTMLDivElement>) {
  const { open, onOpenChange } = useContext(DialogCtx);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-up items-center justify-center bg-charcoal/25 p-4 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn("w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-lift", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-display text-xl", className)} {...props} />;
}
