# Progresso

Fonte de implementação: [ESPEC.md](./ESPEC.md). Documento original completo: [ESPEC-app-assistente-vagas.pdf](./ESPEC-app-assistente-vagas.pdf) (v1.4).

## Fase 0 — Fundação

### P0.1 — Monorepo

Feito em 2026-10-21.

- Monorepo pnpm + Turborepo (`apps/*`, `packages/*`).
- `apps/web`: Next.js App Router, TypeScript strict, Tailwind, shadcn/ui (preset nova, style base-nova, ícones lucide), next-intl com pt-BR padrão e catálogo en. Página placeholder.
- `apps/extension`: WXT + React, Manifest V3, casca vazia (popup + service worker). Sem preenchimento de formulário.
- Pacotes: `@vagapilot/core`, `@vagapilot/db`, `@vagapilot/ai`, `@vagapilot/ats-adapters`, `@vagapilot/gmail`, `@vagapilot/jobs`, `@workspace/ui`, `@vagapilot/config`.
- Vitest nos pacotes (teste mínimo em `@vagapilot/core`). Playwright Test scaffold em `apps/web` (`test:e2e`, fora do `turbo test`).
- Prettier, lint-staged, husky, workflow GitHub Actions (install com cache, lint, typecheck, test, build).
- `docs/ESPEC.md`, `.cursor/rules` da seção 17, `.env.example` sem segredos.

### P0.2 — Supabase, Drizzle e RLS

Feito em 2026-10-21 (seção 9 do PDF, DDL 9.2/9.3 literal; prompt P0.2).

- `supabase/` com CLI local (`project_id = "vagapilot"`). Migrações: `20261021150821_initial_schema.sql` (extensões `pgcrypto` e `vector`, 13 enums, 29 tabelas na ordem exigida, com `evidences` e `email_threads` antes de `application_events`; índices da spec + índices de `user_id`; HNSW cosine em `confirmed_facts.embedding`; triggers de `updated_at`) e `20261021150823_storage_buckets.sql` (buckets privados `cvs`, `evidences`, `exports` com políticas por pasta `{user_id}/`).
- RLS habilitado em todas as tabelas, políticas na forma `(select auth.uid()) = user_id`:
  - CRUD do dono em 24 tabelas de dados do usuário.
  - `subscriptions` e `usage_counters`: o dono só lê; escrita só via `service_role`. Desvio consciente da regra genérica da spec, para o usuário não conseguir alterar o próprio plano ou cota.
  - `audit_log`: o dono lê e insere; `update`/`delete`/`truncate` revogados de `anon`, `authenticated` e `service_role`. O expurgo LGPD (P6) será uma rotina controlada.
  - `job_postings`: leitura para `authenticated`, escrita só via `service_role`. `stripe_events`: sem acesso de cliente.
  - `exports`: o usuário lê e apaga; quem grava é o servidor.
- `supabase/seed.sql`: 2 usuários FICTÍCIOS (`marina@vagapilot.test`, `rafael@vagapilot.test`, senha `Ficticia#2026`), com uma linha por tabela para cada um e termos/privacidade v1 já aceitos.
- `@vagapilot/db`: schema Drizzle (`src/schema.ts`, `src/enums.ts`) espelhando o SQL, mapa de acesso por tabela (`src/access.ts`).
- Testes:
  - `src/schema-sync.test.ts` (sempre roda): Drizzle × SQL (tabelas, colunas, enums), ordem de criação, RLS em toda tabela, forma `(select auth.uid())`, revogação no `audit_log`.
  - `test/rls.test.ts` (Supabase local): usuário A não lê, altera, apaga nem insere como B em cada tabela; regras dos modelos somente leitura, append-only, global e só servidor; isolamento nos 3 buckets.
  - Sem Supabase os testes de RLS pulam com aviso explícito. Com `VAGAPILOT_REQUIRE_SUPABASE=1` eles falham em vez de pular.
- Scripts na raiz: `pnpm db:start`, `db:stop`, `db:reset`, `db:status`. O teste do pacote não usa cache do Turbo (`packages/db/turbo.json`).
- CI: novo job `rls` sobe o Supabase (`supabase/setup-cli`) e roda `pnpm db:reset && pnpm --filter @vagapilot/db test`.
- Verificado localmente: `pnpm db:reset` + `pnpm --filter @vagapilot/db test` com 181/181 testes (145 de RLS executados contra o Postgres local). `supabase db advisors --local` sem apontamentos.
- Pendências:
  - `user_settings`, `saved_searches`, `memory_events` e `excluded_companies` (F14) ficam para o P2.5, como define a ESPEC.
  - As FKs entre tabelas do usuário não garantem o mesmo dono: A pode referenciar o id de uma linha de B se souber o uuid. A RLS impede leitura e escrita da linha de B, mas vale avaliar FKs compostas `(id, user_id)` ou checagens nas rotas.

### P0.3 — Autenticação e shell

Feito em 2026-10-21 (seção 8.5, prompt P0.3; plano: “UI: Figma traduzido para shadcn”).

- Auth com `@supabase/ssr`:
  - `proxy.ts` (antigo middleware do Next 16) renova a sessão com `getClaims()`, protege `/app/*` e manda quem já está logado para fora de `/entrar` e `/cadastro`.
  - E-mail e senha com confirmação (`enable_confirmations = true`). Google pede só `openid email profile`; o provider vem desligado em `supabase/config.toml` e é ligado com as variáveis `SUPABASE_AUTH_EXTERNAL_GOOGLE_*`.
  - `/auth/callback` (PKCE) e `/auth/confirm` (token hash). Sair limpa a sessão.
  - `/aceite` grava `consents` (`termos` e `privacidade`, versão `v1`) via `POST /api/consents`, com Zod e erro `{ error: { code, message } }`. O layout de `/app` exige o aceite.
  - A chave `service_role` não é lida pelo app web.
- Shell em shadcn (base-nova, Base UI) com dados FICTÍCIOS do protótipo (Marina Alves, Nubank etc., em `lib/demo-data.ts`):
  - Sidebar com grupos Workspace e Assistente, card do plano e menu do perfil (Perfil, Configurações, Sair). No mobile vira gaveta.
  - Topbar com saudação e data, busca `Ctrl/Cmd+K` (Command), notificações e “Analisar nova vaga” (Dialog com “Nada será enviado sem sua aprovação.”).
  - Visão geral: 4 métricas, kanban de 4 colunas com `@dnd-kit` (mouse, toque e teclado: Espaço pega, setas trocam de coluna, Espaço solta; anúncios em pt-BR), toast via sonner e trilho direito (próximas ações, insight, Gmail).
  - Sheet de detalhe com fit, próxima ação, linha do tempo, Arquivar e Preparar próxima etapa.
  - Tarefas (lista com concluir) e Currículos (cards por trilha × idioma). Candidaturas, Conversar, Buscas, Perfil e Configurações são placeholders com `Empty`.
- Mapa dos 10 `application_status` para as 4 colunas em `apps/web/lib/board.ts`. Por enquanto o arraste só muda estado local; as transições validadas (`packages/core/status.ts`) são da fase 3.
- Tema: paleta do protótipo em tokens semânticos (`packages/ui/src/styles/globals.css`), Manrope nos títulos e DM Sans no corpo (`next/font`). O `muted-foreground` ficou `#66726b` (o protótipo usa `#748079`) para manter contraste AA. Todas as strings estão em `messages/pt-BR.json`, tipadas via `global.d.ts`.
- Componentes shadcn adicionados em `packages/ui`. Ajustes: `closeLabel` em Dialog e Sheet, `mobileTitle`/`mobileDescription` na Sidebar (rótulos em pt-BR), cabeçalho do CommandDialog movido para dentro do conteúdo e hook `use-mobile` movido para `packages/ui`.
- Bypass de autenticação só para dev: `GET /dev/entrar` grava o cookie `vp_dev_session` e entra como a usuária fictícia Marina. Só funciona com `NODE_ENV !== "production"` **e** `VAGAPILOT_DEV_AUTH_BYPASS=1`; fora disso devolve 404 e o cookie é ignorado. O Playwright liga a flag no `webServer`.
- E2E (`pnpm --filter web test:e2e`, porta 3100):
  - `home.spec.ts`: página pública e redirecionamento de `/app` para `/entrar`.
  - `shell.spec.ts`: rotas, Ctrl+K → Sheet → Arquivar, Dialog, arraste com mouse e com teclado, mobile e ausência de erros de hidratação. Gera screenshots em `E2E_SCREENSHOT_DIR`.
  - `auth.spec.ts`: cadastro → confirmação (admin API) → login → aceite → `/app/chat` → sair. Pula explicitamente quando não há Supabase local.
  - Resultado: 10/10 verdes, duas vezes seguidas.
- Dev local: `apps/web/.env.local` (no `.gitignore`) aponta para `supabase start`. `allowedDevOrigins` inclui `127.0.0.1`.
- Pendências:
  - O e2e ainda não roda no CI.
  - O catálogo `en.json` só tem `Home`; inglês está fora do MVP.
  - Os dados do shell são locais e fictícios; o tracker real é da fase 3.
  - Filtros e “Este mês” são decorativos.
  - Os textos jurídicos de `/termos` e `/privacidade` são placeholders de rascunho.
  - O template de e-mail de confirmação pode apontar para `/auth/confirm` quando o SMTP real for configurado.

