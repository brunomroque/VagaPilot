-- Legal copy: local Chrome only (no cloud browser fallback). Additive new document versions.
insert into public.legal_documents (slug, version, title, effective_date, body_md, template_sha256)
values ('politica-de-privacidade', '2026-11-01.1', 'Política de Privacidade', '01/11/2026', $legal$# Política de Privacidade — {{NOME_FANTASIA}}

> **MINUTA – revisar com advogado.** Versão {{VERSAO}} · vigência a partir de {{DATA_VIGENCIA}}. Rascunho técnico; não é parecer jurídico.

Esta Política explica como {{RAZAO_SOCIAL}}, CNPJ {{CNPJ}}, com sede em {{ENDERECO}}, {{CIDADE_UF}} ("nós"), trata dados pessoais no serviço {{NOME_FANTASIA}} ({{SITE_URL}}), conforme a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD).

## 1. Papéis

1.1. **Controladora:** {{RAZAO_SOCIAL}}, para os dados da sua conta e do uso do Serviço.

1.2. Quando executamos candidaturas por sua instrução, os dados enviados ao site da vaga passam a ser tratados também pelo **empregador/site de terceiro, como controlador independente**, sob a política dele.

1.3. **Operadores/suboperadores** (tratam dados em nosso nome): ver item 6.

1.4. **Encarregado (DPO):** {{NOME_ENCARREGADO}} — {{EMAIL_ENCARREGADO}}.

## 2. Dados que tratamos

- **Cadastro e conta:** nome, e-mail, senha (hash), preferências.
- **Perfil profissional e currículo:** experiências, formação, contato, documentos que você enviar.
- **Respostas de candidatura:** respostas a perguntas de triagem, padrões salvos por você.
- **Gmail (se conectado):** metadados e conteúdo de e-mails relacionados a candidaturas (remetente, assunto, data, corpo), códigos de verificação e links de confirmação.
- **Contas em sites de terceiros:** e-mail e senha gerada, guardada criptografada; sessões de login criptografadas.
- **Registros técnicos:** IP, data/hora, navegador, identificadores de sessão, registros de auditoria e de aceite.
- **Dados sensíveis:** ver item 4.

## 3. Finalidades e bases legais

| Finalidade | Base legal (LGPD) |
|---|---|
| Prestar o Serviço: buscar vagas, preparar e executar candidaturas sob sua instrução | Execução de contrato (art. 7º, V) |
| Ler o Gmail para respostas, códigos e links | Consentimento (art. 7º, I), revogável a qualquer tempo |
| Criar contas em sites de terceiros e guardar a senha | Execução de contrato (art. 7º, V), mediante sua autorização em cada caso |
| Usar IA para interpretar páginas e sugerir respostas | Execução de contrato (art. 7º, V) |
| Segurança, prevenção a fraude, melhoria de receitas (estrutura de páginas, sem dados pessoais) | Legítimo interesse (art. 7º, IX), com teste de balanceamento: tratamos o mínimo necessário, sem perfilamento comercial, com direito de oposição |
| Guardar registros de acesso e de aceite | Cumprimento de obrigação legal (art. 7º, II – Marco Civil, art. 15) e exercício regular de direitos (art. 7º, VI) |
| Comunicações de marketing | Consentimento (art. 7º, I), separado e opcional |

## 4. Dados sensíveis

4.1. Formulários de vagas podem perguntar sobre **raça/cor, gênero, orientação sexual, deficiência (PcD) ou saúde**. **Esses dados só são tratados se você os fornecer, com consentimento específico e destacado para essa finalidade (art. 11, I, LGPD).** Nunca inferimos esses dados, e a IA nunca os preenche por conta própria: o sistema pergunta a você.

4.2. Você pode revogar esse consentimento; os dados sensíveis guardados serão apagados.

## 5. Compartilhamento

Compartilhamos dados apenas: (a) com o site/empregador da vaga, quando você aprova o envio; (b) com operadores do item 6; (c) por obrigação legal ou ordem judicial; (d) para defesa de direitos. **Não vendemos dados pessoais.**

## 6. Operadores e transferência internacional

