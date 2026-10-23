# FASE F — Ideias inspiradas no AIApply (6 tarefas)

Fonte: comparação já feita com a central de ajuda do AIApply (support.aiapply.co): modos de candidatura automática/revisão, biblioteca de respostas, carta de apresentação, simulado de entrevista e busca de vagas. Nada aqui reduz as regras de paridade: approval por vaga (DA-01), sem invenção de fatos e sem envio sem OK continuam valendo, **exceto** onde F1 cria um modo automático explícito, ligado pelo próprio usuário e com limites.
Pré-requisito: Fases A–E concluídas.

---

## F1. Modos de envio: revisão (padrão), híbrido e automático, com limite diário

**Objetivo:** o usuário escolhe pelo chat quanto o app pode enviar sem perguntar.

**Comportamento**

- `revisao` (padrão, igual ao Bot): sempre card de decisão + OK no resumo.
- `hibrido`: pula o card de decisão quando todas as condições automáticas valem, mas **sempre** para no resumo (OK antes de enviar).
- `automatico`: envia sem OK só quando **todas** as condições valem; senão volta para `revisao` naquela vaga.
- Condições automáticas: fit `alto`; sem alerta de duplicidade, histórico recente da empresa (C2) ou limite de ATS; nenhuma pergunta de experiência pendente (D2) e nenhum teste de conhecimento (D4); fonte **não** é de perfil único (Gupy, Catho, Empregos, Indeed); dentro do limite diário; vaga aberta (C8).

**Arquivos:** criar `packages/core/src/submit-mode.ts`, `apps/web/lib/settings/submit-mode.ts`, `packages/ui/src/chat/SubmitModeCard.tsx`; alterar `apps/web/lib/chat/tools.ts`, `apps/web/lib/approvals/submit.ts` (D9), `/app/configuracoes`; migração `<ts>_f1_submit_mode.sql`.

**Contratos**

```ts
export const SubmitMode = z.enum(["revisao", "hibrido", "automatico"])
export const SubmitModeSettings = z.object({
  mode: SubmitMode.default("revisao"),
  dailyLimit: z.number().int().min(1).max(50).default(5),
  sinceDate: z.string().datetime(),
})
export type AutoBlock =
  | "fit_nao_alto"
  | "duplicidade"
  | "historico_empresa"
  | "limite_ats"
  | "pergunta_pendente"
  | "teste_conhecimento"
  | "perfil_unico"
  | "limite_diario"
  | "vaga_fechada"
export function canAutoSubmit(i: {
  mode: SubmitMode
  fit: FitLevel
  alerts: Alert[]
  pendingQuestions: number
  hasQuiz: boolean
  source: string
  sentToday: number
  dailyLimit: number
  liveness: Liveness
}): { ok: true } | { ok: false; reasons: AutoBlock[] }
// tools: set_submit_mode({ mode, dailyLimit? }) — confirmação por card (clique); get_submit_mode()
```

```sql
alter table public.approvals add column kind text not null default 'manual' check (kind in ('manual','envie_direto','automatico'));
create table public.submit_mode_log (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, mode text not null, daily_limit int not null, changed_via text not null check (changed_via in ('chat','tela')), created_at timestamptz not null default now());
-- user_settings.submit_mode jsonb (SubmitModeSettings)
```

- Mensagens: `settings_change` ("Modo automático ligado, limite 5/dia"); em vaga bloqueada para o automático, o texto é "Não enviei sozinho porque: <motivos>" seguido do card normal.

**Regras:** o modo automático só liga por clique num card que lista as condições (o LLM não liga sozinho); a approval `automatico` é criada pelo servidor (nunca pelo LLM) e ainda exige tela de sucesso + screenshot; o limite conta envios do dia em America/Sao_Paulo; "pare tudo" no chat volta para `revisao` na hora.
**Casos de borda:** limite atingido no meio de um lote ⇒ o resto fica em `aguardando_decisao`; fit muda depois de regenerar o CV ⇒ recalcula antes de enviar; vaga Gupy com fit alto ⇒ nunca automático; o usuário muda o limite para 0 ⇒ inválido, sugerir `revisao`.
**Aceite**

