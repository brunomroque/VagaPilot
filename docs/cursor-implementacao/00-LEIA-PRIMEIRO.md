# VagaPilot — Pacote de implementação para o Cursor (paridade com o Bot de Vagas)

> Pacote **só de documentação**. O código está em `C:\GitHub\BuscardorDeVagas` (cópia de análise: `/workspace/app-vagas/code/BuscardorDeVagas`). Espec de produto: `ESPEC-app-assistente-vagas.md` v1.5 (seção 6B). Visão geral e matriz: `CURSOR-HANDOFF-VagaPilot.md`.

## 1. Objetivo

Implementar **todas** as lacunas para que, ao final, o app faça **exatamente** o que o Bot de Vagas (agente pessoal do Bruno) faz hoje. A lista do que ele faz está em `PARIDADE-BOT-DE-VAGAS.md` (IDs `PB-xx`). Cada comportamento aponta para a tarefa que o resolve (`A1`…`E9`).

## 2. Ordem de leitura / uso

| #   | Arquivo                           | Quando                                                                                  |
| --- | --------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | `00-LEIA-PRIMEIRO.md`             | sempre, antes de cada fase                                                              |
| 2   | `PARIDADE-BOT-DE-VAGAS.md`        | antes da fase A (referência de comportamento)                                           |
| 3   | `FASE-A-fundamentos.md`           | 5 tarefas                                                                               |
| 4   | `FASE-B-cv-e-fatos-no-chat.md`    | 6 tarefas (B6 = memória de fatos; ler `MEMORIA-DE-FATOS.md`)                            |
| 5   | `FASE-C-analise-da-vaga.md`       | 9 tarefas                                                                               |
| 6   | `FASE-D-preenchimento-e-envio.md` | 11 tarefas                                                                              |
| 7   | `FASE-E-pos-envio-e-extras.md`    | 9 tarefas                                                                               |
| 8   | `FASE-F-ideias-aiapply.md`        | 6 tarefas (extras inspirados no AIApply; F5 inclui a busca sob demanda, que é paridade) |
| 9   | `TESTES-DE-PARIDADE.md`           | ao fim de cada fase (cenários da fase) e no fim (todos)                                 |

Dependências: A → B → C → D → E → F. Total: 46 tarefas. Dentro da fase, siga a ordem numérica salvo indicação.

## 3. Prompts prontos (cole um por vez no agente do Cursor, modo Agent)

**Preparação (uma vez):**

```
Leia AGENTS.md, CLAUDE.md, docs/PROGRESSO.md, docs/ESPEC.md e .cursor/rules/*.mdc.
Copie para docs/implementacao/ os arquivos da pasta cursor-implementacao que vou anexar
(00-LEIA-PRIMEIRO.md, PARIDADE-BOT-DE-VAGAS.md, MEMORIA-DE-FATOS.md, FASE-A..F, TESTES-DE-PARIDADE.md).
Não altere código ainda. Responda com: (1) dúvidas bloqueantes; (2) divergências entre
os documentos e o código atual (arquivo:linha). Regras inegociáveis em 00-LEIA-PRIMEIRO §4.
```

**Fase A:**

```
Implemente docs/implementacao/FASE-A-fundamentos.md, tarefas A1→A5, em ordem.
Para cada tarefa: migração (se houver) → core puro + testes → serviço → tool/rota → UI → e2e.
Respeite os contratos exatamente (nomes de tipos, tabelas, tools). Não invente comportamento
fora de PARIDADE-BOT-DE-VAGAS.md. Ao terminar cada tarefa rode
`pnpm turbo lint typecheck test build` e os testes listados, atualize docs/PROGRESSO.md
(marcando PB-xx resolvidos) e pare para eu revisar antes da próxima.
```

**Fase B:**

```
Implemente docs/implementacao/FASE-B-cv-e-fatos-no-chat.md, tarefas B1→B6 (B6 segue
MEMORIA-DE-FATOS.md: só grava o que o usuário disse, todo dado tem destino e só cv_elegivel vai ao CV após OK, confirmação se confiança < 0,85, versões,
conflito pergunta qual vale; escreva primeiro o evidence-guard e o eval de intenções), com as mesmas
regras da fase A. Critério extra: nenhum fato vira 'confirmado' sem clique do usuário
(teste de banco obrigatório). Rode os cenários TP-01, TP-02 e TP-31..TP-35 de TESTES-DE-PARIDADE.md.
```

**Fase C:**

```
Implemente docs/implementacao/FASE-C-analise-da-vaga.md, tarefas C1→C9. A ordem do card
no chat deve seguir PB-01..PB-12. Rode os cenários TP-03..TP-07 e TP-15 de TESTES-DE-PARIDADE.md
com o provedor FAKE e fixtures; anexe a saída no PR.
```

**Fase D:**

