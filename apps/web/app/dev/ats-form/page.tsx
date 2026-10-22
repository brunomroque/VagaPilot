import { readFileSync } from "node:fs"
import { join } from "node:path"

/** Dev-only ATS fixture host for extension e2e (fixtures/ats). */
export default async function DevAtsFormPage({
  searchParams,
}: {
  searchParams: Promise<{ fixture?: string; vp_app?: string }>
}) {
  if (process.env.NODE_ENV === "production") {
    return <p>Não disponível.</p>
  }
  const params = await searchParams
  const fixture = params.fixture ?? "generic-apply.html"
  const html = readFileSync(
    join(process.cwd(), "../../fixtures/ats", fixture),
    "utf8"
  )
  return (
    <div
      // Fixture HTML is fictional and local-only.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