- Dado modo `automatico`, limite 2, e 3 vagas fit alto sem alertas no LinkedIn, Então 2 são enviadas com evidência e a 3ª fica "Aguardando decisão" com motivo `limite_diario`.
- Dado modo `automatico` e vaga Gupy fit alto, Então segue o fluxo de revisão com motivo `perfil_unico`.
- Dado modo `hibrido`, Então nunca há envio sem OK no resumo.
- Dado "volta para revisão" no chat, Então o modo muda e aparece `settings_change`.
  **Testes:** `submit-mode.test.ts` (tabela com todas as combinações de bloqueio), `no-auto-submit-on-single-profile.test.ts`, e2e `auto-mode.spec.ts`.

---

## F2. Biblioteca de respostas e fatos confirmados

**Objetivo:** uma tela (e o chat) para ver, editar e desfazer tudo que o app sabe responder; a extensão consulta antes de pausar.

**Arquivos:** criar `apps/web/app/app/respostas/page.tsx`, `apps/web/lib/answers/library.ts`, `packages/ui/src/answers/AnswerRow.tsx`; alterar `apps/extension/lib/autofill.ts` (consulta à biblioteca antes de `perguntar`), `apps/web/app/api/extension/answers/lookup/route.ts`, `apps/web/lib/chat/tools.ts`; migração `<ts>_f2_answer_usage.sql`.

**Contratos**

```ts
type LibraryItem = {
  id: string
  type: "fato" | "resposta_padrao"
  questionKey: string | null
  question: string
  answer: string
  origin: "cv" | "usuario" | "chat" | "tela" | "extensao"
  createdAt: string
  updatedAt: string
  usedIn: { applicationId: string; company: string; at: string }[]
}
export const LookupInput = z.object({
  runId: z.string().uuid(),
  questions: z.array(z.object({ fieldId: z.string(), label: z.string() })),
})
type LookupOutput = {
  hits: { fieldId: string; itemId: string; answer: string; score: number }[]
  misses: string[]
}
// tools: list_answers({ q?, type? }), edit_answer({ id, answer }), undo_change (já existe)
```

```sql
create table public.answer_usage (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, item_type text not null check (item_type in ('fact','standard_answer')), item_id uuid not null, application_id uuid not null references public.applications(id) on delete cascade, run_id uuid references public.application_runs(id) on delete set null, used_at timestamptz not null default now());
create index on public.answer_usage(user_id, item_id);
-- RLS dono
```

**Regras:** a lista mostra só itens confirmados; editar cria versão nova (histórico) e emite `domain_events`; desfazer volta à versão anterior; lookup por `questionKey` exato e, se não houver, similaridade ≥ 0,85 (pgvector); abaixo disso ⇒ pergunta (D2). Documentos aparecem mascarados (D6); segredos nunca aparecem.
**Casos de borda:** edição de resposta já usada em candidatura enviada ⇒ aviso "usada em N candidaturas; não muda o que já foi enviado"; dois itens conflitantes para a mesma chave ⇒ marcar conflito e perguntar; muitas linhas ⇒ paginação e busca.
**Aceite**

- Dado resposta "Disponibilidade: imediata" usada em 2 candidaturas, Então a tela mostra pergunta, resposta, origem, data e as 2 candidaturas.
- Dado "muda minha disponibilidade para 30 dias" no chat, Então a tela atualiza em ≤ 2 s e "desfazer" restaura.
- Dado pergunta parecida numa vaga nova, Então a extensão preenche pela biblioteca sem pausar.
  **Testes:** `library.test.ts`, `lookup.test.ts`, `answer-usage.rls.test.ts`, e2e `respostas.spec.ts`.

---

## F3. Carta de apresentação por vaga (PT/EN)

**Objetivo:** carta curta, só com fatos confirmados, prévia no chat, nunca anexada sem OK.

**Arquivos:** criar `packages/ai/src/cover-letter.ts`, `packages/ai/src/prompts/cover-letter.md`, `apps/web/lib/cover-letter/render.tsx` (`@react-pdf/renderer`), `packages/ui/src/chat/CoverLetterCard.tsx`; alterar `field-policy.ts` (campo "carta"/"cover letter" ⇒ `perguntar` se não houver carta aprovada); migração `cover_letters`.

