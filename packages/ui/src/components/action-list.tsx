import * as React from "react"
import { cn } from "cn"
import { CalendarClockIcon, ListTodoIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export type ActionListItem = {
  id: string
  title: string
  subtitle?: string | null
  due?: string | null
  tone?: "overdue" | "soon" | "normal"
  href?: string
}

export type ActionListProps = {
  title: string
  items: ActionListItem[]
  emptyLabel: string
  summary?: React.ReactNode
  className?: string
}

/** F7 ActionList: pending actions ordered by deadline. */
export function ActionList({
  title,
  items,
  emptyLabel,
  summary,
  className,
}: ActionListProps) {
  const titleId = React.useId()
  return (
    <Card
      size="sm"
      className={cn("w-full max-w-2xl", className)}
      aria-labelledby={titleId}
      role="region"
    >
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2">
          <ListTodoIcon
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {summary}
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {items.map((item) => {
              const body = (
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.title}</span>
                  {item.subtitle ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
              )
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  {item.href ? (
                    <a
                      href={item.href}
                      className="flex min-w-0 flex-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {body}
                    </a>
                  ) : (
                    body
                  )}
                  {item.due ? (
                    <Badge
                      variant={
                        item.tone === "overdue"
                          ? "destructive"
                          : item.tone === "soon"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      <CalendarClockIcon aria-hidden="true" />
                      {item.due}
                    </Badge>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
