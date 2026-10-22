# Runbook — Playwright e2e no CI

## Configuração

- Porta dedicada: **3100** (`E2E_PORT`, ver `apps/web/playwright.config.ts`).
- Servidor: `next dev` com `VAGAPILOT_DEV_AUTH_BYPASS=1`, fixtures ATS e Gmail mock.
- CI: job `e2e`, `workers: 1`, `retries: 2`.

## Reproduzir localmente

```bash
pnpm --filter web test:e2e
```

## Falhas comuns

| Falha                            | Ação                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| Timeout no primeiro request      | Aumentar `webServer.timeout` ou rodar build antes             |
| `chat.spec.ts` / `memory_events` | Garantir filtro por `conversation_id` e `created_at`          |
| Supabase local ausente           | E2e usa bypass; não precisa de stack para a maioria dos specs |
| Porta em uso                     | Definir `E2E_PORT=3101`                                       |

## Extensão Chrome carregada

E2e completo MV3 (extensão + side panel) **não** roda no CI hoje. Cobertura parcial: `e2e/extension.spec.ts` (API + fixture HTML). Ver [extension-e2e-gap.md](./extension-e2e-gap.md).