**Contratos**

```ts
export const CoverLetter = z.object({
  applicationId: z.string().uuid(),
  language: z.enum(["pt-BR", "en"]),
  paragraphs: z
    .array(z.object({ text: z.string(), factIds: z.array(z.string().uuid()) }))
    .min(2)
    .max(4),
  wordCount: z.number().int().max(350),
})
// tools: draft_cover_letter({ applicationId }), approve_cover_letter({ coverLetterId }) (clique)
// arquivo: <Nome>_Carta_<Empresa>[_EN].pdf (E6)
```

```sql
create table public.cover_letters (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, application_id uuid not null references public.applications(id) on delete cascade, language text not null, content jsonb not null, status text not null default 'rascunho' check (status in ('rascunho','aprovada','descartada')), file_path text, created_at timestamptz not null default now());
```

**Regras:** idioma da vaga (mesma regra de C5, inclusive perfil único em PT); todo parágrafo com `factIds` (exceto saudação/fecho); a prévia aparece no chat; anexar ou colar no formulário só com status `aprovada`; entra no resumo do D9.
**Casos de borda:** campo de carta obrigatório e usuário não aprova ⇒ run pausa (`pergunta`); vaga sem descrição ⇒ carta genérica marcada como tal; limite de caracteres do campo ⇒ versão curta.
**Aceite:** Dado vaga em inglês no LinkedIn, Quando peço carta, Então prévia EN com ≤ 350 palavras e todos os parágrafos de conteúdo com `factIds`; Dado carta em rascunho, Então a extensão não anexa.
**Testes:** `cover-letter.eval.ts` (grounding + idioma), `cover-letter-gate.test.ts`, `naming.test.ts`.

---

## F4. Simulado de entrevista: perguntas em texto, respostas por áudio, feedback de conteúdo, fluência e prosódia

**Objetivo:** treino disparado por convite no Gmail. Perguntas em texto no chat; o usuário responde por **áudio** (gravador no composer, ou upload de arquivo) ou por texto. Não é assistente ao vivo durante a entrevista real.

### F4.1 Fluxo

1. E1 concilia um e-mail `entrevista` ⇒ o chat oferece "Quer fazer um simulado?".
2. Pergunta de consentimento (card) com dois opt-ins **separados**: (a) gravar e guardar áudio; (b) análise de voz/prosódia (dado biométrico/sensível). Sem (a), o usuário responde por texto; sem (b), não há análise de prosódia.
3. Opcional, na primeira vez com (b): **linha de base**. O usuário lê um parágrafo neutro (30–45 s) e responde a uma pergunta fácil ("fale do seu dia"). Isso calibra os indicadores.
4. Banco de 6–10 perguntas: da vaga (requisitos), das lacunas (requisitos sem fato) e da empresa. Uma por vez, no idioma da vaga.
5. Para cada pergunta: grava (ou faz upload) ⇒ upload ⇒ transcrição (STT) ⇒ a **transcrição aparece para o usuário corrigir** ⇒ confirmação ⇒ feedback de conteúdo + fluência (+ prosódia, se houver opt-in).
6. No fim: nota por resposta e do simulado, dicas práticas e comparação com simulados anteriores. Tudo fica salvo na candidatura.

### F4.2 STT (pesquisado em 22/10/2026)

| Opção                   | pt-BR / en    | Observações                                                                                                                                                                        |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI `gpt-transcribe` | sim           | Recomendado pela OpenAI; arquivo ≤ 25 MB; mp3/mp4/m4a/wav/webm. `whisper-1`, `gpt-4o-transcribe` e `gpt-4o-mini-transcribe` estão **depreciados**, com desligamento em 26/02/2027. |
| Deepgram `nova-3`       | `pt-BR`, `en` | Timestamps por palavra (bom para palavras por minuto e pausas); a identificação de "éé/hum" é documentada como ponto do `nova-2`.                                                  |
| Google Vertex `chirp_3` | sim           | Também disponível pelo AI SDK.                                                                                                                                                     |
| AI SDK `transcribe()`   | —             | Uma só interface para OpenAI, Deepgram, Google, Groq e outros; retorna `text`, `segments`, `language`, `durationInSeconds`.                                                        |

