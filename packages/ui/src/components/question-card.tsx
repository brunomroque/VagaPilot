import * as React from "react"
import { cn } from "cn"
import { MessageCircleQuestionIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export type QuestionCardProps = {
  question: string
  options: string[]
  onSelect?: (option: string) => void
  selected?: string | null
  disabled?: boolean
  optionsLabel: string
  className?: string
}

/** F7 QuestionCard / clarification widget (RF14.4): clickable options, never a silent guess. */
export function QuestionCard({
  question,
  options,
  onSelect,
  selected,
  disabled = false,
  optionsLabel,
  className,
}: QuestionCardProps) {
  const titleId = React.useId()
  return (
    <Card
      size="sm"
      role="region"
      aria-labelledby={titleId}
      data-testid="question-card"
      className={cn("w-full max-w-2xl", className)}
    >
      <CardHeader>
        <CardTitle id={titleId} className="flex items-center gap-2">
          <MessageCircleQuestionIcon
            className="size-4 text-primary"
            aria-hidden="true"
          />
          {question}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="group"
          aria-label={optionsLabel}
          className="flex flex-wrap gap-2"
        >
          {options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={selected === option ? "default" : "outline"}
              aria-pressed={selected === option}
              disabled={disabled || Boolean(selected)}
              onClick={() => onSelect?.(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