### P0.4 — Criptografia e auditoria

Feito em 2026-10-21 em `@vagapilot/core` (seções 12.3 e 10.7, prompt P0.4).

- `crypto.ts`: envelope AES-256-GCM, DEK por usuário embrulhada pela KEK de um `KeyProvider` (`LocalKeyProvider` via `KEK_LOCAL`, base64 de 32 bytes; `AwsKmsKeyProvider` só com `KmsClient` injetado). `createFieldCrypto` expõe `encryptField`, `decryptField`, `decryptFieldText` e `destroyUserKey` (crypto-shredding); formato versão + IV + tag + cifra, `userId` como AAD, cache de DEK com TTL (padrão 5 min).
- `redact.ts`: `redactPII` / `redactPIIText` mascaram CPF, e-mail e telefone BR, em profundidade; chaves tipo senha/token/OTP viram `[REDACTED_SECRET]`.
- `audit.ts`: `logAudit(sink, evento)` com atores e ações tipados da seção 10.7, redação antes de gravar no `AuditSink`.
- Pendências: adaptador `@aws-sdk/client-kms`, rotação anual da KEK (re-embrulhar DEKs). `DekStore` e `AuditSink` com Postgres foram feitos no P1 (`@vagapilot/db/server`).

## Fase 1 — Perfil, CVs e fatos

### P1.1–P1.4 — Perfil, CVs, fatos confirmados e onboarding

Feito em 2026-10-22 (F1 RF1.1–RF1.6 e CA1.1–CA1.4, F1A, F2 RF2.1–RF2.4 e CA2.1–CA2.3, F3 + F3A, J1, seções 10.4 e 12.3, prompts P1.1–P1.4 do PDF).

- Banco (`supabase/migrations/20261021193916_p1_profile_cvs_facts.sql`, criada pela CLI e aplicada com `supabase migration up`):
  - `user_keys` (DEK embrulhada por usuário): sem grants para `anon`/`authenticated`; `service_role` só insere, lê e apaga (sem `update`). Cascade em `auth.users` faz crypto-shredding na exclusão da conta.
  - `languages.cefr` opcional (A1–C2) ao lado do rótulo PT.
  - `search_confirmed_facts(user_id, vetor, k)`: `security invoker`, filtra `status = 'confirmado'` no SQL; índice `(user_id, status)`.
  - Drizzle (`userKeys`, `languages.cefr`), mapa de acesso (`user_keys` em `serverOnlyTables`) e o teste de sincronia agora leem `alter table … add column`.
- `@vagapilot/db/server`: `SupabaseDekStore` (insert-if-absent via `on conflict do nothing`, nunca sobrescreve; `delete` para crypto-shredding), `SupabaseAuditSink` (append em `audit_log`), `searchConfirmedFacts` (RPC + filtro redundante por status) e helpers `bytea` para o formato hex do PostgREST.
- `@vagapilot/core` (puro, sem I/O):
  - `blocklist.ts`: `normalizeCompanyName` (remove Ltda, S.A., S/A, Brasil, Group, Tecnologia, “do Brasil” etc.), `normalizeDomain`, `domainLabel`, `trigramSimilarity` (estilo pg_trgm) e `matchBlocklist` (nome, apelido, domínio/subdomínio, rótulo do domínio contra o nome, similaridade ≥ 0,9).
  - `cv-filename.ts`: `buildCvFilename(perfil, idioma, padrão, extensão)` com `{first}`, `{last}`, `{full}`, `{lang}`, transliteração e fallback seguro.
  - `consents.ts` (`canStoreDiversityData`: última decisão vence), `facts.ts` (tipos/estados, `isExcerptInText` com normalização de acentos, travessões, bullets e espaços; tokens curtos só casam como palavra inteira) e `br-documents.ts` (`isValidCpfInput`, `formatCpf`, reaproveitando `isValidCpf` de `redact.ts`).
- `@vagapilot/ai`:
  - `extractFactsFromCv(texto)`: AI SDK v7 `generateText` + `Output.object` com Zod (o `generateObject` citado na spec está depreciado na v7; mesma semântica). CV entra como `<untrusted source="cv">`. Fatos cujo `excerpt` não existe no texto normalizado são descartados (`droppedFacts`). Também devolve as experiências detectadas (com trecho).
  - `createEmbedder()` (1536 dimensões, `EMBEDDING_MODEL`) e `createFactSearch({ embedder, store })` → `searchFacts(userId, query, k)` sempre só com `confirmado`.
  - Provedor: Vercel AI Gateway quando há `AI_GATEWAY_API_KEY` (`LLM_MODEL_SMALL`, `EMBEDDING_MODEL`). Sem chave, com `AI_PROVIDER=fake` ou sob Vitest, usa o provedor FAKE determinístico (`src/fake.ts`, marcado como tal): extração por regras linha a linha e embedding por hash. Testes nunca chamam rede.
  - Fixture `@vagapilot/ai/fixtures`: CV FICTÍCIO com 3 experiências.
- `@vagapilot/jobs` (Inngest v4): evento `cv/uploaded` (Zod), função `cv-uploaded` em dois passos (`extract-text`: download do bucket, `unpdf` para PDF e `mammoth` para DOCX, ≤ 15 páginas, grava `extracted_text`; `propose-facts`: extração, embeddings, `confirmed_facts` como `proposto` com `source_ref` {cv_version_id, excerpt, experience_hint, model, prompt_version}, vínculo à experiência do perfil por nome normalizado e `fact.proposed` no `audit_log`). Idempotente por versão de CV. Validação de tipo por magic bytes + extensão, limite de 10 MB e SHA-256.
- Web (`apps/web`):
  - Servidor (`lib/server/*`, `server-only`): cliente `service_role` (só para `user_keys`, `audit_log` e jobs), `getFieldCrypto` (`KEY_PROVIDER`/`KEK_LOCAL` + `SupabaseDekStore`), `audit()` com user agent e `getUserContext()` (sessão do usuário, tudo sob RLS). Toda escrita filtra `user_id` e confere a posse de linhas referenciadas (trilha, experiência) antes de gravar.
  - Rotas da 8.5: `GET /api/profile` (resumo sem dados sensíveis), `GET/PATCH /api/facts`, `POST /api/cv-versions` (multipart), `GET /api/cv-versions/:id/file` (302 para URL assinada de 5 min com `Content-Disposition` do nome neutro; `?format=json`), `/api/inngest`. Erros no formato `{ error: { code, message } }`. `proxyClientMaxBodySize` = 12 MB para não truncar uploads de 10 MB.
  - `/app/perfil` com abas: contato (telefone e nascimento `_enc`), documentos (CPF/RG/CNH `_enc`, CPF validado), endereço `_enc`, situação atual (remuneração atual como resposta padrão sensível em `answer_enc`; “prefiro não informar” apaga), experiências (vínculo, mês/ano, atual), formação, idiomas (nível + CEFR), competências (viram fatos `confirmado`/`manual`; remover revoga), preferências (modelos, regimes, cidades, disponibilidade, viagens, mudança), pretensão (senioridade × regime, mín/alvo, moeda, período), respostas padrão (sensíveis cifradas), empresas bloqueadas (nome normalizado, apelidos, domínios) e diversidade.
  - Diversidade (CA1.3): campos desabilitados sem consentimento; o switch grava `consents` (`diversidade`, `v1`); revogar grava `granted=false` e apaga `diversity_enc`; a action recusa salvar sem consentimento.
  - `/app/cvs`: upload múltiplo (até 6 por vez), trilhas (CRUD), cards trilha × idioma com badge “Padrão”, versões anteriores (`parent_version_id`) com download e “tornar padrão”, editar/reprocessar/remover (não remove versão usada em candidatura). O seed de “Executivo & Híbrido” aparece como “Processando” porque não tem arquivo no Storage.
  - `/app/fatos`: “Confirme seus fatos” agrupado por experiência (do perfil ou detectada no CV), trecho de origem, Confirmar / Editar e confirmar (reembedding, texto original guardado em `source_ref`) / Rejeitar, ações em lote e por grupo, “Adicionar ao perfil” cria a experiência a partir do CV e vincula os fatos. Filtro por estado. Cada mudança grava `fact.confirmed`/`fact.rejected` (CA2.3).
  - `/app/onboarding` (J1/P1.4): 6 etapas (currículos → fatos, pode pular → trilhas e idiomas → respostas obrigatórias com checklist → empresas bloqueadas → convites de Gmail e extensão desabilitados), barra de progresso, “Continuar depois” (salva a etapa em `preferences.onboarding`) e retomada. Concluir exige 1 CV + respostas obrigatórias (CA1.1) e leva a `/app/chat`. O aceite de termos agora segue para `/app/onboarding`; `/app/chat` mostra um aviso para retomar enquanto não termina.
  - Strings em `messages/pt-BR.json` nos namespaces `Forms`, `ProfileOptions`, `ProfilePage`, `Cvs`, `Facts` e `Onboarding`. Formulários com react-hook-form + Zod + `Field`; componentes shadcn novos: `switch`, `alert-dialog`, `radio-group`.