**Recomendação:** usar o `transcribe()` do AI SDK (já é a stack) com o provedor configurável `STT_PROVIDER`. Padrão: **Deepgram `nova-3`** com `language` igual ao idioma da vaga, `smart_format` e timestamps por palavra. Alternativa: OpenAI `gpt-transcribe`. Vícios de linguagem são contados sobre a transcrição bruta (antes de o usuário corrigir), com lista de preenchimentos por idioma.

### F4.3 Prosódia (nervosismo, confiança, clareza)

Features por resposta: F0 (pitch) média e desvio, jitter e shimmer (voz trêmula), energia/volume (RMS) e variação, taxa de fala (palavras/min e sílabas/s), pausas (quantidade, duração média, maior pausa), hesitações e preenchimentos ("éé", "tipo", "né", "um", "uh", "like"), e latência até começar a falar.

| Opção                                                                | Custo                                | Privacidade             | pt-BR                          | Licença / estado                                                             |
| -------------------------------------------------------------------- | ------------------------------------ | ----------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| openSMILE / eGeMAPS                                                  | grátis para pesquisa                 | local                   | independe de idioma            | Licença de pesquisa da audEERING: **uso em produto exige licença comercial** |
| Praat via `parselmouth` + `librosa` (+ VAD `silero-vad`/`webrtcvad`) | grátis                               | local, o áudio não sai  | independe de idioma (acústico) | parselmouth GPL-3 (uso como serviço interno, sem distribuir), librosa ISC    |
| Hume AI Expression Measurement (prosody)                             | ~US$0,025/min (último preço público) | áudio vai para terceiro | sim                            | **Desligada em 14/06/2026**; página de preços removida em out/2026           |
| audEERING devAIce (comercial)                                        | sob consulta                         | SDK local ou nuvem      | sim                            | Alternativa paga se um dia precisar de modelo validado                       |

**Recomendação:** um microserviço Python próprio (`services/voice-analysis`, FastAPI) com **parselmouth + librosa + silero-vad**, rodando local ou num container privado. Custo zero por minuto, o áudio não sai da infraestrutura, e as medidas acústicas não dependem de idioma (palavras/min e preenchimentos vêm da transcrição). Os indicadores vêm de regras transparentes (z-score contra a linha de base do usuário), não de modelo de emoção.

**Indicadores (0–100), por resposta e por simulado**

- **Nervosismo** ↑ com: jitter/shimmer acima da base, F0 média acima da base, palavras/min muito acima ou abaixo, muitas pausas curtas, muitos preenchimentos, latência longa.
- **Confiança** ↑ com: energia estável, F0 com variação moderada (sem monotonia), pausas deliberadas (0,5–1,5 s) em vez de hesitações, poucos preenchimentos, frases terminando sem queda de energia.
- **Clareza** ↑ com: palavras/min entre 120 e 160 (PT/EN, ajustável), confiança média do STT, poucas palavras cortadas, estrutura STAR detectada no texto.
- Pesos ficam em `voice-weights.json`, versionados, e são todos explicados na tela.
- **Sem linha de base:** usar faixas populacionais e marcar "baixa confiança".

**Avisos obrigatórios na UI:** "Estimativa para treino, não é diagnóstico nem avaliação psicológica." Os indicadores são relativos à **sua** linha de base. Prosódia é dado biométrico/sensível (LGPD art. 5º, II e art. 11): exige opt-in explícito e separado, pode ser revogado e apagado a qualquer momento, e nunca é usado para outra finalidade nem compartilhado.

### F4.4 Arquitetura

```
composer (MediaRecorder webm/opus, ou upload) ──▶ Supabase Storage bucket privado `interview-audio/{user}/{session}/{q}.webm`
  ──▶ Inngest `interview/answer.uploaded`
        ├─ step STT (AI SDK transcribe) → transcript_raw + word timestamps
        ├─ step prosody (se opt-in b) → POST services/voice-analysis /analyze (URL assinada 5 min) → features + segmentos marcados
        └─ chat: part `transcript_review` (usuário corrige) ──▶ `interview/answer.confirmed`
              └─ step feedback (LLM: conteúdo + fluência; recebe features numéricas, nunca o áudio) → feedback
```

