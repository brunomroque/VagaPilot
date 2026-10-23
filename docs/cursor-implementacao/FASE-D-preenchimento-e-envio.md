# FASE D — Preenchimento e envio (11 tarefas)

Regra-mãe (DA-01): a extensão **pode clicar em Enviar** somente com approval válida daquela vaga (OK explícito no card de resumo, ou "envie direto" no card daquela vaga), e precisa confirmar com tela de sucesso + screenshot. Sem OK, para antes do botão final.

---

## D1. Runs de candidatura, lock e fila de pendências

**PB:** 22, 37, 39.
**Arquivos:** migração `<ts>_d1_runs.sql`; criar `apps/web/lib/runs/*.ts`, `apps/web/app/api/extension/runs/[id]/{claim,step,finish}/route.ts`; alterar `apps/extension/entrypoints/background.ts`, criar `apps/extension/lib/run-client.ts`.

```sql
create table public.application_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  state text not null check (state in ('fila','preenchendo','aguardando_usuario','pronta_para_envio','enviando','enviada','bloqueada','cancelada','erro')),
  blocked_reason text, step int not null default 0, total int, claimed_by text, heartbeat_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create unique index one_active_run_per_app on public.application_runs(application_id) where state in ('fila','preenchendo','aguardando_usuario','pronta_para_envio','enviando');
-- RLS: dono lê; escrita só via rotas do servidor
```

**Regras:** uma run ativa por candidatura; heartbeat 30 s, lock expira em 2 min; cada passo emite part `progress` ("Preenchendo etapa 2 de 4"); bloqueio vira `pending_item`.
**Casos de borda:** navegador fechado no meio ⇒ lock expira e a run vira `bloqueada(erro_site)` com botão "Retomar"; usuário cancela no chat ⇒ `cancelada`, nada enviado; duas vagas em paralelo ⇒ permitido (lock é por candidatura).
**Aceite:** Dado duas abas tentando a mesma run, Então só uma faz `claim`; Dado bloqueio por login, Então o chat mostra pendência e a planilha "Teste/Etapa pendente — login".
**Testes:** `runs.test.ts` (lock/expiração), RLS.

---

## D2. Política de campos e perguntas agrupadas

**Objetivo:** cada campo do formulário é classificado antes de ser preenchido, e o que falta vira **uma** pergunta agrupada no chat. **PB:** 23, 24, 25, 26.

**Arquivos**

- Criar `packages/core/src/field-policy.ts`, `packages/core/src/field-policy.test.ts`, `packages/ui/src/chat/GroupedQuestionCard.tsx`, `apps/web/app/api/extension/runs/[id]/questions/route.ts`.
- Alterar `packages/ats-adapters/src/types.ts` (`FormField`), adaptadores em `packages/ats-adapters/src/adapters/*`, `apps/extension/lib/autofill.ts`, `apps/web/lib/runs/service.ts`.
- Migração `<ts>_d2_run_questions.sql`.

**Contratos**

```ts
export const FormField = z.object({
  fieldId: z.string(),
  label: z.string(),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "select",
    "radio",
    "checkbox",
    "file",
    "date",
    "password",
    "otp",
  ]),
  options: z.array(z.string()).optional(),
  required: z.boolean(),
  prefilled: z.string().nullable(),
  section: z.string().optional(),
})
export type FieldClass =
  | "fato"
  | "resposta_padrao"
  | "pretensao"
  | "como_soube"
  | "documento"
  | "teste_conhecimento"
  | "segredo"
  | "perguntar"
  | "nunca_preencher"
export function classifyField(
  f: FormField,
  ctx: {
    facts: Fact[]
    standardAnswers: StandardAnswer[]
    salary: SalarySuggestion
    source: string
  }
): { cls: FieldClass; value?: string; factIds?: string[]; confidence: number }
export const RunQuestion = z.object({
  fieldId: z.string(),
  prompt: z.string(),
  kind: z.enum(["experiencia", "operacional", "indicacao", "outro"]),
  options: z.array(z.string()).optional(),
  allowCustom: z.literal(true),
})
```

```sql
create table public.run_questions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.application_runs(id) on delete cascade, field_id text not null,
  prompt text not null, kind text not null, answer text, remember boolean not null default true,
  answered_at timestamptz, created_at timestamptz not null default now(), unique (run_id, field_id));
alter table public.run_questions enable row level security;
create policy rq_owner on public.run_questions for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
```