- Fallback do Inngest: sem `INNGEST_DEV` nem `INNGEST_EVENT_KEY`, o upload roda `processCvUpload` de forma síncrona na própria requisição (dev local e e2e). Com o dev server do Inngest (`npx inngest-cli dev` e `INNGEST_DEV=1`), o upload só envia `cv/uploaded` e a função roda via `/api/inngest`.
- Variáveis locais em `apps/web/.env.local` (fora do git): `SUPABASE_SERVICE_ROLE_KEY` (chave demo do `supabase status`), `KEY_PROVIDER=local`, `KEK_LOCAL`, `AI_PROVIDER=fake`. A chave `service_role` passa a ser lida pelo servidor web, só em módulos `server-only`.
- Testes:
  - Vitest: `core` (CA1.4 e normalização, CA3.1 `buildCvFilename`, CA1.3 consentimento, grounding, CPF), `ai` (CA2.1 com a fixture de 3 experiências, descarte de fato sem trecho, `<untrusted>`, `searchFacts` só confirmados mesmo se o store falhar), `jobs` (PDF/DOCX, limites, CA2.1 de ponta a ponta no Supabase local com idempotência e posse) e `db` (DekStore insert-if-absent, CA1.2 sem texto puro e crypto-shredding, AuditSink, `search_confirmed_facts` só `confirmado` com service role, sessão e RLS entre usuários; `user_keys` no teste de RLS de tabelas só de servidor).
  - Playwright: `onboarding.spec.ts` (CA1.1 usuária fictícia nova completa o wizard com upload, confirma/edita/rejeita fatos, CA2.3 no `audit_log`; salvar e retomar) e `profile.spec.ts` (CA1.2 CPF/RG/telefone cifrados no banco; CA1.3 diversidade com e sem consentimento). `auth.spec.ts` agora passa pelo onboarding (“Continuar depois”) antes do chat.
  - Resultados em 2026-10-22: `pnpm turbo lint typecheck test build` 39/39 tarefas; `pnpm --filter web test:e2e` 16/16.
- Verificação manual no navegador (bypass de dev como Marina): upload pelo wizard (15 fatos propostos), “Adicionar ao perfil”, confirmar grupo, rejeitar, editar e confirmar, lote; trilha nova virou padrão; download com `CV-Marina-Alves-PT.pdf` (upload chamado `versao-ops-final2.pdf`, URL de 300 s); perfil com CPF/RG cifrados no banco; diversidade liga, salva cifrado e desliga apagando; rotas do shell sem regressão; 390 px sem rolagem horizontal. Capturas em `%TEMP%\vagapilot-screenshots\p1-*.png`.
- Pendências:
  - Geração de CV a partir de modelo HTML→PDF (RF3.4/RF3A.2) e propagação de mudanças globais com diff (RF3A.3) não entraram; só upload importado.
  - Limite de versões por plano (6 no Pro, 1 trilha no Grátis) fica para `entitlements.ts` (P6).
  - Antivírus do upload (10.4) não existe localmente; hoje só magic bytes, extensão, tamanho e páginas.
  - Histórico de mudança de idioma e marcação de respostas derivadas como “revisar” (RF1A.3), referências profissionais (RF1A.5) e onboarding conversacional (RF1A.7) não foram feitos.
  - `/app/fatos` não está na sidebar (arquivo compartilhado); acesso por Currículos, onboarding e links. Avaliar item de menu.
  - O PDF/DOCX não passa por OCR: CV escaneado vira “Não foi possível ler”.
  - O provedor fake só reconhece CVs no formato da fixture; a qualidade real depende do modelo do gateway (sem eval nesta fase).
  - O bypass de dev assina como Marina; dados de verificação manual ficaram na conta dela no banco local.

## Fase 2 — Vagas, fit e chat

### P2.1–P2.5 — Adaptadores, ingestão, fit, chat com widgets e F14

Feito em 2026-10-22 (F4 RF4.1–RF4.5 e CA4.1–CA4.3, F4A RF4A.1–RF4A.3, F5 RF5.1/RF5.3 e CA5.1, F5A, F6 RF6.1–RF6.5 e CA6.2, F6A (parcial), F7 RF7.1–RF7.4 e CA7.1–CA7.2, F14 RF14.1–RF14.9 e CA14.1–CA14.11, F15 RF15.1/RF15.4, seções 8.4, 10.2–10.6 e 11.1, prompts P2.1–P2.5 do PDF). Sem rede nos testes: links vêm de respostas gravadas.

- `@vagapilot/ats-adapters` (P2.1, 11.1): `JobSourceAdapter` (`matches`, `canonicalize`, `extract`) para LinkedIn, Gupy, InHire, Greenhouse, Lever, Workday, SuccessFactors, Quickin, Jobbol, Sólides e genérico, mais `detectSource`, `canonicalizeUrl` e `extractJob`.
  - Greenhouse pela Job Board API e Lever pela Postings API; Workday pelo JSON público `/wday/cxs/...`; Gupy pelo JSON embutido (`__NEXT_DATA__`); demais por JSON-LD `JobPosting` com fallback cheerio.
  - LinkedIn: só a página guest (`/jobs-guest/jobs/api/jobPosting/{id}`), uma requisição por link, cache de 24 h, 429/999/403 → `{ status: "blocked" }` (CA4.3, RF15.1, RF15.4). Detecta a vaga externa no `applyUrl` do LinkedIn e em links "Candidatar-se" de páginas genéricas (RF4A.2).
  - `fetchPublic`: `credentials: "omit"`, sem cookie/authorization, user-agent identificável `VagaPilotBot/0.1`, timeout de 10 s, cache 24 h por URL (`MemoryJobCache`). `htmlToText` remove elementos ocultos (`display:none`, `hidden`, `aria-hidden`), um vetor comum de injeção.
  - `fixtures/` com 18 respostas FICTÍCIAS (`routes.json`, `expected.json`) e `@vagapilot/ats-adapters/fixtures` (`createFixtureFetch`, `FIXTURE_JOB_URLS`). Em dev/e2e, `VAGAPILOT_ATS_FIXTURES=1` (ignorado em produção) troca a rede pelas fixtures.
- `@vagapilot/core` (puro): `job-text.ts` (seções Requisitos/Diferenciais PT/EN, e-mail de candidatura, idioma do texto), `job-rules.ts` (`inferSeniority` por palavras-chave antes do LLM, `computeJobAlerts` para idioma/local/modelo/regime/senioridade, `mergeAlerts`, `suggestSalary` com alerta `salario_fora`, `checkDuplicateInTracker` com URL canônica ou empresa normalizada + cargo ≥ 0,85 em 180 dias, rubrica `fitFromRubric`/`capFitByRubric`, `recommendCv` com empate → padrão), `settings.ts` (modelo tipado com Zod: busca salva, patch, preferências por chave enum, modo de aprovação, regras de pretensão, idioma, Memória, `diffValues`, `isSearchDue` no fuso de São Paulo), `policy.ts` (`policyCheck(tool, origin, confirmed)` por risco: leitura, interna, baixo com desfazer, médio/alto com confirmação; conteúdo não confiável nunca aplica nada) e `guardrails.ts` (`extractUrls`, limites 8.000 caracteres/20 links/20 mensagens por minuto, `classifyTopicByRules`, `detectInjection`, `filterOutput` contra links com dados, PII e eco do prompt).
- `@vagapilot/ai`:
  - `extractJobPosting` (RF4.4): `generateText` + `Output.object`, vaga em `<untrusted source="job_posting">`, senioridade por regra vence, URL/e-mail só se aparecerem no texto, `injectionDetected`. `assessFit` (10.5): schema `FitAssessment`, motivos com `factIds` desconhecidos ou não confirmados são descartados, alertas do código reinseridos, nível limitado pela rubrica, `recommendedTrackId` só entre as trilhas dadas. Versões `extract-job.v1` e `assess-fit.v1`.
  - Chat: `prompts/orchestrator.v1.md` (regras da 10.4 e canário; a constante TS é idêntica ao arquivo, checado por teste), `chatToolInputSchemas` e descrições das 22 ferramentas, `parseSettingsIntent`/`parseSearchRequest` (regras pt-BR, várias intenções por pedido, ambiguidade vira `ask_clarification`), `classifyTopic` (regras; só "desconhecido" iria a um modelo pequeno) e o orquestrador FAKE determinístico (`createFakeOrchestratorModel`) usado sem `AI_GATEWAY_API_KEY`. Com chave, `LLM_MODEL_LARGE` (orquestrador e fit) e `LLM_MODEL_SMALL` (extração).
