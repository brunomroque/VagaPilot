# FASE A — Fundamentos do chat-first (5 tarefas)

Pré-requisito: ler `00-LEIA-PRIMEIRO.md`. Caminhos relativos à raiz do repo `BuscardorDeVagas`.

---

## A1. Schema único de mensagens do chat (_parts_) e renderer

**Objetivo:** todo conteúdo estruturado do chat vira uma _part_ tipada, igual aos cards e avisos do Bot. **PB:** 01, 06, 07.

**Arquivos**

- Criar `packages/ai/src/chat/parts.ts` (Zod + tipos), `packages/ui/src/chat/*Card.tsx` para tipos novos.
- Alterar `apps/web/components/chat/tool-output-view.tsx` (renderer por `kind`), `apps/web/components/chat/chat-view.tsx`, `packages/ai/src/chat/tool-schemas.ts` (saídas das tools retornam `ChatPart`).

**Contrato**

```ts
export const ChatPart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("progress"),
    runId: z.string().uuid().optional(),
    label: z.string(),
    step: z.number().int().optional(),
    total: z.number().int().optional(),
  }),
  z.object({ kind: z.literal("job_summary"), jobPostingId: z.string().uuid() }),
  z.object({
    kind: z.literal("duplicate_alert"),
    jobPostingId: z.string().uuid(),
    matches: z.array(DuplicateMatch),
    atsLimit: AtsLimit.nullable(),
  }),
  z.object({ kind: z.literal("fit_card"), jobMatchId: z.string().uuid() }),
  z.object({
    kind: z.literal("decision_card"),
    jobMatchId: z.string().uuid(),
    options: z.array(DecisionOption).length(3),
    allowCustom: z.literal(true),
  }),
  z.object({
    kind: z.literal("question"),
    questionId: z.string().uuid(),
    prompt: z.string(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        style: z.enum(["primary", "default", "danger"]).default("default"),
      })
    ),
    allowCustom: z.boolean(),
    helpText: z.string().optional(),
  }),
  z.object({
    kind: z.literal("fact_confirmation"),
    groupId: z.string(),
    factIds: z.array(z.string().uuid()),
  }),
  z.object({
    kind: z.literal("secure_form"),
    runId: z.string().uuid(),
    purpose: z.enum(["senha", "otp"]),
    site: z.string(),
    rulesText: z.string().optional(),
  }),
  z.object({
    kind: z.literal("approval"),
    approvalId: z.string().uuid(),
    summary: SubmissionSummary,
  }),
  z.object({
    kind: z.literal("evidence"),
    evidenceId: z.string().uuid(),
    applicationId: z.string().uuid(),
    successText: z.string(),
  }),
  z.object({
    kind: z.literal("settings_change"),
    memoryEventId: z.string().uuid(),
    origin: z.enum(["chat", "tela", "extensao", "gmail", "sistema"]),
  }),
  z.object({
    kind: z.literal("pending_item"),
    runId: z.string().uuid().optional(),
    applicationId: z.string().uuid().optional(),
    reason: BlockedReason,
    text: z.string(),
  }),
  z.object({
    kind: z.literal("report"),
    exportId: z.string().uuid(),
    counts: z.record(z.string(), z.number()),
  }),
  z.object({
    kind: z.literal("file_upload"),
    cvVersionId: z.string().uuid(),
    fileName: z.string(),
  }),
])
export const BlockedReason = z.enum([
  "login",
  "senha",
  "otp",
  "documento",
  "pergunta",
  "decisao",
  "captcha",
  "erro_site",
  "botao_desabilitado",
  "vaga_fechada",
])
```

**Regras:** a UI nunca renderiza HTML vindo de part; ids são resolvidos no servidor com RLS. Part inválida → `text` com aviso em log.
**Bordas:** mensagens antigas sem `kind` (P0–P7) continuam renderizando via adaptador legado.
**Aceite**

- Dado uma fixture válida de cada `kind`, Quando renderizada, Então aparece o componente correto acessível por teclado.
- Dado uma part com `kind` desconhecido, Quando renderizada, Então mostra texto seguro e não quebra o chat.
  **Testes:** `packages/ai/src/chat/parts.test.ts` (round-trip Zod), `packages/ui` stories/test por card, e2e `chat-parts.spec.ts`.

---

## A2. Eventos de domínio e sincronização chat ↔ telas (F21)

**Objetivo:** qualquer mudança feita na tela aparece no chat e vice-versa. **PB:** 05, 41 (avisos), base para 37.

**Arquivos:** criar `supabase/migrations/<ts>_a2_domain_events.sql`, `apps/web/lib/events/domain-events.ts`, `apps/web/hooks/use-domain-events.ts`; alterar serviços de escrita em `apps/web/lib/settings/server.ts`, actions de `app/app/{perfil,fatos,cvs,candidaturas}`.

**Contrato**

```sql
create table public.domain_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity text not null check (entity in ('fact','profile','salary_rule','cv_version','application','setting','run')),
  entity_id uuid, origin text not null check (origin in ('chat','tela','extensao','gmail','sistema')),
  diff jsonb not null default '{}', created_at timestamptz not null default now());
alter table public.domain_events enable row level security;
create policy de_owner on public.domain_events for select using ((select auth.uid()) = user_id);
alter publication supabase_realtime add table public.domain_events;
```

```ts
export async function emitDomainEvent(
  sb: SupabaseClient,
  e: {
    entity: Entity
    entityId?: string
    origin: Origin
    diff: Record<string, unknown>
  }
): Promise<void>
```

