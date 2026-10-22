import { getRequestConfig } from "next-intl/server"

import { defaultLocale, type AppLocale } from "./locales"

const messageLoaders = {
  "pt-BR": () => import("../messages/pt-BR.json"),
  en: () => import("../messages/en.json"),
} satisfies Record<
  AppLocale,
  () => Promise<{ default: Record<string, unknown> }>
>

export default getRequestConfig(async () => {
  const locale: AppLocale = defaultLocale
  const messages = (await messageLoaders[locale]()).default

  return { locale, messages, timeZone: "America/Sao_Paulo" }
})
