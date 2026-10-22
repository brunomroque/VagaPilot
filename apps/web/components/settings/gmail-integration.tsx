"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  MailIcon,
  MinusIcon,
  RefreshCwIcon,
  SendIcon,
  UnplugIcon,
} from "lucide-react"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"

import { useWorkspace } from "@/components/app/workspace-context"
import { syncGmailNow } from "@/lib/gmail/actions"
import type { GmailConnectionView, GmailMode } from "@/lib/gmail/types"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"

const ERROR_CODES = [
  "invalid_state",
  "denied",
  "not_configured",
  "read_first",
  "scope_not_granted",
  "missing_refresh_token",
  "oauth_failed",
  "risk_acceptance_required",
] as const

type ErrorCode = (typeof ERROR_CODES)[number]

function isErrorCode(value: string | undefined): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value ?? "")
}

export type GmailFlash = { gmail?: string; motivo?: string }

/** Settings → Integrações → Gmail (P4.1, RF11.1, RF11.9). */
export function GmailIntegration({
  mode,
  connection,
  reviewCount,
  flash,
  isDev,
}: {
  mode: GmailMode
  connection: GmailConnectionView | null
  reviewCount: number
  flash: GmailFlash
  isDev: boolean
}) {
  const t = useTranslations("Gmail")
  const format = useFormatter()
  const { now } = useWorkspace()
  const router = useRouter()
  const [syncing, startSync] = useTransition()
  const [demoPending, setDemoPending] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const flashShown = useRef(false)

  useEffect(() => {
    if (flashShown.current || !flash.gmail) return
    flashShown.current = true
    if (flash.gmail === "conectado" || flash.gmail === "envio") {
      toast.success(t(`flash.${flash.gmail}`))
    } else if (flash.gmail === "erro") {
      toast.error(t("flash.erro"), {
        description: isErrorCode(flash.motivo)
          ? t(`errors.${flash.motivo}`)
          : undefined,
      })
    }
    router.replace("/app/configuracoes", { scroll: false })
  }, [flash, router, t])

  const connected = connection !== null
  const configured = mode !== "unconfigured"
  const statusKey = connection ? connection.status : "off"

  function sync() {
    startSync(async () => {
      const result = await syncGmailNow()
      if (!result.ok) {
        toast.error(t("syncFailed"))
        return
      }
      switch (result.data.status) {
        case "ok":
        case "stopped":
          toast.success(
            t("synced", {
              applied: result.data.applied,
              review: result.data.review,
            })
          )
          break
        case "queued":
          toast.success(t("syncQueued"))
          break
        case "locked":
          toast.info(t("syncLocked"))
          break
        case "not_connected":
          toast.error(t("syncNotConnected"))
          break
        case "error":
          toast.error(t("syncFailed"))
          break
        default: {
          const unreachable: never = result.data.status
          throw new Error(`Unknown sync status: ${String(unreachable)}`)
        }
      }
    })
  }

  async function deliverDemo() {
    setDemoPending(true)
    try {
      const response = await fetch("/api/dev/gmail-mock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset: "demo" }),
      })
      const json = (await response.json().catch(() => null)) as {
        data?: { delivered: number }
      } | null
      if (!response.ok || !json?.data) throw new Error("demo")
      toast.success(t("demoDelivered", { count: json.data.delivered }))
    } catch {
      toast.error(t("demoFailed"))
    } finally {
      setDemoPending(false)
    }
  }

  async function disconnect() {
    setConfirmOpen(false)
    setDisconnecting(true)
    try {
      const response = await fetch("/api/google/connection", {
        method: "DELETE",
      })
      const json = (await response.json().catch(() => null)) as {
        data?: { google: string }
      } | null
      if (!response.ok || !json?.data) throw new Error("revoke")
      toast.success(t("disconnected"), {
        description:
          json.data.google === "failed" ? t("googleRevokeFailed") : undefined,
      })
      router.refresh()
    } catch {
      toast.error(t("disconnectFailed"))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-bold">
          <MailIcon className="size-4 text-primary" aria-hidden="true" />
          <h4>{t("title")}</h4>
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge
            variant={
              connection?.status === "ativo"
                ? "default"
                : connection
                  ? "destructive"
                  : "secondary"
            }
          >
            {t(`status.${statusKey}`)}
          </Badge>
          {mode === "mock" ? (
            <Badge variant="outline">
              <FlaskConicalIcon data-icon="inline-start" />
              {t("mockBadge")}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {!configured ? (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>{t("notConfiguredTitle")}</AlertTitle>
            <AlertDescription>
              {isDev ? t("notConfiguredDev") : t("notConfiguredProd")}
            </AlertDescription>
          </Alert>
        ) : null}

        {connection?.status === "erro" ? (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>{t("errorTitle")}</AlertTitle>
            <AlertDescription>{t("errorDescription")}</AlertDescription>
          </Alert>
        ) : null}

        {connected ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">{t("account")}</dt>
            <dd className="min-w-0 truncate font-medium">
              {connection.googleEmail}
            </dd>
            <dt className="text-muted-foreground">{t("permissions")}</dt>
            <dd className="flex flex-wrap gap-2">
              <Badge variant={connection.canRead ? "secondary" : "outline"}>
                {connection.canRead ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <MinusIcon data-icon="inline-start" />
                )}
                {t("permissionRead")}
              </Badge>
              <Badge variant={connection.canSend ? "secondary" : "outline"}>
                {connection.canSend ? (
                  <CheckIcon data-icon="inline-start" />
                ) : (
                  <MinusIcon data-icon="inline-start" />
                )}
                {t("permissionSend")}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">{t("lastSync")}</dt>
            <dd>
              {connection.lastSyncedAt
                ? format.relativeTime(
                    new Date(
                      Math.min(
                        Date.parse(connection.lastSyncedAt),
                        now.getTime()
                      )
                    ),
                    now
                  )
                : t("neverSynced")}
            </dd>
            <dt className="text-muted-foreground">{t("toReview")}</dt>
            <dd>
              <Link
                href="/app/acoes#revise"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("reviewLink", { count: reviewCount })}
              </Link>
            </dd>
          </dl>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h5 className="text-sm font-semibold">{t("readsTitle")}</h5>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                <li>{t("reads1")}</li>
                <li>{t("reads2")}</li>
                <li>{t("reads3")}</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <h5 className="text-sm font-semibold">{t("notReadsTitle")}</h5>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
                <li>{t("notReads1")}</li>
                <li>{t("notReads2")}</li>
                <li>{t("notReads3")}</li>
                <li>{t("notReads4")}</li>
              </ul>
            </div>
          </div>
        )}

        {connected && !connection.canSend ? (
          <>
            <Separator />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t("allowSendHint")}
              </p>
              <a
                href="/api/google/oauth/start?scope=envio"
                className={buttonVariants({
                  variant: "outline",
                  className: "shrink-0",
                })}
              >
                <SendIcon data-icon="inline-start" />
                {t("allowSend")}
              </a>
            </div>
          </>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {!connected || connection.status === "erro" ? (
          <>
            {configured ? (
              <a
                href="/api/google/oauth/start?scope=leitura"
                className={buttonVariants()}
              >
                <MailIcon data-icon="inline-start" />
                {t("connect")}
              </a>
            ) : (
              <Button disabled>
                <MailIcon data-icon="inline-start" />
                {t("connect")}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">{t("connectHint")}</p>
          </>
        ) : null}

        {connected && connection.status === "ativo" ? (
          <Button onClick={sync} disabled={syncing}>
            {syncing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            {syncing ? t("syncing") : t("syncNow")}
          </Button>
        ) : null}

        {mode === "mock" && connected ? (
          <Button
            variant="outline"
            onClick={deliverDemo}
            disabled={demoPending}
          >
            {demoPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FlaskConicalIcon data-icon="inline-start" />
            )}
            {t("demo")}
          </Button>
        ) : null}

        {connected ? (
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogTrigger
              render={<Button variant="ghost" disabled={disconnecting} />}
            >
              {disconnecting ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <UnplugIcon data-icon="inline-start" />
              )}
              {t("disconnect")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("disconnectDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => void disconnect()}
                >
                  {t("disconnect")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}

        {connected ? (
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({
              variant: "link",
              size: "sm",
              className: "ml-auto",
            })}
          >
            {t("manageGoogle")}
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        ) : null}
      </CardFooter>
    </Card>
  )
}
