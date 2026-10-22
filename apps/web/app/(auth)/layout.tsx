import type { ReactNode } from "react"
import Link from "next/link"

import { Brand } from "@/components/brand"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <Link href="/" className="rounded-lg">
        <Brand />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  )
}