- Banco (`supabase/migrations/20261022134727_p2_jobs_chat_settings.sql`, criada pela CLI e aplicada com `supabase migration up`): `saved_searches` (só os campos do pedido de busca + `active`/`last_run_at`), `job_ingestions` (progresso por link, na publicação `supabase_realtime`), `excluded_companies`, `preferences` (chaves enum), `user_settings` (`approval_mode`) e `memory_events` (intenção, origem, frase, `before`/`after`, status). RLS do dono nas seis, checks de domínio, índices e gatilhos de `updated_at`. Drizzle, mapa de acesso e seed idempotente `supabase/seeds/p2.sql` (aplicado com `psql`).
- `@vagapilot/jobs`: `processJobIngestion` (`job/ingest.requested`: adaptador → extração → upsert de `job_postings` por `canonical_url` com embedding → `computeMatch`), `computeMatch` (blocklist + excluídas → "Pulada automaticamente", duplicidade, alertas, pretensão, fatos confirmados por requisito via `search_confirmed_facts`, `assessFit`, CV, `model_version`/`prompt_version`; nunca sobrescreve a decisão do usuário), buscas (`findPostings`, `previewSearch`, `runSavedSearch` entrega só vagas novas em lote com fit, `dueSearches`) e funções Inngest `job-ingest` (até 3 por usuário em paralelo), `saved-searches-cron` (de hora em hora, fuso de São Paulo) e `search-run`. Sem Inngest, a ingestão roda logo após a resposta (`after`) e as buscas vencidas rodam ao abrir `/app/buscas`.
- Web:
  - `POST /api/chat`: Zod, entrada ≤ 8.000 caracteres (413), 20 mensagens/min e 20 links por lote (429 com mensagem em pt-BR e `ratelimit.hit`), conversa do próprio usuário, mensagens persistidas em `messages`, classificador de tópico antes do agente (recusa sem chamar o modelo, `chat.off_topic_refused`/`chat.injection_blocked`), links → `ingest_job_postings` determinístico (8.4), demais pedidos → `streamText` com as ferramentas, `stopWhen: isStepCount(8)`, saída limitada e filtro de saída por bloco de texto.
  - Ferramentas (`lib/chat/tools.ts`): as da P2.4 e as da F14; cada execução refaz o `policyCheck`. Ferramenta que devolve texto de vaga marca o turno, e efeitos pedidos depois disso viram cartão de confirmação (CA14.8). `propose_fact` cria fato `proposto` + `approvals` `criar_fato` (24 h, hash do preview); só o clique confirma.
  - Serviço F14 (`lib/settings/server.ts`): chat e formulários chamam o mesmo `applySettingChange` (política → plano → escrita sob RLS → `memory_events` → auditoria `search.*`/`settings.changed`). Baixo risco aplica com "Desfazer"; excluir busca e modo de aprovação ficam pendentes até "Confirmar" (CA14.3). Desfazer restaura exatamente `before` e recusa se houver mudança mais nova no mesmo item (CA14.2, `settings.undone`).
  - `/app/chat` com `useChat`: conversa padrão "Busca de emprego" e "Nova conversa", streaming, composer com Enter/Shift+Enter e contador, `role="log"`. Widgets em `packages/ui`: `JobCard` (empresa, cargo, local/modelo/regime, badge de fit, 3 motivos, lacunas, CV, pretensão, alertas, Aplicar/Pular/Salvar/Trocar CV/Ajustar pretensão/Ver detalhes), `StatusChangeCard`, `ActionList`, `ApprovalCard`, `QuestionCard` (esclarecimento) e `SettingsDiffCard` (antes → depois + Desfazer). Botões chamam server actions (`app/app/chat/actions.ts`), nunca o LLM. Lote aparece item a item (Realtime em `job_ingestions` + polling de fallback); falha mostra motivo e campo para colar a descrição (CA4.2). Sheet de detalhe com requisitos, descrição e versões de modelo/prompt.
  - Decisões (`record_decision`): Pular → `descartada` (CA7.1), Salvar → `rascunho`, Aplicar → `em_andamento` (rota `extensao`) e abre o link de candidatura (o da empresa quando o LinkedIn aponta para outro ATS). Cria a candidatura com evento `status_change` ou move pela máquina de `status.ts` (`change_application_status`), fonte `usuario` no clique e `agente` pelo chat.
  - `/app/buscas`: lista, formulário (mesmos campos do chat) com prévia de vagas e fit, editar/excluir/pausar, "Executar agora" e últimos resultados com JobCards. `/app/memoria` (item novo na sidebar): preferências do assistente, modo de aprovação (diálogo de confirmação), empresas excluídas e a lista de mudanças com origem, frase, diff, Desfazer/Confirmar e atalho para editar.
  - "Analisar nova vaga" aceita até 20 links e abre o chat com eles; os cartões aparecem lá.
  - Strings em `Chat`, `ChatTools`, `Jobs`, `SettingsModel`, `Searches` e `Memory` (mais `Nav.memory` e `AnalyzeDialog`).
- Evals (`evals/`, dados FICTÍCIOS, provedor fake por padrão, rodam no `pnpm test` e bloqueiam): `fit` (10 pares, `pnpm eval:fit`: 100%), `settings-intent` (60 frases: intenção e parâmetros 100%), `prompt-injection` (15 ataques no chat + 10 conteúdos de vaga/e-mail/CV: 0 ações não autorizadas), `off-topic` (40 + 40: recusa 100%, recusa indevida 0%) e `prompt-leak-fraud` (15 + 15: 0 vazamentos, 0 ajudas). `pnpm evals` roda todos. Os números medem as regras do fake contra conjuntos escritos junto com elas; com `AI_GATEWAY_API_KEY` o fit e o extrator usam o modelo real.
- Testes:
  - Vitest: `ats-adapters` (25: detecção/canonicalização de todas as fontes, CA4.1 com 16 fixtures ≥ 90% empresa/cargo e ≥ 80% requisitos, CA4.3, 429/999, timeout, cache de 24 h, vaga externa, oculto removido), `core` (CA6.2, CA5.1, rubrica, pretensão, CV, CA14.7 normalização, política CA14.3/CA14.8, CA14.10, classificador, filtro de saída, agenda), `ai` (extração com fixtures e `<untrusted>`, P2.3 descarte de motivos, CA6.2 com o modelo tentando tirar o alerta, prompt sincronizado, intenções, orquestrador fake ignora conteúdo de ferramenta, evals), `jobs` (7 no Supabase local: CA4.1 de ponta a ponta, motivos só com fatos confirmados, RF4.5 vaga compartilhada, CA4.2, CA5.1, RF6.4, RF4A.3 prévia/entrega única) e `db` (as seis tabelas no teste genérico de RLS + `p2-settings.test.ts` com checks e isolamento).
  - Playwright `e2e/chat.spec.ts`: CA7.1 (3 links → 3 JobCards → Pular em < 1 s → `descartada` no banco), CA4.2, CA14.8 (vaga com instruções ocultas e visíveis não muda nada e gera `chat.injection_blocked`), CA14.9, CA14.2 (preferência pelo chat → Desfazer apaga a linha criada) e CA14.7 (busca pelo chat = busca pelo formulário, eventos `chat` e `formulario`). `shell.spec.ts`, `auth.spec.ts` e `onboarding.spec.ts` foram ajustados ao chat real (diálogo abre o chat; título "Conversar").
  - Resultados em 2026-10-22: `pnpm turbo lint typecheck test build` 39/39; `pnpm --filter web test:e2e` 24/24.
- Verificação no navegador (bypass de dev como Marina, dev server da porta 3100): 3 links de fixture viram 3 cartões; Salvar → Rascunho, Pular → Pulada, Aplicar → Em preenchimento em 338 ms abrindo o ATS da empresa; detalhe da vaga; "SP" pede esclarecimento e a escolha cria a busca; busca editada pelo formulário com prévia e desfeita na Memória (volta exatamente); recusa fora de escopo; 390 px sem rolagem horizontal; demais rotas do app respondem 200. Capturas em `%TEMP%\vagapilot-screenshots\p2-*.png`.
- Desvios e decisões:
  - `generateObject` da spec virou `generateText` + `Output.object` (AI SDK v7) e `stepCountIs(8)` virou `isStepCount(8)` (mesmo comportamento; o nome antigo é alias).
  - Links no chat vão direto para a ingestão, sem passar pelo modelo (a 8.4 diz que o `/api/chat` detecta URLs); o modelo cuida do resto.
  - `delete_saved_search`, `update_saved_search` e `undo_change` aceitam `match`/id opcional além do `{ id }` da 10.3, para resolver "apague a busca de gerente de TI" sem um passo extra; a ambiguidade vira pergunta.
  - `job_ingestions` é tabela nova (não está na seção 9): guarda o progresso e as falhas de cada link para o Realtime e para o CA4.2. `excluded_companies` foi criada à parte da `company_blocklist`, como pede a nota da 9.3; as duas valem na análise e nas buscas.
  - Buscas salvas procuram no catálogo de `job_postings` (vagas públicas que os usuários já analisaram). Não há coleta em feeds de ATS nem e-mails de alerta ainda; a RF4A.3 só permite fontes autorizadas.
  - Preferências: `email.include_salary` (padrão: sim, quando a vaga pedir) e `searches.min_fit`. O modo `envie_direto` só é guardado; o envio direto é da fase 2.
  - Rate limit por contagem de `messages` do usuário no último minuto (sem Upstash); o teto de custo por usuário/dia ainda não existe.
- Pendências:
  - Gmail (P4): ligar `onJobAlert` (RF15.2) ao `startIngestion` de `lib/chat/jobs-server.ts` e somar `searchGmailForDuplicates` (RF5.2) ao `duplicate_check` do `computeMatch` (hoje só o controle interno).
  - P6: approvals genéricas (`POST /api/approvals/:id/decide`) devem absorver `decideFactAction`; `entitlements.ts` antes de `extractJobPosting`/`assessFit`/orquestrador (análises por mês) e teto de custo; `draft_application_email` deve respeitar `email.include_salary`; `export_tracker`/`regenerate_report` e `propose_global_cv_change` não existem.
  - Score ATS lado a lado por trilha (RF6A.2), alerta de prazo de inscrição e `research_company` não foram feitos. "Aplicar e enviar direto" fica para a fase 2.
  - Esclarecimento já respondido volta a mostrar as opções depois de recarregar a página; a frase original guardada na Memória é a resposta curta ("São Paulo (cidade)"), não o pedido inteiro.
  - Conjuntos de eval menores que a meta da 10.6 (fit 10/50, settings 60/100, injeção 25/200, fora de escopo 80/200, vazamento e fraude 30/100).
  - O texto do namespace `Settings` (página Configurações, P4) foi sobrescrito por engano durante a mesclagem das mensagens da P2 e reescrito com as mesmas 5 chaves; vale revisar a redação.
  - Aplicar seed por pipe do PowerShell no `psql` estraga UTF-8; use `psql -f` dentro do contêiner.

