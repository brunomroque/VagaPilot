import * as React from "react"
import { cn } from "cn"
import { ShieldCheckIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export type ApprovalCardProps = {
  title: string
  description?: string | null
  rows?: { label: string; value: string }[]
  confirmLabel: string
  cancelLabel: string
  onConfirm?: () => void
  onCancel?: () => void
  /** Final state after the decision; buttons are hidden. */
  resolved?: { label: string; tone: "success" | "muted" } | null
  busy?: boolean
  className?: string
}

/** F7 ApprovalCard: nothing sensitive happens until the person clicks "Confirmar" (CA14.3). */
export function ApprovalCard({
  title,
  description,
  rows = [],
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  resolved,
  busy = false,
  className,
}: ApprovalCardProps) {
  const titleId = React.useId()
  return (
    <Card
      size="sm"
      role="region"
      aria-labelledby={titleId}
      data-testid="approval-card"
      className={cn("w-full max-w-2xl ring-primary/30", className)}
    >
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle id={titleId} className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />
          {title}
        </CardTitle>
        {resolved ? (
          <Badge variant={resolved.tone === "success" ? "default" : "outline"}>
            {resolved.label}
          </Badge>
        ) : null}
        {description ? (
          <CardDescription className="col-span-2">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      {rows.length > 0 ? (
        <CardContent>
          <dl className="grid gap-1.5 text-sm">
            {rows.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className="grid grid-cols-[minmax(0,10rem)_1fr] gap-2"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 break-words">{row.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      ) : null}
      {!resolved && (onConfirm || onCancel) ? (
        <CardFooter className="gap-2">
          {onConfirm ? (
            <Button size="sm" onClick={onConfirm} disabled={busy}>
              {confirmLabel}
            </Button>
          ) : null}
          {onCancel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </Button>
          ) : null}
        </CardFooter>
      ) : null}
    </Card>
  )
}
