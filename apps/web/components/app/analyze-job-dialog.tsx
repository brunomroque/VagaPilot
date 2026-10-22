"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircle2Icon, ChevronRightIcon, SparklesIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"

import { useWorkspace } from "@/components/app/workspace-context"
import { extractUrls, MAX_LINKS_PER_BATCH } from "@vagapilot/core/guardrails"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Textarea } from "@workspace/ui/components/textarea"

/** One link per line; bare domains ("linkedin.com/jobs/view/…") get https:// (RF4.1). */
function linksOf(value: string): string[] {
  const withProtocol = value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) =>
      /^https?:\/\//i.test(token) || !/\.[a-z]{2,}/i.test(token)
        ? token
        : `https://${token}`
    )
    .join("\n")
  return extractUrls(withProtocol)
}

/** "Analisar nova vaga": sends the links to the chat, where the cards appear one by one. */
export function AnalyzeJobDialog() {
  const t = useTranslations("AnalyzeDialog")
  const tCommon = useTranslations("Common")
  const router = useRouter()
  const { analyzeOpen, setAnalyzeOpen } = useWorkspace()

  const schema = z.object({
    links: z
      .string()
      .trim()
      .min(1, t("invalid"))
      .refine((value) => linksOf(value).length > 0, t("invalid"))
      .refine(
        (value) => linksOf(value).length <= MAX_LINKS_PER_BATCH,
        t("tooMany", { max: MAX_LINKS_PER_BATCH })
      ),
  })

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { links: "" },
  })

  function onOpenChange(open: boolean) {
    setAnalyzeOpen(open)
    if (!open) form.reset()
  }

  const onSubmit = form.handleSubmit(({ links }) => {
    const urls = linksOf(links)
    onOpenChange(false)
    router.push(`/app/chat?analisar=${encodeURIComponent(urls.join("\n"))}`)
  })

  return (
    <Dialog open={analyzeOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" closeLabel={tCommon("close")}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
              <SparklesIcon className="size-5" />
            </span>
            <DialogTitle className="text-xl font-bold">
              {t("title")}
            </DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Controller
              control={form.control}
              name="links"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid || undefined}>
                  <FieldLabel htmlFor="job-url">{t("label")}</FieldLabel>
                  <Textarea
                    {...field}
                    id="job-url"
                    rows={4}
                    inputMode="url"
                    autoComplete="off"
                    autoFocus
                    placeholder={t("placeholder")}
                    aria-invalid={fieldState.invalid}
                  />
                  <FieldError errors={[fieldState.error]} />
                  <FieldDescription className="flex items-center gap-1.5">
                    <CheckCircle2Icon className="size-4 text-primary" />
                    {t("trust")}
                  </FieldDescription>
                </Field>
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("cancel")}
            </DialogClose>
            <Button type="submit">
              {t("submit")}
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