## Fase 3 — Controle

### P3.1 e P3.2 — Tracker, exportações e ações

Feito em 2026-10-22 (F10 RF10.1–RF10.6 e CA10.1–CA10.3, F10A, seção 9.4, J6, prompts P3.1 e P3.2 do PDF; plano: “Kanban visual em 4 colunas”).

- Máquina de status em `packages/core/src/status.ts`:
  - Grafo literal da seção 9.4. `entrevista → entrevista` é uma nova rodada.
  - Estados terminais: `reprovada`, `encerrada`, `descartada`. Só o usuário reabre: `reprovada`/`encerrada` → `enviada`, `em_analise`, `etapa_pendente` ou `entrevista`; `descartada` → `rascunho`. A spec não lista os destinos de reabertura; esta é a escolha feita.
  - Só a fonte `usuario` é manual. `agente`, `extensao`, `gmail`, `worker` e `sistema` são automáticas: nunca saem de estado terminal, nunca regridem (ordem de progresso), exigem evidência (CA10.2) e confiança ≥ 0,8; abaixo disso o motivo é `needs_review` (fila "Revise").
  - `confirmedByUser` aplica as regras manuais mantendo a fonte real (clique em card do chat ou na fila "Revise").
  - Funções `switch` com checagem `never`. Testes cobrem os 100 pares manuais e os 500 automáticos.
- Outros módulos puros no core: `csv.ts` (RFC 4180, BOM, `;`, CRLF, proteção contra fórmula), `dates.ts` (dd/mm/aaaa e parsing no fuso `America/Sao_Paulo`), `tracker.ts` (tipo `TrackerApplication`, filtros status/fonte/rota/fit/período/busca, "Suas ações", totais por status/fonte/trilha, métricas da visão geral) e `tracker-csv.ts` (colunas da RF10A.1, mapeamento de importação com sinônimos PT/EN e relatório de linhas rejeitadas). Os mesmos filtros servem à tela e à exportação.
- Migração `20261021193850_tracker_status_functions.sql`: `change_application_status`, `set_application_next_action` e `complete_application_action`, `security invoker`, atômicas (linha + `application_events`). Recusam linhas de outro dono, evidência ou thread de outro dono (`*_not_found`) e `from` desatualizado (`status_conflict`). `anon` sem execução. Nenhuma tabela nova.
- Seed idempotente `supabase/seeds/tracker.sql` (registrado em `config.toml`): 7 processos fictícios da Marina com match/fit, eventos de várias origens (Gmail com confiança e evidência), e-mails fictícios e próximas ações relativas a `now()`. Aplicado com `psql -f`, sem `db reset`.
- Web (`apps/web`):
  - O layout de `/app` carrega candidaturas, CVs e status do Gmail com a sessão do usuário (RLS). O estado é compartilhado por Visão geral, Candidaturas, Tarefas, Ctrl+K e Sheet. Mutações são server actions com Zod que chamam `refresh()`; a UI usa `useOptimistic`, que desfaz sozinho em caso de erro.
  - Kanban: soltar numa coluna consulta a máquina de estados. Um status permitido aplica direto, vários abrem um diálogo de escolha, nenhum dá toast de erro. Mouse, toque e teclado, com anúncios em pt-BR.
  - `/app/candidaturas`: abas Tabela (TanStack Table v9: ordenação e paginação) e Kanban, busca e filtros por status, fonte, rota, fit e período, mudança de status por linha, criação manual (Dialog com Field + Zod; o CV escolhido precisa ser do usuário), importação CSV com mapeamento e relatório de rejeitadas, e exportação CSV/PDF com os filtros ativos.
  - Sheet de detalhe: status fino (só transições permitidas), próxima ação e prazo, notas, linha do tempo com rótulo da origem, confiança, assunto do e-mail e evidência, e evidências com imagem por URL assinada de 5 min.
  - `/app/acoes`: ações ordenadas por prazo (atrasada, 48 h, depois, sem prazo) e botão "Feito", que gera evento `deadline_set` com `done`. A Visão geral usa dados reais: métricas do mês, fit médio, ações pendentes, taxa de retorno, trilho "Próximas ações" e card do Gmail lido de `gmail_connections`. O insight continua texto fixo.
  - Os botões "Filtros" (fonte, rota, fit) e "Período" da Visão geral funcionam. O botão decorativo "Nova tarefa" saiu.
  - "Analisar nova vaga" abre a criação manual com o link preenchido até a ingestão (P2.2).
  - `GET /api/applications/export?format=csv|pdf` com os filtros da tabela (Zod), sessão e erro `{ error: { code, message } }`. O CSV sai em UTF-8 com BOM, `;` e datas dd/mm/aaaa. O PDF (`@react-pdf/renderer`) tem capa com período e totais por status, fonte e trilha de CV, taxa de retorno, tabela colorida pela paleta fixa da F10A com legenda (`lib/tracker/palette.ts`, texto escuro sobre tons claros) e a seção "Suas ações".
  - Auditoria: `status.changed` e `data.exported` via `logAudit` + `SupabaseAuditSink` de `@vagapilot/db/server` (do P1), com a sessão do usuário.
  - Bypass de dev: `/dev/entrar` agora também faz login real da Marina no Supabase local, para as leituras passarem pela RLS. O `proxy.ts` renova esse token sem redirecionar.
  - Turbopack não resolve `.js` → `.ts` nos pacotes NodeNext. O loader `apps/web/turbopack/strip-relative-js-extension.cjs`, registrado em `next.config.ts`, resolve isso para `@vagapilot/*` (ajustado junto com o P1).
  - Strings nos namespaces `Tracker`, `Tasks`, `Board`, `Metrics`, `Rail` e `JobSheet`.
- Testes:
  - Vitest no core: `status.test.ts`, `tracker.test.ts` e `tracker-csv.test.ts` (CA10.1 com os bytes `EF BB BF`, `;`, CRLF e dd/mm/aaaa; CA10.3 com 200 linhas em menos de 10 s e 10 rejeitadas).
  - `packages/db/test/tracker-functions.test.ts` (7 testes, Supabase local): isolamento entre Marina e Rafael, evidência alheia, concorrência, CA10.2.
  - E2E: `e2e/tracker.spec.ts` cobre criar → status pela tabela → kanban com escolha e movimento inválido → linha do tempo com eventos e auditoria no banco; CA10.1 (download com BOM, PDF e erro 400); CA10.3 (200 linhas em menos de 10 s com relatório); "Feito" em Tarefas refletindo na Visão geral. Cada teste usa linhas próprias com prefixo `E2E` e apaga no fim. `e2e/shell.spec.ts` virou só leitura sobre o seed.
- Verificado no navegador como Marina via bypass: arraste válido, escolha ao reabrir, movimento inválido, filtros e busca, Sheet, criação, importação, exportação CSV/PDF, "Feito", consistência entre as três telas e layout em 390 px sem overflow.
- Pendências:
  - `GET /api/applications` e `PATCH /api/applications/:id` (seção 8.5) não foram criados; a UI usa server actions. Ferramenta `export_tracker` do agente e relatório agendado (RF10A.2) ficam para P2.4/P6.
  - "Encerrada" automática após 45 dias (cron `sistema`) não foi implementada.
  - Leitura limitada a 1.000 linhas por consulta (`max_rows` do PostgREST); paginar no servidor se passar disso.
  - Os filtros não vão para a URL.
  - O aviso de script do `next-themes` no overlay de dev vem da P0.

## Fase 4 — Gmail

### P4.1–P4.3 — Conexão, sincronização, classificação, status e lembretes

Feito em 2026-10-22 (F11 RF11.1–RF11.11 e CA11.1–CA11.7, J5, RF5.2, RF15.2, seções 10.4, 10.5, 11.2 e 12.3, prompts P4.1–P4.3 do PDF). Sem credenciais Google reais: tudo roda contra uma interface com backend de fixtures.

