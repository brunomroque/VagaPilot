# Auditoria go-live — snapshot MCP (2026-10-23)

Verificação automatizada de pré-requisitos de produção para **VagaPilot** (`https://vagapilot.netlify.app`, Supabase `synbycvebzzqarojicfu`).  
Ferramentas: Netlify MCP, Supabase MCP (projeto linkado), Stripe MCP, `curl`. **Não** inclui leitura de `.env.netlify` local.

Legenda de status: **OK** | **Parcial** | **Não verificável** | **Falta**

---

## Resumo executivo

| Área                                 | Status geral                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Deploy Netlify                       | **OK** — produção `ready`, commit `fe5b83e`                                                 |
| Variáveis Netlify (núcleo go-live)   | **OK** — Supabase, Stripe, `NEXT_PUBLIC_APP_URL` presentes em produção                      |
| Migrações Supabase                   | **Parcial** — chat-first/QA OK; 3 migrações do repo ainda não no hospedado                  |
| Supabase Auth (Site URL / redirects) | **Não verificável** via MCP — conferir no dashboard                                         |
| Stripe webhook Live                  | **Não verificável** — sessão MCP só conta **Test**                                          |
| Stripe webhook Test                  | **Falta** — endpoint placeholder desabilitado, sem `checkout.session.completed`             |
| Smoke HTTP                           | **OK** — `/precos` 200, callback redirect esperado, webhook rota ativa (400 sem assinatura) |

---

## Tabela consolidada

