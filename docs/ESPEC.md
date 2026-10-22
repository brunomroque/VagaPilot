# Especificação portátil — VagaPilot

Documento original completo: [ESPEC-app-assistente-vagas.pdf](./ESPEC-app-assistente-vagas.pdf) (versão 1.4, 21/10/2026).

Este markdown resume as seções 8 a 17 para implementação. Não acrescenta requisitos. Se divergir do PDF, prevalece o PDF. Dentro do PDF, em conflito prevalece o mais restritivo (segurança e "nunca inventar").

Como usar no Cursor: abrir o chat com `@docs/ESPEC.md` e a seção citada. As regras da seção 17 estão em `.cursor/rules`. Executar uma fase da seção 16 por vez. Ao terminar, atualizar [PROGRESSO.md](./PROGRESSO.md). Variáveis em `.env.example`. Dados de teste só fictícios.

As seções 1 a 7 (visão, personas, jornadas J1–J8, requisitos F1–F16 com RF/CA, não funcionais) permanecem no PDF. O índice abaixo só aponta o que as fases 16 citam.

## Índice funcional (seções 4–6, detalhe no PDF)

Princípios: nunca inventar; humano no controle; um controle único com evidência; menos trabalho repetitivo.

MVP: F1 perfil e onboarding; F2 fatos confirmados; F3 versões de CV; F4 ingestão por link; F4A.3 buscas salvas; F5 duplicidade; F6 fit; F7 chat com widgets; F8 candidatura assistida (extensão, sem submit automático); F9 e-mail com aprovação; F10 tracker; F11 Gmail; F12 Stripe; F13 LGPD; F14 chat que parametriza o app; F15 LinkedIn só assistido; F16 aviso de risco e aceite por integração.

Não-objetivos do MVP: spray-and-pray, scraping autenticado do LinkedIn, contornar captcha, job board próprio, inventar experiência.

Não funcionais (seção 7): TTFB da UI < 300 ms p75; streaming do chat < 2 s; análise < 20 s p95; disponibilidade 99,5%; 5.000 usuários ativos/mês; OWASP ASVS L2; RLS; dados preferencialmente no Brasil (`sa-east-1`); WCAG 2.1 AA; strings via `next-intl`; fuso do usuário; logs sem PII; custo de LLM < R$ 0,15 por análise; cobertura ≥ 70% em `packages/core`; evals de IA no CI.

Seções 18–21 (riscos do projeto, roadmap, questões em aberto, glossário) ficam no PDF. Questões ainda abertas lá: parecer jurídico do Easy Apply; KMS AWS vs GCP e Fly vs Cloud Run (até a fase 2); Pix Stripe vs provedor local; se o endereço de ingestão entra no MVP; nome definitivo e domínio; revisão humana de CV como receita.

## 8. Arquitetura

### 8.1 Visão

Navegador (web Next.js + extensão MV3) fala com Next.js na Vercel (App Router, route handlers, agente AI SDK, webhooks Stripe e Google). O app lê e grava Supabase (`sa-east-1`: Postgres, RLS, pgvector, Storage, Auth, Vault) e enfileira jobs (Inngest ou Trigger.dev): ingestão, sync Gmail, PDF, relatórios. Jobs chamam LLM, Gmail e, na fase 2, workers Playwright isolados. E-mail transacional via Resend.

### 8.2 Stack

| Camada                 | Escolha                                                                                                   | Alternativa citada |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------ |
| Monorepo               | pnpm + Turborepo                                                                                          | Nx                 |
| Web                    | Next.js App Router + TypeScript estrito                                                                   | Remix              |
| UI                     | Tailwind + shadcn/ui + lucide-react                                                                       | Mantine            |
| Hospedagem web         | Vercel (região gru1)                                                                                      | Cloudflare         |
| Banco                  | Supabase Postgres sa-east-1, RLS, pgvector, Storage, Auth                                                 | Neon + Clerk       |
| ORM                    | Drizzle + SQL versionado (RLS em SQL)                                                                     | Prisma             |
| Fila                   | Inngest (ou Trigger.dev v3)                                                                               | BullMQ + Redis     |
| IA                     | Vercel AI SDK (`streamText`, `generateObject` + Zod) atrás de gateway (Vercel AI Gateway ou OpenRouter)   | LangGraph          |
| Modelos                | Grande para análise/fit/redação; pequeno para classificação de e-mail e extração; embeddings multilíngues | —                  |
| Observabilidade de LLM | Langfuse, com redação de PII                                                                              | Helicone           |
| Navegador remoto       | Fase 2: Playwright em contêiner efêmero por sessão                                                        | Browserbase        |
| Extensão               | WXT + React + o mesmo design system, Manifest V3                                                          | Plasmo             |
| PDF                    | `@react-pdf/renderer` para relatórios; HTML→PDF com Playwright para CVs                                   | Gotenberg          |
| DOCX                   | `docx`                                                                                                    | —                  |
| Pagamentos             | Stripe Checkout, Billing, Customer Portal; Pix na fase 2                                                  | Pagar.me / Asaas   |
| E-mail transacional    | Resend                                                                                                    | Postmark           |
| Erros                  | Sentry (web, extensão, workers)                                                                           | —                  |
| Analytics              | PostHog (UE ou self-host), sem PII                                                                        | —                  |
| Validação              | Zod em toda fronteira                                                                                     | —                  |
| Testes                 | Vitest; Playwright Test (e2e web + fixtures de ATS); evals próprios                                       | —                  |

### 8.3 Monorepo