- Microserviço: sem estado e sem gravar em disco (arquivo temporário apagado). Autenticação por segredo de serviço. Timeout de 60 s.
- Limites: até 3 min por resposta, até 10 MB por arquivo (webm/opus ~32 kbps cabe com folga; também fica abaixo dos 25 MB da OpenAI), formatos webm/ogg/m4a/mp3/wav, até 10 perguntas por simulado e até 3 simulados por candidatura por dia.

### F4.5 Arquivos

- Criar:
  - `apps/web/components/chat/audio-recorder.tsx`
  - `apps/web/app/api/interview/audio/route.ts`
  - `packages/ai/src/interview/{question-bank.ts,feedback.ts,fillers.ts,fluency.ts}`
  - `packages/jobs/src/functions/interview-answer.ts`
  - `packages/ui/src/chat/{InterviewQuestionCard,TranscriptReviewCard,InterviewFeedbackCard,VoiceConsentCard,ProgressChart}.tsx`
  - `apps/web/app/app/candidaturas/[id]/simulados/page.tsx`
  - `services/voice-analysis/{app.py,features.py,scoring.py,voice-weights.json,requirements.txt,Dockerfile,tests/}`
  - migração `<ts>_f4_interview.sql`
- Alterar:
  - `apps/web/components/chat/chat-view.tsx` (gravador no composer)
  - `packages/ai/src/chat/parts.ts` (novas parts)
  - `apps/web/lib/chat/tools.ts`
  - `packages/gmail/src/reconcile.ts` (gatilho)
  - página de privacidade/configurações (consentimentos e exclusão)

### F4.6 Contratos

```ts
export const InterviewSession = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  language: z.enum(["pt-BR", "en"]),
  isBaseline: z.boolean(),
  status: z.enum(["aberta", "concluida", "cancelada"]),
})
export const InterviewQuestion = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  order: z.number().int(),
  text: z.string(),
  source: z.enum(["vaga", "lacuna", "empresa", "baseline"]),
  requirement: z.string().optional(),
})
export const AudioUpload = z.object({
  questionId: z.string().uuid(),
  mime: z.enum([
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
  ]),
  bytes: z
    .number()
    .int()
    .max(10 * 1024 * 1024),
  durationSec: z.number().max(180),
})
export const Transcript = z.object({
  raw: z.string(),
  edited: z.string().nullable(),
  language: z.string(),
  words: z.array(
    z.object({
      w: z.string(),
      start: z.number(),
      end: z.number(),
      conf: z.number().optional(),
    })
  ),
  sttProvider: z.string(),
  sttModel: z.string(),
})
export const FluencyMetrics = z.object({
  durationSec: z.number(),
  wpm: z.number(),
  fillers: z.array(z.object({ token: z.string(), count: z.number().int() })),
  pauses: z.object({
    count: z.number().int(),
    meanSec: z.number(),
    maxSec: z.number(),
  }),
  latencySec: z.number(),
})
export const ProsodyFeatures = z.object({
  f0Mean: z.number(),
  f0Std: z.number(),
  jitterLocal: z.number(),
  shimmerLocal: z.number(),
  rmsMean: z.number(),
  rmsStd: z.number(),
  voicedRatio: z.number(),
  syllablesPerSec: z.number(),
})
export const MarkedSegment = z.object({
  startSec: z.number(),
  endSec: z.number(),
  kind: z.enum([
    "hesitacao",
    "pausa_longa",
    "preenchimento",
    "voz_tremula",
    "volume_baixo",
    "ritmo_acelerado",
  ]),
  note: z.string(),
})
export const VoiceScores = z.object({
  nervosismo: z.number().min(0).max(100),
  confianca: z.number().min(0).max(100),
  clareza: z.number().min(0).max(100),
  baselineUsed: z.boolean(),
  lowConfidence: z.boolean(),
  weightsVersion: z.string(),
})
export const ContentFeedback = z.object({
  clareza: z.number().min(0).max(100),
  star: z.object({
    situation: z.boolean(),
    task: z.boolean(),
    action: z.boolean(),
    result: z.boolean(),
  }),
  aderenciaVaga: z.number().min(0).max(100),
  claimsNotInFacts: z.array(z.string()),
  tips: z.array(z.string()).max(5),
  betterVersion: z.string(),
  language: z.enum(["pt-BR", "en"]),
})
// Microserviço: POST /analyze { audioUrl, words?, baseline?: ProsodyFeatures } → { features: ProsodyFeatures, fluency: FluencyMetrics, segments: MarkedSegment[], scores: VoiceScores }
// tools: start_mock_interview({ applicationId }), submit_text_answer({ questionId, text }), confirm_transcript({ answerId, edited }), set_voice_consent({ audio: boolean, prosody: boolean }) (clique), delete_interview_audio({ sessionId | answerId | "all" })
// parts novas: interview_question, transcript_review, interview_feedback, voice_consent
```

