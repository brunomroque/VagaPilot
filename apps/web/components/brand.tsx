import { SparklesIcon } from "lucide-react"
import { useTranslations } from "next-intl"

import { cn } from "@workspace/ui/lib/utils"

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-accent",
        className
      )}
    >
      <SparklesIcon className="size-4 fill-current" />
    </span>
  )
}

export function Brand({ className }: { className?: string }) {
  const t = useTranslations("Brand")

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="font-heading text-lg font-extrabold tracking-tight">
        {t("name")}
      </span>
    </span>
  )
}
