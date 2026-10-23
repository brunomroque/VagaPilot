/**
 * Fixture-backed `fetch` for tests, local dev and e2e (P2.1: no network in CI).
 * Serves the recorded FICTITIOUS responses in `fixtures/`; unknown URLs answer 404.
 * Node only (reads files). Never enabled in production builds by the web app.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

type Route = { file?: string; status?: number; contentType?: string }

export type RecordedRequest = {
  url: string
  headers: Record<string, string>
  credentials: RequestCredentials | undefined
}

export type FixtureFetch = typeof fetch & { requests: RecordedRequest[] }

/** Links used across tests and the e2e suite. */
export const FIXTURE_JOB_URLS = {
  greenhouse: "https://boards.greenhouse.io/empresaficticia/jobs/4001001",
  greenhouseEn: "https://job-boards.greenhouse.io/lojaexemplo/jobs/4001002",
  lever:
    "https://jobs.lever.co/exemplotech/8b1c2d3e-0000-4000-8000-000000000001",
  gupy: "https://empresaficticia.gupy.io/jobs/1001",
  linkedin: "https://www.linkedin.com/jobs/view/3900000001/",
  linkedinBlocked: "https://www.linkedin.com/jobs/view/3900000999/",
  injection: "https://logisticaficticia.gupy.io/jobs/1666",
  missing: "https://vagas.exemplo.test/nao-existe-404",
} as const

/**
 * Dev and e2e only. `dir` and `file` are chosen at runtime, so without the
 * ignore comment Turbopack traces the whole repository into the server bundle.
 */
function readFixtureText(dir: string, file: string): string {
  return readFileSync(
    /*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, file),
    "utf8"
  )
}

function fixtureFileExists(dir: string, file: string): boolean {
  return existsSync(
    /*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, file)
  )
}

function candidateDirs(): string[] {
  const dirs: string[] = []
  try {
    dirs.push(resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures"))
  } catch {
    // Bundled code may not expose a file URL; fall back to walking up from cwd.
  }
  let current = process.cwd()
  for (let depth = 0; depth < 6; depth += 1) {
    dirs.push(
      join(current, "packages/ats-adapters/fixtures"),
      join(current, "fixtures")
    )
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirs
}

export function fixturesDir(): string {
  const found = candidateDirs().find((dir) =>
    fixtureFileExists(dir, "routes.json")
  )
  if (!found) throw new Error("ATS fixtures directory not found")
  return found
}

function loadRoutes(dir: string): Record<string, Route> {
  const raw = JSON.parse(readFixtureText(dir, "routes.json")) as {
    routes: Record<string, Route>
  }
  return raw.routes
}

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  const headers = new Headers(init?.headers)
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

export function createFixtureFetch(
  options: { dir?: string; delayMs?: number } = {}
): FixtureFetch {
  const dir = options.dir ?? fixturesDir()
  const routes = loadRoutes(dir)
  const requests: RecordedRequest[] = []
  const fixtureFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    requests.push({
      url,
      headers: headerRecord(init),
      credentials: init?.credentials,
    })
    if (options.delayMs)
      await new Promise((done) => setTimeout(done, options.delayMs))
    const route = routes[url]
    if (!route) return new Response("not found", { status: 404 })
    if (!route.file) return new Response("", { status: route.status ?? 500 })
    return new Response(readFixtureText(dir, route.file), {
      status: route.status ?? 200,
      headers: { "content-type": route.contentType ?? "text/html" },
    })
  }) as FixtureFetch
  fixtureFetch.requests = requests
  return fixtureFetch
}

export type ExpectedFixture = {
  url: string
  source: string
  company: string
  title: string
}

export function loadExpectedFixtures(
  dir: string = fixturesDir()
): ExpectedFixture[] {
  return (
    JSON.parse(readFixtureText(dir, "expected.json")) as {
      postings: ExpectedFixture[]
    }
  ).postings
}
