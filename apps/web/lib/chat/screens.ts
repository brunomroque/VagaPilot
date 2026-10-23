/** Deep links from chat tools to existing /app screens (chat-first spec 3.4). */

export const CHAT_SCREEN_PATHS = {
  home: "/app",
  panel: "/app/visao-geral",
  chat: "/app/chat",
  applications: "/app/candidaturas",
  tasks: "/app/acoes",
  cvs: "/app/cvs",
  searches: "/app/buscas",
  memory: "/app/memoria",
  facts: "/app/fatos",
  profile: "/app/perfil",
  settings: "/app/configuracoes",
  onboarding: "/app/onboarding",
} as const

export type ChatScreenKey = keyof typeof CHAT_SCREEN_PATHS

export type ChatScreenContext = {
  screen: ChatScreenKey | "unknown"
  pathname: string
  applicationId?: string | null
  jobPostingId?: string | null
  cvVersionId?: string | null
}

export function screenFromPathname(
  pathname: string
): ChatScreenKey | "unknown" {
  if (pathname === "/app" || pathname === "/app/") return "home"
  if (pathname.startsWith("/app/visao-geral")) return "panel"
  if (pathname.startsWith("/app/chat")) return "chat"
  if (pathname.startsWith("/app/candidaturas")) return "applications"
  if (pathname.startsWith("/app/acoes")) return "tasks"
  if (pathname.startsWith("/app/cvs")) return "cvs"
  if (pathname.startsWith("/app/buscas")) return "searches"
  if (pathname.startsWith("/app/memoria")) return "memory"
  if (pathname.startsWith("/app/fatos")) return "facts"
  if (pathname.startsWith("/app/perfil")) return "profile"
  if (pathname.startsWith("/app/configuracoes")) return "settings"
  if (pathname.startsWith("/app/onboarding")) return "onboarding"
  return "unknown"
}

export function buildDeepLink(input: {
  screen: ChatScreenKey
  applicationId?: string
  cvVersionId?: string
  factId?: string
  searchId?: string
}): string {
  const base = CHAT_SCREEN_PATHS[input.screen]
  const params = new URLSearchParams()
  if (input.applicationId) params.set("id", input.applicationId)
  if (input.cvVersionId) params.set("version", input.cvVersionId)
  if (input.factId) params.set("id", input.factId)
  if (input.searchId) params.set("id", input.searchId)
  const qs = params.toString()
  if (input.screen === "profile" && input.factId) {
    return `${base}#experiencias`
  }
  return qs ? `${base}?${qs}` : base
}