```
apps/web                 Next.js (UI, API, agente, webhooks)
apps/extension           Extensão Chrome (WXT, MV3)
apps/browser-worker      Fase 2
packages/core            Tipos, enums, regras puras (fit, pretensão, blocklist, status)
packages/db              Drizzle, migrações SQL, RLS, seeds
packages/ai              Prompts, schemas Zod, ferramentas, guardrails, evals
packages/ats-adapters    Detecção de fonte, extratores, mapeadores de formulário
packages/gmail           Cliente Gmail, consultas, classificador, vinculação
packages/jobs            Funções Inngest
packages/ui              shadcn compartilhado
packages/config          ESLint, tsconfig, preset Tailwind
docs/ESPEC.md
evals/                   Datasets rotulados fictícios
fixtures/ats/            HTML de formulários
.cursor/rules/
```

### 8.4 Fluxos

Análise de vaga: `POST /api/chat` detecta URLs e chama `ingest_job_postings`. A ferramenta enfileira `job/ingest.requested` e devolve ids. A UI assina Supabase Realtime em `job_postings:user_id`. O job detecta a fonte, extrai, normaliza com `generateObject`, gera embedding, grava `job_postings` (pública) e `job_matches` (por usuário), checa blocklist e duplicidade (controle + Gmail), calcula fit e publica evento. O agente compõe o `JobCard`.

Candidatura assistida: "Aplicar" cria `applications` (`em_andamento`) e `application_packages` (snapshot) e abre a URL com `?vp_app={application_id}`. A extensão busca `GET /api/ext/packages/{id}` com token de dispositivo e preenche. Pergunta desconhecida: `POST /api/ext/questions` cria `pending_questions` e `QuestionCard`; a resposta volta via Realtime. Confirmação: `POST /api/ext/applications/{id}/confirm` com evidência (upload assinado) e evento `enviada`.

Gmail: cron `0 */2 * * *`. Para cada conexão ativa, `history.list` desde `last_history_id`, pré-filtro, classificar em lote, vincular, `application_events`, recalcular `next_action_due_at`, notificar se houver prazo.

### 8.5 Rotas

Todas autenticadas com cookie Supabase ou token de dispositivo. Zod na entrada. Rate limit (Upstash). Erro `{ error: { code, message } }`.

| Rota                                                                                                                   | Uso                                                |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `POST /api/chat`                                                                                                       | Chat com stream (AI SDK UI messages)               |
| `GET/PUT /api/profile`                                                                                                 | Perfil                                             |
| `GET/POST/PATCH /api/facts`                                                                                            | Fatos                                              |
| `POST /api/cv-versions`, `GET /api/cv-versions/:id/file`                                                               | CV; download com nome neutro (URL assinada, 5 min) |
| `POST /api/jobs/ingest`                                                                                                | Ingestão sem chat                                  |
| `GET /api/applications`, `PATCH /api/applications/:id`                                                                 | Controle                                           |
| `GET /api/applications/export?format=csv\|pdf`                                                                         | Exportação                                         |
| `POST /api/approvals/:id/decide`                                                                                       | Aprovar ou rejeitar                                |
| `POST /api/ext/pair`, `GET /api/ext/packages/:id`, `POST /api/ext/questions`, `POST /api/ext/applications/:id/confirm` | Extensão                                           |
| `GET /api/google/oauth/start`, `GET /api/google/oauth/callback`, `DELETE /api/google/connection`                       | Gmail                                              |
| `POST /api/stripe/webhook`, `POST /api/billing/checkout`, `POST /api/billing/portal`                                   | Cobrança                                           |
| `POST /api/privacy/export`, `POST /api/privacy/delete`                                                                 | LGPD                                               |
| `POST /api/inngest`                                                                                                    | Jobs                                               |

## 9. Modelo de dados

Postgres (Supabase). Convenções: `id uuid default gen_random_uuid()`, `created_at`/`updated_at timestamptz`, `user_id uuid references auth.users on delete cascade` em toda tabela de dados do usuário, RLS com `user_id = auth.uid()`. Campos `_enc` são `bytea` cifrados na aplicação (envelope encryption, seção 12.3).

Ordem da migração: criar `evidences` e `email_threads` antes de `application_events` (as FKs dependem delas). Habilitar RLS e políticas select/insert/update/delete `using (user_id = auth.uid())` em tabelas com `user_id`. `job_postings` é global (dados públicos): select para `authenticated`, escrita via `service_role`. `audit_log` é append-only: revogar update/delete de `authenticated` (expurgo LGPD é exceção controlada).

Extensões: `pgcrypto`, `vector`.

### 9.1 Relações

`users` 1—1 `candidate_profiles`. `users` 1—N `experiences`, e `experiences` 1—N `confirmed_facts`. `users` 1—N `educations`, `languages`, `standard_answers`, `salary_rules`, `company_blocklist`. `users` 1—N `cv_versions` N—1 `cv_tracks`. `job_postings` (global) 1—N `job_matches` N—1 `users`. `users` 1—N `applications` 1—N `application_events`. `applications` 1—N `approvals`, `pending_questions`, `evidences`, `application_packages`. `users` 1—1 `gmail_connections` 1—N `email_threads` N—0..1 `applications`. `users` 1—N `conversations` 1—N `messages`. `users` 1—N `audit_log`, `consents`, `devices`, e 1—1 `subscriptions`. Também `usage_counters` e `stripe_events`.

### 9.2 Enums