- Tool do chat: `answer_run_questions({ runId, answers: { fieldId: string; value: string; remember: boolean }[] })` → retoma a run (`aguardando_usuario → preenchendo`).
- Mensagem: part `question` com `questions: RunQuestion[]` (variante agrupada) e texto "Preciso de N respostas para continuar a candidatura na <Empresa>."

**Regras de negócio**

- Antes de `perguntar`, chamar `resolveFacts` (B6/MEMORIA §3.4) e a biblioteca (F2); a resposta livre do usuário passa por `propose_fact` (B6).
- `confidence < 0.8` em mapeamento de fato ⇒ `perguntar`.
- Experiência sem fato confirmado ⇒ `perguntar`; **nunca** inventar número de anos.
- Indicação ("Foi indicado por alguém?") ⇒ "Não", salvo fato/resposta padrão.
- Perguntas da mesma run são agrupadas num card; perguntas já respondidas (D3/F2) não se repetem.
- A extensão não digita nada num campo `perguntar` até a resposta chegar.

**Casos de borda**

- Formulário em várias páginas: perguntas por página, sem perder respostas anteriores.
- Campo obrigatório com opções que não contêm a resposta verdadeira ⇒ perguntar mostrando as opções.
- Usuário responde só parte do card ⇒ a run continua aguardando apenas os campos que faltam.
- Pergunta em inglês ⇒ card em português com o texto original entre aspas.

**Aceite**

- Dado "Quantos anos com Kubernetes?" sem fato, Quando a extensão chega ao campo, Então a run vai para `aguardando_usuario`, o chat mostra o card e o campo continua vazio.
- Dado 3 perguntas desconhecidas na mesma página, Então aparece **um** card com as 3.
- Dado "Foi indicado?" sem fato, Então preenche "Não" e lista no resumo com origem `padrao`.

**Testes:** `field-policy.test.ts` (tabela de 30 campos de fixture), `run-questions.rls.test.ts`, e2e `grouped-question.spec.ts`, `parity: PB-23..26`.

---

## D3. "Lembrar resposta" vira fato ou resposta padrão

**Objetivo:** responder uma vez e nunca mais ser perguntado. **PB:** 27.

**Arquivos:** alterar `GroupedQuestionCard.tsx` (checkbox "Lembrar para próximas vagas", marcado), `apps/web/lib/facts/actions.ts`, `apps/web/lib/standard-answers/actions.ts`; criar `packages/core/src/question-key.ts`.

**Contratos**

```ts
export function questionKey(prompt: string): string // normaliza (minúsculas, sem acento, sem números da vaga, sinônimos) → chave estável
type RememberResult =
  | { target: "fact"; factId: string }
  | { target: "standard_answer"; key: string }
```

```sql
alter table public.standard_answers add column question_key text, add column source_run_id uuid references public.application_runs(id) on delete set null;
create unique index sa_user_qkey on public.standard_answers(user_id, question_key) where question_key is not null;
alter table public.facts add column source_question_key text;
```

**Regras:** a gravação usa o serviço de B6 (`memory-service.ts`): intenção, guarda de evidência, confirmação se confiança baixa, versões. `kind=experiencia` ⇒ fato `confirmado`, `source_ref.origin='usuario'`, data; demais ⇒ `standard_answers`. Emite `settings_change` (A2). Desfazer via `undo_change`.
**Casos de borda:** mesma pergunta com unidade diferente (anos × meses) ⇒ converter e perguntar se ambíguo; resposta contradiz fato existente ⇒ pergunta qual vale, sem sobrescrever em silêncio; "lembrar" desmarcado ⇒ resposta usada só nesta run.
**Aceite**

- Dado "4 anos" com lembrar, Quando outra vaga pergunta "Years of experience with Kubernetes", Então preenche "4" sem perguntar e o resumo mostra origem `fato`.
- Dado lembrar desmarcado, Então a próxima vaga pergunta de novo.
  **Testes:** `question-key.test.ts` (PT/EN), `remember-answer.test.ts`, `parity: PB-27`.

---

## D4. Testes de conhecimento

**Objetivo:** responder questionário técnico só com autorização para aquele questionário. **PB:** 29 (DA-03).

**Arquivos:** criar `packages/ai/src/answer-knowledge.ts`, `apps/web/lib/runs/knowledge.ts`; alterar `field-policy.ts`, `ApprovalCard.tsx` (seção "Teste").

**Contratos**