```sql
create table public.voice_consents (user_id uuid primary key references auth.users(id) on delete cascade, audio_storage boolean not null default false, prosody_analysis boolean not null default false, text_version text not null, granted_at timestamptz, revoked_at timestamptz);
create table public.interview_sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, application_id uuid references public.applications(id) on delete cascade, language text not null, is_baseline boolean not null default false, status text not null default 'aberta', summary jsonb, created_at timestamptz not null default now());
create table public.interview_answers (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, session_id uuid not null references public.interview_sessions(id) on delete cascade, question jsonb not null,
  mode text not null check (mode in ('audio','texto')), audio_path text, audio_deleted_at timestamptz, transcript jsonb, fluency jsonb, prosody jsonb, segments jsonb, voice_scores jsonb, content_feedback jsonb, created_at timestamptz not null default now());
create table public.voice_baselines (user_id uuid not null references auth.users(id) on delete cascade, language text not null, features jsonb not null, created_at timestamptz not null default now(), primary key (user_id, language));
-- RLS dono em todas; bucket `interview-audio` privado, policy por prefixo {auth.uid()}/
```

### F4.7 Regras de negócio

- O feedback de conteúdo usa **só fatos confirmados**. Afirmação da resposta sem fato vai para `claimsNotInFacts` com a dica "não diga isso se não for verdade, ou confirme como fato". A versão melhorada nunca inventa nada.
- O feedback sai no idioma da vaga.
- Fluência: faixa-alvo de 120–160 palavras/min; resposta de comportamento ideal entre 60 e 120 s; preenchimentos acima de 3 por minuto ⇒ dica.
- A análise de prosódia só roda com o opt-in (b) ativo **no momento** do processamento. Revogar o consentimento apaga `prosody`, `voice_scores`, `segments` e `voice_baselines`.
- Apagar o áudio a qualquer momento (por resposta, por simulado ou tudo) zera o arquivo no Storage e seta `audio_deleted_at`. A transcrição e o feedback ficam, a menos que o usuário peça para apagar tudo.
- Retenção padrão do áudio: 90 dias, depois apagado por job.
- A evolução entre simulados compara as médias de nervosismo, confiança, clareza, palavras/min e preenchimentos (gráfico na página de simulados).

### F4.8 Casos de borda

- **Áudio vazio/silêncio** (`voicedRatio < 0,1` ou transcrição vazia) ⇒ "Não ouvi nada; grave de novo", sem feedback e sem custo de LLM.
- **Ruído alto** (SNR estimado < 10 dB ou confiança média do STT < 0,6) ⇒ transcrição marcada "baixa qualidade"; a prosódia não é calculada e aparece "ambiente ruidoso".
- **Idioma trocado** (STT detecta `en` numa vaga PT, ou o contrário) ⇒ perguntar "Quer treinar em inglês?". Se não, o feedback diz que respondeu no idioma errado.
- **Áudio acima de 3 min ou 10 MB** ⇒ bloqueado no cliente; upload maior é recusado no servidor com mensagem.
- **Formato não suportado** ⇒ recusar.
- **Permissão de microfone negada** ⇒ mostrar o upload e o texto.
- **Usuário corrige muito a transcrição** (> 40% de diferença) ⇒ a fluência usa a transcrição bruta e avisa.
- **Voz de outra pessoa / várias vozes** ⇒ avisar e não pontuar a prosódia.
- **Microserviço fora do ar** ⇒ entrega o feedback de conteúdo e fluência, com a prosódia "indisponível".
- **Sem linha de base** ⇒ `lowConfidence=true`.

