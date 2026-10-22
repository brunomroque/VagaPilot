"use client"

import { useState, useTransition } from "react"
import { useTranslations } from "next-intl"
import { PuzzleIcon } from "lucide-react"
import { toast } from "sonner"

import { startExtensionPairing } from "@/lib/ext/actions"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

export function ExtensionIntegration() {
  const t = useTranslations("Settings.extension")
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PuzzleIcon className="size-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {code ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-center">
            <p className="text-xs text-muted-foreground">{t("codeLabel")}</p>
            <p className="font-mono text-3xl font-bold tracking-[0.3em]">
              {code}
            </p>
            {expiresAt ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("expires", {
                  time: new Date(expiresAt).toLocaleTimeString("pt-BR"),
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
        )}
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await startExtensionPairing()
              if (!result.ok) {
                toast.error(result.error.message)
                return
              }
              setCode(result.data.code)
              setExpiresAt(result.data.expiresAt)
              toast.success(t("generated"))
            })
          }
        >
          {t("generate")}
        </Button>
      </CardFooter>
    </Card>
  )
}
