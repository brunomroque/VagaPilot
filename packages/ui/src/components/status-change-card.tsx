import * as React from "react"
import { cn } from "cn"
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

export type StatusChangeCardProps = {
  title: string
  from?: string | null
  to: string
  note?: string | null
  action?: { label: string; onClick: () => void; disabled?: boolean }
  className?: string
}

/** F7 StatusChangeCard: "Empresa · Cargo: Rascunho → Pulada" with an optional action. */
export function StatusChangeCard({
  title,
  from,
  to,
  note,
  action,
  className,
}: StatusChangeCardProps) {
  return (
    <div
      role="status"
      data-testid="status-change-card"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm",
        className
      )}
    >
      <RefreshCwIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 font-medium">{title}</span>
      <span className="flex items-center gap-1.5">
        {from ? (
          <>
            <Badge variant="outline">{from}</Badge>
            <ArrowRightIcon
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </>
        ) : null}
        <Badge variant="secondary">{to}</Badge>
      </span>
      {note ? (
        <span className="text-xs text-muted-foreground">{note}</span>
      ) : null}
      {action ? (
        <Button
          size="xs"
          variant="ghost"
          onClick={action.onClick}
          disabled={action.disabled}
          className="ml-auto"
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}
