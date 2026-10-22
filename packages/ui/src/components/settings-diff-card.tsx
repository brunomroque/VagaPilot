import * as React from "react"
import { cn } from "cn"
import { ArrowRightIcon, SlidersHorizontalIcon, Undo2Icon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export type SettingsDiffRow = { field: string; before: string; after: string }

export type SettingsDiffCardProps = {
  title: string
  rows: SettingsDiffRow[]
  statusLabel: string
  undone?: boolean
  undoLabel: string
  onUndo?: () => void
  busy?: boolean
  beforeLabel: string
  afterLabel: string
  className?: string
}

/** F14 card: what was understood as "antes â†’ depois", applied with "Desfazer" (RF14.3). */
export function SettingsDiffCard({
  title,
  rows,
  statusLabel,
  undone = false,
  undoLabel,
  onUndo,
  busy = false,
  beforeLabel,
  afterLabel,
  className,
}: SettingsDiffCardProps) {
  const titleId = React.useId()
  return (
    <Card
      size="sm"
      role="region"
      aria-labelledby={titleId}
      data-testid="settings-diff-card"
      data-undone={undone || undefined}
      className={cn("w-full max-w-2xl", className)}
    >
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle id={titleId} className="flex items-center gap-2">
          <SlidersHorizontalIcon
            className="size-4 text-primary"
            aria-hidden="true"
          />
          {title}
        </CardTitle>
        <Badge variant={undone ? "outline" : "secondary"}>{statusLabel}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th scope="col">{title}</th>
                <th scope="col">{beforeLabel}</th>
                <th scope="col">{afterLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.field} className="align-top">
                  <th
                    scope="row"
                    className="py-1 pr-3 text-left font-normal text-muted-foreground"
                  >
                    {row.field}
                  </th>
                  <td className="py-1 pr-2 break-words text-muted-foreground line-through decoration-muted-foreground/50">
                    {row.before}
                  </td>
                  <td className="py-1 pr-2" aria-hidden="true">
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                  </td>
                  <td className="py-1 font-medium break-words">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {onUndo && !undone ? (
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={onUndo}
              disabled={busy}
            >
              <Undo2Icon data-icon="inline-start" />
              {undoLabel}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