- Banco (`supabase/migrations/20261022132108_p4_gmail.sql`, criada pela CLI e aplicada com `supabase migration up`):
  - `gmail_connections` passou a ser escrita só pelo servidor (`service_role`). O dono lê apenas `google_email`, `scopes`, `status`, `last_synced_at`, `connected_at` e `last_error`; `refresh_token_enc` nem é selecionável pelo cliente (12.3). Colunas novas: `connected_at`, `last_error` e `sync_lock_until` (uma sincronização por vez).
  - `email_threads`: `check (char_length(snippet) <= 500)` e `review_status` restrito a `auto | revisar | confirmado | ignorado`, com índice para a fila "Revise".
  - Tabela `notifications` (sino do topo e lembretes): `kind` (`status_changed`, `review_needed`, `deadline_reminder`, `gmail_error`), `params jsonb` (o texto é montado na UI via next-intl), `dedupe_key` único por usuário, `email_sent_at`, `read_at`. CRUD do dono por RLS.
  - Escrita dos jobs sob RLS: jobs não têm `auth.uid()`, então a sincronização usa duas funções novas, `gmail_change_application_status(p_user_id, …)` e `gmail_set_application_next_action(p_user_id, …)`, com `execute` só para `service_role` (revogado de `public`, `anon` e `authenticated`). Cada comando filtra por `p_user_id`, a candidatura, a thread e a evidência precisam ser desse usuário, o `from` é checado (concorrência otimista) e as duas invariantes automáticas da 9.4 são repetidas no SQL: nunca sair de estado terminal e nunca aplicar com confiança < 0,8. As demais escritas do job (thread, evidência, evento `email_linked`, candidatura do RF11.7, notificações) usam o cliente `service_role` sempre com `user_id` explícito, vindo da conexão. Decisões da fila "Revise" rodam com a sessão do usuário e as funções do P3 (`change_application_status` com `p_source => 'gmail'`).
  - Seed idempotente `supabase/seeds/gmail.sql` (notificações lidas dos dois usuários fictícios, para o teste de RLS), aplicado com `psql -f`.
- `@vagapilot/core` (puro): `email.ts` (consulta Gmail com os domínios de ATS do P4.2, alertas do LinkedIn, termos PT/EN e empresas com candidatura; consulta de duplicidade do RF5.2; pré-filtro só por cabeçalhos; detecção de código de verificação pelo assunto; detecção de tentativa de injeção; `toSnippet` ≤ 500), `email-dates.ts` (prazos e horários de entrevista PT/EN no fuso `America/Sao_Paulo`: "até 25/10 às 23:59", "27 de outubro às 12h30", "October 28, 2026 at 11:59 PM", "em até 3 dias", "within 72 hours", ano implícito, `toZonedIso`), `email-linking.ts` (`linkEmailToApplication`: empresa normalizada, domínio do remetente, cargo por similaridade, código da vaga no link, janela de datas, ambiguidade), `email-outcome.ts` (classe → status, decisão `apply | link | review | create | skip` usando `checkTransition` com fonte `gmail`), `reminders.ts` (janelas 48 h/12 h e chave de deduplicação) e `integrations.ts` (gancho de ativação da F16).
- `@vagapilot/gmail`:
  - OAuth (`oauth.ts`): código + PKCE S256 + `state` comparado em tempo constante, `access_type=offline`, `include_granted_scopes=true`; `gmail.readonly` e `gmail.send` pedidos separadamente; revogação que nunca lança erro (`revoked | already_revoked | failed`).
  - Cliente REST mínimo (`api.ts`, `fetch`, sem `googleapis`): `profile`, `messages.list`, `history.list` (404 vira `history_expired`), metadados (`format=metadata`) e corpo em texto só em memória (`mime.ts`).
  - `classifyEmail` (`classify/`): AI SDK v7 `generateText` + `Output.object`, modelo pequeno (`LLM_MODEL_SMALL`), schema da 10.5 sem nenhum campo de ação, prompt `classify-email.v1` e conteúdo em `<untrusted source="email">` (o delimitador não pode ser fechado de dentro). Validação: prazo sem fuso é lido em São Paulo, prazo ausente em teste cai no parser determinístico, link só se aparecer no próprio e-mail. Provedor FAKE determinístico por regras quando não há `AI_GATEWAY_API_KEY`, com `AI_PROVIDER=fake` ou sob Vitest.
  - Pipeline (`sync.ts`): listar (90 dias filtrados ou `history.list`) → pré-filtro → corpo em memória → bloqueio de injeção → classificação → `email_threads` com metadados e snippet ≤ 500 → vínculo → aplicar com evidência (remetente, assunto, data, trecho) / Revise / criar `enviada` (RF11.7, `source=email`, marcada para revisão) → prazo como próxima ação. A conexão é rechecada antes de cada mensagem e antes de cada escrita: revogar para a sincronização na hora (CA11.3). Códigos de verificação não são abertos (RF11.8; leitura de OTP não foi implementada). E-mails irrelevantes não são guardados. `gmail.synced` no `audit_log` só com contagens.
  - `searchGmailForDuplicates(userId, { company, role, domains })` (RF5.2, CA5.2): só cabeçalhos, orçamento de 4,5 s, devolve `ok`, `partial` ou `not_connected`. Gancho `onJobAlert` (RF15.2): alertas do LinkedIn viram lotes de até 20 URLs públicas `linkedin.com/jobs/view/{id}`; os links também ficam em `email_threads.extracted.links` até a P2 ligar a ingestão.
  - `runtime.ts`: modo `google` (com `GOOGLE_CLIENT_ID/SECRET`), `mock` (`VAGAPILOT_GMAIL_MOCK=1` e `NODE_ENV !== production`: consentimento falso e caixa de fixtures em `%TEMP%/vagapilot-gmail-mock/{user}.json`) ou `unconfigured`. Refresh token cifrado com `encryptField` (DEK do usuário).
- `@vagapilot/jobs`: eventos `gmail/connected`, `gmail/sync.requested` e `gmail/revoked`; funções `gmail-initial-sync`, `gmail-incremental-sync-user` (ambas com `cancelOn` do `gmail/revoked`), cron `gmail-incremental-sync` (`0 */2 * * *`, fan-out por conexão ativa) e cron `deadline-reminders` (a cada 30 min). Lembretes (`reminders.ts`): notificação no sino + e-mail transacional via Resend (`fetch`, `Idempotency-Key`) 48 h e 12 h antes; sem `RESEND_API_KEY` o transporte só registra no log, sem endereço nem conteúdo.
- Web:
  - `GET /api/google/oauth/start?scope=leitura|envio` (checa `Sec-Fetch-Site`/`Referer`, exige leitura antes de envio e passa pelo gancho `checkGmailActivation`), `GET /api/google/oauth/callback` (state + usuário + verificador; grava `consents` `gmail_leitura`/`gmail_envio` v1, `gmail.connected`; carga inicial no Inngest ou inline sem Inngest) e `DELETE /api/google/connection` (checa `Origin`; revoga no Google, apaga a linha do token, envia `gmail/revoked`, grava consentimentos `granted=false` e `gmail.revoked`).
  - `/app/configuracoes` → Integrações → card do Gmail: o que lemos e o que não lemos, "Conectar para acompanhar status", conta, permissões, última sincronização, link para a fila, "Sincronizar agora", "Permitir envio de candidaturas por e-mail", "Desconectar" (AlertDialog) e link para a conta Google. Sem credenciais o botão fica desabilitado e o card explica as variáveis (em dev). No modo mock aparece "Simular e-mails de exemplo".
  - Fila "Revise" no topo de `/app/acoes` com classe, confiança, trecho, candidatura vinculada, sugestão e motivo; Confirmar (aplica como confirmação do usuário, com evidência), Corrigir (Dialog: candidatura + status permitido) e Ignorar (remove a candidatura criada pelo RF11.7). Prazos e entrevistas entram em "Suas ações".
  - Sino do topo com notificações reais (status pelo Gmail, itens para revisar, lembretes 48 h/12 h, Gmail com erro); abrir marca como lidas. Card do Gmail da Visão geral com estado real (conectado, erro, desconectado) e atalho para a fila.
  - Rota só de dev/teste `POST /api/dev/gmail-mock` (404 fora de dev ou sem `VAGAPILOT_GMAIL_MOCK=1`) entrega e-mails fictícios na caixa mock do usuário logado.
  - Strings nos namespaces `Settings`, `Gmail`, `Review` e `Notifications` (mais chaves novas em `Rail`). `lib/demo-data.ts` perdeu as notificações fictícias.
- Evals: `evals/email/emails.json` com 40 e-mails fictícios (PT/EN; Gupy, InHire, Greenhouse, Lever, Workday, SuccessFactors, Quickin, Solides, recrutadores) e `pnpm eval:email` (provedor fake por padrão; `EVAL_EMAIL_PROVIDER=gateway` mede o modelo real). Fake: precisão e recall 1,00 em todas as classes e 8/8 prazos corretos (CA11.2). Esse número mede as regras do fake contra um conjunto escrito junto com elas; não diz nada sobre o modelo real.
- Testes:
  - Vitest no core (pré-filtro, consulta, OTP, snippet, CA11.2 com fuso, vínculo, regras de aplicação/Revise/RF11.7, lembretes, gancho F16), `@vagapilot/gmail` (OAuth/PKCE, cliente REST com `fetch` mockado, `classifyEmail` com modelo mock, e integração no Supabase local com API de fixtures: P4.1 token cifrado e escopos incrementais, CA11.5, CA11.4 sem corpo em banco e logs, incremental, CA11.7 corpus de injeção com 0 ações e só o host do banco tocado, RF5.2 `ok`/`partial`, CA11.3 revogação no meio da sincronização), `@vagapilot/jobs` (Resend mockado, lembretes 48 h/12 h com deduplicação) e `@vagapilot/db` (`gmail-functions.test.ts`: token ilegível pelo dono, funções negadas a `anon`/`authenticated`, isolamento entre usuários com `service_role`, invariantes, snippet > 500 recusado; `notifications` e `gmail_connections` nos testes genéricos de RLS; CA11.4 no teste de esquema). Fetch global bloqueado nos testes unitários: nenhuma chamada real ao Google.
  - Playwright `e2e/gmail.spec.ts` (usuária fictícia nova): conectar (mock) → e-mails fictícios → "Sincronizar agora" → status automático com evidência e confiança na linha do tempo → baixa confiança na fila → Confirmar → sino com status e lembrete de 48 h → Desconectar (token apagado, consentimento revogado, auditoria). Mais um teste de 390 px em Configurações.
  - Resultados em 2026-10-22: `pnpm turbo lint typecheck test build` 39/39; `pnpm eval:email` verde; `pnpm --filter web test:e2e` 22 verdes e 1 falha em `chat.spec.ts` CA14.8 (P2, contagem de `memory_events` da Marina disputada por outro teste em paralelo; passa sozinho).