```ts
export const KnowledgeQuiz = z.object({
  quizId: z.string(),
  questions: z.array(
    z.object({
      fieldId: z.string(),
      text: z.string(),
      options: z.array(z.string()).min(2),
    })
  ),
})
export const KnowledgeAnswers = z.object({
  answers: z.array(
    z.object({
      fieldId: z.string(),
      option: z.string(),
      rationale: z.string().max(300),
    })
  ),
})
// tool: authorize_knowledge_quiz({ runId, quizId, allow: boolean })
```

```sql
create table public.quiz_authorizations (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, run_id uuid not null references public.application_runs(id) on delete cascade, quiz_hash text not null, allowed boolean not null, decided_at timestamptz not null default now(), unique(run_id, quiz_hash));
```

**Regras:** detecção = ≥ 3 perguntas de múltipla escolha com conteúdo técnico (classificador + heurística). Autorização ligada ao `quiz_hash` (perguntas+opções). Sem OK ⇒ run para com `blocked_reason='pergunta'`. Respostas listadas no resumo com origem `teste`.
**Casos de borda:** teste com tempo (cronômetro) ⇒ avisar e pedir OK antes de iniciar; teste de personalidade ⇒ não é "conhecimento" (E4); questionário muda após OK ⇒ novo OK.
**Aceite:** Dado questionário de 5 perguntas, Então card "Posso responder este teste?"; Quando "sim", Então as 5 respostas aparecem no resumo; Quando "não", Então nada é marcado e a pendência é criada.
**Testes:** `knowledge-detect.test.ts`, eval `knowledge-test.eval.ts`, `parity: PB-29`.

---

## D5. Senha e OTP por formulário seguro

**Objetivo:** segredos nunca passam pelo chat. **PB:** 30, 31.

**Arquivos:** criar `packages/ui/src/chat/SecureFormCard.tsx`, `apps/web/app/api/runs/[id]/secret/route.ts`, `apps/web/lib/secrets/vault.ts`, `apps/extension/lib/secret-channel.ts`, `packages/core/src/password-rules.ts`; migração `<ts>_d5_run_secrets.sql`.

**Contratos**

```ts
export const SecretSubmit = z.object({
  purpose: z.enum(["senha", "otp"]),
  value: z.string().min(1).max(256),
  saveToVault: z.boolean().default(false),
})
export function parsePasswordRules(text: string): {
  minLength?: number
  upper?: boolean
  lower?: boolean
  digit?: boolean
  symbol?: boolean
}
```

```sql
create table public.run_secrets (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, run_id uuid not null references public.application_runs(id) on delete cascade, purpose text not null check (purpose in ('senha','otp')), ciphertext bytea not null, expires_at timestamptz not null, consumed_at timestamptz);
alter table public.run_secrets enable row level security; -- sem policy de select para o cliente; só a rota do servidor lê
```

**Regras:** cifrado com a chave do servidor (mesma de `standard_answers`), TTL 5 min, consumido uma vez pela extensão autenticada; `redact()` em logs; o LLM só vê "segredo fornecido". Senha só vai ao cofre se o usuário marcar.
**Casos de borda:** OTP expirou no site ⇒ novo `secure_form` "código novo"; usuário cola senha no chat comum ⇒ a mensagem é mascarada antes de salvar e ele é avisado; site rejeita a senha ⇒ mostra a regra do site e pede outra.
**Aceite:** Dado site pedindo criar senha, Então aparece `secure_form` com as regras; Quando enviada, Então busca pelo valor em `messages`, `audit_log`, `domain_events` e logs retorna 0 ocorrências.
**Testes:** `password-rules.test.ts`, `secret-channel.test.ts`, `no-secret-leak.test.ts`, `parity: PB-30/31`.

---

## D6. Documentos pessoais

**Objetivo:** campos de documento usam só dados salvos e cifrados. **PB:** 32.

**Arquivos:** alterar `apps/web/app/app/perfil/*` (seção Documentos), `packages/core/src/field-policy.ts`; criar `packages/core/src/mask.ts`.

**Contratos**

```ts
type PersonalDocKey = "cpf" | "rg" | "data_nascimento" | "endereco" | "telefone"
export function mask(key: PersonalDocKey, v: string): string // "***.***.***-12"
// tool: request_personal_doc({ runId, key }) → abre secure_form (sem LLM)
```