| Operador | Uso | Local |
|---|---|---|
| Supabase | Banco de dados e autenticação | EUA |
| Netlify | Hospedagem e funções | EUA |
| Upstash | Filas e cache | EUA |
| Google (Gemini; Gmail API) | IA; leitura do Gmail autorizada por você | EUA |
| Browserbase, Kernel, Steel, Browserless (opcional, admin) | Conexão interativa de sites quando configurado pelo administrador; **não** é fallback da candidatura automatizada | EUA |
| Provedor de e-mail transacional (se configurado) | Envio de avisos | EUA |

**Há transferência internacional de dados (art. 33, LGPD),** fundamentada em cláusulas contratuais dos provedores e, quando aplicável, no seu consentimento específico e destacado, após informação sobre o caráter internacional da operação (art. 33, VIII). Exigimos dos operadores medidas de segurança compatíveis.

## 7. Dados do Google (Gmail) — Uso Limitado

7.1. O uso e a transferência de informações recebidas das APIs do Google seguem a [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), **incluindo os requisitos de Uso Limitado (Limited Use)**.

7.2. Usamos o escopo **somente leitura** do Gmail exclusivamente para: identificar respostas às suas candidaturas, códigos de verificação e links de confirmação dos sites das candidaturas. **Não usamos dados do Gmail para publicidade, não os vendemos, não os usamos para treinar modelos de IA de uso geral e não os transferimos a terceiros**, exceto para prestar essa funcionalidade, por obrigação legal ou com seu consentimento.

7.3. **Nenhuma pessoa lê seus e-mails**, exceto: com seu consentimento expresso para um caso específico; quando necessário para segurança (ex.: investigar abuso); para cumprir a lei; ou de forma agregada e anonimizada para operações internas.

7.4. Você pode desconectar o Gmail a qualquer momento em Configurações e revogar o acesso em https://myaccount.google.com/permissions.

## 8. Retenção

| Dado | Prazo |
|---|---|
| Conta, perfil, candidaturas | Enquanto a conta existir; apagados em até 30 dias após o encerramento, salvo obrigações legais |
| E-mails processados do Gmail | Somente os dados extraídos necessários; conteúdo bruto não é guardado além do necessário |
| Senhas de sites de terceiros | Até você apagar, redefinir ou encerrar a conta |
| Registros de acesso (IP, data/hora) | **Mínimo de 6 meses** (Marco Civil, art. 15) |
| Registros de aceite e revogação | Enquanto durar a conta e pelo prazo prescricional aplicável para defesa de direitos |

## 9. Segurança

Criptografia em trânsito (TLS) e em repouso para segredos (senhas de sites, sessões), controle de acesso por usuário (RLS), registros de auditoria, princípio do menor privilégio. Nenhum sistema é totalmente imune; mantemos plano de resposta a incidentes.

## 10. Incidentes

Em caso de incidente de segurança que possa gerar risco ou dano relevante, comunicaremos a ANPD e os titulares afetados em prazo razoável, conforme o art. 48 da LGPD e a regulamentação da ANPD.

## 11. Seus direitos (art. 18, LGPD)

Confirmação e acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; eliminação dos dados tratados com consentimento; informação sobre compartilhamento; informação sobre a possibilidade de não consentir; revogação do consentimento; oposição; revisão de decisões automatizadas (art. 20). Exerça pelo e-mail {{EMAIL_ENCARREGADO}} ou em Configurações. Você também pode reclamar à ANPD.

## 12. Menores

O Serviço é só para maiores de 18 anos. Não tratamos conscientemente dados de menores.

## 13. Cookies

Usamos cookies essenciais (sessão e segurança). Cookies não essenciais, se adotados, dependerão de consentimento.

## 14. Alterações

Avisaremos alterações relevantes com antecedência mínima de 15 dias e pediremos novo consentimento quando exigido.

## 15. Contato

{{EMAIL_CONTATO}} · Encarregado: {{NOME_ENCARREGADO}} ({{EMAIL_ENCARREGADO}}).
$legal$, '4ffb84ac97abba148bd354b67db88aea8e2967e227bb4e2bd524d9d6110cc459');

