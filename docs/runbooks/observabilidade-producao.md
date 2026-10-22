# Runbook — observabilidade em produção

## Sentry

1. Criar projeto web na org Sentry.
2. Definir `SENTRY_DSN` e `NEXT_PUBLIC_SENTRY_DSN` na Vercel.
3. Confirmar que eventos chegam **sem** CPF/e-mail (ver `redactSentryEvent`).

## Langfuse

1. Projeto Langfuse (cloud ou self-host UE).
2. `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.
3. Traces do chat habilitados via `llmTelemetryOptions("chat")`; conteúdo passa por redação de metadados.

## PostHog

1. Projeto UE ou self-host; **sem** identify com e-mail/nome.
2. `NEXT_PUBLIC_POSTHOG_KEY` + host.
3. Eventos permitidos: pseudônimos (`job_analyzed`, etc., spec 12.4).

## OpenTelemetry

1. Coletor ou backend compatível OTLP HTTP.
2. `OTEL_EXPORTER_OTLP_ENDPOINT` + opcional `OTEL_SERVICE_NAME=vagapilot-web`.

## Upstash

1. Redis REST na região próxima ao app.
2. `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. Sem credenciais: rate limit de chat continua via contagem em Postgres.
