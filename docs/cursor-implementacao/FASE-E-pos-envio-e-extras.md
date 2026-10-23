# FASE E — Pós-envio e extras (9 tarefas)

## E1. Conciliação de e-mails com a planilha

**Objetivo:** e-mails de retorno atualizam o status, como o Bot. **PB:** 46, 47, 48, 49.

**Arquivos:** alterar `packages/gmail/src/classify.ts`, `packages/gmail/src/reconcile.ts`, `packages/jobs/src/functions/gmail-sync.ts`; criar `packages/core/src/deadlines.ts`, migração `<ts>_e1_email_links.sql`.

**Contratos**

```ts
export const EmailClass = z.enum([
  "confirmacao",
  "reprovacao",
  "entrevista",
  "teste",
  "convite_rh",
  "proposta",
  "outro",
])
export const EmailClassification = z.object({
  cls: EmailClass,
  company: z.string().nullable(),
  title: z.string().nullable(),
  deadline: z.string().datetime().nullable(),
  confidence: z.number().min(0).max(1),
})
type ReconcileResult =
  | { kind: "atualizada"; applicationId: string; from: Status; to: Status }
  | { kind: "ambigua"; candidates: string[] }
  | { kind: "nova_linha"; applicationId: string }
  | { kind: "ignorada" }
// tool: resolve_email_match({ emailLinkId, applicationId | null })
```

```sql
create table public.email_links (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null, application_id uuid references public.applications(id) on delete set null, cls text not null,
  confidence real not null, resolved_by text not null check (resolved_by in ('auto','usuario')), deadline_at timestamptz,
  created_at timestamptz not null default now(), unique(user_id, gmail_message_id));
-- RLS dono
```

**Regras:** casa por empresa normalizada + cargo (similaridade ≥ 0,8) + data após a candidatura; `confidence < 0,75` ou > 1 candidata ⇒ `ambigua` e card "De qual vaga é este e-mail?"; convite de RH sem candidatura ⇒ nova linha `Fonte/Rota="<ATS> (convite)"`; status nunca regride (Reprovada não volta para Em análise); prazo ⇒ lembrete 24 h antes. Corpo do e-mail é `<untrusted>`.
**Casos de borda:** e-mail de plataforma genérica (remetente do ATS, empresa no corpo); duas candidaturas na mesma empresa; e-mail encaminhado; idioma inglês; e-mail repetido (idempotente por `gmail_message_id`).
**Aceite**

- Dado e-mail fictício de reprovação da Empresa Alfa, Então Reprovada, notas "E-mail dd/mm: <assunto>" e aviso no chat.
- Dado e-mail de teste sem cargo e 2 candidaturas na Beta, Então card com as 2 opções; nada muda até a escolha.
  **Testes:** `classify.eval.ts` (30 e-mails fictícios), `reconcile.test.ts`, `deadlines.test.ts`, `parity: PB-46..49`.

---

## E2. Código de verificação por e-mail (OTP) — NÃO VERIFICADO no Bot

**Objetivo:** sugerir o código recebido por e-mail sem usá-lo sozinho. **PB:** 31.

**Arquivos:** criar `packages/gmail/src/otp.ts`; alterar `SecureFormCard.tsx` (campo pré-sugerido), `lib/settings/server.ts` (flag `otp_from_gmail`, padrão `false`).

**Contratos**

```ts
export function findOtp(
  msgs: GmailMessage[],
  ctx: { atsDomain: string; since: Date }
): { code: string; messageId: string } | null // regex 4–8 dígitos perto de "código|code|verification"
```

**Regras:** só com flag ligada pelo chat ou pela tela; janela de 10 min; domínio do remetente precisa bater com o ATS; o código aparece mascarado no card e só é usado após clique; nunca salvo.
**Casos de borda:** dois códigos ⇒ o mais recente; código em imagem ⇒ não encontrado (sem OCR, DA-08); e-mail chega depois ⇒ polling de 15 s por até 3 min.
**Aceite:** Dado flag ligada e e-mail fictício "Seu código: 482913", Então o card mostra "••••13 — usar?" e só preenche após clique; Dado flag desligada, Então só o campo vazio.
**Testes:** `otp.test.ts`, `no-secret-leak.test.ts` (inclui OTP).

---

## E3. Preparação de entrevista

**Objetivo:** roteiro de estudo quando chega convite. **PB:** 50.

**Arquivos:** criar `packages/ai/src/interview-prep.ts`, `apps/web/app/app/candidaturas/[id]/preparacao/page.tsx`, `apps/web/lib/interview/export-md.ts`; migração `interview_preps`.

**Contratos**

```ts
export const InterviewPrep = z.object({
  applicationId: z.string().uuid(),
  companyBrief: z.string(),
  likelyQuestions: z.array(z.object({ q: z.string(), why: z.string() })),
  starStories: z.array(
    z.object({
      title: z.string(),
      situation: z.string(),
      task: z.string(),
      action: z.string(),
      result: z.string(),
      factIds: z.array(z.string().uuid()).min(1),
    })
  ),
  gaps: z.array(z.string()),
  questionsToAsk: z.array(z.string()),
  language: z.enum(["pt-BR", "en"]),
})
// tool: generate_interview_prep({ applicationId })
```

