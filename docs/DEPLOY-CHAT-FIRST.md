# Deploy — chat-first + QA (2026-10-23)

Checklist em **pt-BR** para publicar a sequência **chat-first** (fases 1–7) e os patches de **QA/P2** no ambiente de produção (`https://vagapilot.netlify.app`, Supabase `synbycvebzzqarojicfu`).

Referências: [ESPEC.md](./ESPEC.md), [CHAT-FIRST-JORNADA.md](./CHAT-FIRST-JORNADA.md), [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md), smoke detalhado em [QA_SMOKE_LANCAMENTO.md](./QA_SMOKE_LANCAMENTO.md).

---

## 1. Commits no repositório (ordem cronológica)

| SHA (curto) | Mensagem                             | Conteúdo principal                                                                                                                               |
| ----------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `4a59166`   | `feat(chat-first): fase 1`           | Home do app = chat, navegação                                                                                                                    |
| `8d459e9`   | `feat(chat-first): fase 2`           | Persistência chat + proveniência                                                                                                                 |
| `0dfc2ca`   | `feat(chat-first): fase 5`           | Ferramentas missing info / perfis plataforma                                                                                                     |
| `9176a6e`   | `feat(chat-first): fase 6`           | PostHog / observabilidade chat                                                                                                                   |
| `a55ad2e`   | `feat(chat-first): fase 7`           | Onboarding “Fazer pelo chat”                                                                                                                     |
| `49d941b`   | `fix(qa): harden pairing, billing…`  | Core (`app-url`, `audit`, `postgres`), pareamento §11.3, Stripe §11.5/§14, CV, sidebar/planos, migration `20261023170000`, template e-mail local |
| `782552f`   | `docs(qa): record production smoke`  | Resultados smoke 23/10                                                                                                                           |
| `11da660`   | `docs: document Stripe Live webhook` | Eventos webhook Live + PROGRESSO                                                                                                                 |
| `fe5b83e`   | `feat(qa-p2): atomic usage…`         | RPC `increment_usage`, `/precos`, nome no cadastro, `/dev/*` 404 em prod                                                                         |
| `32f60b7`   | `docs: add chat-first deploy…`       | Este checklist + `docs/*.env.txt` no `.gitignore`                                                                                                |
| `7743fb0`   | `Complete chat-first spec gaps…`     | Selos, `register_gap`, eval `form_only`, e2e chat + CI Supabase local                                                                            |

**Não commitar:** `docs/supabase-vagapilot.env.txt`, `.env*`, `.agents/`, `skills-lock.json`, `data/`, `.augment/`, `.bob/`, etc.

---

## 2. Push (Git → Netlify)

- [ ] `git fetch origin` e conferir que `main` local = remoto (inclui `32f60b7`; se estiver à frente, `git push origin main`).
- [ ] **Nunca** incluir arquivos de segredo no commit (`docs/*.env.txt` está no `.gitignore`).
- [ ] Push: `git push origin main`.
- [ ] Netlify (`vagapilot`): build **ready**; conferir `NEXT_PUBLIC_APP_URL=https://vagapilot.netlify.app`.
- [ ] Após deploy, invalidar cache se `/precos` ainda retornar 404 (edge cache).

---

## 3. Migrações Supabase (produção)

Aplicar **nesta ordem** no projeto hospedado (us-east-1). Versões locais em `supabase/migrations/`.

| Ordem | Arquivo local                               | O que muda                                                                               |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1     | `20261023160000_chat_first_persistence.sql` | Tabelas/links do chat-first, políticas RLS chat                                          |
| 2     | `20261023170000_qa_pairing_grants_cv.sql`   | Pareamento 8 chars, lockout, `extraction_error`, grants (devices, audit, exclusão, etc.) |
| 3     | `20261023180000_increment_usage.sql`        | Função `increment_usage` (contador atômico, só `service_role`)                           |

**Como aplicar (escolha uma):**

- **CLI linkado:** `supabase db push` (projeto linkado ao remoto).
- **Dashboard:** SQL Editor → colar conteúdo de cada arquivo, na ordem.
- **MCP / API:** registrar migration equivalente (ex.: remoto já pode ter versão `20261023144419` equivalente ao `increment_usage`).

**Conferência pós-migração:**

- [ ] `device_pairing_codes.code` aceita só 8 caracteres do alfabeto Crockford.
- [ ] Coluna `cv_versions.extraction_error` existe.
- [ ] `authenticated` **não** tem INSERT em `audit_log`, `devices`, `device_pairing_codes`.
- [ ] `SELECT` em `increment_usage` indisponível para `authenticated`; `service_role` executa a RPC.

---

## 4. Config manual (dashboard)

### Supabase Auth

- [ ] **Site URL:** `https://vagapilot.netlify.app`
- [ ] **Redirect URLs:**  
      `https://vagapilot.netlify.app/auth/callback`  
      `https://vagapilot.netlify.app/auth/callback?next=/aceite`  
      `https://vagapilot.netlify.app/auth/callback?next=/app`  
      `https://vagapilot.netlify.app/auth/confirm`
- [ ] **Confirm signup:** corpo pt-BR (espelhar `supabase/templates/confirmation.html`); SMTP Resend se for usar envio real.

### Stripe (Live)

- [ ] Webhook: `https://vagapilot.netlify.app/api/stripe/webhook`
- [ ] Eventos mínimos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (detalhes em [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md)).

---

## 5. Verificação local (antes ou depois do push)

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter @vagapilot/core test
```

Opcional com Supabase local:

```bash
pnpm db:reset
pnpm --filter @vagapilot/db test
```

---

## 6. Smoke tests em produção (resumo)

Executar o checklist completo em [QA_SMOKE_LANCAMENTO.md](./QA_SMOKE_LANCAMENTO.md). Mínimo pós-deploy:

| #   | Fluxo                                               | Esperado                                               |
| --- | --------------------------------------------------- | ------------------------------------------------------ |
| 1   | `/dev/entrar`, `/dev/ats-form`                      | **404**                                                |
| 2   | `/precos`                                           | **200**, cards de plano                                |
| 3   | Cadastro → e-mail confirmação                       | Link com host **vagapilot.netlify.app**, não localhost |
| 4   | Chat: colar texto longo de vaga                     | Dispara análise                                        |
| 5   | CV escaneado                                        | Mensagem pt-BR (`extraction_error`), não “zero fatos”  |
| 6   | Pareamento extensão                                 | Código **8** caracteres; bloqueio após erros           |
| 7   | `/app/planos`                                       | Checkout/portal; trial Pro só na 1ª assinatura         |
| 8   | Passe de busca (Stripe test/live conforme ambiente) | Plano `search_pass` + `current_period_end` ~90 dias    |

---

## 7. Rollback (se necessário)

- **App:** revert commit no Git + redeploy Netlify (commit anterior estável).
- **DB:** migrações são **forward-only**; reverter schema exige migration compensatória manual — preferir corrigir forward com patch SQL pequeno.
- **Stripe:** desativar webhook Live temporariamente se checkout estiver quebrando assinaturas.

---

Última atualização: 2026-10-23. Registrar conclusão em [PROGRESSO.md](./PROGRESSO.md).