**Regras:** valor cifrado em `standard_answers` (`kind='documento'`); chat e resumo só mostram máscara; sem dado ⇒ `blocked_reason='documento'` e `secure_form`.
**Casos de borda:** formato diferente por site (CPF com/sem pontos) ⇒ formata conforme `pattern` do campo; upload de arquivo de documento ⇒ nunca automático, sempre pergunta.
**Aceite:** Dado CPF ausente, Então a run pausa com `documento`; Dado CPF salvo, Então o resumo mostra só a máscara.
**Testes:** `mask.test.ts`, `documents.test.ts`.

---

## D7. "Como soube", arquivo do CV e respostas pré-preenchidas pelo ATS

**Objetivo:** conferir o que o ATS já preencheu. **PB:** 33, 34, 35 (DA-12).

**Arquivos:** alterar `apps/extension/lib/autofill.ts`, adaptadores; criar `packages/core/src/prefill-diff.ts`, `apps/extension/lib/file-check.ts`.

**Contratos**

```ts
type PrefillDiff = {
  fieldId: string
  label: string
  atsValue: string
  expected: string
  action: "corrigido" | "perguntar"
}
export function diffPrefill(
  fields: FormField[],
  expected: Record<string, string>
): PrefillDiff[]
type FileCheck = {
  expectedFileName: string
  expectedSha256: string
  foundFileName?: string
  ok: boolean
}
```

**Regras:** "como soube" = fonte real (`route` da A3); divergência de valor ⇒ corrigir e listar como `corrigido`; divergência em campo sem valor esperado ⇒ perguntar; arquivo do CV conferido por nome e hash do arquivo enviado.
**Casos de borda:** ATS que substitui o CV pelo do perfil ⇒ trocar e listar; ATS que não mostra o nome do arquivo ⇒ `ok=false` + aviso no resumo; opção "LinkedIn" inexistente ⇒ "Outros" + texto "LinkedIn".
**Aceite:** Dado pretensão antiga pré-preenchida, Então o resumo mostra "Pretensão: corrigida de R$ 18.000 para R$ 25.000"; Dado CV errado anexado pelo ATS, Então é trocado antes do resumo.
**Testes:** `prefill-diff.test.ts`, fixtures `gupy-prefilled.html`.

---

## D8. Experiências copiadas do CV (Workday e similares)

**Objetivo:** preencher listas repetíveis de experiência a partir do CV. **PB:** 44.

**Arquivos:** criar `packages/ats-adapters/src/adapters/workday-experiences.ts`, `packages/core/src/experience-map.ts`.

**Contratos**

```ts
type ExperienceEntry = {
  company: string
  title: string
  start: string /* MM/AAAA */
  end: string | null
  current: boolean
  description: string
  factIds: string[]
}
export function experiencesFromCv(cv: CvModel): ExperienceEntry[]
```

**Regras:** mesma ordem do CV; descrições só dos bullets (com `factIds`); limite de caracteres do campo ⇒ truncar em frase inteira; datas no formato do site.
**Casos de borda:** site com menos blocos que o CV ⇒ preencher os mais recentes e avisar; datas só com ano ⇒ perguntar o mês; limite de candidaturas da empresa (C2) atingido ⇒ não iniciar.
**Aceite:** Dado CV fictício com 14 experiências, Então 14 blocos são preenchidos e conferidos no resumo (contagem igual).
**Testes:** `experience-map.test.ts`, fixture `workday-form.html`.

---

## D9. Resumo, OK, envio, tela de sucesso e screenshot

**Objetivo:** etapa 7–8 do Bot com envio somente após OK daquela vaga. **PB:** 07, 38 (DA-01, DA-02).

**Arquivos:** criar `packages/ui/src/chat/ApprovalCard.tsx`, `apps/web/lib/approvals/submit.ts`, `apps/web/app/api/approvals/[id]/approve/route.ts`, `apps/extension/lib/submit.ts`, `apps/extension/lib/success-detect.ts`; migração `<ts>_d9_submission.sql`.

**Contratos**

```ts
export const SubmissionSummary = z.object({
  applicationId: z.string().uuid(),
  company: z.string(),
  title: z.string(),
  cvFileName: z.string(),
  salary: z.number().optional(),
  answers: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      origin: z.enum(["fato", "padrao", "usuario", "teste", "corrigido"]),
    })
  ),
  packageHash: z.string(),
})
// tool: approve_submission({ approvalId }) — só aceita chamada vinda do clique (token de UI de uso único); o LLM não aprova
```