- `employment_type`: `clt`, `pj`, `autonomo`, `estagio`, `temporario`, `cooperado`, `outro`
- `seniority`: `estagio`, `junior`, `pleno`, `senior`, `especialista`, `coordenador`, `gerente`, `head`, `diretor`, `vp`, `c_level`
- `work_model`: `presencial`, `hibrido`, `remoto`
- `contract_regime`: `clt`, `pj`, `ambos`, `nao_informado`
- `fact_status`: `proposto`, `confirmado`, `rejeitado`
- `fit_level`: `alto`, `medio`, `baixo`
- `job_source`: `linkedin`, `gupy`, `inhire`, `greenhouse`, `lever`, `workday`, `successfactors`, `quickin`, `jobbol`, `solides`, `email`, `indicacao`, `outro`
- `application_route`: `extensao`, `email`, `manual`, `autonomo`
- `application_status`: `rascunho`, `descartada`, `em_andamento`, `enviada`, `em_analise`, `etapa_pendente`, `entrevista`, `proposta`, `reprovada`, `encerrada`
- `event_source`: `usuario`, `agente`, `extensao`, `gmail`, `worker`, `sistema`
- `approval_status`: `pendente`, `aprovada`, `rejeitada`, `expirada`
- `approval_kind`: `enviar_email`, `submeter_formulario`, `responder_pergunta`, `alterar_cv`, `criar_fato`, `pre_autorizacao`
- `email_class`: `confirmacao`, `reprovacao`, `teste_etapa`, `convite_entrevista`, `recrutador_contato`, `vaga_alerta`, `irrelevante`

O PDF não inclui `codigo_verificacao` neste enum, embora F11 classifique esse tipo. Não persistir o código.

### 9.3 Tabelas (colunas que a implementação precisa)

`candidate_profiles` (PK `user_id`): `display_name`, `first_name`, `last_name`, `email_contact`, `phone_enc`, `city`, `state char(2)`, `country char(2) default 'BR'`, `address_enc`, `documents_enc`, `linkedin_url`, `portfolio_url`, `birth_date_enc`, `diversity_enc` (só com consentimento `diversidade`), `preferences jsonb default '{}'`, `locale default 'pt-BR'`, `timezone default 'America/Sao_Paulo'`, `cv_filename_pattern default 'CV-{first}-{last}-{lang}'`.

`experiences`: empresa, cargo, `employment_type`, `start_date`, `end_date`, `is_current`, `location`, `description`, `sort_order`.

`educations`: instituição, `degree`, `field`, `level`, datas, `status` (concluido, cursando, trancado).

`languages`: `language`, `level` (basico, intermediario, avancado, fluente, nativo, mais CEFR opcional).

`confirmed_facts`: `experience_id` opcional, `statement`, `statement_en` opcional, `kind` (conquista, competencia, ferramenta, certificacao, idioma, dominio, metrica), `tags text[]`, `status fact_status default 'proposto'`, `source` (`cv_upload`, `chat`, `manual`, `import`), `source_ref jsonb`, `confirmed_at`, `embedding vector(1536)` com índice HNSW cosine.

`cv_tracks`: `name`, `description`, `keywords text[]`.

`cv_versions`: `track_id`, `language` (`pt-BR`, `en`, `es`), `label`, `is_default`, `storage_path` no bucket privado `cvs/{user_id}/...`, `docx_storage_path`, `file_sha256`, `extracted_text`, `origin` (`upload`, `gerado`, `template_recrutador`), `parent_version_id`, `fact_ids uuid[]`.

`salary_rules`: `seniority`, `regime`, `amount_min`, `amount_target`, `currency char(3) default 'BRL'`, `period` (mensal, anual, hora). Único `(user_id, seniority, regime)`.

`standard_answers`: `key`, `question_examples text[]`, `answer` ou `answer_enc` se sensível, `language default 'pt-BR'`, `is_sensitive`, `embedding vector(1536)`. Único `(user_id, key, language)`.

`company_blocklist`: `company_name`, `normalized_name`, `aliases text[]`, `domains text[]`, `reason`.

`job_postings`: `canonical_url unique`, `source`, `external_id`, empresa e domínio normalizados, `title`, `seniority`, `location`, `work_model`, `regime default 'nao_informado'`, `language`, requisitos obrigatórios e desejáveis, `languages_required jsonb`, faixa salarial, `apply_url`, `apply_email`, `description_md`, `raw_hash`, `posted_at`, `fetched_at`, `closed_at`, `embedding vector(1536)`.

`job_matches`: único `(user_id, job_posting_id)`. `fit`, `fit_score`, `reasons jsonb` (`text`, `fact_ids`, `requirement`), `gaps`, `alerts`, `recommended_cv_version_id`, `suggested_salary jsonb`, `duplicate_check jsonb`, `blocked`, `decision` (aplicar, pular, salvar), `decision_reason`, `model_version`, `prompt_version`.

`applications`: `job_match_id`, `job_posting_id`, `company`, `role_title`, `source`, `route`, `status default 'rascunho'`, `applied_at`, `cv_version_id`, `cv_sha256`, `salary_informed jsonb`, `next_action`, `next_action_due_at`, `link`, `notes`, `external_protocol`, `last_email_at`. Índices `(user_id, status)` e `(user_id, next_action_due_at)`.

`evidences`: `application_id`, `kind` (screenshot, protocol_text, email, sent_email, file), `storage_path`, `text_excerpt`, `url`, `expires_at`.

`application_events`: `application_id`, `type` (status_change, note, question_answered, email_linked, evidence_added, deadline_set), `from_status`, `to_status`, `source`, `confidence numeric(3,2)`, `payload jsonb`, `email_thread_id`, `evidence_id`, `occurred_at`.

`application_packages`: snapshot imutável. `payload_enc`, `cv_version_id`, `expires_at` (24 h), `consumed_at`.

`pending_questions`: `question_text`, `field_type`, `options jsonb`, `proposed_answer`, `proposed_from jsonb`, `answer`, `remember`, `status` (aberta, respondida, ignorada), `answered_at`.

`approvals`: `kind`, `application_id`, `subject_ref jsonb`, `preview jsonb`, `preview_sha256`, `status default 'pendente'`, `decided_at`, `decided_via` (web, extensao, email), `expires_at` (24 h), `scope jsonb` para pré-autorização.

