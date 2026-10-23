# Smoke test — lançamento VagaPilot

Checklist enxuto para validar **produção** (`https://vagapilot.netlify.app`) após deploy e configuração de infra. Marque cada item quando concluído.

Referências: [ESPEC.md §11.3, §11.5, §14](./ESPEC.md), [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md).

---

## Pré-requisitos (infra)

| Item                                | Onde conferir                                                                                                                              | OK  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| **Netlify — `NEXT_PUBLIC_APP_URL`** | Site `vagapilot` → Environment → deve ser `https://vagapilot.netlify.app` (não `localhost`)                                                | ☐   |
| **Netlify — Supabase**              | `NEXT_PUBLIC_SUPABASE_URL`, chaves anon/publishable, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`                                           | ☐   |
| **Netlify — Stripe**                | `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, Price IDs (Pro/Executive/Search Pass)                  | ☐   |
| **Supabase — migrações**            | Projeto `synbycvebzzqarojicfu`: incluir `chat_first_persistence` e `qa_pairing_grants_cv` (pareamento 8 chars, grants, `extraction_error`) | ☐   |
| **Supabase Auth — URLs**            | Dashboard → Authentication → URL Configuration (ver [Config manual](#config-manual-dashboard))                                             | ☐   |
| **Stripe — webhook produção**       | URL `https://vagapilot.netlify.app/api/stripe/webhook` com eventos abaixo                                                                  | ☐   |
| **Deploy**                          | Push em `main` dispara build Netlify; deploy `ready` no painel                                                                             | ☐   |

**Eventos Stripe obrigatórios no endpoint de produção:**

- `checkout.session.completed` (Passe de busca e checkout one-shot)
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

---

## 1. Página pública e rotas dev

1. Abra `https://vagapilot.netlify.app` — landing carrega sem erro visível no console.
2. Acesse `https://vagapilot.netlify.app/dev/entrar` → **404** (não bypass de dev).
3. Acesse `https://vagapilot.netlify.app/dev/ats-form` → **404** em produção.

---

## 2. Cadastro + confirmação de e-mail

1. `/cadastro` — crie conta com e-mail **seu** (não use seed fictício em prod).
2. Abra o e-mail de confirmação.
3. **Esperado:** link aponta para `https://vagapilot.netlify.app/...` (ex.: `/auth/confirm` ou callback), **não** `localhost` nem `127.0.0.1`.
4. Clique no link → sessão criada → redirecionamento para aceite (`/aceite`) ou app conforme fluxo.
5. Se o link ainda for localhost: corrija **Site URL** e **Redirect URLs** no Supabase (seção [Config manual](#config-manual-dashboard)).

---

## 3. Login e onboarding

1. `/entrar` — login com a conta confirmada.
2. Aceite termos/privacidade se solicitado.
3. Onboarding:
   - **CV com texto selecionável (PDF):** upload conclui; fatos ou mensagem de progresso coerente.
   - **CV escaneado (sem texto):** mensagem em pt-BR explicando PDF sem texto (campo `extraction_error`), não “zero fatos” silencioso.
4. Conclua ou pule etapas até chegar ao chat (`/app` ou `/app/chat`).

---

## 4. Chat — análise de vaga e idioma

1. No chat, **cole** o texto de uma vaga (título, requisitos, empresa).
2. **Esperado:** assistente inicia análise / fit (sem erro 500).
3. Envie mensagem que **sugira** mudança de idioma do perfil (ex.: “prefiro vagas em inglês”).
4. **Esperado:** pede **confirmação** antes de gravar; idioma **não** muda só porque a vaga menciona inglês ou uma cidade.

---

## 5. Plano, limites e `/app/planos`

1. **Sidebar:** card de plano mostra plano efetivo e uso (métrica análises de vaga), **não** demo fixo “18/30 Pro”.
2. Conta **Free:** limite **15** análises/mês (§14).
3. Abra **`/app/planos`** — valores e botões batem com a página (Pro trial 7 dias na primeira assinatura Pro, se elegível).
4. Se tiver **Pro ativo ou trial:** limite **200** análises/mês na UI.

---

## 6. Stripe — assinar Pro e portal

1. Em `/app/planos`, clique em assinar **Pro** (mensal ou anual) → redireciona ao **Stripe Checkout** (modo teste se chaves forem test).
2. Cartão teste `4242 4242 4242 4242`, data futura, CVC qualquer.
3. Após sucesso → retorno para **`/app/planos`** (ou URL de success configurada).
4. **Portal:** botão “Gerenciar assinatura” (ou equivalente) → **Stripe Customer Portal** abre; voltar ao app.
5. Sidebar/planos refletem **Pro** ou **trialing** conforme checkout.

---

## 7. Passe de busca (`checkout.session.completed`)

1. Conta de teste **sem** assinatura Pro ativa (ou use conta dedicada).
2. Em `/app/planos`, compre **Passe de busca** (pagamento único).
3. Conclua pagamento no Stripe (test).
4. **Verificação pós-pagamento:**
   - Stripe Dashboard → Webhooks → endpoint de prod → evento `checkout.session.completed` **entregue** (2xx).
   - No app: plano efetivo **Passe de busca** / benefícios de busca conforme §14 (90 dias a partir da sessão).
   - Opcional (Supabase SQL, service role): linha em `subscriptions` com `plan = search_pass`, `status = active`, `current_period_end` ~90 dias à frente.
5. Se webhook falhar (4xx/5xx): conferir `STRIPE_WEBHOOK_SECRET` no Netlify e URL do endpoint.

---

## 8. Pareamento da extensão (§11.3)

1. Web logado → **Configurações → Extensão Chrome** → gerar código.
2. **Esperado:** código **8 caracteres** (alfabeto sem 0/1/I/O), TTL ~10 min.
3. Extensão (build publicada ou unpacked de dev apontando para prod): informe código + nome do dispositivo.
4. **Esperado:** pareamento OK; extensão mostra conectado.
5. **Rate limit (opcional, cuidado):** 9+ tentativas inválidas em `POST /api/ext/pair` na mesma rede → **429** após limite por IP (8 / 10 min).

---

## 9. Regressões rápidas

| Área            | Passo                                                               | OK  |
| --------------- | ------------------------------------------------------------------- | --- |
| Logout          | Sair → `/entrar`; `/app` redireciona                                | ☐   |
| Privacidade     | Solicitar exclusão só via fluxo UI/API documentado (não SQL direto) | ☐   |
| CSP / analytics | Console sem bloqueio crítico de PostHog/Sentry na home e `/app`     | ☐   |

---

## Config manual (dashboard)

> **Automação:** o MCP do projeto (`synbycvebzzqarojicfu`) **não** expõe alteração de Site URL / Redirect URLs / templates / SMTP — só migrações, SQL, logs e docs. Use o dashboard (ou CLI `supabase config push` **somente** após revisar o diff; ver nota abaixo).

### URLs que o app usa (origem = `NEXT_PUBLIC_APP_URL` → produção `https://vagapilot.netlify.app`)

| Fluxo                                    | Onde no código                          | URL / rota                                                                                           |
| ---------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cadastro e-mail                          | `apps/web/app/(auth)/actions.ts`        | `{origin}/auth/callback?next=/aceite` (`emailRedirectTo`)                                            |
| Login Google                             | idem                                    | `{origin}/auth/callback?next={next}` (`redirectTo`; `next` padrão `/app`, vindo de `/entrar?next=…`) |
| Retorno PKCE                             | `apps/web/app/auth/callback/route.ts`   | `GET /auth/callback?code=…&next=…` (default `next=/app`)                                             |
| Confirmação token hash (template custom) | `apps/web/app/auth/confirm/route.ts`    | `GET /auth/confirm?token_hash=…&type=…&next=…` (default `next=/aceite`)                              |
| Guardas                                  | `app/app/layout.tsx`, `aceite/page.tsx` | redirecionam para `/entrar?next=/app` ou `/entrar?next=/aceite`                                      |

O template versionado usa `{{ .ConfirmationURL }}` (link gerado pelo Supabase com o `emailRedirectTo` acima). **Não** trocar para `{{ .SiteURL }}` sozinho sem incluir `/auth/confirm` ou callback.

**Login Google (OAuth):** no Google Cloud, URI autorizada do client = `https://synbycvebzzqarojicfu.supabase.co/auth/v1/callback` (callback do Supabase, não do Netlify).

### Supabase (`synbycvebzzqarojicfu`)

Painéis diretos:

- [URL Configuration](https://supabase.com/dashboard/project/synbycvebzzqarojicfu/auth/url-configuration)
- [E-mail templates → Confirm signup](https://supabase.com/dashboard/project/synbycvebzzqarojicfu/auth/templates)
- [SMTP settings](https://supabase.com/dashboard/project/synbycvebzzqarojicfu/auth/smtp)

1. **Authentication → URL Configuration**
   - **Site URL:** `https://vagapilot.netlify.app`
   - **Redirect URLs** (adicionar todas; lista exata):
     - `https://vagapilot.netlify.app/auth/callback`
     - `https://vagapilot.netlify.app/auth/callback?next=/aceite`
     - `https://vagapilot.netlify.app/auth/callback?next=/app`
     - `https://vagapilot.netlify.app/auth/confirm`
   - **Opcional (Google com `next` variável):** `https://vagapilot.netlify.app/auth/callback**` (wildcard Supabase; cobre `/entrar?next=/app/chat` etc.). Se preferir lista fechada, inclua cada `next` usado nos testes.
2. **Authentication → Emails → Confirm signup**
   - **Assunto:** `Confirme seu e-mail no VagaPilot`
   - **Corpo (HTML):** copiar de `supabase/templates/confirmation.html`:

```html
<h2>Confirme seu e-mail no VagaPilot</h2>
<p>Olá,</p>
<p>
  Use o botão abaixo para confirmar <strong>{{ .Email }}</strong> e entrar na
  sua conta.
</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar e-mail</a></p>
<p>Se você não criou uma conta no VagaPilot, ignore esta mensagem.</p>
```

- Ativar **Confirm email** (cadastro exige confirmação), alinhado a `enable_confirmations` no `config.toml` local.

3. **Authentication → Emails → SMTP (Resend)**
   - Host: `smtp.resend.com`
   - Port: `465` (SSL)
   - User: `resend`
   - Password: API key Resend (`re_…`) — colar **só** no dashboard; mesma chave segmentada VagaPilot descrita em [CONFIG_STRIPE_RESEND.md §2](./CONFIG_STRIPE_RESEND.md), **não** commitar.
   - Sender e-mail: domínio **verified** no Resend (ex. `contato@…` ou `lembretes@tatamehub.app` em staging).
   - Sender name: `VagaPilot`
   - Detalhes e `EMAIL_FROM` dos lembretes Inngest: §2 do mesmo doc (Auth SMTP ≠ `RESEND_API_KEY` no Netlify, mas pode ser a mesma chave no painel Supabase).
4. **CLI `config push` (opcional, cuidado):** o repo **não** está `supabase link` no ambiente do agente. O `supabase/config.toml` local mantém `site_url = http://127.0.0.1:3100` para dev — um push cego **sobrescreveria** a Site URL de produção. Só use após `supabase link --project-ref synbycvebzzqarojicfu`, `supabase config diff` e confirmação manual; para go-live, o dashboard acima é o caminho mais seguro.
5. **Database → Migrations:** confirmar versões `chat_first_persistence` e `qa_pairing_grants_cv` aplicadas.

### Stripe (conta VagaPilot, test ou live conforme ambiente)

1. **Developers → Webhooks → Add endpoint**
   - URL: `https://vagapilot.netlify.app/api/stripe/webhook`
   - Eventos: lista na seção [Pré-requisitos](#pré-requisitos-infra)
2. Copiar **Signing secret** → Netlify `STRIPE_WEBHOOK_SECRET` (produção).
3. Conferir Price IDs anuais e Search Pass com [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md).

### Netlify (`vagapilot`)

- Variáveis obrigatórias adicionais se algo falhar: ver seção 3 de [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md) e `.env.example` em `apps/web`.
- Deploy: merge/push em `main` conectado ao repositório GitHub `brunomroque/VagaPilot`.

---

## Registro do teste

| Data       | Testador                    | Build/deploy (Netlify ID) | Resultado               | Notas                                                                 |
| ---------- | --------------------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------- |
| 23/10/2026 | Agente (smoke automatizado) | não capturado             | ☐ Pass parcial / ☐ Fail | Ver [Resultados 23/10/2026 (produção)](#resultados-23102026-produção) |
|            |                             |                           | ☐ Pass / ☐ Fail         |                                                                       |

---

## Resultados 23/10/2026 (produção)

Ambiente: `https://vagapilot.netlify.app`. Métodos: `curl.exe -sI` (status/redirect) + MCP browser (UI). **Sem login**, sem cadastro real, sem Stripe.

| Caso                                                      | Resultado            | Evidência                                                                                                                      |
| --------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Landing `/` carrega (HTTP + UI)                           | **Pass**             | HTTP **200**; título “VagaPilot”, headline “Seu copiloto de candidaturas.”, CTAs visíveis                                      |
| `/dev/entrar` → 404                                       | **Pass**             | HTTP **404**                                                                                                                   |
| `/dev/ats-form` → 404                                     | **Pass**             | HTTP **404**                                                                                                                   |
| `/app/planos` → redirect login                            | **Pass**             | HTTP **307** → `https://vagapilot.netlify.app/entrar?next=%2Fapp%2Fplanos`; seguindo redirect → **200** na página de login     |
| `/app` (área autenticada) → redirect login                | **Pass**             | HTTP **307** → `/entrar?next=%2Fapp`                                                                                           |
| `/precos` (rota pública dedicada)                         | **N/A (404)**        | HTTP **404**; UI Next.js “This page could not be found.” — **não há** `/precos` em prod                                        |
| Preços públicos via landing                               | **Pass (com login)** | Link footer “Planos e preços” aponta para **`/app/planos`** (mesmo gate de auth); preços só após login                         |
| `/cadastro` — UI signup pública                           | **Pass**             | HTTP **200**; campos E-mail/Senha, botão “Criar conta”, OAuth Google; texto “Você confirma o e-mail antes do primeiro acesso.” |
| `/entrar` — UI login pública                              | **Pass**             | HTTP **200**; campos E-mail/Senha, “Continuar com Google”, link “Criar conta”                                                  |
| Login com conta dev/seed em prod                          | **Skip**             | Sem credenciais reais; não usar senha de seed em produção                                                                      |
| Cadastro + confirmação e-mail (§2)                        | **Not tested**       | Requer e-mail real                                                                                                             |
| Onboarding, chat, limites, Stripe, extensão (§§3–9)       | **Not tested**       | Requer sessão autenticada                                                                                                      |
| Pré-requisitos infra (Netlify/Supabase/Stripe dashboards) | **Not tested**       | Fora do escopo deste smoke HTTP/UI                                                                                             |

**Observações**

- Redirect de rotas `/app/*` usa **307** (não 302); comportamento esperado para gate de auth.
- Página de preços “pública” no produto atual = link na home para `/app/planos`, não rota `/precos`.
