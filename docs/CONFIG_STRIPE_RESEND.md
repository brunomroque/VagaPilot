# Configuração Stripe + Resend (VagaPilot)

Guia para ligar cobrança e e-mail transacional no **modo de teste / dev**, com segmentação explícita do projeto **VagaPilot** (`metadata.project=vagapilot` no Stripe; chave Resend dedicada).

> **Nunca commite** `.env.local`, tokens `sk_test_…`, `re_…` ou `whsec_…`. Copie os valores só para `apps/web/.env.local` e, se usar workers Inngest localmente, para o `.env.local` na raiz do monorepo.

Referências no código:

- Preços e centavos: `apps/web/lib/billing/stripe.ts` (`BILLING_SEED_HINT`) e [ESPEC.md §14](./ESPEC.md) (tabela BRL).
- Checkout: `apps/web/app/api/billing/checkout/route.ts`.
- Webhook: `apps/web/app/api/stripe/webhook/route.ts`.
- E-mail (lembretes): `packages/jobs/src/mailer.ts` (`RESEND_API_KEY`, `EMAIL_FROM`).

---

## 1. Stripe (test mode)

### Conta usada na configuração MCP

| Campo                  | Valor                       |
| ---------------------- | --------------------------- |
| Nome no Dashboard      | **VagaPilot**               |
| Modo                   | **Test** (`livemode=false`) |
| `stripe_context` (MCP) | `acct_1UTUOMEMPqsIYuI6`     |

Headers padrão no `.cursor/mcp.json` (conta test VagaPilot): `Stripe-Context` + `Stripe-Livemode: false`. Recarregue o Cursor após alterar o JSON.

Não há outros produtos ativos nesta conta além dos listados abaixo — evita misturar com TatameHub/chefvapt.

### Produtos criados (test)

| Produto               | ID                    | Metadata                                |
| --------------------- | --------------------- | --------------------------------------- |
| VagaPilot Pro         | `prod_VUTOfWVDQ6hDn4` | `project=vagapilot`, `plan=pro`         |
| VagaPilot Executive   | `prod_VUTOm0yrMCoFfy` | `project=vagapilot`, `plan=executive`   |
| VagaPilot Search Pass | `prod_VUTOI2CLmmrMLk` | `project=vagapilot`, `plan=search_pass` |

### Preços criados (BRL, centavos)

Valores alinhados à [ESPEC §14](./ESPEC.md). Assinaturas **anuais** cobram o total do ano (equivalente a R$ 39/mês ou R$ 99/mês), não o valor mensal avulso.

| Plano       | Intervalo       | Valor           | Price ID (test)                  | Variável `.env`                  |
| ----------- | --------------- | --------------- | -------------------------------- | -------------------------------- |
| Pro         | mensal          | R$ 49,00        | `price_1UTUS6EMPqsIYuI6af40s7Tu` | `STRIPE_PRICE_PRO_MONTHLY`       |
| Pro         | anual           | R$ 468,00/ano   | `price_1UTUS6EMPqsIYuI6h2pbA3kY` | `STRIPE_PRICE_PRO_YEARLY`        |
| Executive   | mensal          | R$ 129,00       | `price_1UTUS9EMPqsIYuI6VXjJ2pFq` | `STRIPE_PRICE_EXECUTIVE_MONTHLY` |
| Executive   | anual           | R$ 1.188,00/ano | `price_1UTUSAEMPqsIYuI6yGXOqR3P` | `STRIPE_PRICE_EXECUTIVE_YEARLY`  |
| Search Pass | pagamento único | R$ 299,00       | `price_1UTUSAEMPqsIYuI6v33p78I6` | `STRIPE_PRICE_SEARCH_PASS`       |

Trial de 7 dias do Pro: aplicado no Checkout quando `plan=pro` e modo assinatura (`checkout/route.ts`).

### Chaves Stripe (obter no Dashboard)

