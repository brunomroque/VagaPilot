export const locales = ["pt-BR"] as const

export type AppLocale = (typeof locales)[number]

export const defaultLocale: AppLocale = "pt-BR"