`email_drafts`: destinatários, `subject`, `body_md`, `attachment_cv_version_id`, `status` (rascunho, aprovado, enviado, falhou), ids do Gmail, `sent_at`.

`gmail_connections` (PK `user_id`): `google_email`, `scopes text[]`, `refresh_token_enc`, `last_history_id`, `last_synced_at`, `status` (ativo, revogado, erro).

`email_threads`: `gmail_thread_id`, `gmail_message_id` único com `user_id`, remetente e domínio, `subject`, `received_at`, `snippet` (≤ 500 caracteres), `classification`, `confidence`, `extracted jsonb` (company, role, deadline, link, interview_at), `application_id`, `review_status` (auto, revisar, confirmado, ignorado). Corpo completo nunca persistido.

`conversations`: `title`. `messages`: `conversation_id`, `role`, `parts jsonb` (UIMessage do AI SDK).

`audit_log`: `bigserial`, `actor` (usuario, agente, extensao, worker, sistema, suporte), `action`, `target_type`, `target_id`, `approval_id`, `details jsonb` sem PII em texto puro, `ip`, `user_agent`. Somente inserção.

`consents`: `purpose` (termos, privacidade, ia_cv, gmail_leitura, gmail_envio, diversidade, marketing), `version`, `granted`.

`devices`: `name`, `token_hash`, `last_seen_at`, `revoked_at`.

`subscriptions`: `stripe_customer_id`, `stripe_subscription_id`, `plan default 'free'`, `status`, `current_period_end`.

`usage_counters`: PK `(user_id, period char(7), metric)`, `value`.

`stripe_events`: PK `id` do evento Stripe, `processed_at`.

F14 também cita tabelas de configuração ainda não desenhadas na seção 9 (`user_settings`, `saved_searches`, `memory_events`, `excluded_companies` como lista além de `company_blocklist`). Implementar na fase P2.5 a partir do PDF (F14), sem inventar colunas além do que o pedido de busca já lista: cargo, nível, local/raio, modelo, regime, idioma, faixa, data de publicação, empresas excluídas, frequência e horário.

### 9.4 Transições de status

Validadas em `packages/core/status.ts`, com testes.

- `rascunho` → `em_andamento` | `descartada` | `enviada` (manual ou Gmail)
- `em_andamento` → `enviada` | `descartada` | `rascunho`
- `enviada` → `em_analise` | `etapa_pendente` | `entrevista` | `reprovada` | `encerrada`
- `em_analise` → `etapa_pendente` | `entrevista` | `reprovada` | `encerrada`
- `etapa_pendente` → `em_analise` | `entrevista` | `reprovada` | `encerrada`
- `entrevista` → `etapa_pendente` | `entrevista` | `proposta` | `reprovada` | `encerrada`
- `proposta` → `encerrada`
- `reprovada` é terminal; reabrir só manualmente

Atualização automática (Gmail) nunca regride status e nunca sai de estado terminal sem ação do usuário. Confiança ≥ 0,8 para aplicar sozinha; abaixo disso, fila "Revise".

Rótulos PT-BR: rascunho Rascunho; descartada Pulada; em_andamento Em preenchimento; enviada Enviada; em_analise Em análise; etapa_pendente Teste/Etapa pendente; entrevista Entrevista; proposta Proposta; reprovada Reprovada; encerrada Encerrada (vaga fechada ou sem retorno após N dias, padrão 45, configurável).

## 10. Agente de IA

### 10.1 Princípios

1. Só afirma o que está em `confirmed_facts` com status `confirmado`, `experiences`, `educations`, `languages`, `standard_answers` ou `candidate_profiles`.
2. Efeito externo exige `approvals` com hash do conteúdo exato. Se o conteúdo mudou, a execução é recusada.
3. Blocklist, duplicidade, pretensão, transições de status e nome de arquivo são código em `packages/core`, não LLM.
4. LLM para extração de vaga, fit qualitativo, classificação de e-mail, redação e mapeamento pergunta → resposta.
5. Cada ferramenta registra entrada resumida, saída, modelo, versão do prompt e custo.

### 10.2 Forma

Orquestrador em `/api/chat`: `streamText`, tools, `stopWhen: stepCountIs(8)`, system em `packages/ai/prompts/orchestrator.v1.md`.

Sub-rotinas com `generateObject` + Zod: `extractJobPosting`, `assessFit`, `classifyEmail`, `linkEmailToApplication`, `mapQuestionToAnswer`, `draftApplicationEmail`, `extractFactsFromCv`, `classifyTopic` (antes do orquestrador), `parseSettingsIntent`, `parseSearchRequest`. Fase 2: `tailorCv`, `buildStarStories`.

Contexto por ferramenta, não o perfil inteiro no prompt: `get_profile_summary`, `search_facts(query, k)` sempre com `status = 'confirmado'`.

### 10.3 Ferramentas

Leitura, sem aprovação: `ingest_job_postings`, `get_job_match`, `check_duplicate`, `search_facts`, `get_profile_summary`, `recommend_cv`, `suggest_salary` (determinística), `list_pending_actions`, `export_tracker`, `get_settings`.

Escrita interna do próprio clique do usuário: `record_decision`, `start_assisted_application`.

Com card e desfazer: `create_saved_search`, `update_saved_search`, `add_excluded_company`, `remove_excluded_company`, `update_language_level` (regeneração de CV pede confirmação), `set_salary_rules`, `set_preference`, `regenerate_report`, `undo_change`.

Exigem confirmação: `propose_fact`, `save_standard_answer`, `delete_saved_search`, `set_approval_mode`, `propose_global_cv_change`.

`draft_application_email` só cria rascunho. `request_send_email` cria approval. `send_email` recebe só `approvalId`. `update_application_status` manual não exige approval; automática exige confiança ≥ 0,8. `ask_clarification` é widget.

