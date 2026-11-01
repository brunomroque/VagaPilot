# Auditoria UX — Leis de UX (VagaPilot Web)

Escopo: `apps/web` (Next.js, pt-BR). Método: leitura de componentes e rotas listadas em `docs/ux/prompt-audit.md`. **Somente diagnóstico** — nenhuma alteração de código nesta entrega.

Referência: [lawsofux.com](https://lawsofux.com).

## Resumo priorizado

| ID   | Lei                          | Impacto | Esforço | Seguro sem produto? | Arquivo                                             | Status |
| ---- | ---------------------------- | ------- | ------- | ------------------- | --------------------------------------------------- | ------ |
| UX01 | Estética-usabilidade / Jakob | Alto    | P       | Sim                 | `components/app/app-sidebar.tsx`                    | feito  |
| UX04 | Goal-Gradient                | Alto    | P       | Sim                 | `components/onboarding/wizard-shell.tsx`            | feito  |
| UX02 | Hick                         | Alto    | M       | Não                 | `components/app/app-sidebar.tsx`                    |        |
| UX05 | Miller / Tesler              | Alto    | M       | Parcial             | `app/app/onboarding/page.tsx`                       |        |
| UX07 | Região comum / Jakob         | Médio   | P       | Sim                 | `components/app/app-topbar.tsx`, `app/app/page.tsx` | feito  |
| UX08 | Proximidade / Esforço mínimo | Médio   | P       | Sim                 | `app/app/page.tsx`                                  | feito  |
| UX09 | Hick                         | Médio   | M       | Sim                 | `components/app/applications-view.tsx`              |        |
| UX12 | Similaridade / Jakob         | Médio   | P       | Sim                 | `app/app/configuracoes/page.tsx`                    | feito  |
| UX16 | Zeigarnik                    | Médio   | P       | Parcial             | `app/app/onboarding/page.tsx`                       |        |
| UX26 | Proximidade                  | Médio   | P       | Sim                 | `app/app/onboarding/page.tsx`                       | feito  |
| UX03 | Jakob                        | Médio   | P       | Parcial             | `components/onboarding/wizard-shell.tsx`            |        |
| UX10 | Miller                       | Médio   | M       | Parcial             | `app/app/perfil/page.tsx`                           |        |
| UX13 | Fitts                        | Médio   | P       | Sim                 | `components/app/app-topbar.tsx`                     | feito  |
| UX15 | Von Restorff                 | Médio   | P       | Não                 | `components/app/app-topbar.tsx`                     |        |
| UX21 | Postel                       | Médio   | P       | Sim                 | `components/auth/credentials-form.tsx`              | feito  |
| UX23 | Proximidade                  | Médio   | P       | Sim                 | `components/chat/chat-view.tsx`                     | feito  |
| UX28 | Jakob / Peak-End             | Médio   | M       | Não                 | `components/app/notifications-menu.tsx`             |        |
| UX06 | Peak-End                     | Médio   | G       | Não                 | `app/app/onboarding/page.tsx`                       |        |
| UX11 | Similaridade                 | Baixo   | P       | Sim                 | `app/page.tsx`                                      |        |
| UX14 | Jakob                        | Baixo   | P       | Sim                 | `components/app/app-topbar.tsx`                     |        |
| UX17 | Tesler / Serial Position     | Baixo   | P       | Não                 | `components/onboarding/wizard-shell.tsx`            |        |
| UX18 | Doherty                      | Baixo   | M       | Sim                 | `components/chat/chat-view.tsx`                     |        |
| UX19 | Esforço mínimo               | Baixo   | P       | Parcial             | `components/chat/conversation-list.tsx`             |        |
| UX20 | Fitts                        | Baixo   | P       | Sim                 | `components/chat/conversation-list.tsx`             |        |
| UX24 | Esforço mínimo               | Baixo   | P       | Sim                 | `components/chat/chat-view.tsx`                     |        |
| UX29 | Similaridade                 | Baixo   | M       | Parcial             | `components/app/app-sidebar.tsx`                    |        |
| UX30 | Jakob                        | Baixo   | P       | Sim                 | `app/(auth)/layout.tsx`                             |        |

---

## Achados (detalhe)

### UX01 — Percentual de perfil fictício na sidebar

- **Lei:** Estética-usabilidade (dado falso quebra confiança); Jakob (usuário espera dado real como no resto do app).
- **Onde:** `apps/web/components/app/app-sidebar.tsx:214-216`
- **Problema:** O rodapé da conta exibe `Profile.completion` com `demoProfile.completion` (92), definido em `lib/demo-data.ts` como protótipo Figma — não reflete o perfil do usuário autenticado.
- **Correção proposta:** Calcular percentual no servidor (ou reutilizar requisitos de onboarding/perfil) e passar via `AppShell` → `AppSidebar`; ocultar a linha se não houver métrica confiável.
- **Impacto:** Alto | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX04 — Mapa de etapas do onboarding invisível no mobile

- **Lei:** Goal-Gradient (visibilidade do progresso motiva conclusão).
- **Onde:** `apps/web/components/onboarding/wizard-shell.tsx:121-133`
- **Problema:** A lista numerada das 6 etapas usa `hidden … md:flex`; no mobile só restam barra e “etapa X de Y”, sem nomes das etapas.
- **Correção proposta:** Mostrar rótulo da etapa atual sempre (ex.: badge abaixo da barra) ou carrossel horizontal scrollável de etapas no `< sm`.
- **Impacto:** Alto | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX02 — Dois atalhos de chat na navegação principal

- **Lei:** Hick (mais opções equivalentes aumentam tempo de decisão).
- **Onde:** `apps/web/components/app/app-sidebar.tsx:72-88` (grupos “Área de trabalho” e “Assistente”)
- **Problema:** “Início (chat)” (`/app`) e “Conversar” (`/app/chat`) usam o mesmo ícone e função cognitiva próxima; o usuário precisa adivinhar qual abrir para histórico vs. home chat-first.
- **Correção proposta:** Unificar em um item + submenu (“Histórico”) ou renomear/reordenar conforme spec 3.1 (decisão de IA do produto).
- **Impacto:** Alto | **Esforço:** M | **Seguro sem produto:** Não

### UX05 — Etapa “Respostas” sobrecarrega memória de trabalho

- **Lei:** Miller (muitos blocos simultâneos); Tesler (complexidade concentrada na UI em vez de fluxo guiado).
- **Onde:** `apps/web/app/app/onboarding/page.tsx:205-251`
- **Problema:** Checklist + `PreferencesForm` + `SalaryRulesEditor` + `LanguagesEditor` + `SituationForm` na mesma etapa, sem acordeão ou subpassos.
- **Correção proposta:** Dividir em sub-etapas (preferências → remuneração → idiomas) ou wizard interno com um foco por tela; manter checklist sticky ligado ao requisito ativo.
- **Impacto:** Alto | **Esforço:** M | **Seguro sem produto:** Parcial (afeta ordem J1/P1.4)

### UX07 — Dois títulos principais na home `/app`

- **Lei:** Região comum / Jakob (padrão de dashboard: um `<h1>` por view).
- **Onde:** `apps/web/components/app/app-topbar.tsx:32-34` e `apps/web/app/app/page.tsx:35-36`
- **Problema:** Topbar global traz saudação como `<h1>`; a página repete `<h1>` com título da home — leitores de tela e hierarquia visual ficam ambíguos.
- **Correção proposta:** Topbar usa `<p>`/`<span>` decorativo; `<h1>` só no conteúdo da rota (ou o inverso, consistente em todas as rotas `/app/*`).
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX08 — Painel resumido ausente em telas pequenas

- **Lei:** Proximidade / Esforço mínimo (métricas úteis exigem navegação extra no mobile).
- **Onde:** `apps/web/app/app/page.tsx:68-70`
- **Problema:** `OverviewCompact` está em `hidden lg:block`; mobile não vê candidaturas do mês, tarefas pendentes nem fit médio sem ir a `/app/visao-geral`.
- **Correção proposta:** Versão colapsável acima ou abaixo do chat em `< lg`, ou link compacto “Resumo” no topo da coluna.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX09 — Barra de filtros densa em Candidaturas

- **Lei:** Hick.
- **Onde:** `apps/web/components/app/applications-view.tsx:115-149`
- **Problema:** Busca + quatro `FilterMenu` + período + contador competem na mesma linha; mobile quebra em muitos controles de peso similar.
- **Correção proposta:** Agrupar filtros em um único “Filtrar” (sheet/dialog) no mobile; manter chips de filtros ativos visíveis.
- **Impacto:** Médio | **Esforço:** M | **Seguro sem produto:** Sim

### UX12 — Copy hardcoded em Configurações

- **Lei:** Similaridade / Jakob (resto da UI via next-intl).
- **Onde:** `apps/web/app/app/configuracoes/page.tsx:68-92`
- **Problema:** Seções “Riscos e responsabilidades” e “Permissões do agente” e links não passam por `messages/pt-BR.json`, ao contrário do bloco de integrações.
- **Correção proposta:** Extrair chaves `Settings.risks.*` e `Settings.permissions.*`; alinhar tom ao restante.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX16 — Múltiplos convites para o chat durante onboarding incompleto

- **Lei:** Zeigarnik (tarefas abertas competindo por atenção).
- **Onde:** `apps/web/app/app/onboarding/page.tsx:300-310` (card “opção chat”), `wizard-shell.tsx:104-107` (“Depois”), alertas repetidos em `app/app/page.tsx:38-51` e `app/app/chat/page.tsx:51-64`
- **Problema:** Três caminhos para sair do wizard (card superior, botão “Depois”, alerta nas rotas de chat) sem estado unificado de prioridade.
- **Correção proposta:** Um único CTA secundário “Continuar depois” no wizard; remover card duplicado ou torná-lo contextual só após etapa N.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Parcial

### UX26 — Checklist de requisitos desconectado dos formulários

- **Lei:** Proximidade (Gestalt).
- **Onde:** `apps/web/app/app/onboarding/page.tsx:207-251`
- **Problema:** Checklist em grid no topo; formulários longos abaixo — difícil associar item pendente ao campo correspondente.
- **Correção proposta:** Ancorar cada item do checklist ao bloco do form (scroll-into-view / ids) ou inline “falta X” no próprio bloco.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX03 — Conclusão do onboarding não leva à home chat-first

- **Lei:** Jakob (home principal é `/app`, spec 3.1).
- **Onde:** `apps/web/components/onboarding/wizard-shell.tsx:88` (`router.push("/app/chat")`); também `wizard-shell.tsx:76` em “Depois”
- **Problema:** Usuário termina ou adia e cai em `/app/chat`, não em `/app`, divergindo do item “Início (chat)” da nav.
- **Correção proposta:** Redirecionar para `/app` (ou único destino acordado) e deep-link opcional para histórico.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Parcial (comentário em `aceite/page.tsx:19` cita fluxo atual)

### UX10 — Perfil com sete abas horizontais

- **Lei:** Miller.
- **Onde:** `apps/web/app/app/perfil/page.tsx:28-36`, `components/profile/profile-tabs.tsx:34-41`
- **Problema:** Sete tabs (`contato` … `diversidade`) excedem faixa confortável (~5±2); scroll horizontal ajuda, mas ainda exige comparação lexical.
- **Correção proposta:** Agrupar em 3–4 categorias (“Dados pessoais”, “Carreira”, “Preferências”, “Privacidade”) ou menu lateral em desktop.
- **Impacto:** Médio | **Esforço:** M | **Seguro sem produto:** Parcial

### UX13 — Busca global com alvo pequeno em viewports médias

- **Lei:** Fitts.
- **Onde:** `apps/web/components/app/app-topbar.tsx:38-48`
- **Problema:** Entre `md` e `lg`, o botão de busca vira só ícone (texto e `Kbd` ocultos), área clicável menor que o CTA “Analisar” (`size="lg"`).
- **Correção proposta:** Manter rótulo visível a partir de `sm` ou igualar `size` ao botão primário.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX15 — CTA “Analisar vaga” domina a topbar

- **Lei:** Von Restorff (destaque pode desviar do fluxo chat-first).
- **Onde:** `apps/web/components/app/app-topbar.tsx:51-55`
- **Problema:** Botão sólido grande em todas as rotas compete com composer e FAB de chat em páginas não relacionadas a ingestão.
- **Correção proposta:** Variante contextual (outline fora de candidaturas/home) ou mover para FAB secundário — requer prioridade de produto.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Não

### UX21 — Cadastro/login sem links legais adjacentes

- **Lei:** Postel (aceitar intenção: usuário pode procurar termos antes de criar conta).
- **Onde:** `apps/web/components/auth/credentials-form.tsx:113-232` (layout em `app/(auth)/layout.tsx:8-13` só mostra marca)
- **Problema:** Landing expõe termos/privacidade; telas de auth não repetem links mínimos próximos ao submit.
- **Correção proposta:** `FieldDescription` com links para `/termos` e `/privacidade` abaixo do botão principal no signup.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX23 — Erros do chat longe do composer

- **Lei:** Proximidade.
- **Onde:** `apps/web/components/chat/chat-view.tsx:382-393`
- **Problema:** `Alert` destrutivo fica entre log e form sticky; em conversas longas o usuário pode não ver o erro ao tentar reenviar.
- **Correção proposta:** Duplicar aviso no topo do form ou usar `aria-live="assertive"` no bloco do composer.
- **Impacto:** Médio | **Esforço:** P | **Seguro sem produto:** Sim | **Status:** feito

### UX28 — Abrir sino marca tudo como lido

- **Lei:** Jakob (padrão: leitura item a item); Peak-End ( sensação de “perdi algo” se sumiu badge sem abrir cada aviso).
- **Onde:** `apps/web/components/app/notifications-menu.tsx:87-92`
- **Problema:** `onOpenChange` chama `markNotificationsRead()` ao abrir o menu, não ao interagir com cada notificação.
- **Correção proposta:** Marcar lido no clique do item ou botão “Marcar todas”; manter badge até ação explícita — decisão de produto/privacidade.
- **Impacto:** Médio | **Esforço:** M | **Seguro sem produto:** Não

### UX06 — Última etapa do onboarding termina em “Em breve”

- **Lei:** Peak-End (final do fluxo deixa impressão de produto incompleto).
- **Onde:** `apps/web/app/app/onboarding/page.tsx:260-290`
- **Problema:** Etapa `convites` só exibe botões `disabled` + badge “Em breve”; usuário conclui onboarding sem integração tangível.
- **Correção proposta:** Ocultar etapa até feature existir, ou substituir por checklist “opcional” com links reais para Configurações (Gmail/extensão já vivem em `/app/configuracoes`).
- **Impacto:** Médio | **Esforço:** G | **Seguro sem produto:** Não

### UX11 — Link da landing fora do catálogo i18n

- **Lei:** Similaridade.
- **Onde:** `apps/web/app/page.tsx:49-50`
- **Problema:** Texto “Riscos da automação” hardcoded; demais links usam `t(...)`.
- **Correção proposta:** Chave `Home.risks` em `messages/pt-BR.json`.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Sim

### UX14 — Atalho de teclado exibe “Ctrl” fixo

- **Lei:** Jakob (macOS espera ⌘).
- **Onde:** `apps/web/components/app/app-topbar.tsx:45-47`
- **Problema:** `Kbd` sempre mostra Ctrl+K; o handler aceita metaKey (`command-menu.tsx:36`), mas a dica visual não.
- **Correção proposta:** Detectar plataforma ou usar rótulo neutro “⌘/Ctrl + K”.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Sim

### UX17 — Rótulo “Pular ou continuar” só na etapa 2

- **Lei:** Tesler / Serial Position (regra muda no meio do fluxo).
- **Onde:** `apps/web/components/onboarding/wizard-shell.tsx:194`
- **Problema:** Botão avançar usa copy especial só quando `step === 2` (fatos), inconsistente com outras etapas opcionais.
- **Correção proposta:** Alinhar copy à regra de negócio (sempre “Continuar” + link “Pular revisão” separado) — requer spec.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Não

### UX18 — Nova conversa recarrega a página inteira

- **Lei:** Doherty (threshold ~400 ms de feedback; reload quebra fluidez).
- **Onde:** `apps/web/components/chat/chat-view.tsx:291`
- **Problema:** `window.location.assign` força navigation full page em vez de transição client-side já usada em `Link`/`router`.
- **Correção proposta:** `router.push` + reset de estado documentado no comentário QA, mantendo garantia de id novo.
- **Impacto:** Baixo | **Esforço:** M | **Seguro sem produto:** Sim

### UX19 — Lista de conversas oculta com uma ou zero threads extras

- **Lei:** Esforço mínimo (descoberta de histórico).
- **Onde:** `apps/web/components/chat/conversation-list.tsx:17`
- **Problema:** `items.length <= 1` retorna `null`; usuário com uma conversa não vê UI de arquivar/trocar até criar segunda.
- **Correção proposta:** Mostrar sempre botão “Nova conversa” na lista ou manter nav explícita no header (já existe no `ChatView`).
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Parcial

### UX20 — Arquivar conversa com alvo pequeno

- **Lei:** Fitts.
- **Onde:** `apps/web/components/chat/conversation-list.tsx:30-34`
- **Problema:** Ação destrutiva/secundária em `Button size="sm" variant="ghost"` colada ao chip ativo — fácil missclick em touch.
- **Correção proposta:** Mover para menu “⋯” do thread ativo ou confirmar via dialog.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Sim

### UX24 — Alerta de erro do chat sem dismiss

- **Lei:** Esforço mínimo.
- **Onde:** `apps/web/components/chat/chat-view.tsx:382-385`
- **Problema:** Erro persiste até novo envio bem-sucedido; não há botão fechar.
- **Correção proposta:** `Alert` com dismiss que limpa `notice`.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Sim

### UX29 — Mesmo ícone para dois destinos de chat

- **Lei:** Similaridade (Gestalt).
- **Onde:** `apps/web/components/app/app-sidebar.tsx:73,85`
- **Problema:** `MessageSquareTextIcon` repetido em `homeChat` e `chat` aumenta confusão visual (reforça UX02).
- **Correção proposta:** Ícone distinto para histórico (ex.: `MessagesSquare`) após decisão de IA de navegação.
- **Impacto:** Baixo | **Esforço:** M | **Seguro sem produto:** Parcial

### UX30 — Auth layout sem contexto de produto

- **Lei:** Jakob (landing rica vs. card isolado).
- **Onde:** `apps/web/app/(auth)/layout.tsx:8-13`
- **Problema:** Só marca + formulário; não reforça proposta de valor nem link “Voltar” explícito (só logo clicável).
- **Correção proposta:** Link textual “← Início” e uma linha de tagline abaixo da marca.
- **Impacto:** Baixo | **Esforço:** P | **Seguro sem produto:** Sim

---

## Fluxos revisados (checklist)

| Fluxo             | Arquivos principais                                                         | Observação                                                                             |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Landing           | `app/page.tsx`                                                              | UX11                                                                                   |
| Cadastro / entrar | `(auth)/*`, `credentials-form.tsx`                                          | UX21, UX30                                                                             |
| Onboarding        | `onboarding/page.tsx`, `wizard-shell.tsx`                                   | UX04–UX06, UX16, UX26                                                                  |
| Chat              | `chat/page.tsx`, `chat-view.tsx`, `conversation-list.tsx`, `chat-sheet.tsx` | UX18–UX20, UX23–UX24                                                                   |
| Shell / nav       | `app-shell.tsx`, `app-sidebar.tsx`, `app-topbar.tsx`, `command-menu.tsx`    | UX01–UX02, UX13–UX15, UX29                                                             |
| CVs / fatos       | `cvs/page.tsx`, `fatos/page.tsx`                                            | Fluxos coerentes; pendências ligadas a onboarding                                      |
| Perfil            | `perfil/page.tsx`, `profile-tabs.tsx`                                       | UX10                                                                                   |
| Buscas            | `searches-view.tsx`                                                         | Formulário denso mas padrão CRUD; aviso de risco visível (`searches-view.tsx:142-150`) |
| Candidaturas      | `applications-view.tsx`                                                     | UX09                                                                                   |
| Configurações     | `configuracoes/page.tsx`                                                    | UX12; integrações bem agrupadas (`aria-labelledby`)                                    |

## Próximos passos sugeridos

1. Corrigir **UX01** e **UX04** (rápidos, alto impacto, sem debate de produto).
2. Decidir IA de navegação chat (**UX02**, **UX03**, **UX29**) com base na ESPEC §3.1.
3. Tratar onboarding **UX05–UX06** em alinhamento com J1/P1.4.

---

_Gerado por auditoria somente leitura conforme `docs/ux/prompt-audit.md`._