### F4.9 Aceite

- Dado e-mail fictício de entrevista conciliado, Então o chat oferece o simulado e mostra os 2 consentimentos separados.
- Dado consentimento só de áudio, Quando gravo 60 s, Então vejo a transcrição para corrigir e, depois, o feedback de conteúdo + fluência, **sem** indicadores de voz.
- Dado os dois consentimentos e uma linha de base, Quando respondo, Então vejo nervosismo/confiança/clareza 0–100, trechos marcados com tempo e o aviso "estimativa para treino".
- Dado "apague meus áudios", Então os objetos somem do bucket e `audio_deleted_at` é preenchido. A transcrição permanece.
- Dado a revogação da análise de voz, Então `voice_baselines` e os indicadores são apagados.
- Dado uma resposta citando uma certificação que não existe nos fatos, Então ela aparece em `claimsNotInFacts`.
- Dado resposta por texto, Então o feedback de conteúdo funciona igual (sem fluência/prosódia).

### F4.10 Testes

- `fillers.test.ts` (PT/EN), `fluency.test.ts` (timestamps de fixture), `feedback.eval.ts` (grounding, STAR, idioma).
- `consent.rls.test.ts`, `delete-audio.test.ts`, `audio-upload.route.test.ts` (limites/MIME).
- `services/voice-analysis/tests/test_features.py`: senoide de F0 conhecida ⇒ f0Mean ±2 Hz; silêncio ⇒ voicedRatio≈0; ruído branco ⇒ flag de ruído.
- `test_scoring.py`: monotonicidade (mais preenchimentos ⇒ nervosismo não diminui).
- e2e `mock-interview.spec.ts` com áudio fictício gravado por TTS (sem voz real).

---

## F5. Busca de vagas pelo chat (sob demanda) + agendamento opcional

**Objetivo:** **paridade**: o Bot faz busca ativa quando o usuário pede no chat (ex.: "busca vagas de Engineering Manager remoto"). O agendamento diário/semanal das buscas salvas é **opcional**, desligado por padrão e ligado pelo chat. **PB:** 56 (confirmado pelo Bruno).

**Arquivos:** criar `packages/ats-adapters/src/search/{types.ts,linkedin-guest.ts,gupy.ts,greenhouse.ts,lever.ts}`, `packages/core/src/search-filter.ts`, `apps/web/lib/search/run-search.ts`, `packages/jobs/src/functions/saved-search-schedule.ts`, `packages/ui/src/chat/SearchResultsCard.tsx`; alterar `apps/web/lib/chat/tools.ts`; migração `<ts>_f5_search.sql`.

**Contratos**

```ts
export const SearchQuery = z.object({
  text: z.string().min(2),
  location: z.string().optional(),
  remote: z
    .enum(["remoto", "hibrido", "presencial", "qualquer"])
    .default("qualquer"),
  language: z.enum(["pt-BR", "en", "qualquer"]).default("qualquer"),
  sources: z.array(z.string()).optional(),
  postedWithinDays: z.number().int().max(30).default(14),
})
export interface SearchAdapter {
  source: string
  search(
    q: SearchQuery,
    f: Fetcher
  ): Promise<
    { url: string; title: string; company: string; postedAt?: string }[]
  >
}
type SearchOutcome = {
  found: number
  afterDedupe: number
  excluded: {
    reason:
      | "duplicada"
      | "ja_candidatou"
      | "empresa_excluida"
      | "palavra_excluida"
      | "fechada"
      | "fit_baixo"
    n: number
  }[]
  shown: string[] /* jobMatchIds alto/bom */
}
// tools: search_jobs(SearchQuery), save_search({ query, name }), set_search_schedule({ savedSearchId, cadence: "off"|"diario"|"semanal" }) (clique)
```

```sql
create table public.saved_searches (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null, query jsonb not null, cadence text not null default 'off' check (cadence in ('off','diario','semanal')), last_run_at timestamptz, created_at timestamptz not null default now());
create table public.search_exclusions (user_id uuid not null references auth.users(id) on delete cascade, kind text not null check (kind in ('empresa','palavra','fonte')), value text not null, primary key(user_id, kind, value));
create table public.search_seen (user_id uuid not null references auth.users(id) on delete cascade, canonical_url text not null, first_seen_at timestamptz not null default now(), primary key(user_id, canonical_url));
-- RLS dono
```

**Regras:** fluxo principal = pedido no chat ⇒ `progress` ⇒ adaptadores (só páginas públicas, respeitando robots/termos; sem login automatizado) ⇒ unwrap (A5) ⇒ dedupe (URL canônica + `search_seen` + C2) ⇒ exclusões (blocklist, empresas/palavras) ⇒ C1/C3/C4 ⇒ só fit **alto/bom** viram card (C7), no máximo 10 por vez, e o resto aparece como "mais N"; resumo final "achei X, Y novas, Z descartadas (motivos)". O agendamento só roda se a `cadence` for diferente de `off`, e o resultado chega no chat. Nada é enviado: cada card segue o fluxo normal (ou F1).
**Casos de borda:** fonte fora do ar ⇒ segue com as outras e avisa; 0 resultados ⇒ sugerir ampliar filtros; pedido vago ("busca vagas") ⇒ pergunta o cargo; agendamento sem resultados novos ⇒ não manda mensagem (só no relatório E5).
**Aceite**

- Dado "busca vagas de Engineering Manager remoto" e fixtures com 12 vagas (3 já vistas, 1 de empresa excluída, 2 fit baixo), Então o chat mostra 6 cards e o resumo com os motivos.
- Dado nenhum agendamento ligado, Então nenhuma busca roda sozinha.
- Dado "roda essa busca toda segunda", Então aparece um card de confirmação e a `cadence` muda para `semanal` só após o clique.
  **Testes:** `search-filter.test.ts`, adaptadores com fixtures, `saved-search-schedule.test.ts` (relógio fixo), `parity: PB-56`.

---

## F6. Versões em inglês por trilha, regeneradas a cada fato novo

**Objetivo:** cada trilha tem versão EN sempre atualizada, nunca usada em fontes de perfil único.

**Arquivos:** alterar `packages/jobs/src/functions/cv-regenerate.ts` (B4), `render-cv.tsx` (B5), `packages/core/src/cv-routing.ts` (C5); criar `packages/ai/src/translate-cv.ts`, `packages/core/src/single-profile.ts`.

**Contratos**

```ts
export function translateCvModel(
  pt: CvModel,
  glossary: Record<string, string>
): Promise<CvModel /* language: "en", mesmos factIds */>
export const SINGLE_PROFILE_SOURCES = [
  "gupy",
  "catho",
  "empregos",
  "indeed",
] as const
export function isSingleProfile(source: string): boolean
```

```sql
insert into public.single_profile_sources values ('empregos') on conflict do nothing;
alter table public.cv_versions add column translated_from uuid references public.cv_versions(id);
```

**Regras:** toda regeneração (B4) gera PT e EN de cada trilha; a tradução preserva os `factIds` e não acrescenta conteúdo (teste de paridade de bullets); glossário de cargos/termos editável; em fonte de perfil único a versão EN é **bloqueada** no roteamento, no upload pela extensão e na carta (F3); nome `<Nome>_CV_<Trilha>_EN.pdf`.
**Casos de borda:** tradução falha ⇒ mantém a EN anterior marcada "desatualizada" e avisa; trilha sem CV PT ⇒ não gera EN; vaga em inglês em fonte de perfil único ⇒ PT + aviso.
**Aceite**

- Dado fato novo confirmado, Então cada trilha ganha versão PT e EN novas com o mesmo número de bullets e os mesmos `factIds`.
- Dado vaga Catho em inglês, Então CV Híbrido PT e a EN não aparece como opção.
- Dado a extensão num formulário Gupy, Quando o arquivo é EN, Então troca pelo PT antes do resumo.
  **Testes:** `translate-cv.eval.ts`, `single-profile.test.ts`, `cv-routing.test.ts` (casos novos).