```sql
create table public.interview_preps (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, application_id uuid not null references public.applications(id) on delete cascade, content jsonb not null, created_at timestamptz not null default now());
```

**Regras:** toda história STAR tem `factIds` confirmados; lacunas da vaga sem fato viram "como responder com honestidade"; idioma da vaga; exporta `.md` com nome `prep-<empresa>-<cargo>.md` (E6).
**Casos de borda:** vaga sem descrição salva ⇒ usar e-mail do convite e avisar; empresa com nome genérico ⇒ resumo marcado "NÃO VERIFICADO".
**Aceite:** Dado convite de entrevista conciliado, Então o chat oferece "Quer um roteiro?"; Quando sim, Então gera roteiro em que todas as histórias referenciam fatos.
**Testes:** `interview-prep.eval.ts` (grounding), `export-md.test.ts`.

---

## E4. Guia de Fit Cultural (Gupy)

**Objetivo:** guia de respostas para testes comportamentais da Gupy, no formato que o Bot usa. **PB:** 51 (DA-03).

**Arquivos:** criar `packages/ai/src/fit-cultural.ts`, `packages/ai/src/prompts/fit-cultural.md` (formato de `_formato_gupy.md`, anonimizado), `apps/web/lib/interview/fit-cultural-export.ts`.

**Contratos**

```ts
export const FitCulturalGuide = z.object({
  applicationId: z.string().uuid(),
  sections: z.array(
    z.object({
      theme: z.string(),
      guidance: z.string(),
      exampleFromFacts: z.string().optional(),
      factIds: z.array(z.string().uuid()),
    })
  ),
})
// tool: generate_fit_cultural_guide({ applicationId })
```

**Regras:** é guia de estudo; não preenche o teste da Gupy (teste de personalidade não entra em D4); exemplos só de fatos confirmados; arquivo `fit-cultural-<empresa>-AAAA-MM-DD.md`.
**Casos de borda:** candidatura fora da Gupy ⇒ oferecer só se o e-mail citar teste comportamental; sem fatos de comportamento ⇒ guia sem exemplos, com aviso.
**Aceite**

- Dado e-mail fictício "Etapa: Fit Cultural" da Gupy para a Empresa Gama, Quando aceito o guia, Então o arquivo segue as seções do formato e cada exemplo tem `factIds`.
- Dado qualquer pedido, Então a extensão não abre nem responde o teste.
  **Testes:** `fit-cultural.snapshot.test.ts`, `fit-cultural.eval.ts` (grounding), `parity: PB-51`.

---

## E5. Relatório periódico e sob demanda no chat

**Objetivo:** resumo das candidaturas como o Bot manda. **PB:** 52, 53.

**Arquivos:** criar `packages/jobs/src/functions/tracker-report.ts`, `packages/core/src/report-diff.ts`, `packages/ui/src/chat/ReportCard.tsx`; alterar `lib/settings/server.ts` (`report_schedule`).

**Contratos**

```ts
export const ReportSchedule = z.object({
  enabled: z.boolean().default(true),
  cadence: z.enum(["semanal", "diario"]).default("semanal"),
  weekday: z.number().int().min(0).max(6).default(5),
  hour: z.number().int().default(18),
  tz: z.literal("America/Sao_Paulo"),
})
type ReportDiff = {
  counts: Record<DisplayStatus, number>
  changes: {
    applicationId: string
    company: string
    from: DisplayStatus | null
    to: DisplayStatus
  }[]
  pending: PendingItem[]
}
// tools: export_tracker (já existe, passa a gerar part report), set_report_schedule(ReportSchedule)
```

**Regras:** padrão semanal (sexta 18h, horário de Brasília) + sob demanda ("me manda o status"), o que se observou no Bot; contagens das 7 categorias + Descartada (A3); anexa CSV e MD `status-candidaturas-AAAA-MM-DD`; só mudanças desde o último relatório.
**Casos de borda:** nenhuma mudança ⇒ relatório curto "sem novidades" + pendências; usuário pede no meio da semana ⇒ não reinicia a contagem do agendado; fuso/DST ⇒ sempre America/Sao_Paulo.
**Aceite**

- Dado 5 mudanças na semana, Quando o job roda, Então part `report` com contagens, 5 mudanças e link do CSV com o cabeçalho exato.
- Dado "me manda o status agora", Então o mesmo relatório sai em ≤ 10 s.
  **Testes:** `report-diff.test.ts`, `tracker-report.test.ts` (fake Inngest + relógio fixo), `parity: PB-52/53`.

---

## E6. Regras de nomenclatura

**Objetivo:** nomes de arquivo e empresa iguais aos do Bot. **PB:** 43.