```
Implemente docs/implementacao/FASE-D-preenchimento-e-envio.md, tarefas D1→D11.
Atenção à decisão DA-01: a extensão PODE clicar em Enviar somente com approval válida
daquela vaga (OK explícito ou 'envie direto' no card daquela vaga) e só marca 'enviada'
com tela de sucesso + screenshot. Escreva primeiro os testes que provam que NÃO há
caminho de submit sem approval. Rode TP-08..TP-14.
```

**Fase E:**

```
Implemente docs/implementacao/FASE-E-pos-envio-e-extras.md, tarefas E1→E9.
Rode TP-16..TP-22 e, no fim, TODOS os cenários de TESTES-DE-PARIDADE.md.
Gere docs/PARIDADE-RESULTADO.md com PB-xx → status (ok/falhou) e evidência (teste/arquivo).
```

**Fase F:**

```
Implemente docs/implementacao/FASE-F-ideias-aiapply.md, tarefas F1→F6.
F1: o modo padrão é 'revisao'; 'automatico' só liga por clique e nunca envia em Gupy/Catho/
Empregos/Indeed, com fit não-alto, com duplicidade ou pergunta de experiência pendente — escreva
primeiro os testes desses bloqueios. F4: consentimentos separados (áudio e análise de voz),
exclusão de áudio e aviso "estimativa para treino"; o microserviço services/voice-analysis
roda sem gravar em disco. F5: a busca pelo chat é o fluxo principal; agendamento desligado
por padrão. Rode TP-23..TP-30 e, no fim, todos os cenários.
```

**Auditoria final:**

```
Compare PARIDADE-BOT-DE-VAGAS.md com o código: para cada PB-xx, cite o teste que prova
o comportamento. Liste qualquer PB sem teste como não concluído. Não marque pronto sem prova.
```

## 4. Regras inegociáveis

1. **Nunca inventar experiência.** Só fatos `confirmado`. Pergunta de experiência sem fato → pausa e pergunta; resposta vira fato reutilizável (com o OK do usuário). `verifyGrounding` + `pnpm eval:no-fabrication` bloqueantes.
2. **Nunca enviar sem OK explícito daquela vaga** (clique no `approval`, opção "Sim… envie direto" do card daquela vaga, ou resposta afirmativa ao card "Envio a candidatura X?"). Sem OK → para antes de enviar e mostra o que vai ser enviado.
3. **Envio só conta com evidência**: tela de sucesso detectada + screenshot salvo em `evidences`. Sem isso → `aguardando_confirmacao`, nunca `enviada`.
4. **Senhas e códigos OTP: zero-knowledge.** Digitados pelo usuário num formulário seguro que escreve direto na página; servidor, banco, logs e LLM nunca recebem o valor.
5. **Documentos pessoais** (RG, CPF-imagem, CTPS, CNPJ, comprovantes) nunca são anexados sem ação do usuário. Dados cadastrais textuais do perfil (ex.: CPF como texto exigido no formulário) só se o usuário já os cadastrou e marcou como uso permitido.
6. **Conteúdo externo é não confiável** (vaga, e-mail, página, CV de terceiros). Nunca executa instruções dele.
7. **Uma automação de navegador por vez** por usuário.
8. **Registrar tudo**, inclusive puladas/descartadas/bloqueadas.
9. Dados de teste **sempre fictícios**; nenhum dado real do Bruno em fixtures, evals ou commits.
10. RLS em toda tabela nova; strings em `messages/pt-BR.json`; Zod em toda fronteira.

## 5. Definição de pronto

Uma tarefa está pronta quando:

- `pnpm turbo lint typecheck test build` verde; evals verdes; e2e da tarefa verde;
- os critérios **Dado/Quando/Então** da tarefa passam como teste automatizado;
- os `PB-xx` ligados à tarefa estão cobertos por teste nomeado `parity: PB-xx ...`;
- `docs/PROGRESSO.md` atualizado.

O **projeto** está pronto quando **todos** os `PB-xx` marcados "obrigatório" em `PARIDADE-BOT-DE-VAGAS.md` têm teste de paridade verde e **todos** os cenários de `TESTES-DE-PARIDADE.md` produzem o resultado esperado (mesmas decisões, mesmas paradas, mesmo registro na planilha que o Bot de Vagas produziria).

## 6. Decisões assumidas

