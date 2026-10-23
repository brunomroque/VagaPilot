# VagaPilot: jornada guiada pelo chat (chat-first)

> Especificação para o Cursor implementar. **Nada é removido.** Todas as telas e funções atuais continuam. O chat passa a ser a **porta de entrada e o guia** da jornada, e a plataforma preenche os dados por trás, nas tabelas que já existem. Assim, tudo o que for feito pelo chat aparece nas telas atuais.
>
> Leia antes: `AGENTS.md`, `.cursor/rules/30-agente-ia.mdc`, `.cursor/rules/20-dados-seguranca.mdc`, `docs/cursor-implementacao/MEMORIA-DE-FATOS.md`, `docs/cursor-implementacao/FASE-G-cvs-multiplos-e-perfil-unico.md`.

---

## 1. Ponto de partida (o que o repo já tem)

| Peça                | Onde está                                                                                                                                                                   | Situação                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Página de chat      | `apps/web/app/app/chat/page.tsx` e `actions.ts`                                                                                                                             | Existe, mas é um item do menu, não a entrada principal                                                                                                                                                                                                |
| Rota de streaming   | `apps/web/app/api/chat/route.ts`                                                                                                                                            | Usa `streamText`, `createUIMessageStream`, guardrails (`classifyTopic`), rate limit Upstash, `audit` e `outputFilterTransform`                                                                                                                        |
| Ferramentas         | `apps/web/lib/chat/tools.ts`, `packages/ai/src/chat/tool-schemas.ts`, `apps/web/lib/email/chat-tools.ts`                                                                    | 26 ferramentas, entre elas `ingest_job_postings`, `get_job_match`, `recommend_cv`, `record_decision`, `ask_clarification`, `propose_fact`, `draft_application_email`, `request_send_email`, `send_email`, `undo_change` e as de buscas e preferências |
| Cartões no chat     | `apps/web/components/chat/*` (`tool-output-view.tsx`, `job-card-view.tsx`, `settings-change-view.tsx`, `pending-questions-panel.tsx`, `ingest-batch.tsx`)                   | Os outputs carregam `kind` (`job_card`, `fact_approval`, `email_approval`, `clarification`…), definido em `apps/web/lib/chat/types.ts`                                                                                                                |
| Persistência        | Tabelas `conversations` (id, user_id, title, created_at) e `messages` (conversation_id, role, parts jsonb), via `apps/web/lib/chat/conversations.ts` (`HISTORY_LIMIT = 60`) | Funciona, mas sem `updated_at`, arquivamento, contexto de vaga ou vínculo com os registros criados                                                                                                                                                    |
| Aprovação           | Tabela `approvals` (com `preview_sha256` e `expires_at`), `apps/web/lib/approvals/decide.ts`, `/api/approvals/[id]/decide`                                                  | Já é usada no envio de e-mail; vamos generalizar                                                                                                                                                                                                      |
| Memória e fatos     | `confirmed_facts` (status `proposto`, `source`, `source_ref`, embedding), `memory_events`, as telas `/app/fatos` e `/app/memoria`                                           | Existe; falta a classificação "relevante para CV ou só formulário"                                                                                                                                                                                    |
| CVs                 | `cv_tracks`, `cv_versions` (`parent_version_id`, `fact_ids`, `origin`), tela `/app/cvs`                                                                                     | Não há ferramenta de chat que gere ou ajuste CV, nem regra explícita de CV Híbrido                                                                                                                                                                    |
| Perguntas pendentes | `pending_questions` (`remember`, `proposed_answer`, realtime)                                                                                                               | Existe; vamos usar no fluxo "informação faltante"                                                                                                                                                                                                     |
| Home                | `apps/web/app/app/page.tsx` renderiza `components/app/overview.tsx`                                                                                                         | O chat não aparece na home                                                                                                                                                                                                                            |
| Observabilidade     | `packages/ai/src/telemetry.ts` (Langfuse), `sentry.*.config.ts` + `lib/observability/sentry-redact.ts`, `components/posthog-provider.tsx`                                   | Existe; faltam os eventos do funil do chat                                                                                                                                                                                                            |

