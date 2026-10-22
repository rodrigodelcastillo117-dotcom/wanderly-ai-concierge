import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;

// Cada Tooltip trae su propio Provider (patrón actual de shadcn): así la app no necesita un
// TooltipProvider global en App.tsx, que metía Radix Tooltip + Floating UI (~15 KB gzip) en el
// paquete inicial de todas las visitas aunque casi ninguna pantalla use tooltips de Radix.
const Tooltip = ({ delayDuration, skipDelayDuration, disableHoverableContent, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  skipDelayDuration?: number;
}) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} skipDelayDuration={skipDelayDuration} disableHoverableContent={disableHoverableContent}>
    <TooltipPrimitive.Root {...props} />
  </TooltipPrimitive.Provider>
);

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
