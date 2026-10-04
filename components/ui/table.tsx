"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/** Whether a box is narrower than its content, so that it scrolls sideways; kept up to date. */
function useScrollsSideways(box: React.RefObject<HTMLElement | null>) {
  const [scrolls, setScrolls] = React.useState(false)
  React.useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === "undefined") return
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [box])
  return scrolls
}

/** While a box scrolls sideways, a named region a keyboard can reach and scroll (WCAG 2.1.1). */
const scrollRegion = (scrolls: boolean, label?: string) =>
  scrolls && label ? { role: "region", "aria-label": label, tabIndex: 0 } : {}

/** A box for wide content that scrolls sideways on a narrow screen; `label` names it while it does. */
function ScrollRegion({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null)
  const scrolls = useScrollsSideways(box)
  return <div ref={box} className={className} {...scrollRegion(scrolls, label)}>{children}</div>
}

/** A table whose container scrolls sideways when it is wider than the screen; `label` names it then. */
function Table({ className, label, ...props }: React.ComponentProps<"table"> & { label?: string }) {
  const container = React.useRef<HTMLDivElement>(null)
  const scrolls = useScrollsSideways(container)
  return (
    <div
      ref={container}
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
      {...scrollRegion(scrolls, label)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  ScrollRegion,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
