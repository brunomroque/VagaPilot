import { notFound } from "next/navigation"
import type { ReactNode } from "react"

/** Block every /dev/* route in production builds (QA smoke). */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound()
  return children
}
