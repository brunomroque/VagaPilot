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

### Supabase (`synbycvebzzqarojicfu`)

1. **Authentication → URL Configuration**
   - **Site URL:** `https://vagapilot.netlify.app`
   - **Redirect URLs** (adicionar todas):
     - `https://vagapilot.netlify.app/auth/callback`
     - `https://vagapilot.netlify.app/auth/callback?next=/aceite`
     - `https://vagapilot.netlify.app/auth/callback?next=/app`
     - `https://vagapilot.netlify.app/auth/confirm`
2. **Authentication → Emails → Confirm signup**
   - Assunto e corpo em **pt-BR** (espelhar `supabase/templates/confirmation.html` do repo).
   - SMTP: configurar Resend (ou provedor) no dashboard; **não** commitar API key.
3. **Database → Migrations:** confirmar versões `chat_first_persistence` e `qa_pairing_grants_cv` aplicadas.

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

| Data | Testador | Build/deploy (Netlify ID) | Resultado       | Notas |
| ---- | -------- | ------------------------- | --------------- | ----- |
|      |          |                           | ☐ Pass / ☐ Fail |       |
