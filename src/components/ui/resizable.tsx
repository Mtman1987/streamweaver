"use client"

import * as React from "react"
import { Grip, PanelBottom, PanelLeft, PanelRight, PanelTop } from "lucide-react"

import { cn } from "@/lib/utils"

// A rudimentary implementation of a resizable panel group, as a substitute for a more complex library.

type ResizablePanelGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  direction: "horizontal" | "vertical"
}

const ResizablePanelGroup = React.forwardRef<
  HTMLDivElement,
  ResizablePanelGroupProps
>(({ className, direction, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex w-full h-full",
      direction === "horizontal" ? "flex-row" : "flex-col",
      className
    )}
    {...props}
  >
    {children}
  </div>
))
ResizablePanelGroup.displayName = "ResizablePanelGroup"

type ResizablePanelProps = React.HTMLAttributes<HTMLDivElement> & {
  defaultSize?: number
  minSize?: number
}

const ResizablePanel = React.forwardRef<
  HTMLDivElement,
  ResizablePanelProps
>(({ className, children, defaultSize = 50, ...props }, ref) => {
  const style = {
    flexBasis: `${defaultSize}%`,
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
})
ResizablePanel.displayName = "ResizablePanel"

const ResizableHandle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { withHandle?: boolean }
>(({ className, withHandle = false, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative flex items-center justify-center bg-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      "data-[panel-group-direction=vertical]:h-2.5 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:cursor-row-resize data-[panel-group-direction=vertical]:[--handle-size:0.5rem]",
      "data-[panel-group-direction=horizontal]:w-2.5 data-[panel-group-direction=horizontal]:h-full data-[panel-group-direction=horizontal]:cursor-col-resize data-[panel-group-direction=horizontal]:[--handle-size:0.5rem]",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <Grip className="h-2.5 w-2.5" />
      </div>
    )}
  </div>
))
ResizableHandle.displayName = "ResizableHandle"

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }