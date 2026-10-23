# CVs múltiplos, CV Híbrido e plataformas de perfil único

As tarefas de implementação estão na **Fase G** (`FASE-G-cvs-multiplos-e-perfil-unico.md`, G1–G6).

**Depende de:** B4/B5 (geração de CV e PDF ATS-friendly), B6 (memória de fatos), C3 (score ATS), C5 (roteamento de CV), D11 (run `atualizar_cv`), F6 (versões EN).

**DA-11, revisada em 22/10/2026:** o app **sempre** pede OK com prévia/diff antes de regenerar qualquer CV, inclusive em lote. Nunca edita perfil externo sem OK.

Todos os dados de exemplo são fictícios.

---

## 1. Trilhas por área de atuação (qualquer usuário)

- **Quando:** no onboarding e quando o usuário pedir ("revisa minhas trilhas").
- **O que:** a partir dos fatos confirmados (B6) e das experiências extraídas (B1), o app sugere **1 a 3 trilhas**, cada uma com justificativa: experiências que a sustentam, competências principais e cargos-alvo típicos.
- **Ações do usuário (chat ou `/app/cvs`):** aceitar, renomear, juntar, remover, criar ("chama a B de Plataforma", "cria uma trilha de Produto", "junta as duas").
- Cada trilha tem versão **PT** e **EN** (F6). A trilha **Híbrida** (§2) existe sempre, não conta no limite de 3 e não pode ser removida.
- **Exemplos:** Bruno: "Ops/Platform" (SRE, DevOps, Plataforma) e "Engenharia" (gestão e liderança de engenharia), mais a Híbrida. Carla Souza (fictícia, analista de dados que virou PM): "Dados/Analytics" e "Produto", mais a Híbrida.

## 2. CV Híbrido: obrigatório para todos

### 2.1 Texto mostrado ao usuário (onboarding e tela de CVs)

> "Algumas plataformas guardam **um único currículo/perfil** por conta. Na Gupy, quando você muda o currículo, a mudança vale para **todas** as candidaturas em andamento, inclusive as que estão em triagem. Em outras (Indeed, Catho, Empregos.com.br, InfoJobs), o mesmo currículo vai para todas as vagas. Por isso existe o **CV Híbrido**: um currículo em português, genérico o bastante para cobrir todas as suas trilhas, usado sempre nessas plataformas. Os CVs de trilha e as versões em inglês vão só para vagas em que cada candidatura recebe seu próprio arquivo (Greenhouse, Lever, InHire, LinkedIn Easy Apply…)."

### 2.2 Plataformas (pesquisa de 22/10/2026)

| Plataforma                                                                | Tipo                                             | Evidência / fonte                                                                                                                                                                     | Regra no app                                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Gupy                                                                      | `perfil_unico_retroativo`                        | Central de candidatos Gupy, "Como atualizar o meu currículo?": "As alterações realizadas em seu currículo serão replicadas para todas as suas candidaturas ativas."                   | Sempre Híbrido PT; mudar o perfil afeta as candidaturas ativas                                |
| Indeed                                                                    | `perfil_unico_prospectivo`                       | Assistência Indeed (FAQ de CV): um CV por conta; o novo substitui o anterior e vale para as próximas candidaturas; candidatura enviada não pode ser alterada                          | Sempre Híbrido PT                                                                             |
| Catho                                                                     | `perfil_unico_prospectivo` + aviso de retroativo | Catho Ajuda ("para onde vai o meu currículo", "Autoenvio de currículo"): currículo único da conta, inclusive no autoenvio. **Não confirmado** se candidaturas antigas são atualizadas | Sempre Híbrido PT; avisos tratam como retroativo, por segurança                               |
| Empregos.com.br                                                           | `perfil_unico_prospectivo`                       | **NÃO VERIFICADO**; tratado como perfil único até confirmação                                                                                                                         | Sempre Híbrido PT                                                                             |
| InfoJobs                                                                  | `perfil_unico_prospectivo`                       | **NÃO VERIFICADO**; tratado como perfil único até confirmação                                                                                                                         | Sempre Híbrido PT                                                                             |
| LinkedIn Easy Apply                                                       | `por_candidatura`                                | Arquivo escolhido/enviado por candidatura (comportamento conhecido, confirmar). Perfil público é um cadastro à parte                                                                  | CV da trilha (PT/EN); perfil público entra no controle de cadastros (§3), alinhado ao Híbrido |
| Greenhouse, Lever, InHire, Workday, SmartRecruiters e outros ATS por vaga | `por_candidatura`                                | Arquivo por candidatura                                                                                                                                                               | CV da trilha; registrar versão enviada (§3.4)                                                 |

- A lista vive na tabela `platform_catalog` (revisável sem deploy) e substitui a constante `SINGLE_PROFILE_SOURCES` de C5/F6.
- Domínio desconhecido entra como `por_candidatura`; se a plataforma tiver "Meu currículo" (perfil da conta), o app pergunta.

### 2.3 Conteúdo do Híbrido

- Resumo neutro cobrindo todas as trilhas.
- Competências: união das trilhas, principais primeiro.
- Experiências: todas, com bullets escolhidos para cobrir as palavras-chave de todas as trilhas.
- Score ATS mínimo de 60 por trilha (configurável); abaixo disso, aviso.
- Sempre PT; nunca EN nessas plataformas (F6 já bloqueia).

## 3. Controle de cadastros (perfis em plataformas)

### 3.1 Tabela em `/app/cadastros` e via chat ("onde tenho cadastro?")

| Plataforma | Conta            | CV publicado | Versão | Última sincronização | Candidaturas ativas dependentes | Status                    |
| ---------- | ---------------- | ------------ | ------ | -------------------- | ------------------------------- | ------------------------- |
| Gupy       | b•••@exemplo.com | Híbrido PT   | v7     | 18/10/2026           | 4                               | desatualizado (atual: v8) |
| Catho      | b•••@exemplo.com | Híbrido PT   | v8     | 22/10/2026           | 1                               | atualizado                |
| InfoJobs   | b•••@exemplo.com | ?            | ?      | —                    | 0                               | desconhecido              |

- Status: `atualizado`, `desatualizado`, `desconhecido`, `atualizando`, `erro`.
- Dependentes: candidaturas da plataforma em Enviada, Em análise, Teste/Etapa pendente, Entrevista ou Aguardando decisão.

### 3.2 Detecção de cadastro novo

- E-mail de boas-vindas: nova classe `boas_vindas_plataforma` no E1 ("Bem-vindo à Gupy", "Sua conta na Catho foi criada").
- Candidatura feita em plataforma de perfil único sem cadastro registrado.
- Chat: "tenho conta na InfoJobs".
- Em todos os casos o cadastro nasce `desconhecido` e o app pergunta qual CV está publicado. Chave única: (usuário, plataforma, conta).

### 3.3 Quando o Híbrido muda

1. A nova versão é aprovada com diff + OK (DA-11) e passa pelo validador incremental (§4).
2. Cadastros de perfil único com versão menor ficam `desatualizado`.
3. Uma **pendência por plataforma** é criada ("Atualizar Gupy: 4 candidaturas ativas veem o CV novo").
4. **Guia ou automação, só com OK:** a extensão abre "Meu currículo", sobe o PDF ou edita só os blocos do diff, mostra o resumo e **para antes de salvar**. Com OK, salva, tira screenshot e marca `atualizado` com a versão. Sem OK, mostra o passo a passo manual; quando o usuário diz "atualizei", o app pede confirmação ou screenshot.
5. Na Gupy, o card avisa: "isso muda o currículo que os recrutadores veem nas 4 candidaturas em triagem".

### 3.4 ATS por vaga

- Cada candidatura grava **qual CV e versão** foram enviados (`application_cv_snapshots`, com hash do PDF).
- Nunca atualizar retroativamente; troca só via D11 (run `atualizar_cv`), com OK.

## 4. Regra de mudança APENAS INCREMENTAL

Objetivo: melhorar o score ATS sem criar inconsistência entre versões e plataformas.

### 4.1 Permitido

- Acrescentar palavras-chave, tecnologias, responsabilidades e resultados de fatos confirmados com `destino='cv_elegivel'` e `cv_allowed=true` (B6).
- Reordenar bullets dentro da mesma experiência.
- Ajustar resumo e competências sem remover itens já enviados.
- Acrescentar experiência nova (fato novo confirmado).

### 4.2 Proibido (bloqueado pelo validador)

- Trocar ou remover datas, cargos, empresas, formação (instituição, curso, datas) ou contato.
- Remover experiência, bullet ou competência já **enviado** em candidatura ou publicado em plataforma.
- Rebaixar nível de idioma.
- **Exceção de correção:** pedido explícito "corrigir dado" exige OK específico, mostra candidaturas e plataformas que ficam inconsistentes e registra `correction=true`.

### 4.3 Validação automática

- Experiências casadas por `experienceId` estável; formação por `educationId`.
- Campos imutáveis: `company`, `title`, `start`, `end`, `education.*`, `contact.*`.
- Resultado `ok` ou `blocked` com motivos; em `blocked` o card não mostra "Aplicar".

### 4.4 Score e histórico

- Score ATS (C3) antes/depois por trilha e versão; palavras-chave de referência agregadas das últimas 30 vagas da trilha ou da vaga atual.
- Histórico de versões: diff, score, fatos usados e onde cada versão foi enviada/publicada.

### 4.5 Exemplos

- **Bruno** confirma "Terraform, 4 anos": o diff acrescenta Terraform às competências e um bullet na experiência correspondente em Ops/Platform PT, Ops/Platform EN e Híbrido PT. Scores: Ops 72→78; Híbrido 65→69; Engenharia sem mudança. Card: "Aplicar nos 3 CVs".
- **Carla (fictícia)** confirma "SQL avançado + dbt": entra em Dados PT/EN e no Híbrido, não em Produto. Depois pede "muda meu cargo na Empresa Beta para Senior PM": **bloqueado** (cargo imutável, já enviado em 3 candidaturas); o app oferece "Corrigir dado".

## 5. Mensagens do chat (modelos)

- **Sugestão de trilhas:** "Analisei seu histórico e sugiro 2 trilhas: **Dados/Analytics** (Empresas Alfa e Beta: SQL, dbt, dashboards) e **Produto** (Empresa Gama: discovery, roadmap). O **CV Híbrido** é obrigatório. [Por quê?] [Aceitar] [Renomear] [Criar outra]"
- **Prévia de mudança:** "Prévia das mudanças em 3 CVs. Score ATS: Ops 72→78, Ops EN 70→76, Híbrido 65→69. [Ver diff] [Aplicar] [Escolher CVs] [Agora não]"
- **Bloqueio:** "Bloqueado: a mudança altera a data de início na Empresa Alfa (dado imutável, já enviado em 5 candidaturas). Se estava errado, use [Corrigir dado]."
- **Híbrido mudou:** "O Híbrido mudou (v8). Gupy e Catho estão desatualizados; na Gupy, 4 candidaturas em triagem vão ver o CV novo quando você atualizar. Quer que eu abra a Gupy e prepare a atualização? Paro antes de salvar. [Preparar] [Me mostre o passo a passo] [Depois]"
- **Cadastro novo:** "Cadastro novo detectado: InfoJobs (e-mail de boas-vindas de 22/10). Qual CV está lá? [Híbrido atual] [Não sei, vamos atualizar] [Não é meu]"

## 6. Casos de borda

- Uma única área: 1 trilha + Híbrido, que pode ficar quase igual à trilha.
- Pedido de 4ª trilha: explica o limite e oferece juntar ou trocar.
- Plataforma muda de comportamento: altera `platform_catalog`, sem deploy.
- Duas contas na mesma plataforma: dois cadastros com dependentes próprios.
- Boas-vindas de plataforma fora do catálogo: cadastro `desconhecido`, tipo `por_candidatura`, e pergunta.
- Falha no meio do lote: nenhuma versão publicada pela metade; geração atômica por CV; o lote mostra quais geraram.
- Fato revogado (B6) já usado em CV: não remove sozinho; propõe correção com OK específico e avisa sobre candidaturas enviadas.