```sql
alter table public.approvals add column package_hash text, add column scope text not null default 'vaga' check (scope = 'vaga'), add column ui_token_hash text;
create table public.submission_evidence (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade, approval_id uuid not null references public.approvals(id),
  screenshot_path text not null, success_text text not null, url text not null, captured_at timestamptz not null default now(), unique(approval_id));
alter table public.submission_evidence enable row level security;
create policy se_owner on public.submission_evidence for select using ((select auth.uid()) = user_id);
```

**Regras:** approval guarda `packageHash`; mudança no formulário ⇒ approval inválida e novo OK; "envie direto" (C7) cria approval pré-aprovada daquela vaga, que vale enquanto o hash bater com o que o card mostrou (CV + pretensão); a extensão clica em Enviar só com approval válida; depois espera a tela de sucesso (texto/seletor por ATS, timeout 20 s), chama `chrome.tabs.captureVisibleTab`, salva no bucket privado `evidence/` e só então marca `enviada` + part `evidence`.

**Casos de borda:** aba fechada entre OK e envio ⇒ `bloqueada(erro_site)`, novo OK ao retomar; tela de sucesso não reconhecida ⇒ screenshot salvo + pendência "confirme se enviou", nunca "Enviada" direto; duplo clique ⇒ idempotente por `approvalId`.

**Aceite**

- Dado "pare antes", Então a run termina em `pronta_para_envio` e Enviar não é clicado (spy).
- Dado OK no `approval`, Então clica, captura o screenshot e muda para Enviada com evidência.
- Dado OK e formulário alterado depois, Então pede novo OK.
- Dado qualquer caminho de código, Então não existe submit sem approval válida (teste de arquitetura).

**Testes:** `submit.test.ts`, `approval-hash.test.ts`, `no-submit-without-approval.test.ts`, e2e da extensão com página de teste, `parity: PB-07/38`.

---

## D10. Casos bloqueados

**Objetivo:** registrar e explicar quando não dá para enviar. **PB:** 39.

**Arquivos:** criar `apps/extension/lib/blockers.ts`, `packages/core/src/blocked.ts`; alterar `runs/service.ts`.

**Contratos**

```ts
type BlockerDetection = {
  reason: BlockedReason
  evidence: string
  suspectFields?: string[]
  screenshotPath?: string
}
export function detectBlocker(
  dom: DomSnapshot,
  http?: { status: number }
): BlockerDetection | null
// mensagem: pending_item { reason, text: "Não consegui enviar: <motivo>. O que fazer: <próximo passo>." }
```

**Regras:** botão desabilitado após 3 s com tudo preenchido ⇒ `botao_desabilitado` + campos obrigatórios suspeitos; Cloudflare/captcha/403 ⇒ `captcha` (nunca contornar); 404/encerrada ⇒ C8; erro 5xx ⇒ 1 nova tentativa e depois `erro_site`.
**Casos de borda:** captcha resolvido manualmente pelo usuário ⇒ botão "Continuar" retoma; bloqueio após OK ⇒ OK continua válido se o hash não mudou.
**Aceite:** Dado botão desabilitado, Então pendência "botão desabilitado" com campos suspeitos e planilha "Teste/Etapa pendente [Incompleta/bloqueada]".
**Testes:** `blockers.test.ts` (fixtures disabled/cloudflare/404/500).

---

## D11. Trocar o CV de uma candidatura existente

**Objetivo:** substituir o CV quando a versão mudou. **PB:** 45.

**Arquivos:** alterar `application_runs` (coluna `kind`), `apps/web/lib/runs/service.ts`, `packages/ats-adapters` (capacidade `canEditApplication`).

**Contratos**

```sql
alter table public.application_runs add column kind text not null default 'candidatura' check (kind in ('candidatura','atualizar_cv'));
```

```ts
// tool: propose_cv_swap({ applicationId, newCvVersionId }) → card question "Trocar CV?" (sim/não)
```

**Regras:** só se o ATS permite editar; mesmo fluxo de approval/screenshot do D9; sem edição ⇒ nota "não é possível trocar neste ATS".
**Casos de borda:** candidatura já em Entrevista ⇒ desaconselhar e pedir confirmação; ATS exige login expirado ⇒ D5.
**Aceite:** Dado candidatura enviada com CV antigo e ATS editável, Quando confirmo, Então nova evidência e nota "CV atualizado em dd/mm".
**Testes:** `update-cv-run.test.ts`.