**Arquivos:** criar `packages/core/src/naming.ts`.

**Contratos**

```ts
export function cvFileName(o: {
  fullName: string
  track: string
  lang: "pt-BR" | "en"
}): string // "Nome_Sobrenome_CV_Engenharia_EN.pdf"
export function reportFileName(d: Date, ext: "md" | "csv"): string // status-candidaturas-2026-10-22.csv
export function companyKey(name: string): string // sem Ltda/S.A./Inc, sem acento, minúsculas — só para comparação
```

**Regras:** acentos removidos só do nome de arquivo; exibição mantém a grafia original.
**Casos de borda:** nomes compostos com partícula ("de", "da"); empresa "Alfa Tecnologia Ltda." × "ALFA TECNOLOGIA" ⇒ mesma chave.
**Aceite:** Dado "Empresa Alfa Ltda." e "EMPRESA ALFA", Então `companyKey` igual.
**Testes:** `naming.test.ts`.

---

## E7. Consultas de histórico pelo chat

**Objetivo:** "Já me candidatei à Alfa?" respondido com dados. **PB:** 54.

**Arquivos:** criar `apps/web/lib/chat/history.ts`; alterar `apps/web/lib/chat/tools.ts`.

**Contratos**

```ts
export const QueryHistoryInput = z.object({
  company: z.string().optional(),
  status: z.array(Status).optional(),
  since: z.string().date().optional(),
  text: z.string().optional(),
})
type QueryHistoryOutput = {
  rows: {
    applicationId: string
    company: string
    title: string
    appliedAt: string | null
    status: DisplayStatus
    lastEmail?: string
  }[]
  total: number
}
// tool: query_history(QueryHistoryInput)
```

**Regras:** busca por `companyKey` + e-mails conciliados; responde com tabela curta; sem resultado ⇒ "Não encontrei candidaturas para X" (nunca "não se candidatou" se o Gmail não estiver conectado — avisa a limitação).
**Casos de borda:** empresa com nomes parecidos (Alfa × Alfa Bank) ⇒ lista separada e pergunta; mais de 20 linhas ⇒ resumo + link para `/app/candidaturas?empresa=`.
**Aceite:** Dado 2 candidaturas fictícias na Alfa, Quando pergunto "já me candidatei à Alfa?", Então a resposta lista as 2 com status e datas.
**Testes:** `history.test.ts`, eval `history-query.eval.ts`, `parity: PB-54`.

---

## E8. Rascunho de mensagem ao recrutador

**Objetivo:** texto pronto para quem publicou a vaga, sem envio automático. **PB:** 55.

**Arquivos:** criar `packages/ai/src/recruiter-message.ts`; alterar `apps/web/lib/chat/tools.ts`.

**Contratos**

```ts
export const RecruiterMessage = z.object({
  applicationId: z.string().uuid(),
  channel: z.enum(["linkedin", "email"]),
  to: z.string().nullable(),
  language: z.enum(["pt-BR", "en"]),
  subject: z.string().optional(),
  body: z.string().max(1200),
  factIds: z.array(z.string().uuid()),
})
// tool: draft_recruiter_message({ applicationId, channel })
```

**Regras:** usa `postedBy` da C1; até 600 caracteres no LinkedIn; só fatos confirmados; mostra botão "Copiar"; e-mail só sai pelo fluxo `request_send_email` com approval; LinkedIn nunca é enviado pelo app.
**Casos de borda:** sem recrutador identificado ⇒ saudação genérica; vaga encerrada ⇒ avisar antes.
**Aceite:** Dado "escreva para quem publicou", Então rascunho com o nome do recrutador, ≤ 600 caracteres, e nenhum envio registrado.
**Testes:** `recruiter-message.eval.ts`, `no-auto-send.test.ts`.

---

## E9. Eval de jornada ponta a ponta (gate de paridade)

**Objetivo:** rodar `TESTES-DE-PARIDADE.md` automaticamente.

**Arquivos:** criar `evals/parity/harness.ts`, `evals/parity/tp-XX.eval.ts` (um por cenário), `evals/parity/fixtures/*`, `scripts/parity-report.ts`; alterar `package.json` (`eval:parity`), `.github/workflows/ci.yml`.

**Contratos**

```ts
type ParityScenario = {
  id: `TP-${string}`
  pb: string[]
  given: () => Promise<void>
  when: () => Promise<void>
  then: Array<(ctx: Ctx) => Promise<void>>
}
type ParityResult = { id: string; pb: string[]; ok: boolean; evidence: string }
```

**Regras:** provedor FAKE, relógio fixo (America/Sao_Paulo), Gmail e ATS por fixtures; nada sai para a internet; gera `docs/PARIDADE-RESULTADO.md`.
**Casos de borda:** cenário instável ⇒ falha (sem retry silencioso).
**Aceite:** Dado o repo, Quando `pnpm eval:parity`, Então todos os TP verdes e o relatório lista PB → teste.
**Testes:** o próprio harness tem `harness.test.ts`.
