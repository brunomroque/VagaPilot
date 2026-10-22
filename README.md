# VagaPilot

Monorepo do assistente de candidaturas. A especificação portátil está em [docs/ESPEC.md](docs/ESPEC.md). O PDF original está em [docs/ESPEC-app-assistente-vagas.pdf](docs/ESPEC-app-assistente-vagas.pdf).

## Scripts

```bash
pnpm install
pnpm turbo lint typecheck test build
pnpm dev
```

`pnpm --filter web test:e2e` roda o scaffold Playwright (não faz parte do `turbo test`).

## Pacotes

| Pasta                   | Nome                      | Papel nesta fase                            |
| ----------------------- | ------------------------- | ------------------------------------------- |
| `apps/web`              | `web`                     | Next.js App Router                          |
| `apps/extension`        | `extension`               | Casca MV3 (WXT + React)                     |
| `packages/ui`           | `@workspace/ui`           | shadcn compartilhado                        |
| `packages/config`       | `@vagapilot/config`       | ESLint flat, tsconfig, preset Tailwind      |
| `packages/core`         | `@vagapilot/core`         | Domínio puro (ainda só o entry de fundação) |
| `packages/db`           | `@vagapilot/db`           | Drizzle, depois                             |
| `packages/ai`           | `@vagapilot/ai`           | Agente, depois                              |
| `packages/ats-adapters` | `@vagapilot/ats-adapters` | Fontes de vaga, depois                      |
| `packages/gmail`        | `@vagapilot/gmail`        | Gmail, depois                               |
| `packages/jobs`         | `@vagapilot/jobs`         | Inngest, depois                             |

## Adicionar um componente shadcn

Na raiz do app web:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

O CLI grava o componente em `packages/ui`. No app:

```tsx
import { Button } from "@workspace/ui/components/button"
```

Aliases em `apps/web/components.json` e `packages/ui/components.json`.