**Regras:** emissão no mesmo fluxo da escrita (falha de emissão não desfaz a escrita, mas loga). `diff` nunca contém segredo (passa por `redact`).
**Bordas:** várias abas abertas; reconexão Realtime (refaz busca desde o último id).
**Aceite**

- Dado o chat aberto, Quando o usuário altera a pretensão de Gerente em `/app/perfil`, Então em ≤ 2 s o chat mostra `settings_change` com origem "tela".
- Dado `/app/candidaturas` aberta, Quando o chat registra "pulada", Então a linha aparece sem recarregar.
  **Testes:** unit `domain-events.test.ts`; RLS `domain_events.rls.test.ts`; e2e `sync-bidirecional.spec.ts`.

---

## A3. Status normalizados e planilha idêntica à do Bot

**Objetivo:** mesmas categorias e colunas do relatório do Bot. **PB:** 36, 52.

**Arquivos:** migração `<ts>_a3_status.sql`; alterar `packages/core/src/status.ts`, `tracker.ts`, `tracker-csv.ts`, `apps/web/lib/tracker/report-pdf.tsx`, `messages/pt-BR.json`.

**Contrato**

- Adicionar status `aguardando_decisao` (de `rascunho`) e coluna `applications.blocked_reason BlockedReason null`, `applications.route text` (Fonte/Rota composta, ex.: "LinkedIn → Gupy", "InHire (convite)").
- Mapeamento para exibição (7 + 1):

```ts
export const DISPLAY_STATUS = {
  entrevista: "Entrevista",
  proposta: "Entrevista",
  etapa_pendente: "Teste/Etapa pendente",
  em_andamento: "Teste/Etapa pendente",
  aguardando_decisao: "Aguardando decisão",
  em_analise: "Em análise",
  enviada: "Enviada",
  reprovada: "Reprovada",
  encerrada: "Encerrada",
  descartada: "Descartada",
  rascunho: "Aguardando decisão",
} as const
```

- CSV: colunas exatamente `Empresa,Cargo,Fonte/Rota,Data aplicação,Status normalizado,Última atualização,Evidência/Notas,Link`; datas `dd/MM/yyyy` (America/Sao_Paulo); RFC 4180.
  **Regras:** `em_andamento` com `blocked_reason` exibe nas notas "[Incompleta/bloqueada] motivo". Puladas: `Data aplicação` vazia, notas "Pulada a pedido do usuário."
  **Bordas:** importação de CSV antigo com status livres (mapear por dicionário; não reconhecido → `em_analise` + nota).
  **Aceite**
- Dado 1 enviada, 1 pulada e 1 bloqueada por login, Quando exporto o CSV, Então o cabeçalho e as 3 linhas batem byte a byte com a fixture `tracker-paridade.csv`.
  **Testes:** `tracker-csv.parity.test.ts`, `status.test.ts` (transições novas).

---

## A4. Orquestrador v2 e skills de domínio

**Objetivo:** o prompt do chat descreve o algoritmo do Bot passo a passo e o tom ("Vou ler essa vaga e checar se você já se candidatou"). **PB:** 01, 06, 21.

**Arquivos:** criar `packages/ai/src/prompts/orchestrator.v2.md`, `.cursor/skills/{analise-de-vaga,checagem-duplicidade,fit-ats,escolha-cv,card-decisao,preenchimento-formulario,envio-evidencia,conciliacao-email,cv-lifecycle,preparacao-entrevista}/SKILL.md`; alterar `apps/web/app/api/chat/route.ts` (versão do prompt por flag `CHAT_PROMPT_VERSION`), `packages/ai/src/chat/fake-orchestrator.ts` (roteiros de paridade).
**Regras do prompt:** ordem fixa 1→9; uma mensagem curta de progresso antes de trabalho longo; nunca afirma envio sem part `evidence`; termina respostas com pendências relevantes (PB-37); português do Brasil, frases curtas, sem jargão.
**Aceite**

- Dado o provedor FAKE e o link de fixture, Quando o usuário cola o link, Então as parts saem na ordem `progress → job_summary → duplicate_alert? → fit_card → decision_card`.
  **Testes:** eval `evals/journey/order.eval.ts`; snapshot do prompt.

---

## A5. Normalização de links e roteamento

**Objetivo:** aceitar qualquer link que o Bot aceita. **PB:** 02, 10.
**Arquivos:** criar `packages/ats-adapters/src/unwrap.ts`; alterar `detect.ts`, `packages/core/src/guardrails.ts` (`extractUrls`).
**Contrato:** `export async function unwrapUrl(url: string, fetcher: Fetcher): Promise<{ finalUrl: string; hops: string[] }>` — trata `linkedin.com/safety/go?url=`, `lnkd.in/*` (segue até 3 redirects HEAD), parâmetros de rastreio (`utm_*`, `trk`, `refId`).
**Regras:** só segue http(s); bloqueia IP privado (SSRF); máx. 3 saltos; 5 s.
**Bordas:** link encurtado que cai em login → ingestão marca `vaga_fechada`? Não: marca `login` e pede texto da vaga.
**Aceite:** Dado `https://www.linkedin.com/safety/go/?url=https%3A%2F%2Flnkd.in%2FabcXYZ`, Quando colado, Então a vaga final (fixture) é ingerida e o card mostra o link final.
**Testes:** `unwrap.test.ts` (fixtures de redirect, SSRF negado).