**Conclusão:** não é preciso criar um chat novo. O trabalho é: (1) promover o chat a guia, (2) completar as ferramentas que faltam (ATS, CV, perfis de plataforma, candidatura, classificação de fato), (3) generalizar a aprovação, (4) registrar a proveniência "preenchido via chat", (5) enriquecer a persistência e a telemetria.

---

## 2. Princípios

1. **O chat guia e as telas continuam.** Toda ação do chat grava nas mesmas tabelas que as telas leem. Nenhuma tela é removida nem perde função.
2. **A plataforma preenche por trás.** A pessoa conversa e a IA chama ferramentas que criam ou atualizam os registros. A pessoa não precisa abrir formulário, mas pode.
3. **Aprovação humana antes de qualquer coisa consequente.** Enviar e-mail, salvar fato, alterar CV, registrar candidatura enviada, mudar o modo de aprovação, excluir. Isso sempre passa por um cartão com Aprovar e Recusar, gravado em `approvals`.
4. **CV só ganha conteúdo.** Nunca se apagam ou alteram datas, cargos ou empresas. Ver a seção 6.
5. **Sem invenção.** Uma afirmação sobre a experiência da pessoa só pode vir de `search_facts` (fatos confirmados). Isso já está no prompt `packages/ai/prompts/orchestrator.v1.md`, e as novas ferramentas mantêm a regra.
6. **Mesmo domínio, duas portas.** As ferramentas chamam as mesmas funções de servidor que as telas usam (`lib/cvs/server.ts`, `lib/facts/server.ts`, `lib/tracker/server.ts`, `lib/profile/server.ts`, `lib/settings/server.ts`). Não se duplica regra de negócio.

---

## 3. Experiência (UX)

### 3.1 Chat como home

- `/app` passa a mostrar o **chat em destaque**. Um layout possível: o chat ocupa a coluna principal, e a coluna lateral mostra um resumo do `Overview` (próximas ações, candidaturas recentes).
- O `Overview` atual continua acessível em `/app/visao-geral`, ou como aba "Painel" na própria home. **Não removê-lo.**
- O item "Chat" do `app-sidebar.tsx` continua (aponta para `/app/chat`, a conversa em tela cheia). O primeiro item do menu vira "Início (chat)".
- Adicionar um botão flutuante "Perguntar ao VagaPilot" em todas as telas `/app/*`. Ele abre o chat em `Sheet` lateral, já com o contexto da tela (ex.: em `/app/candidaturas`, com a candidatura selecionada).
- `command-menu.tsx`: adicionar o atalho "Perguntar ao chat…".
- Para quem acabou de se cadastrar, o onboarding pode ser feito pelo chat (opção "Fazer pelo chat"). O wizard `/app/onboarding` continua existindo.

### 3.2 Mensagem de abertura (proativa)

Ao abrir a home, o chat mostra um cartão `kind: "next_steps"` montado a partir dos dados, sem chamar o LLM:

- perfil incompleto (`lib/onboarding/server.ts`);
- `pending_questions` abertas;
- `approvals` pendentes;
- perfis de plataforma desatualizados (seção 5.3);
- ações com prazo (`list_pending_actions`).

Cada item tem botões de opção ("Resolver agora", "Depois").

### 3.3 Widgets no chat (novos `kind` em `lib/chat/types.ts`)

| kind                                   | Uso                                                     | Botões                                                               |
| -------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `options` (generaliza `clarification`) | Escolha única ou múltipla                               | Opções clicáveis + "Outro (digitar)"                                 |
| `ats_score`                            | Score ATS antes e depois, keywords cobertas e faltantes | "Gerar CV ajustado", "Ver vaga"                                      |
| `cv_diff`                              | Diff do CV, só com adições destacadas                   | Aprovar, Recusar, Editar                                             |
| `fact_classification`                  | Fato novo + a classificação sugerida                    | Só esta candidatura / Salvar fato / Atualizar CVs / Registrar lacuna |
| `profile_tracking`                     | Lista de plataformas (LinkedIn, Gupy…) com o status     | "Marcar como atualizado", "Ver o que mudar"                          |
| `application_card`                     | Candidatura criada ou atualizada                        | "Abrir em Candidaturas", "Mudar status"                              |
| `next_steps`                           | Abertura proativa                                       | Os itens da seção 3.2                                                |
| `deep_link`                            | Link para uma tela existente                            | "Abrir"                                                              |