Fase 2: `research_company`; `submit_application_remote` só com approval ou pré-autorização válida.

`send_email` e `submit_application_remote` não recebem conteúdo livre do LLM. O conteúdo vem do banco.

### 10.4 Guardrails

Nunca afirmar experiência, ferramenta, certificação, idioma, número ou resultado sem fato recuperado por ferramenta. `verifyGrounding(text, factIds)` em tudo que vai a terceiros; afirmação sem suporte bloqueia e pergunta. Resposta de formulário exige `proposed_from`; sem origem, `pending_question`. "Possui experiência com X?" só pode ser "Sim" com fato confirmado; também não responder "Não" automaticamente. Anos de experiência saem das datas em `experiences`.

Approvals expiram em 24 h. Pré-autorização (fase 2) é `approval(kind='pre_autorizacao')` com escopo explícito e revogável. Limites padrão: 25 candidaturas/dia, 10 e-mails/dia. F14 acrescenta 20 mensagens/min, 20 links por lote, teto de custo por usuário/dia.

Conteúdo de vaga, ATS e e-mail entra delimitado como `<untrusted source="...">`. Ferramenta com efeito externo não dispara a partir desse conteúdo. Destinatário de e-mail precisa constar na vaga ou no e-mail do recrutador e aparecer no card. A extensão recebe JSON validado e não executa código do backend.

Dados sensíveis não vão ao LLM; a extensão resolve `{{profile.cpf}}` localmente. Logs de LLM passam por regex de CPF, telefone e e-mail antes do Langfuse.

Chat (F14): classificador de tópico antes do orquestrador; fora de escopo recusa e conta no limite do plano. Allowlist de ferramentas, sem código genérico e sem navegação livre. `policy.check(intent, origin, risk)` no servidor. Filtro de saída contra links desconhecidos com dados do usuário, PII além do formulário e vazamento de prompt. Recusar falsificação e filtros discriminatórios. Entrada ≤ 8.000 caracteres; upload ≤ 10 MB, PDF/DOCX/TXT, ≤ 15 páginas, antivírus. Saída limitada por etapa.

### 10.5 Schemas citados

`FitAssessment`: `fit` alto|medio|baixo, `score` 0–100, até 5 `reasons` com `factIds` não vazio, `gaps` (obrigatorio|desejavel), `alerts` com códigos `idioma`, `local`, `modelo`, `regime`, `senioridade_acima`, `senioridade_abaixo`, `salario_fora`, `recommendedTrackId` anulável, `recommendedLanguage` pt-BR|en|es.

Alertas de idioma, local, modelo, regime e senioridade são calculados em código e entregues ao LLM; o LLM não pode removê-los. Rubrica: alto = todos os obrigatórios cobertos e sem alerta bloqueante; medio = até 2 obrigatórios sem cobertura ou 1 alerta; baixo = o resto.

`classifyEmail`: `class`, `confidence`, `company?`, `role?`, `deadline?` ISO-8601 com fuso, `interviewAt?`, `link?`, `reasoning_short`.

### 10.6 Evals (bloqueiam merge quando a meta é 0)

| Suíte               | Conjunto              | Meta                                      |
| ------------------- | --------------------- | ----------------------------------------- |
| extract-job         | 60 vagas, 10 fontes   | campos-chave ≥ 90%                        |
| fit                 | 50 pares rotulados    | concordância ≥ 80%                        |
| email-classify      | 200 e-mails           | precisão ≥ 0,9, recall ≥ 0,85             |
| no-fabrication      | 80 casos adversariais | 0 afirmações sem suporte                  |
| email-draft         | 30 vagas              | sem salário se não pedido; ≤ 150 palavras |
| settings-intent     | 100 frases pt-BR      | intenção e parâmetros ≥ 90%               |
| prompt-injection    | 200 ataques           | 0 ações não autorizadas                   |
| off-topic           | 200 pedidos           | recusa ≥ 95%; recusa indevida ≤ 2%        |
| prompt-leak / fraud | 50 + 50               | 0 vazamentos; 0 ajudas a falsificar       |
| secrets-scan        | canários de senha/OTP | 0 ocorrências em banco, logs e traces     |

Datasets fictícios.

### 10.7 Auditoria mínima

`fact.proposed/confirmed/rejected`, `cv.uploaded/generated`, `job.ingested`, `match.created`, `decision.recorded`, `package.created/consumed`, `form.field_filled`, `question.asked/answered`, `approval.requested/approved/rejected/expired`, `email.sent`, `application.submitted`, `status.changed`, `gmail.connected/revoked/synced`, `data.exported`, `account.deletion_requested`, `settings.changed/undone`, `search.created/updated/deleted`, `chat.off_topic_refused`, `chat.injection_blocked`, `ratelimit.hit`, `killswitch.toggled`, `risk.accepted/revoked/reconsent_required` (imutáveis). Visível em "Atividade".

## 11. Integrações

### 11.1 Extração de vagas

Ordem: API/JSON público; endpoint público sem login; HTML + JSON-LD `schema.org/JobPosting`; fallback fase 2 (headless) ou pedir o texto.

| Fonte                              | Método no MVP                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| LinkedIn                           | Página pública guest / JSON-LD a partir do jobId. Sem login, sem cookies do usuário, cache 24 h. 429/999 → fallback "cole o texto" |
| Gupy                               | Página pública (JSON embutido ou JSON-LD). Candidatura exige conta → extensão                                                      |
| InHire                             | Página pública. Formulário aberto → extensão                                                                                       |
| Greenhouse                         | Job Board API `boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true`                                                |
| Lever                              | `api.lever.co/v0/postings/{company}/{id}`                                                                                          |
| Workday                            | JSON público `/wday/cxs/{tenant}/{site}/job/...`. Conta → extensão                                                                 |
| SuccessFactors                     | HTML + JSON-LD. Conta → extensão                                                                                                   |
| Quickin, Jobbol, Solides, Recrutei | HTML + JSON-LD, adaptadores incrementais                                                                                           |
| E-mail                             | Texto colado; detectar `apply_email`                                                                                               |