insert into public.legal_documents (slug, version, title, effective_date, body_md, template_sha256)
values ('termo-riscos-automacao', '2026-11-01.1', 'Termo de Ciência e Aceite de Riscos da Automação', '01/11/2026', $legal$# Termo de Ciência e Aceite de Riscos da Automação — {{NOME_FANTASIA}}

> **MINUTA – revisar com advogado.** Versão {{VERSAO}} · vigência a partir de {{DATA_VIGENCIA}}. Rascunho técnico; não é parecer jurídico.

Este Termo complementa os [Termos de Uso]({{SITE_URL}}/termos) e a [Política de Privacidade]({{SITE_URL}}/privacidade) de {{RAZAO_SOCIAL}} (CNPJ {{CNPJ}}). Ele explica, em linguagem simples, **os riscos de usar a candidatura automatizada**. Leia até o final. Você só poderá usar a candidatura na nuvem depois de aceitar cada item separadamente. Você pode revogar este aceite a qualquer momento em Configurações → Riscos e responsabilidades; a candidatura na nuvem será desativada.

## O que a automação faz

Quando você pede, o VagaPilot abre o site da vaga **no seu próprio Chrome local**, preenche o formulário com os seus dados e respostas, e para na revisão. **Nada é enviado sem a sua aprovação do resumo final.**

## Riscos e responsabilidades (leia com atenção)

**1. Sites que proíbem robôs.** Alguns sites de vagas proíbem automação nos seus termos. **Usar a automação nesses sites pode causar bloqueio da sua conta no site ou recusa da candidatura. Avisamos quando o site é conhecido como restritivo, mas a lista pode estar incompleta. A decisão de prosseguir é sua.**

**2. Termos de sites aceitos só por você.** **O sistema nunca marca, por conta própria, caixas de termos, privacidade, marketing ou consentimento.** Quando o site pedir, a execução pausa e mostra o link do texto; você escolhe "Aceito" ou "Cancelar". **Ao clicar em "Aceito", é você quem aceita os termos daquele site**, e sua decisão fica registrada com o endereço do texto e uma impressão digital (hash) dele.

**3. Criação de contas e senhas.** **Se você autorizar, o sistema pode criar uma conta no site com o seu e-mail e uma senha gerada, guardada criptografada.** A conta é sua. Você pode ver ou trocar a senha em Configurações.

**4. Leitura de e-mail e abertura de links.** **Com o Gmail conectado (somente leitura), o sistema lê e-mails ligados às suas candidaturas para achar respostas, códigos de verificação e links de confirmação, e abre apenas links do domínio do site da candidatura.** Instruções escritas em e-mails nunca são seguidas.

**5. Erros da inteligência artificial.** **A IA pode errar e preencher um dado incorreto. Respostas de baixa confiança aparecem destacadas na revisão. Revise sempre antes de aprovar: o que você aprovar será enviado em seu nome.**

**6. Receitas aprendidas podem ficar desatualizadas.** **Em sites novos, o sistema aprende os passos e os repete depois. Se o site mudar, a receita pode falhar; quando não for seguro, a execução pausa e pede sua confirmação.**

**7. LinkedIn.** A candidatura automatizada no LinkedIn está desativada, pois as regras daquela plataforma não permitem.

**8. Provedores no exterior.** **Seus dados passam por provedores de infraestrutura (Supabase, Upstash, Netlify) e de IA (Google Gemini), localizados principalmente nos Estados Unidos.** Detalhes na Política de Privacidade (transferência internacional).

**9. Cotas e disponibilidade.** **Parte do serviço usa cotas gratuitas ou limitadas. Quando acabarem, a candidatura pode ficar indisponível ou atrasar.**

**10. Sua responsabilidade.** **Você é o autor das candidaturas e responde pela veracidade dos dados e respostas e pelos aceites que fizer. Não garantimos emprego, entrevista ou resposta.** Respondemos pelas falhas comprovadas do próprio serviço, nos termos da lei.

**11. Permissões permanentes (opcional).** Em Configurações → Permissões do agente você pode, se quiser, autorizar o sistema a realizar certas ações sem perguntar a cada vez: aceitar termos de sites, criar contas, abrir links e usar códigos recebidos por e-mail, aceitar caixas de marketing e, com confirmação adicional, enviar a candidatura final. A autorização pode valer para todos os sites ("Sempre permitir") ou só para os sites da sua lista ("Permitir em sites da lista"); uma lista de bloqueio sempre prevalece. **Ao ativar uma permissão permanente, você nomeia o VagaPilot seu mandatário para praticar aquela ação em seu nome, inclusive aceitar os termos daqueles sites e informar os dados das categorias que você marcar, e esses atos valem como se você mesmo os tivesse praticado.** A permissão vale **somente para as categorias de dados que você marcar uma a uma** (contato; documentos como CPF/RG; endereço; pretensão salarial; família/estado civil; diversidade; saúde/PcD; antecedentes, vínculos e compliance; termos do site; marketing/opt-in); nenhuma vem marcada. **Dados sensíveis (diversidade, saúde e deficiência — art. 11 da LGPD) só são cobertos se você marcar cada categoria em destaque e digitar uma confirmação própria; esse é o seu consentimento específico e destacado para que o agente os informe e consinta em seu nome nos sites cobertos.** Quando uma etapa envolver categoria que você não marcou, o agente pergunta. Mesmo com permissão ativa: **(a) marketing fica desmarcado até você confirmá-lo; (b) sites classificados como de alto risco sempre perguntam; e (c) o envio final automático fica desligado até você digitar a confirmação adicional — sem ela, cada envio depende da sua aprovação do resumo.** Após cada candidatura, e na revisão antes do envio, mostramos o relatório "Dados sensíveis enviados" (pergunta, resposta exata, categoria, origem da autorização e confiança da IA), guardado criptografado e visível só para você; administradores veem apenas contagens por categoria. Se você optar (desligado por padrão), avisamos por e-mail **apenas** quando um dado dessas categorias for preenchido por permissão permanente, sem incluir os dados no assunto. Cada ativação, alteração e revogação fica registrada no histórico de aceites, e cada ação automática fica registrada com o site, o endereço dos termos e o hash do texto, visível no histórico de atividade. **Você pode revogar qualquer permissão ou categoria a qualquer momento**, com efeito para as próximas ações; para corrigir um dado já enviado, siga as instruções "Corrigir/contestar" do relatório (o site terceiro decide se permite edição).

### Navegador local (Chrome no seu computador)

- **Como funciona:** a automação de candidatura roda **somente no seu próprio Chrome**, no seu computador, já logado nas **suas contas reais** (LinkedIn, Gupy e outros sites). Não há fallback automático para navegador na nuvem.
- **Risco de bloqueio:** qualquer automação na sua conta pode levar o site a **limitar, suspender ou bloquear permanentemente** a sua conta, recusar candidaturas ou exigir verificações extras. Isso depende só das regras e sistemas de cada site.
- **Sem garantia:** {{NOME_FANTASIA}} **não garante** nenhuma conta sua em sites de terceiros e **não se responsabiliza** por bloqueios, limitações, perda de acesso, de contatos ou de histórico.
- **Você decide e assume:** ao aceitar este termo e iniciar uma busca, conexão de conta ou candidatura, **você assume integralmente esses riscos**. Se não quiser assumi-los, não conecte suas contas e candidate-se manualmente.
- **Senhas:** nunca pedimos nem guardamos a senha das suas contas para usar o Chrome local; você faz login você mesmo, no seu navegador.

## Registro do aceite

Ao aceitar, registramos: data e hora (servidor, UTC), IP, navegador, sessão, a versão e o hash deste texto e cada item marcado. Você recebe uma cópia e pode baixá-la em Configurações. Guardamos esse registro enquanto durar a conta e pelo prazo necessário à defesa de direitos; registros de acesso por no mínimo 6 meses (Marco Civil da Internet, art. 15).

Dúvidas: {{EMAIL_CONTATO}}.
$legal$, '07eea81db344edd2193c618a18b431dadaad4156a1908bbf430a1ed97365b901');