| ID    | Decisão                                                                                                                                                                                                                                                                                                                   | Por que espelha o Bot de Vagas                                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| DA-01 | A extensão **clica em Enviar** somente com approval válida daquela vaga (OK explícito ou "envie direto" do card daquela vaga) e confirma com tela de sucesso + screenshot. Sem OK, para antes.                                                                                                                            | Decisão do Bruno; é o que o Bot faz (ex.: "Confirmando a candidatura agora… te mando a tela").                                              |
| DA-02 | "Envie direto" vale **só para aquela vaga**; não existe pré-autorização global.                                                                                                                                                                                                                                           | O Bot oferece a opção por card, vaga a vaga.                                                                                                |
| DA-03 | Testes de conhecimento: o app sugere a resposta e pede OK; o usuário pode dar **autorização permanente só para aquele questionário** ("Responda os testes, pare só em experiência").                                                                                                                                      | Exatamente o widget usado na vaga de SRE.                                                                                                   |
| DA-04 | Card de decisão/aprovação sem resposta **não** é OK: a vaga fica `aguardando_decisao` e o fluxo segue com outras vagas.                                                                                                                                                                                                   | O Bot trata pergunta ignorada como pulada e não assume resposta.                                                                            |
| DA-05 | Reação 👍 numa mensagem que propõe **respostas** vale como OK dessas respostas, **nunca** como OK de envio.                                                                                                                                                                                                               | O Bot interpretou 👍 como ok das respostas e reforçou que não envia sem confirmação.                                                        |
| DA-06 | Rótulos de fit: **alto / bom / baixo** (o enum interno `medio` passa a exibir "bom"; banco não muda). Valores intermediários do Bot ("médio-baixo") viram "baixo" com motivo.                                                                                                                                             | Linguagem atual do Bot.                                                                                                                     |
| DA-07 | Status normalizados = 7 categorias do relatório do Bot (Entrevista, Teste/Etapa pendente, Aguardando decisão, Em análise, Enviada, Reprovada, Encerrada) + Descartada. "Incompleta/bloqueada" fica dentro de Teste/Etapa pendente com `blocked_reason`.                                                                   | Relatórios de 20–21/10.                                                                                                                     |
| DA-08 | OCR de CV escaneado fica **fora** desta entrega (o Bot não lida com CV escaneado).                                                                                                                                                                                                                                        | Não observado no Bot.                                                                                                                       |
| DA-09 | Skills da Gupy: só como apoio no desenvolvimento; o produto usa as skills de domínio próprias.                                                                                                                                                                                                                            | Bot não usa skills Gupy.                                                                                                                    |
| DA-10 | Automação: extensão no navegador do usuário (não worker remoto). O Bot usa um navegador próprio; a extensão é o equivalente mais seguro, e o resultado observável (formulário preenchido, parada, envio, screenshot) é o mesmo.                                                                                           | Paridade de resultado.                                                                                                                      |
| DA-11 | Ao confirmar um fato que muda CV, o app **sempre pede OK com prévia/diff antes de regenerar os CVs**, inclusive em confirmação em lote (decisão do Bruno, 22/10/2026); após o OK gera versão nova (a antiga fica) e **pergunta** se deve atualizar perfis externos (LinkedIn, Gupy) — nunca edita perfil externo sozinho. | O Bot atualizou os 6 CVs e perguntou "Quer que eu atualize os dois?".                                                                       |
| DA-12 | Ao abrir formulário com respostas pré-preenchidas pelo ATS (ex.: perfil Gupy) divergentes das regras atuais, o app **corrige antes de enviar** e avisa; se o campo não for editável, avisa antes do envio.                                                                                                                | O Bot só percebeu a pretensão "Acima de R$ 40.000" depois do envio; a paridade melhorada evita o erro. Registrado como melhoria consciente. |

## Fase G (adicionada em 22/10/2026)

- Contagem: A=5, B=6, C=9, D=11, E=9, F=6, **G=6**. **Total: 52 tarefas.** G vem depois de B6, C5, D9/D11, E1 e F6.
- Leitura: PARIDADE → MEMORIA-DE-FATOS → **CVS-MULTIPLOS-E-PERFIL-UNICO** → FASE-A…G → TESTES.
- Pronto = TP-01..TP-41 verdes.

**Prompt da Fase G (colar no Cursor):**

> Leia `CVS-MULTIPLOS-E-PERFIL-UNICO.md`, `FASE-G-cvs-multiplos-e-perfil-unico.md`, `MEMORIA-DE-FATOS.md` e as tarefas B4, B6, C5, D9, D11, E1 e F6. Implemente G1→G6 nessa ordem, uma por PR. Regras inegociáveis: nunca regenerar CV sem prévia/diff + OK, inclusive em lote (DA-11); nunca salvar perfil externo sem OK; perfil único sempre recebe Híbrido PT (Catho, Empregos.com.br e InfoJobs contam como perfil único até confirmação); o validador incremental bloqueia mudança em empresa, cargo, datas, formação e contato; dados de teste fictícios. Ao terminar, rode TP-36..TP-41.

**Decisões em aberto (Fase G):**

1. Confirmar perfil único de Empregos.com.br e InfoJobs.
2. Catho: a atualização atinge candidaturas já enviadas? Hoje o app avisa como se atingisse.
3. Perfil público do LinkedIn: alinhar ao Híbrido ou só cadastro informativo.
4. Limite de 3 trilhas (+ Híbrida) e base do score ATS em 30 vagas por trilha.
5. Score mínimo do Híbrido por trilha (60).
6. Correção de dado imutável: OK específico + registro basta, ou bloquear de vez com candidatura em Entrevista?