Regras dos widgets:

- Os cliques nos botões viram mensagens estruturadas (`parts` com `type: "data-action"`, com o id da aprovação e a escolha). O backend trata essas mensagens sem depender de o modelo interpretar texto.
- Hoje o `bodySchema` aceita só `text`. Ele precisa aceitar também `data-action`, validado com zod.

### 3.4 Links do chat para as telas, e das telas para o chat

- Todo cartão que cria ou altera um registro mostra "Abrir em …". Exemplos: `/app/candidaturas?id=…`, `/app/cvs?version=…`, `/app/fatos?id=…`, `/app/perfil#experiencias`, `/app/buscas?id=…`, `/app/memoria`.
- As telas existentes mostram o selo **"Preenchido via chat"** (com um link "ver conversa") nos registros que têm proveniência de chat (seção 7.2). Os componentes afetados são: `application-sheet.tsx`, `cv-library.tsx`, `fact-review.tsx`, `profile-forms.tsx`, `memory-view.tsx` e `searches-view.tsx`.

---

## 4. Ferramentas: o que existe e o que falta

### 4.1 Já existem (manter e reaproveitar)

`ingest_job_postings`, `get_job_match`, `check_duplicate`, `search_facts`, `get_profile_summary`, `recommend_cv`, `suggest_salary`, `record_decision`, `list_pending_actions`, `get_settings`, `ask_clarification`, `create_saved_search`, `update_saved_search`, `delete_saved_search`, `add_excluded_company`, `remove_excluded_company`, `update_language_level`, `set_salary_rules`, `set_preference`, `set_approval_mode`, `undo_change`, `propose_fact`, `export_tracker`, `draft_application_email`, `request_send_email`, `send_email`.

### 4.2 Novas (adicionar em `tool-schemas.ts` + `CHAT_TOOL_DESCRIPTIONS` + `lib/chat/tools.ts`)