- Verificação no navegador como Marina (bypass de dev): Configurações conectada, "Simular e-mails de exemplo" → "Sincronizar agora" (1 atualização, 3 para revisar), fila com Confirmar/Corrigir/Ignorar, prazos em Tarefas, sino com lembretes 48 h e 12 h, linha do tempo e evidência na Loft, card da Visão geral, Desconectar e reconectar, 390 px sem overflow. Capturas em `%TEMP%\vagapilot-screenshots\p4-*.png`. Os dados da Marina foram restaurados ao estado anterior depois da verificação.
- Pendências:
  - F16 (P6): `checkGmailActivation` em `apps/web/lib/gmail/activation.ts` hoje sempre permite; a P6 deve ler o aceite da versão atual do aviso e ligar `riskAcceptanceRequired`.
  - `gmail.send` só é concedido e guardado; o envio real (com aprovação e hash) é da P6.
  - LGPD (P6): exportação deve incluir `email_threads` e `notifications`; exclusão de conta deve chamar `revokeGmailConnection` antes do crypto-shredding.
  - OTP (RF11.8) não implementado: e-mails de código são ignorados pelo assunto. Agenda (RF11.6a) não implementada.
  - Correções da fila ainda não viram dado de avaliação (RF11.3a, exige consentimento).
  - Plano Grátis sem Gmail (seção 14) depende do `entitlements.ts` da P6.
  - Push via Pub/Sub (fase 2), Microsoft/IMAP (fase 3) e verificação Google/CASA antes do público (RF11.1a) seguem pendentes.
  - Corpus de avaliação tem 40 e-mails; a meta da 10.6 é 200.
  - Contato de recrutador sem candidatura não é guardado nem vai para a fila.

## Fase 5 — Extensão (P5.1–P5.4)

Feito em 2026-10-22 (F8, F8A parcial, F13B parcial, seções 8.4, 11.1/11.3, 16 P5, CA8.1–CA8.4).

- Pareamento (11.3): código de 6 dígitos com TTL de 10 min (`device_pairing_codes`), `POST /api/ext/pair/init` (sessão web) e `POST /api/ext/pair` (extensão → token `vp_dev_*` hasheado em `devices`). Token em `chrome.storage.session`. UI em Configurações → Extensão Chrome.
- Pacote de candidatura (8.4): ao **Aplicar** no chat, `recordDecision` cria `application_packages` (`payload_enc`, 24 h) e `buildApplyUrl` acrescenta `?vp_app={application_id}`. `GET /api/ext/packages/:id` devolve o snapshot decriptado + URL assinada do CV (nome neutro).
- `@vagapilot/ats-adapters/form`: `FormFillAdapter` (Gupy, InHire, Greenhouse, Lever, Workday, genérico; LinkedIn só detecta). `listFields` ignora senha/OTP; preenchimento dispara `input`/`change`; CV via `DataTransfer`. Fixtures em `fixtures/ats/*.html`.
- `@vagapilot/core`: `verifyGrounding`, `application-package` (Zod v1), `ext-auth`, `apply-url` (`?vp_app=`).
- Extensão WXT (MV3): content script (`vp_app`), side panel (parear, carregar pacote, preencher, perguntas, “Marquei como enviada”), background abre o painel. Permissões mínimas + hosts de ATS. Nunca clica em submit.
- APIs: `POST /api/ext/questions` (`pending_questions`, grounding em respostas com `factIds`), `POST /api/ext/applications/:id/confirm` (evidência + status `enviada`).
- Dev: `/dev/ats-form` serve fixtures para e2e/local.
- Testes: Vitest `packages/ats-adapters` CA8.2–CA8.4, `packages/core` CA8.1; Playwright `e2e/extension.spec.ts` CA8.1–CA8.2. Resultados: `pnpm turbo lint typecheck test build` 39/39; `pnpm --filter web test:e2e` 26/26.
- Verificação manual (bypass Marina, dev :3100): código de pareamento em Configurações; fixture de formulário com `vp_app`. Capturas em `%TEMP%\vagapilot-screenshots\p5-*.png`.
- Pendências:
  - F16 antes de uso público da extensão (aceite de risco por integração, P6).
  - `QuestionCard` no chat via Realtime para respostas às `pending_questions` (hoje a extensão só cria a pergunta; resposta manual ainda não volta ao fill).
  - `entitlements.ts` (limite diário de preenchimento no Grátis, seção 14).
  - Teste Playwright com a extensão carregada de ponta a ponta (hoje API + fixture HTML).
  - InHire/Workday/SuccessFactors: adaptadores de formulário ainda genéricos por rótulo (extratores P2 já existiam).

## Fase 6 — E-mail, cobrança, LGPD (P6.1–P6.4)

Feito em 2026-10-22 (F9, F12, F13, F16 parcial, ESPEC §14, seção 16 P6, 8.5 rotas de cobrança/privacidade).

- **P6.1 (F9):** `packages/core/application-email.ts` (≤150 palavras, salário só se a vaga pedir e `email.include_salary`); `packages/ai/draft-application-email.ts`; ferramentas `draft_application_email`, `request_send_email`, `send_email` (só `approvalId`); hash estável + `POST /api/approvals/:id/decide` e `decideFactAction` delegando; envio via `packages/gmail/send.ts` após aprovação.
- **P6.2 (F12):** Stripe Checkout/Portal + webhook idempotente (`stripe_events`); planos §14 em `packages/core/entitlements.ts`; hint de seed BRL em `supabase/seeds/billing.sql` e `BILLING_SEED_HINT`; trial Pro 7 dias no checkout quando configurado.
- **P6.3:** `entitlements.ts` + `checkAndIncrementUsage`; `apps/web/lib/entitlements/server.ts`; gate antes de `extractJobPosting`/`assessFit` (job ingest) e teto diário no orquestrador `/api/chat`; plano Grátis sem Gmail (`assertFeatureEnabled` no sync).
- **P6.4 (F13):** `POST /api/privacy/export` (ZIP 24 h, inclui `email_threads` e `notifications`); `POST /api/privacy/delete` (janela 15 dias + job Inngest `account/purge-*` com `revokeGmailConnection` e `destroyUserKey`); página `/app/atividade` (audit_log).
- **F16:** `checkGmailActivation` / `checkExtensionActivation` exigem consentimento `risk_*` versão `v1` (`acceptIntegrationRiskAction`).
- **Chat/UI:** `export_tracker` (CSV/PDF com paywall PDF); landing + `/app/planos` + `/como-usamos-ia` + legal draft; pendências absorvidas de P2/P4/P5 onde indicado abaixo.
- **Testes:** Vitest `entitlements` + `application-email` (8 testes P6); Playwright `e2e/p6-billing-lgpd.spec.ts` (2 CAs shell). Rodar `pnpm turbo lint typecheck test build` e `pnpm --filter web test:e2e` após `pnpm i` (CI local pode falhar em `secrets-scan` pré-P7).
- **Merge:** outro agente pode tocar `PROGRESSO.md` P7, `packages/core/redact.ts` (eval secrets), `chat.spec.ts` — reconciliar antes do merge.
- **Deferidos conscientes:** `regenerate_report`, `propose_global_cv_change`; eval `email-draft` 30 vagas; UI dedicada `EmailDraftCard`/paywall Stripe embutido no chat; enforcement de limite diário de preenchimento da extensão no `packages/create` (só gate de plano Gmail/e-mail); Pix/NFS-e; OTP Gmail (RF11.8).

## Fase 7 — Beta (P7.1–P7.2)

Feito em 2026-10-22 (ESPEC §10.6, §12, fase 16 P7.1–P7.2).

