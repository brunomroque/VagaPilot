import type { ReactNode } from "react"
import { DM_Sans, Manrope } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getTranslations } from "next-intl/server"

import "@workspace/ui/globals.css"
import { PostHogProvider } from "@/components/posthog-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

const fontSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" })

const fontHeading = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
})

export async function generateMetadata() {
  const t = await getTranslations("Metadata")

  return {
    title: t("title"),
    description: t("description"),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  const locale = await getLocale()
  const t = await getTranslations("Common")

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        fontSans.variable,
        fontHeading.variable
      )}
    >
      <body>
        <NextIntlClientProvider>
          <PostHogProvider>
            <ThemeProvider defaultTheme="light" enableSystem={false}>
              <TooltipProvider>{children}</TooltipProvider>
              <Toaster
                position="bottom-center"
                containerAriaLabel={t("toasts")}
              />
            </ThemeProvider>
          </PostHogProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