| Ferramenta                                         | O que faz                                                                                                                                           | Grava em                                                                  | Exige aprovação?                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ats_score`                                        | Calcula o score ATS de um `cv_version` contra um `job_posting`. Usa `packages/ai/src/assess-fit.ts` e uma pontuação determinística de keywords      | `job_matches` (novo campo `ats` jsonb: antes e depois)                    | Não, é só leitura e cálculo                          |
| `propose_cv_adjustment`                            | Gera uma nova versão de CV a partir de uma trilha, para a vaga. **Só adiciona** bullets, keywords e um resumo, sempre baseados em `confirmed_facts` | Cria `approvals` (`kind = cv_change`) com o diff em `preview`             | Sim                                                  |
| `apply_cv_adjustment`                              | Depois da aprovação, cria o `cv_versions` com `parent_version_id`, `origin = 'chat'` e `fact_ids`                                                   | `cv_versions` + Storage                                                   | Recebe só `approvalId`                               |
| `ensure_hybrid_cv`                                 | Garante que exista a trilha **Híbrido** (obrigatória) e a mantém atualizada quando outras trilhas ganham conteúdo                                   | `cv_tracks`, `cv_versions` (via aprovação)                                | Sim, na geração                                      |
| `list_cv_tracks`                                   | Lista as trilhas e as versões padrão por idioma                                                                                                     | leitura                                                                   | Não                                                  |
| `get_profile_tracking` / `mark_profile_updated`    | Acompanha os perfis em plataformas (LinkedIn, Gupy, Catho, InHire…) e marca os desatualizados                                                       | Nova tabela `platform_profiles` (seção 7.1)                               | Marcar como atualizado: não (é declaração da pessoa) |
| `create_application` / `update_application_status` | Cria ou move uma candidatura. Reaproveita `lib/tracker/actions.ts`                                                                                  | `applications`, `application_events`                                      | "Enviada" exige confirmação; os demais status, não   |
| `read_gmail`                                       | Lê ou resume threads ligadas a candidaturas. Reaproveita `lib/gmail/queries.ts`                                                                     | leitura de `email_threads`                                                | Não                                                  |
| `answer_missing_info`                              | Trata a resposta livre a uma `pending_question` (seção 6.2)                                                                                         | `pending_questions`, `standard_answers`, `confirmed_facts`, `cv_versions` | Depende do destino                                   |
| `classify_fact`                                    | Classifica um fato como `cv_relevant` ou `form_only`                                                                                                | `confirmed_facts` (novo campo `usage`)                                    | A confirmação é feita pelo cartão                    |
| `open_screen`                                      | Devolve um `deep_link` para uma tela existente                                                                                                      | nenhum                                                                    | Não                                                  |

**Gmail:** o envio continua no fluxo atual, sem mudanças: `draft_application_email` → `request_send_email` → cartão `email_approval` → `send_email(approvalId)`. O conteúdo enviado vem do banco, conferido pelo hash do rascunho.

### 4.3 Aprovação generalizada

- Ampliar o enum `approval_kind` com `cv_change`, `fact_save`, `application_submit`, `profile_change` e `destructive`.
- Usar sempre o mesmo padrão: `preview` + `preview_sha256` + `expires_at`. A decisão passa por `lib/approvals/decide.ts` e `/api/approvals/[id]/decide`. A ferramenta de efeito recebe **só** `approvalId` e confere o hash antes de gravar.
- O modo de aprovação da pessoa (`set_approval_mode`) nunca dispensa a aprovação de envio externo, nem a de mudança de CV.

---

## 5. Fluxos principais

### 5.1 "Achei esta vaga"

1. A pessoa cola o link → `ingest_job_postings` → o cartão `job_card` mostra fit e duplicidade (`check_duplicate`).
2. `recommend_cv` + `ats_score` → o cartão `ats_score` mostra o score com o CV atual.
3. A IA pergunta (widget `options`): "Gerar CV ajustado?", "Registrar candidatura?", "Pular".
4. Se a resposta for gerar o CV: `propose_cv_adjustment` → cartão `cv_diff` (só adições), com o ATS antes e depois → Aprovar → `apply_cv_adjustment`. Em seguida, `ensure_hybrid_cv` propõe incluir o conteúdo novo no Híbrido.
5. `create_application` → cartão `application_card` com o link `/app/candidaturas?id=…`.
6. Se faltar algum dado no formulário, `pending_questions` → fluxo 5.2.
7. E-mail, se houver: rascunho → aprovação → envio.

### 5.2 Informação faltante (resposta livre)

A IA pergunta no chat. A pessoa responde em texto livre. `answer_missing_info` sugere um destino, que a pessoa confirma no cartão `fact_classification`:

| Destino                      | Efeito                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Só esta candidatura**      | Grava `pending_questions.answer`, com `remember = false`                                                                                                                                               |
| **Salvar fato reutilizável** | `propose_fact` → `confirmed_facts` (status `proposto` → `confirmado` após o clique). `usage = form_only` ou `cv_relevant` (seção 5.4). Respostas de formulário recorrentes vão para `standard_answers` |
| **Atualizar CVs**            | Só se `usage = cv_relevant`: `propose_cv_adjustment` nas trilhas afetadas + Híbrido. Cada uma passa por aprovação                                                                                      |
| **Registrar lacuna**         | A pessoa não tem a experiência. Registrar em `memory_events` (tipo `gap`) para não perguntar de novo e para nunca afirmar essa experiência                                                             |

### 5.3 Perfis de plataforma

- Toda vez que um CV ou fato `cv_relevant` é confirmado, os `platform_profiles` da pessoa ficam com `outdated = true`, e o motivo é registrado.
- O cartão `profile_tracking` lista o que mudar em cada plataforma. O texto é sugerido, e a pessoa atualiza manualmente. Depois, "Marcar como atualizado".
- Esses perfis também ganham uma seção somente leitura em `/app/perfil` (aba "Plataformas").

### 5.4 Memória de fatos: CV ou só formulário

- `cv_relevant`: conquistas, ferramentas, responsabilidades, certificações. Pode entrar em CV.
- `form_only`: pretensão salarial, disponibilidade, CNH, documentos, deficiência, endereço, motivo de saída, dados sensíveis. **Nunca entra em CV.** É usado só em formulário ou extensão (`/api/ext/questions`).
- O classificador sugere a categoria e a pessoa confirma. Os dados sensíveis seguem `lib/server/field-crypto.ts`.

---

## 6. Regras de CV (obrigatórias)

1. **Só adicionar.** A nova versão é sempre derivada (`parent_version_id`). É proibido remover ou alterar **datas, cargos, empresas** e a ordem cronológica das experiências.
2. A validação é feita no servidor (`lib/cvs/server.ts`), antes de criar a aprovação: comparar as experiências estruturadas (empresa, cargo, início, fim) da versão pai e da nova. Se houver qualquer remoção ou alteração, rejeitar com `kind: "error"`, `code: "cv_destructive_change"`.
3. Todo bullet novo precisa apontar para pelo menos um `confirmed_facts.id` (gravar em `fact_ids`). Sem fato, não entra.
4. **CV Híbrido é obrigatório:** sempre existe uma trilha `Híbrido`, criada no onboarding ou na primeira geração. Ela recebe a união do conteúdo `cv_relevant` das demais trilhas.
5. O diff mostrado no cartão `cv_diff` é o mesmo conteúdo cujo hash vai para `preview_sha256`.

---

## 7. Dados (novas migrations; não editar as antigas)

### 7.1 Tabelas e colunas

- `conversations`: adicionar `updated_at timestamptz`, `archived_at timestamptz`, `context jsonb` (ex.: `{ job_posting_id, application_id, screen }`) e `last_message_at`.
- `messages`: adicionar `tool_names text[]` e `model text`. Índice `(conversation_id, created_at)`.
- **`chat_record_links`** (nova): `id`, `user_id`, `conversation_id`, `message_id`, `table_name text`, `record_id uuid`, `action text` (`created`, `updated`), `created_at`. Liga a conversa aos registros que ela criou. É o que alimenta o selo "Preenchido via chat" e o link "ver conversa".
- **`platform_profiles`** (nova): `id`, `user_id`, `platform text`, `url text`, `last_updated_at`, `outdated boolean default false`, `outdated_reason text`, `created_at`, `updated_at`.
- `confirmed_facts`: adicionar `usage text check (usage in ('cv_relevant','form_only')) default 'cv_relevant'`.
- `job_matches`: adicionar `ats jsonb` (score antes e depois e keywords).
- Enum `approval_kind`: os novos valores da seção 4.3.
- `memory_events`: aceitar o tipo `gap`.

### 7.2 Proveniência

- Os registros criados pelo chat usam `source = 'chat'` onde a coluna já existe (`confirmed_facts.source`, `cv_versions.origin`). Nas demais tabelas, a proveniência fica em `chat_record_links`.

### 7.3 RLS e grants

- Toda tabela nova: `enable row level security` e as políticas `select/insert/update/delete` com `user_id = auth.uid()`. Seguir o padrão das migrations `20261023040812_authenticated_sequence_grants.sql` e `20261023130000_authenticated_table_grants.sql` (grants para `authenticated`).
- As tabelas novas entram em `lib/privacy/export.ts` e em `lib/privacy/delete-account.ts`, por causa da LGPD.
- Seeds de dev: estender `supabase/seeds/p2.sql`.
- Lembrete: a migration precisa ser aplicada também no projeto Supabase de produção, em us-east-1.

---

## 8. Observabilidade

- **Langfuse** (`packages/ai/src/telemetry.ts`): um trace por turno, com `conversationId` como sessão, as ferramentas chamadas, a latência e o custo. Sem PII: manter a redação atual.
- **Sentry**: capturar os erros das ferramentas com a tag `chat.tool`, passando por `sentry-redact.ts`. Não enviar `parts` brutos.
- **PostHog** (`posthog-provider.tsx`), eventos sem conteúdo de mensagem:
  - `chat_opened` (`{ entry: home|sheet|page }`)
  - `chat_message_sent`
  - `chat_tool_called` (`{ tool }`)
  - `chat_widget_clicked` (`{ kind, choice }`)
  - `approval_decided` (`{ kind, decision }`)
  - `cv_adjusted_via_chat` (`{ ats_delta }`)
  - `application_created_via_chat`
  - `missing_info_resolved` (`{ destino }`)
  - `deep_link_opened` (`{ screen }`)
  - `profile_marked_updated`
- **Métrica-alvo:** a porcentagem de candidaturas, CVs e fatos criados via chat contra os criados via tela.

---

## 9. Plano por fases

### Fase 1: chat como entrada (só UI e navegação)

- Home `/app` com o chat em destaque; o Overview vai para a aba ou rota "Painel".
- Chat em `Sheet` em todas as telas, com o contexto da tela; atalho no `command-menu`.
- O cartão `next_steps` (determinístico).
- `open_screen` + o widget `deep_link`.

**Aceite:** todas as telas antigas abrem e funcionam (e2e `shell.spec.ts`, `tracker.spec.ts` e `profile.spec.ts` passam); `/app` abre com o chat; o chat aberto em `/app/candidaturas` conhece a candidatura selecionada.

### Fase 2: persistência e proveniência

- As migrations da seção 7.1 (conversas, `chat_record_links`) com RLS.
- Lista de conversas, arquivamento e retomada.
- Selo "Preenchido via chat" nas telas.

**Aceite:** um registro criado pelo chat mostra o selo e o link para a conversa; outra pessoa não consegue ler a conversa (teste de RLS); a exportação LGPD inclui as conversas.

### Fase 3: aprovação generalizada + widgets

- Novos `approval_kind`; as mensagens `data-action` aceitas em `/api/chat`; os widgets `options`, `cv_diff`, `fact_classification` e `application_card`.

**Aceite:** nenhuma ferramenta de efeito grava sem um `approvalId` válido, com hash conferido e dentro do prazo; recusar não grava nada; e2e `chat.spec.ts` cobre aprovar e recusar.

### Fase 4: vaga → ATS → CV → candidatura

- `ats_score`, `propose_cv_adjustment`, `apply_cv_adjustment`, `ensure_hybrid_cv`, `list_cv_tracks`, `create_application` e `update_application_status`.

**Aceite:** o fluxo 5.1 funciona de ponta a ponta; o validador bloqueia qualquer remoção ou alteração de data, cargo ou empresa (testes unitários com casos negativos); todo bullet novo tem `fact_ids`; a trilha Híbrido sempre existe; o ATS depois é maior ou igual ao ATS antes, ou a IA explica por quê.

### Fase 5: informação faltante, memória e perfis

- `answer_missing_info`, `classify_fact` (`usage`), `platform_profiles`, `get_profile_tracking` e `mark_profile_updated`, e a lacuna em `memory_events`.

**Aceite:** os 4 destinos da seção 5.2 gravam nos lugares certos; um fato `form_only` nunca aparece em CV (eval novo em `evals/no-fabrication`); a confirmação de um fato `cv_relevant` marca os perfis de plataforma como desatualizados; uma lacuna registrada impede que a IA afirme essa experiência.

### Fase 6: Gmail pelo chat + observabilidade

- `read_gmail`; revisar o fluxo de envio no chat; os eventos PostHog, as tags Sentry e as sessões Langfuse.

**Aceite:** nenhum e-mail sai sem o cartão `email_approval` aprovado (e2e `gmail.spec.ts`); os eventos aparecem no PostHog sem conteúdo de mensagem; o trace Langfuse agrupa os turnos por conversa.

### Fase 7: onboarding pelo chat (opcional)

- Opção "Fazer pelo chat" em `/app/onboarding`, que preenche `candidate_profiles`, `experiences`, `educations` e `languages` com confirmação por seção.

**Aceite:** o perfil preenchido pelo chat aparece igual em `/app/perfil`; o wizard antigo continua funcionando.

Em todas as fases: rodar os evals existentes (`packages/ai/src/evals/*`: guardrails, no-fabrication, settings-intent) e a CI (`.github/workflows/ci.yml`).

---

## Progresso (implementação)

| Fase | Status    | Notas                                                                                                                                                    |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | concluída | `/app` chat-first, `/app/visao-geral` painel, sheet + FAB, `next_steps`, `open_screen` / `deep_link`, atalho no command menu                             |
| 2    | concluída | Migration `20261023160000_chat_first_persistence.sql`, lista/arquivo de conversas, selo em candidaturas, export LGPD ampliado                            |
| 3    | concluída | `data-action` no POST `/api/chat`, widgets (`options`, `cv_diff`, `fact_classification`, `application_card`, …), `decideApprovalAction`                  |
| 4    | concluída | ATS determinístico, propose/apply CV, Híbrido, candidatura via chat; validador `cv-structure` com testes negativos                                       |
| 5    | concluída | `answer_missing_info`, `classify_fact`, `platform_profiles` + tracking; lacuna via destino `register_gap` (memória) pendente de fluxo completo no cartão |
| 6    | concluída | `read_gmail`, PostHog `chat-events`, Langfuse `sessionId` = `conversationId`                                                                             |
| 7    | concluída | Opção “Fazer pelo chat” no onboarding (`/app/onboarding`)                                                                                                |

**Decisões:** namespace i18n `AppHome` (evita colisão com landing `Home`); selo de proveniência só em `application-sheet` na v1 (demais telas podem reutilizar `FilledViaChatBadgeClient`); migration enum `approval_kind` sem `IF NOT EXISTS` (aplicar uma vez).

**Pendente produção:** aplicar migration no Supabase us-east-1; badges em CV/fatos/perfil/memória/buscas.

---

## 10. Riscos e mitigações

| Risco                                                | Mitigação                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A IA inventa experiência no CV                       | Bullet só com `fact_ids`, validador no servidor, eval `no-fabrication` ampliado                                                                            |
| Mudança destrutiva no CV                             | Validador estruturado (seção 6.2) + diff só de adições + aprovação                                                                                         |
| Envio ou gravação sem consentimento                  | Ferramenta de efeito recebe só `approvalId`; hash + expiração; o modo de aprovação não dispensa os envios                                                  |
| Prompt injection vindo do texto da vaga ou do e-mail | Manter `classifyTopic`, `outputFilterTransform` e os evals `prompt-injection` e `prompt-leak-fraud`; o conteúdo externo nunca dispara ferramenta de efeito |
| Dado sensível vazando para o CV ou para a telemetria | `usage = form_only`, `field-crypto`, `sentry-redact`, eventos PostHog sem conteúdo                                                                         |
| Custo e latência com muitas ferramentas              | Determinístico primeiro (ATS por keywords, `next_steps` sem LLM); limitar `isStepCount`; rate limit Upstash já existente                                   |
| Divergência entre o chat e as telas                  | Ferramentas chamam as mesmas funções `lib/*/server.ts`; nada de lógica duplicada                                                                           |
| Regressão nas telas atuais                           | Fase 1 só adiciona; os e2e atuais são obrigatórios em toda PR                                                                                              |
| Histórico grande (`HISTORY_LIMIT = 60`)              | Resumo da conversa em `conversations.context` quando passar do limite                                                                                      |

---

## 11. Fora do escopo

- Remover ou esconder qualquer tela atual.
- Envio automático de candidatura sem confirmação.
- Atualização automática de perfis em plataformas externas (a pessoa atualiza; o app só sugere e acompanha).