1. [Stripe Dashboard](https://dashboard.stripe.com/test/apikeys) → **Developers → API keys** (toggle **Test mode**).
2. Copiar:
   - **Publishable key** → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
   - **Secret key** → `STRIPE_SECRET_KEY`

### Webhook

**URL de produção / preview:**

```text
{NEXT_PUBLIC_APP_URL}/api/stripe/webhook
```

Ex.: `http://localhost:3100/api/stripe/webhook` em dev (com túnel ou Stripe CLI).

**Eventos usados hoje** (`apps/web/app/api/stripe/webhook/route.ts`):

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Idempotência: tabela `stripe_events` (event.id).

#### Desenvolvimento local (recomendado)

```bash
stripe listen --forward-to localhost:3100/api/stripe/webhook
```

O CLI imprime um **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

**Eventos de teste com `stripe trigger`**

- **Webhook do VagaPilot** (`/api/stripe/webhook`): use assinatura, não PaymentIntent:

  ```bash
  stripe trigger customer.subscription.created
  stripe trigger customer.subscription.updated
  stripe trigger customer.subscription.deleted
  ```

  O handler só persiste `subscriptions` quando `metadata.user_id` existe no objeto da assinatura; fixtures padrão do CLI não incluem esse campo — útil para smoke de assinatura/entrega, não para simular um usuário real.

- **`payment_intent.succeeded`**: o fixture embutido do CLI (v1.55.x) ainda envia `payment_method_types`, rejeitado na API atual. Remova o parâmetro legado e use métodos automáticos sem redirect:

  ```bash
  stripe trigger payment_intent.succeeded ^
    --remove payment_intent:payment_method_types ^
    --override "payment_intent:automatic_payment_methods[enabled]=true" ^
    --override "payment_intent:automatic_payment_methods[allow_redirects]=never"
  ```

  (No PowerShell/bash, quebre a linha com `` ` `` ou `\` em vez de `^` se preferir.)

#### Dashboard (deploy)

1. **Developers → Webhooks → Add endpoint**
2. URL: `{NEXT_PUBLIC_APP_URL}/api/stripe/webhook`
3. Eventos: os três acima (ou “Select events” equivalentes).
4. Copiar **Signing secret** → `STRIPE_WEBHOOK_SECRET`

Nenhum endpoint de webhook foi criado automaticamente (URL pública necessária).

---

## 2. Resend (e-mail transacional)

Usado por `@vagapilot/jobs` para lembretes de prazo (48 h / 12 h). Sem `RESEND_API_KEY`, o transporte só **loga** em dev; o sino in-app continua.

### Segmentação VagaPilot

| Recurso                  | Detalhe                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| API key (criada via MCP) | Nome: **`VagaPilot (dev)`**, ID: `68c5e458-c844-414e-b1c7-d260594b7ba9`, permissão: **sending_access**                                               |
| Token                    | Exibido **uma vez** na criação. Se não salvou: Resend → **API Keys** → revogar/recriar `VagaPilot (dev)`. **Não** coloque o token neste repositório. |
| Inbox                    | Nenhum inbox criado (opcional para suporte; lembretes usam API de envio, não inbox).                                                                 |

Outras chaves na mesma conta Resend (TatameHub, chefvapt, Netlify, etc.) **não** devem ser reutilizadas no VagaPilot.

### Domínios verificados na conta (sa-east-1)

| Domínio         | Envio | Recebimento |
| --------------- | ----- | ----------- |
| `tatamehub.app` | sim   | não         |
| `tatamehub.com` | sim   | não         |
| `chefvapt.com`  | sim   | não         |

**`vagapilot.app`** (fallback em `mailer.ts`: `lembretes@vagapilot.app`) **não** está verificado nesta conta.

### `EMAIL_FROM` (obrigatório bater com domínio verificado)

Escolha **uma** opção:

1. **Produção (recomendado):** adicionar domínio `vagapilot.app` (ou subdomínio) em Resend → **Domains → Add** → registros DNS (SPF, DKIM, opcional DMARC) → aguardar **verified** → usar por exemplo:

   ```env
   EMAIL_FROM=VagaPilot <lembretes@vagapilot.app>
   ```

2. **Dev / staging temporário:** usar endereço em domínio já verificado (ex.: subdomínio dedicado ao produto, **não** misturar com marketing de outros apps):

   ```env
   EMAIL_FROM=VagaPilot <lembretes@tatamehub.app>
   ```

   Ajuste o endereço local (`lembretes@…`) conforme política interna; o importante é o domínio estar **verified** no Resend.

3. **Onboarding Resend:** enquanto não houver domínio próprio, o Dashboard mostra um remetente de teste (ex. `@resend.dev`) — válido só para testes limitados; troque antes de produção.

---

## 3. Variáveis de ambiente

Copie para **`apps/web/.env.local`** (e replique `RESEND_*` / `INNGEST_*` na raiz se rodar jobs locais).

```env
# App
NEXT_PUBLIC_APP_URL=http://localhost:3100

# Stripe (test)
STRIPE_SECRET_KEY=sk_test_…
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…

STRIPE_PRICE_PRO_MONTHLY=price_1UTUS6EMPqsIYuI6af40s7Tu
STRIPE_PRICE_PRO_YEARLY=price_1UTUS6EMPqsIYuI6h2pbA3kY
STRIPE_PRICE_EXECUTIVE_MONTHLY=price_1UTUS9EMPqsIYuI6VXjJ2pFq
STRIPE_PRICE_EXECUTIVE_YEARLY=price_1UTUSAEMPqsIYuI6yGXOqR3P
STRIPE_PRICE_SEARCH_PASS=price_1UTUSAEMPqsIYuI6v33p78I6

# Resend
RESEND_API_KEY=re_…
EMAIL_FROM=VagaPilot <lembretes@vagapilot.app>
```

Substitua `sk_test_`, `pk_test_`, `whsec_` e `re_` pelos valores reais (Dashboard / CLI / chave criada).

---

## 4. GitHub Actions (opcional)

Repositório: `brunomroque/VagaPilot`. Só configure secrets de **teste** se quiser CI com billing/e-mail:

```bash
gh secret set STRIPE_SECRET_KEY --body "sk_test_…"
gh secret set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --body "pk_test_…"
# … demais price IDs e RESEND_API_KEY conforme necessidade do workflow
```

Não foi executado automaticamente nesta configuração.

---

## 5. Verificação rápida

1. `pnpm --filter web dev` com `.env.local` preenchido.
2. Checkout teste: POST autenticado em `/api/billing/checkout` com `{ "plan": "pro", "interval": "month" }` → URL Stripe Checkout (cartão teste `4242…`).
3. Webhook: após `stripe listen`, concluir assinatura teste e conferir linha em `subscriptions`.
4. Resend: disparar job de lembrete ou teste via API Resend com o mesmo `EMAIL_FROM`.

---

## Histórico

- **2026-10-22:** Produtos/preços test VagaPilot criados via Stripe MCP; chave Resend `VagaPilot (dev)` criada; documento inicial.
