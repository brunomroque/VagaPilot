# Segurança — VagaPilot (beta)

Referência: [ESPEC.md](./ESPEC.md) seções 10.4, 12 e fase P7.2. Checklist alinhado ao **OWASP ASVS L2** (controles aplicáveis ao MVP web + extensão).

## Checklist ASVS (resumo operacional)

| Área | Controle                                                 | Status no repositório                 |
| ---- | -------------------------------------------------------- | ------------------------------------- |
| V1   | Validação de entrada com Zod nas rotas API               | Implementado                          |
| V2   | Autenticação Supabase; extensão com token de dispositivo | Implementado                          |
| V3   | Sessão cookie HttpOnly; dev bypass só local              | Implementado                          |
| V4   | RBAC via RLS Postgres (`user_id = auth.uid()`)           | Implementado + job CI `rls`           |
| V5   | Validação de saída; filtro de chat; `verifyGrounding`    | Implementado + evals                  |
| V7   | Erros sem vazamento de stack ao cliente                  | Padrão `{ error: { code, message } }` |
| V8   | Dados sensíveis em `_enc`; redação `redactPII`           | `packages/core/redact`                |
| V9   | CSP, X-Frame-Options, HSTS na Vercel                     | CSP em `apps/web/lib/security/csp.ts` |
| V10  | CSRF: SameSite + origem em mutações                      | Parcial (SameSite cookies)            |
| V11  | Rate limit chat (DB + Upstash opcional)                  | `upstash-ratelimit.ts`                |
| V12  | Upload limitado (10 MB, tipos)                           | Chat/CV conforme spec 10.4            |
| V13  | Logs/traces sem PII; Langfuse com redação                | `llmTelemetryOptions` + redact        |
| V14  | Segredos só em env; canários no CI                       | `evals/secrets-canaries`              |
| V15  | Dependências: `pnpm audit` local; CodeQL                 | Pendente público                      |

## Observabilidade (P7.2)

| Ferramenta    | Variáveis                              | Comportamento sem chave     |
| ------------- | -------------------------------------- | --------------------------- |
| Sentry        | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Inativo                     |
| OpenTelemetry | `OTEL_EXPORTER_OTLP_ENDPOINT`          | Inativo                     |
| Langfuse      | `LANGFUSE_*`                           | Telemetria AI SDK desligada |
| PostHog       | `NEXT_PUBLIC_POSTHOG_*`                | Provider no-op              |

## Evals bloqueantes (10.6)

- `pnpm eval:no-fabrication` — **bloqueia merge** (0 afirmações sem suporte).
- Demais suítes em `pnpm evals` e `pnpm eval:email` — metas de volume documentadas em [PROGRESSO.md](./PROGRESSO.md).

## Pendências conscientes

- Pentest antes do público (spec 12).
- MFA obrigatório na fase 2 (envio autônomo).
- Entitlements Stripe/Gmail (P6) ainda não ligados — ver runbook de dependências.