| Item                                         | Status          | Evidência MCP/curl                                                                                                                                                                                                                                                   |
| -------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Netlify — deploy produção**                | OK              | `netlify-project-services-reader` → site `vagapilot` (`af7cbebc-fe91-4053-8e42-dddced8c6f04`); `netlify-deploy-services-reader` → deploy `6adb73cbec51f0e926470603` **state `ready`**, branch `main`, commit `fe5b83e`, publicado 2026-10-23T14:51:17Z               |
| **Netlify — `NEXT_PUBLIC_APP_URL`**          | OK              | `manage-env-vars` (getAll) → valor `https://vagapilot.netlify.app`, contexto `all`                                                                                                                                                                                   |
| **Netlify — Supabase (URL + chaves + DB)**   | OK              | Chaves **presentes** em produção: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_PROJECT_REF` (valores mascarados no MCP) |
| **Netlify — Stripe (checkout/webhook)**      | OK              | **Presentes** em produção: `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_EXECUTIVE_MONTHLY`, `STRIPE_PRICE_EXECUTIVE_YEARLY`, `STRIPE_PRICE_SEARCH_PASS`  |
| **Netlify — observabilidade / e-mail app**   | OK              | **Presentes**: `RESEND_API_KEY`, `EMAIL_FROM`, Sentry, PostHog, Langfuse, Upstash, Google OAuth/Gmail redirect                                                                                                                                                       |
| **Netlify — Inngest (jobs)**                 | Falta           | Chaves `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` **ausentes** na lista do site (lembretes/jobs em background dependem disso)                                                                                                                                       |
| **Netlify — apply runner (opcional P2+)**    | Falta           | `APPLY_RUNNER_SECRET` **ausente** (necessário para funções de apply na nuvem)                                                                                                                                                                                        |
| **Supabase — URL do projeto**                | OK              | `get_project_url` → `https://synbycvebzzqarojicfu.supabase.co`                                                                                                                                                                                                       |
| **Supabase — chaves publishable/anon**       | OK              | `get_publishable_keys` → publishable `default` ativo + anon legacy ativo (detalhes omitidos neste doc)                                                                                                                                                               |
| **Supabase — migrações chat-first / QA**     | OK              | `list_migrations` inclui `20261023160000` (`chat_first_persistence`), `20261023170000` (`qa_pairing_grants_cv`), `20261023180000` (`increment_usage`)                                                                                                                |
| **Supabase — migrações repo vs hospedado**   | Falta           | No repo e **não** listadas no hospedado: `20261023190000` (`cloud_browser_pool`), `20261023220000` (`cloud_login_sessions`), `20261023230000` (`gmail_verification_generic_ats`)                                                                                     |
| **Supabase Auth — Site URL + Redirect URLs** | Não verificável | MCP Supabase **não expõe** URL Configuration; aplicar manualmente conforme [QA_SMOKE_LANCAMENTO.md](./QA_SMOKE_LANCAMENTO.md#config-manual-dashboard)                                                                                                                |
| **Supabase Auth — logs 24h**                 | Parcial         | `query_logs` (`auth_logs`): 268× status 200, 3× 303, 2× 400; **sem** pico de erros de redirect na janela; Site URL em si não confirmada                                                                                                                              |
| **Stripe — conta MCP**                       | Parcial         | `list_available_accounts_or_orgs` → só **VagaPilot Test** (`acct_1UTUOMEMPqsIYuI6`, `livemode=false`)                                                                                                                                                                |
| **Stripe — webhook Test**                    | Falta           | `GetWebhookEndpoints` (test): `we_1UTWx7…`, **disabled**, URL `https://example.com/…`; eventos: `customer.subscription.{created,updated,deleted}` — **sem** `checkout.session.completed`                                                                             |
| **Stripe — webhook Live (produção)**         | Não verificável | `livemode=true` → erro “No account found”; conferir [Dashboard Stripe → Webhooks (Live)](https://dashboard.stripe.com/webhooks) URL `https://vagapilot.netlify.app/api/stripe/webhook` e eventos em [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md)             |
| **HTTP — `/precos`**                         | OK              | `curl -sI` → **200**                                                                                                                                                                                                                                                 |
| **HTTP — `/auth/callback`**                  | OK              | `curl -sI` → **307** → `Location: /entrar?erro=link_invalid` (rota viva; redirect esperado sem token OAuth)                                                                                                                                                          |
| **HTTP — `POST /api/stripe/webhook`**        | OK              | `curl -X POST` body `{}` → **400** (rota existe; rejeita assinatura inválida)                                                                                                                                                                                        |

---

## Netlify — chaves de ambiente (somente nomes)

Lista via `netlify-project-services-updater` → `manage-env-vars` (`getAllEnvVars: true`), site `vagapilot`.  
**Presente** = chave configurada no site (valor não reproduzido aqui).

### Núcleo go-live ([QA_SMOKE_LANCAMENTO.md](./QA_SMOKE_LANCAMENTO.md))

| Chave                                                              | Produção |
| ------------------------------------------------------------------ | -------- |
| `NEXT_PUBLIC_APP_URL`                                              | presente |
| `NEXT_PUBLIC_SUPABASE_URL`                                         | presente |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                             | presente |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                    | presente |
| `SUPABASE_SERVICE_ROLE_KEY`                                        | presente |
| `DATABASE_URL`                                                     | presente |
| `STRIPE_SECRET_KEY`                                                | presente |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`                               | presente |
| `STRIPE_WEBHOOK_SECRET`                                            | presente |
| `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_YEARLY`             | presente |
| `STRIPE_PRICE_EXECUTIVE_MONTHLY` / `STRIPE_PRICE_EXECUTIVE_YEARLY` | presente |
| `STRIPE_PRICE_SEARCH_PASS`                                         | presente |

### Outras chaves no site (amostra)

Presentes no painel Netlify (não todas exigidas para o smoke de lançamento): `AI_PROVIDER`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_GMAIL_REDIRECT_URI`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `UPSTASH_REDIS_*`, `KEY_PROVIDER`, `KEK_LOCAL`, `LANGFUSE_*`, `SENTRY_*`, `NEXT_PUBLIC_POSTHOG_*`, `POSTHOG_PROJECT_ID`, `SECRETS_SCAN_OMIT_KEYS`, `LLM_MODEL_*`, `EMBEDDING_MODEL`, `OTEL_SERVICE_NAME`, `SUPABASE_SECRET_KEY`, etc.

Ausentes relevantes para funcionalidades posteriores: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `APPLY_RUNNER_SECRET`, `AI_GATEWAY_API_KEY` (há chaves Gemini diretas).

---

## Deploy

- **Painel:** [Netlify — vagapilot](https://app.netlify.com/projects/vagapilot)
- **URL:** https://vagapilot.netlify.app
- **Deploy atual:** `6adb73cbec51f0e926470603` — `ready`, Git `main` @ `fe5b83e`

---

## Supabase — migrações

- **Painel:** [Supabase — synbycvebzzqarojicfu](https://supabase.com/dashboard/project/synbycvebzzqarojicfu/database/migrations)
- **Auth URL config:** [Authentication → URL Configuration](https://supabase.com/dashboard/project/synbycvebzzqarojicfu/auth/url-configuration) (manual)

Última migração **aplicada no hospedado** (MCP): `20261023180000` (`increment_usage`).

---

## Stripe — webhooks

Eventos mínimos do handler: ver tabela em [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md#eventos-mínimos-processados-pelo-handler).

- **Test (MCP):** endpoint placeholder — **não** usar para produção.
- **Live:** autorizar conta Live no Stripe MCP ou conferir no dashboard; garantir `checkout.session.completed` no endpoint de produção.

---

## Pendências manuais (dashboard)

1. **Supabase Auth** — Site URL `https://vagapilot.netlify.app` + redirect URLs listadas no QA.
2. **Supabase Auth** — template de confirmação pt-BR + SMTP (Resend) no projeto hospedado.
3. **Stripe Live** — webhook em `https://vagapilot.netlify.app/api/stripe/webhook` com `checkout.session.completed` e `customer.subscription.*`; alinhar `STRIPE_WEBHOOK_SECRET` no Netlify.
4. **Supabase DB** — aplicar migrações `20261023190000`–`20261023230000` se for usar browser pool / login na nuvem / verificação Gmail genérica.
5. **Netlify** — opcional: `INNGEST_*` se jobs agendados forem requisito de lançamento.

---

## Referências

- [QA_SMOKE_LANCAMENTO.md](./QA_SMOKE_LANCAMENTO.md)
- [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md)
- [DEPLOY-CHAT-FIRST.md](./DEPLOY-CHAT-FIRST.md)