```ts
export interface JobSourceAdapter {
  source: JobSource
  matches(url: URL): boolean
  canonicalize(url: URL): string
  extract(url: URL, ctx: FetchCtx): Promise<RawJobPosting>
}

export interface FormFillAdapter {
  ats: JobSource
  detect(doc: Document): boolean
  listFields(doc: Document): FormField[]
  fill(field: FormField, value: FillValue): Promise<void>
  attachCv(file: File): Promise<void>
  isConfirmationPage(doc: Document): ConfirmationInfo | null
}
```

`extract` não recebe credenciais do usuário. LinkedIn no MVP, modo mais restritivo da seção 13: a extensão só sugere no painel lateral, sem preencher a página nem clicar em enviar. Kill switch global. Sem busca em massa, sem gravar perfil de terceiro sem ação explícita de salvar.

### 11.2 Gmail

Escopos restritos `gmail.readonly` e `gmail.send`, incrementais e separados. Verificação Google e CASA antes do público. No beta, modo de teste (até 100 usuários). Plano B (encaminhamento para endereço de ingestão) está no PDF e fica fora do MVP pela decisão do plano de implementação. Refresh token cifrado. `DELETE /api/google/connection` revoga no Google e apaga o token. Primeira carga: 90 dias filtrados. Depois, incremental a cada 2 h. Não abrir e-mail fora do filtro. Snippet ≤ 500 caracteres. OTP só com consentimento separado, janela de 10 minutos, remetente do ATS da candidatura em andamento; usar e descartar; nunca guardar nem enviar ao LLM.

### 11.3 Extensão

Chrome Web Store, propósito único. Permissões mínimas: `activeTab`, `scripting`, `storage`, `sidePanel`; hosts só dos ATS suportados, genérico sob demanda. Token em `chrome.storage.session`. Pareamento por código de 6 dígitos (10 min). Nunca clicar em submit no MVP. Nunca ler `input[type=password]` nem autocomplete de senha/OTP. Senha de ATS nunca persistida. Captcha, 2FA e login social: o usuário. Evidência: protocolo, URL e screenshot da confirmação, não da página com senha. Payload ao backend limitado a rótulos/opções, texto de confirmação e screenshot da confirmação. Nome de arquivo do CV sempre neutro (`buildCvFilename`).

### 11.4 Workers (fase 2)

Contêiner efêmero por candidatura, sem disco persistente, timeout 10 min. Não guardar senha. Storage state cifrado, TTL curto (exemplo do PDF: 7 dias), revogável. Captcha devolve para a extensão. Sem pool residencial para burlar bloqueio.

### 11.5 Stripe

Produtos em BRL. Checkout com cartão no MVP. Pix e NFS-e na fase 2. Portal para cancelamento. Webhook idempotente por `event.id`.

## 12. Segurança, privacidade e LGPD

A operadora é controladora dos dados de conta e dos dados de candidatura tratados para prestar o serviço. Base: execução de contrato; consentimento para dados sensíveis (diversidade) e para o Gmail; legítimo interesse só para segurança e fraude. DPO e canal publicados. RIPD antes do lançamento.

Direitos: acesso, portabilidade (ZIP), correção, exclusão, informação de compartilhamento (Supabase, Vercel, provedores de LLM, Stripe, Resend, Sentry, PostHog), revogação por finalidade, revisão de decisão automatizada (o fit é recomendação; a decisão é do usuário).

Criptografia: TLS 1.2+ e HSTS. Em repouso, criptografia do provedor mais envelope nos campos `_enc`: DEK por usuário (AES-256-GCM) cifrada por KEK em KMS (AWS ou GCP) ou Supabase Vault. Rotação anual da KEK. Apagar a DEK é crypto-shredding na exclusão. Dev: `LocalKeyProvider` via ambiente. Tokens OAuth só no servidor (`service_role`). Buckets privados `cvs`, `evidences`, `exports`. URL assinada ≤ 5 min (exportação LGPD: link de 24 h no passo P6.3).

RLS testada (usuário A não lê, altera nem apaga dados de B). Zod, CSP, CSRF (SameSite=Lax + origem), rate limit. MFA opcional no MVP; obrigatório na fase 2 para envio autônomo. Suporte a dados do usuário só com consentimento temporário de 24 h, no `audit_log`. Renovate, `pnpm audit` e CodeQL no CI; pentest antes do público. Backup diário com PITR de 7 dias; retenção de backups 30 dias.

Retenção: conta enquanto ativa e exclusão em até 15 dias após o pedido; capturas 12 meses (configurável 3–24); metadados de e-mail 12 meses; traces de LLM 30 dias com PII redigida; logs de aplicação 30 dias sem PII; audit log 5 anos ou até a exclusão, com o mínimo legal pseudonimizado.

LLM: contrato de não treinamento e retenção zero quando existir. Página "Como a IA é usada". Textos jurídicos são rascunho até revisão de advogado. F16: aceite não elimina responsabilidade pelo CDC (arts. 25 e 51, I).

## 13. Conformidade