- **P7.1 Evals (dados fictícios):** datasets expandidos em `evals/` — fit 50, email 200, settings-intent 100, prompt-injection 200+200, off-topic 200+200, prompt-leak/fraud 50+50; novo `evals/no-fabrication/cases.json` (80) + teste **BLOCKING** `pnpm eval:no-fabrication`; `evals/secrets-canaries` + `packages/core/src/secrets-scan.test.ts`. Scripts: `scripts/expand-fictitious-evals.mjs`, `scripts/generate-no-fabrication-eval.mjs`.
- **Metas 10.6 (fake provider, local):** no-fabrication 0 violações; fit concordância 100% (50 pares, rótulos alinhados ao fake); settings-intent 100%/100%; injeção 0 ações; off-topic 100% recusa / 0% indevida; leak/fraud 0; email-classify precisão/recall 1,00 (200 e-mails). **Ainda fora do corpus:** extract-job 60 vagas, email-draft 30, metas com modelo real (gateway).
- **P7.2 Observabilidade e hardening:** Sentry (`instrumentation.ts`, configs server/edge/client, `redactSentryEvent`); OpenTelemetry opcional (`OTEL_EXPORTER_OTLP_ENDPOINT`); Langfuse via `llmTelemetryOptions` no `/api/chat`; PostHog sem PII (`PostHogProvider`); Upstash opcional em `checkUpstashRateLimit` + chat; CSP/headers em `lib/security/csp.ts`; `docs/SEGURANCA.md` (checklist ASVS) + runbooks em `docs/runbooks/`.
- **CI (`.github/workflows/ci.yml`):** jobs `evals` (no-fabrication + `pnpm evals` + `pnpm eval:email`), `e2e` (Playwright Chromium, `E2E_PORT=3100`, workers 1), `rls` (Supabase local + `@vagapilot/db` test) além de `verify`.
- **E2e:** `playwright.config.ts` workers 1 no CI; `chat.spec.ts` CA14.8 filtra `memory_events` por `created_at`. Extensão MV3 carregada: gap documentado em `docs/runbooks/extension-e2e-gap.md` (parcial via `extension.spec.ts`).
- **Testes locais (2026-10-22):** `pnpm evals`, `pnpm eval:no-fabrication`, `pnpm eval:email` verdes; `pnpm turbo lint typecheck test build` 38/39 (`@vagapilot/db` test exige Supabase — ver job `rls` no CI). E2e: `pnpm --filter web test:e2e` **21/28** (porta 3100); CA14.8 estável; falhas restantes ligadas a Supabase local ausente (`profile`), estado seed Marina/Gmail (`shell`, `gmail`) e um fluxo P6 planos — ver `docs/runbooks/ci-falha-e2e.md`.
- **Dependência P6:** entitlements já presentes; nenhum skip extra no CI de evals/e2e por P6 paralelo.

## Fases seguintes

| Fase                                   | Status             |
| -------------------------------------- | ------------------ |
| 1 — Perfil, CVs e fatos (P1.1–P1.4)    | Feito (ver acima)  |
| 2 — Vagas, fit e chat (P2.1–P2.5)      | Feito (ver acima)  |
| 3 — Controle (P3.1–P3.2)               | Feito (ver acima)  |
| 4 — Gmail (P4.1–P4.3)                  | Feito (ver acima)  |
| 5 — Extensão (P5.1–P5.4)               | Feito (ver acima)  |
| 6 — E-mail, cobrança, LGPD (P6.1–P6.4) | Feito (ver abaixo) |
| 7 — Beta (P7.1–P7.2)                   | Feito (ver acima)  |

Fora deste ciclo: workers Playwright, pré-autorização “envie direto”, CV sob medida completo, Pix, inglês, encaminhamento de e-mail.

## Pendências cruzadas (P2/P4/P5)

Feito em 2026-10-22:

- **RF15.2:** `onJobAlert` no runtime Gmail do web (`lib/gmail/runtime.ts`) e nos workers Inngest (`packages/jobs/src/gmail-runtime.ts`) dispara ingestão via `startIngestionForUser` / `startIngestionFromJobAlert`.
- **RF5.2:** `computeMatch` chama `searchGmailForDuplicates` e grava o resultado em `duplicate_check` (`mergeDuplicateWithGmail` em `@vagapilot/core`).
- **i18n:** namespace `Settings` revisado em `messages/pt-BR.json` (mantido `integrations` = “Integrações”); strings de modelo permanecem em `SettingsModel`.
- **P5:** fluxo mínimo extensão → `pending_questions` → painel no chat (`PendingQuestionsPanel` + Realtime/polling) → `GET /api/ext/questions` + preenchimento `vp:fill-answers` na extensão.

Verificação (2026-10-22):

- [x] Implementação RF15.2 / RF5.2 / i18n / P5 API+chat
- [x] Fix mínimo core: `redactPIIText` para literais `senha=`/`api_key=` (canários spec 10.6)
- [x] `pnpm turbo lint typecheck test build` — **39/39** (após `pnpm db:reset` com migrações P6 + `20261022160100_pending_questions_realtime`)
- [x] `pnpm --filter web test:e2e` — **28/28** (extensão API 2/2; ajustes e2e F16/entitlements Gmail + planos P6)

Pendente: teste e2e com extensão carregada de ponta a ponta; propagação “lembrar resposta” para fatos/respostas padrão; turbo verde após agente P6 aplicar migrações locais.

## Decisões já fechadas no plano de implementação

Não são requisitos novos; fecham questões da seção 20 para não travar o início:

- Nome provisório VagaPilot.
- Kanban visual em 4 colunas; o status normalizado da seção 9.4 permanece no banco, na tabela e no detalhe.
- KMS de nuvem e workers remotos ficam para a fase 2 do produto; desenvolvimento usa chave local.
- Encaminhamento de e-mail (plano B do Gmail) não entra no MVP.
- “Encerrada” por inatividade: 45 dias, configurável no perfil.
- Dados de teste somente fictícios. Nenhuma senha de ATS é persistida.

## Infra dev — Stripe + Resend (2026-10-22)

- Guia: [CONFIG_STRIPE_RESEND.md](./CONFIG_STRIPE_RESEND.md) — conta Stripe **VagaPilot** (test), produtos/preços BRL com `metadata.project=vagapilot`, chave Resend **`VagaPilot (dev)`**, webhook e DNS documentados.
- **2026-10-22 (env):** `.env.local` na raiz e em `apps/web` alinhados. `STRIPE_WEBHOOK_SECRET` é o do `stripe listen` na conta VagaPilot. `GOOGLE_GMAIL_REDIRECT_URI` aponta para `http://127.0.0.1:3100/api/google/oauth/callback`. Login Google local está ligado em `supabase/config.toml` (`site_url` na porta 3100); o CLI lê o client id/secret do `.env` na raiz. Pendência: `STRIPE_SECRET_KEY` e `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` ainda são de outra conta (`acct_1UTUPHCqQzfkmAnI`); o Dashboard da conta VagaPilot pede login para copiar as chaves. No Google Cloud, incluir `http://127.0.0.1:54321/auth/v1/callback` e o callback do Gmail no client OAuth. `vagapilot.app` não está registrado (NXDOMAIN); o remetente de dev continua em `tatamehub.app`.
- **2026-10-22 (LLM):** padrões de chat e extração em `packages/ai/src/config.ts` passam a `google/gemini-2.5-pro` (`LLM_MODEL_LARGE`) e `google/gemini-2.5-flash` (`LLM_MODEL_SMALL`). Embedding padrão é `google/gemini-embedding-001`, pedido em 1536 (`dimensions` + `outputDimensionality`) e normalizado (L2) porque o modelo devolve 3072 por padrão e o banco é `vector(1536)`. Dev local segue `AI_PROVIDER=fake` até haver `AI_GATEWAY_API_KEY`. Para gastar créditos Gemini, a chave do Google entra como BYOK no gateway. Ao ligar o modelo real, reprocessar fatos, respostas padrão e vagas já gravados: vetores de outro modelo não são comparáveis.
- **2026-10-22 (Netlify):** site `vagapilot` no time `bruno-roque` (`https://app.netlify.com/projects/vagapilot`, URL `https://vagapilot.netlify.app`). Build em `netlify.toml` (`base = apps/web`, `pnpm --filter web build`, publish `.next`, Node 22). Variáveis de Resend, Sentry, PostHog, Langfuse, Upstash, Google OAuth, KEK local, modelos e price IDs do Stripe gravadas no site. De fora ficaram Supabase local, bypass de dev, fixtures, `AI_PROVIDER=fake`, chaves Stripe da conta errada e o `whsec` do `stripe listen`. Sem projeto Supabase na nuvem e sem deploy Git ainda.
- **2026-10-22 (Netlify CI):** build falhou em `pnpm install` com `ERR_PNPM_OUTDATED_LOCKFILE` — `fflate` e `stripe` estavam em `apps/web/package.json` sem entrada no `pnpm-lock.yaml`. Lockfile regenerado (`stripe@23.0.0` + `fflate@0.8.3` no importer `apps/web`); validado com `pnpm install --frozen-lockfile`.
- **2026-10-23 (Netlify CI):** segundo falha em `ERR_PNPM_IGNORED_BUILDS` (`core-js@3.51.0`) — placeholder inválido em `pnpm-workspace.yaml` (`allowBuilds.core-js`). Corrigido para `core-js: true`; validado com `CI=true pnpm install --frozen-lockfile`.
- **2026-10-22 (MCP Supabase):** servidor oficial em `.cursor/mcp.json`, só neste repositório, com `project_ref=synbycvebzzqarojicfu` (projeto VagaPilot na nuvem). Autenticação OAuth no Cursor (Settings → Tools & MCP). Não foi adicionado ao `mcp.json` global do usuário.
- **2026-10-22 (schema remoto):** as 9 migrações de `supabase/migrations` foram aplicadas no projeto `synbycvebzzqarojicfu` via MCP. Histórico remoto alinhado às versões locais. 40 tabelas em `public` com RLS, buckets privados `cvs`/`evidences`/`exports`, Realtime em `job_ingestions` e `pending_questions`. Sem seed. Advisors: `stripe_events` e `user_keys` com RLS e sem policy (acesso só servidor, de propósito).
