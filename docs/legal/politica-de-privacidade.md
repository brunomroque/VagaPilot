# Política de Privacidade — {{NOME_FANTASIA}}

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
| Browserbase, Kernel, Steel, Browserless | Navegador na nuvem para candidaturas | EUA |
| Google (Gemini; Gmail API) | IA; leitura do Gmail autorizada por você | EUA |
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