LinkedIn: sem automação na conta do usuário. Leitura pública de baixa frequência com cache. Easy Apply no modo mais restritivo: só sugestões no painel lateral (copiar/colar), sem preencher a página. ATS: MVP é assistido, o usuário está na sessão dele e clica em enviar. Modo autônomo só na fase 2, em ATS de formulário público sem proibição explícita, com taxa limitada e lista revista por jurídico. Nunca resolver captcha. Limites diários e fit. Gmail só para o recurso visível, sem treino e sem publicidade. Extensão com permissões mínimas. E-mail sempre da conta do usuário, depois da aprovação, sem assinatura obrigatória "enviado por IA" (transparência opcional). Diversidade só com cadastro e consentimento; padrão "Prefiro não informar". Testes de personalidade: preparação, nunca resposta pelo app.

## 14. Precificação (proposta inicial, BRL)

| Plano            | Preço                                 | Inclui                                                                                                                     |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Grátis           | R$ 0                                  | 15 análises/mês, 1 trilha de CV (PT), controle manual ilimitado, 5 candidaturas assistidas/mês, sem Gmail                  |
| Pro              | R$ 49/mês (R$ 39/mês no anual)        | 200 análises/mês, até 6 versões de CV, extensão com limite diário, Gmail, candidatura por e-mail, CSV/PDF                  |
| Executivo        | R$ 129/mês (R$ 99/mês no anual)       | Pro + análises ilimitadas com uso justo, CV sob medida, STAR, cultura, candidatura autônoma na fase 2, suporte prioritário |
| Passe de busca   | R$ 299 / 90 dias                      | Executivo por 3 meses                                                                                                      |
| B2B outplacement | Fase 3, a partir de R$ 60/licença/mês | Painel do consultor com consentimento                                                                                      |

Trial de 7 dias do Pro sem cartão. Limites aplicados no backend antes de qualquer chamada de LLM cobrável. Há também menção, em F3A, de até 8 versões no Pro; a tabela de preço diz até 6. Em conflito, o PDF manda o mais restritivo até o produto decidir: usar 6 da tabela de preço salvo revisão explícita.

## 15. Métricas

Estrela-guia: candidaturas de qualidade (fit alto ou médio, com evidência) enviadas por usuário ativo por semana.

Grupos: ativação (onboarding, tempo até a primeira análise, ≥ 20 fatos, extensão, Gmail); engajamento (links, aplicar vs pular, enviadas, ações no prazo); resultado (taxa de resposta, entrevista, tempo até a primeira entrevista); qualidade da IA (concordância do fit, perguntas pausadas, grounding, correções na fila Revise); confiabilidade (extração por fonte, preenchimento por ATS, erros da extensão); negócio (conversão, MRR, churn, CAC, LTV, custo de LLM); confiança (0 fabricações, exclusões, tickets de privacidade).

Eventos PostHog sem PII, ids pseudônimos: `job_analyzed{source,fit}`, `decision_made{decision}`, `application_submitted{route,source}`, `question_paused{ats}`, `email_status_detected{class,auto}`.

## 16. Plano de construção

Um branch e um PR por passo. Testes do passo passando. Strings em `next-intl` (pt-BR). `docs/PROGRESSO.md` atualizado. Critérios de aceite nomeados `it('CA1.4 ...')` quando o CA for implementado.

Definição de pronto de todo passo: TypeScript estrito, sem `any` implícito, Zod nas fronteiras, testes do passo, e2e quando houver UI, RLS e autorização nas tabelas e rotas novas, sem PII em logs, i18n, acessibilidade básica, `PROGRESSO.md`, migrações reversíveis quando possível.

### Fase 0 — Fundação (P0.1–P0.4)

P0.1 Monorepo, CI, `.env.example`, `PROGRESSO.md`. Pronto quando `pnpm i && pnpm turbo lint typecheck test build` passa.

P0.2 Drizzle espelhando a seção 9, migrações SQL com `pgcrypto` e `vector`, enums, tabelas, índices, RLS, `audit_log` append-only, `job_postings` com select para authenticated. CLI local `supabase start`. Seed de 2 usuários fictícios. Testes de RLS por tabela. Pronto quando `pnpm db:reset && pnpm --filter db test` passa.

P0.3 Auth `@supabase/ssr`: e-mail/senha com verificação, Google só `openid email profile`, middleware em `/app/*`, aceite de termos e privacidade em `consents` (purpose `termos` e `privacidade`, version `v1`). Layout com sidebar e strings pt-BR. E2E: cadastro → aceite → `/app/chat`.

P0.4 `packages/core/crypto.ts`: DEK AES-256-GCM por usuário, `KeyProvider` com `LocalKeyProvider` (dev) e `AwsKmsKeyProvider`. `encryptField` / `decryptField`, cache de DEK com TTL curto, `destroyUserKey`. `logAudit` sem PII em claro (regex de CPF, e-mail, telefone, com testes).

### Fase 1 — Perfil, CVs e fatos (P1.1–P1.4)

P1.1 Formulários (react-hook-form + Zod) de contato, documentos `_enc`, formação, experiências, idiomas, preferências, pretensão (senioridade × regime), respostas padrão e blocklist. Diversidade só com consentimento `diversidade`. `normalizeCompanyName` e `matchBlocklist` em `packages/core` (remove Ltda, S.A., S/A, Brasil, Group, Tecnologia; compara domínios; similaridade trigram ≥ 0,9). CA1.4: "Acme" bloqueia "ACME Ltda.", "Acme Brasil" e `acme.com.br`.

P1.2 Upload PDF/DOCX no bucket `cvs/{user_id}/`, SHA-256, extração (`pdf-parse`, `mammoth`) no job `cv/uploaded`. CRUD de trilhas e versões, `parent_version_id`, download com `buildCvFilename`, URL assinada de 5 min.

P1.3 `extractFactsFromCv` com `generateObject`. `excerpt` precisa existir no texto. Status `proposto`. Embeddings configuráveis por env. UI de confirmar, editar ou rejeitar, com `audit_log`. `search_facts` filtra `confirmado`.

P1.4 Wizard J1: upload, fatos (pode pular), trilhas e idiomas, respostas obrigatórias, blocklist, convites opcionais de Gmail e extensão. E2E de onboarding.

### Fase 2 do plano — Vagas, fit e chat (P2.1–P2.5)

P2.1 Adaptadores e `detectSource` / `canonicalize` para linkedin, gupy, inhire, greenhouse, lever, workday, successfactors, quickin, jobbol, solides e genérico. Greenhouse e Lever por API pública. LinkedIn guest, sem cookies, user-agent identificável, timeout 10 s, cache 24 h, 429/999 devolve `{status:'blocked'}`. Demais: HTML + JSON-LD, fallback cheerio. Fixtures, sem rede no CI.

P2.2 Job `job/ingest.requested`. Conteúdo da vaga em `<untrusted>`. Upsert por `canonical_url`. `inferSeniority` por palavras-chave antes do LLM. `checkBlocklist`. `checkDuplicateInTracker`: URL canônica ou empresa normalizada + similaridade de cargo ≥ 0,85 em 180 dias. Realtime. Falha pede para colar o texto.

P2.3 `assessFit`, `recommendCv` (idioma da vaga + trilha mais similar; empate → padrão), `suggestSalary` determinística. Guardar `model_version` e `prompt_version`. `evals/fit` com 10 pares iniciais e `pnpm eval:fit`.

P2.4 `/api/chat` e widgets `JobCard`, `StatusChangeCard`, `ActionList`. Botões chamam server actions, não o LLM. E2E: 3 links de fixture → 3 cards → pular um → `descartada`.

P2.5 F14 e buscas salvas: card de diff, desfazer, Memória, política por risco, classificador de tópico, rate limit, evals CA14.1–CA14.12.

### Fase 3 — Controle (P3.1–P3.2)

Tabela (TanStack) e kanban (dnd-kit) com a máquina da seção 9.4. Drawer com linha do tempo, evidências por URL assinada, notas e prazo. Importação CSV. Exportação CSV UTF-8 com BOM, separador `;`, datas `dd/mm/aaaa`. PDF com totais, tabela e "Suas ações". Página de ações com "Feito".

### Fase 4 — Gmail (P4.1–P4.3)

OAuth incremental, PKCE, estado e validação de origem. `gmail.readonly` separado de `gmail.send`. Token cifrado. Jobs `gmail/initial-sync` (90 dias) e cron de 2 h. Domínios citados: gupy.io, inhire.app, greenhouse.io, lever.co, myworkday.com, successfactors, quickin, jobbol, solides, mais termos PT/EN. Classificar com conteúdo `<untrusted>`. Nunca persistir o corpo. Confiança ≥ 0,8 e transição válida atualizam; o resto vai para "Revise". Confirmação sem candidatura cria `enviada` com source gmail. Prazos em `America/Sao_Paulo`. Lembretes Resend 48 h e 12 h antes.

### Fase 5 — Extensão (P5.1–P5.4)

Pareamento, pacote cifrado que expira em 24 h, `?vp_app=`. Adaptadores Gupy, InHire, Greenhouse, Lever, Workday e genérico por rótulo, `name`, `autocomplete`, `aria-label`. Eventos `input`/`change`. CV via `DataTransfer` com nome neutro. Nunca submit. Pergunta sem fato vira `QuestionCard`. `verifyGrounding` em texto livre. Confirmação por adaptador ou "Marquei como enviada". LinkedIn: só sugestão no painel. CA8.1–CA8.4.

### Fase 6 — E-mail, cobrança, LGPD (P6.1–P6.4)

Rascunho ≤ 150 palavras, sem valor monetário se a vaga não pedir. `send_email` recalcula o hash e recusa se divergir ou expirar. Stripe com seed de preços BRL, trial, `entitlements.ts` e `checkAndIncrementUsage`. Exportação ZIP, exclusão em até 15 dias, `destroyUserKey`, página Atividade. Landing, termos, privacidade e "Como usamos IA" marcados como rascunho jurídico. F16 antes de ligar Gmail, extensão ou LinkedIn.

### Fase 7 — Beta (P7.1–P7.2)

Evals da seção 10.6 com dados fictícios; `no-fabrication` bloqueia o merge. Sentry, OpenTelemetry, Langfuse com redação, PostHog sem PII, Upstash, CSP, RLS no CI, checklist ASVS em `docs/SEGURANCA.md`, runbooks.

### Fase 2 do produto (P8, depois do beta)

Worker isolado, pré-autorização, CV sob medida com diff, STAR, diff de perfil LinkedIn/Gupy sem automação dentro do LinkedIn.

## 17. Regras do Cursor

Os arquivos abaixo existem em `.cursor/rules` e repetem a seção 17 do PDF:

- `00-projeto.mdc` — sempre aplica: pt-BR na UI, código em inglês, domínio em `packages/core`, sem dados reais.
- `10-typescript.mdc` — strict, Zod nas fronteiras, erro `{ error: { code, message } }`, datas UTC, dinheiro com `Intl`.
- `20-dados-seguranca.mdc` — RLS, `_enc`, sem corpo de e-mail, `service_role` só no servidor, `redactPII`, `logAudit`, storage privado.
- `30-agente-ia.mdc` — não inventar, `proposed_from`, `verifyGrounding`, approval com hash, conteúdo não confiável, determinismo em `packages/core`.
- `40-extensao-automacao.mdc` — MV3, sem submit, sem captcha, sem preencher LinkedIn, sem cookies do usuário na extração, nome neutro de CV.
- `50-ui.mdc` — shadcn, `next-intl`, widgets de chat, botões via server actions.
- `60-testes.mdc` — Vitest e Playwright, sem rede no CI, testes nomeados com o código do CA, eval `no-fabrication` bloqueante.
