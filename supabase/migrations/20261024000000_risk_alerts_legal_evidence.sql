-- Phase 3: risk alerts, versioned legal documents and append-only acceptance evidence.
-- MINUTA texts from docs/legal/*.md (templates with {{TAGS}}). Company values are rendered at
-- runtime from LEGAL_VARS (packages/core/src/legal.ts); the acceptance hash covers the RENDERED text.

create or replace function public.block_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only table %: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Immutable, versioned legal documents (a new version is a new row).
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug in ('termos-de-uso', 'politica-de-privacidade', 'termo-riscos-automacao')),
  version text not null,
  title text not null,
  effective_date text not null,
  body_md text not null,
  template_sha256 text not null,
  published_at timestamptz not null default now(),
  unique (slug, version)
);

alter table public.legal_documents enable row level security;
revoke all on table public.legal_documents from anon, authenticated;

create trigger legal_documents_immutable
before update or delete on public.legal_documents
for each row execute function public.block_mutation();

-- Append-only acceptance / revocation evidence, hash-chained per user (prev_hash -> record_hash).
-- user_id has no FK on purpose: evidence survives account deletion for the legal retention period.
create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null,
  user_id uuid not null,
  email text,
  action text not null check (action in ('accept', 'revoke', 'permission_grant', 'permission_revoke')),
  document_id uuid not null references public.legal_documents on delete restrict,
  document_slug text not null,
  document_version text not null,
  document_sha256 text not null,
  checkboxes jsonb not null default '{}'::jsonb,
  typed_confirmation text,
  accepted_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  ip text,
  user_agent text,
  session_id text,
  locale text,
  ui_version text,
  prev_hash text,
  record_hash text not null unique,
  unique nulls not distinct (user_id, prev_hash)
);

create index legal_acceptances_user_idx on public.legal_acceptances (user_id, seq);

alter table public.legal_acceptances enable row level security;
revoke all on table public.legal_acceptances from anon, authenticated;

create trigger legal_acceptances_append_only
before update or delete on public.legal_acceptances
for each row execute function public.block_mutation();

create trigger legal_acceptances_no_truncate
before truncate on public.legal_acceptances
for each statement execute function public.block_mutation();

comment on table public.legal_acceptances is
  'Append-only clickwrap evidence (retention >= 6 months, Marco Civil art. 15). Never update or delete.';

-- Per-action consent decisions on third-party ATS terms checkboxes (the AI never ticks them).
create table public.apply_consent_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  application_id uuid,
  question_id uuid,
  site text not null,
  field_label text not null,
  terms_url text,
  terms_sha256 text,
  decision text not null check (decision in ('aceito', 'cancelado')),
  ip text,
  user_agent text,
  decided_at timestamptz not null default now()
);

create index apply_consent_decisions_user_idx on public.apply_consent_decisions (user_id, decided_at desc);

alter table public.apply_consent_decisions enable row level security;
revoke all on table public.apply_consent_decisions from anon, authenticated;

create trigger apply_consent_decisions_append_only
before update or delete on public.apply_consent_decisions
for each row execute function public.block_mutation();

-- Admin-managed automation risk level per domain (drives alerts and the job badge).
create table public.site_risk_levels (
  domain text primary key,
  level text not null check (level in ('baixo', 'medio', 'alto')),
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.site_risk_levels enable row level security;
revoke all on table public.site_risk_levels from anon, authenticated;

-- Initial list: review. Levels reflect known anti-automation terms or bot detection.
insert into public.site_risk_levels (domain, level, note) values
  ('linkedin.com', 'alto', 'Termos proíbem automação; integração desativada.'),
  ('indeed.com', 'alto', 'Termos restringem automação; detecção de bots.'),
  ('glassdoor.com', 'alto', 'Termos restringem automação.'),
  ('catho.com.br', 'medio', 'Revisar termos.'),
  ('infojobs.com.br', 'medio', 'Revisar termos.'),
  ('myworkdayjobs.com', 'medio', 'Detecção de bots frequente.');

insert into public.legal_documents (slug, version, title, effective_date, body_md, template_sha256)
values ('termos-de-uso', '2026-10-23.1', 'Termos de Uso', '23/10/2026', $legal$# Termos de Uso — {{NOME_FANTASIA}}

> **MINUTA – revisar com advogado.** Versão {{VERSAO}} · vigência a partir de {{DATA_VIGENCIA}}. Este texto é um rascunho técnico e não constitui parecer jurídico.

Estes Termos regulam o uso do serviço {{NOME_FANTASIA}}, oferecido por {{RAZAO_SOCIAL}}, inscrita no CNPJ sob o nº {{CNPJ}}, com sede em {{ENDERECO}}, {{CIDADE_UF}} ("nós"), por meio do site {{SITE_URL}} e aplicações relacionadas ("Serviço"). Ao criar a conta e marcar "Li e aceito", você ("Usuário") declara ter lido e concordado com estes Termos, com a [Política de Privacidade]({{SITE_URL}}/privacidade) e com o [Termo de Ciência e Aceite de Riscos da Automação]({{SITE_URL}}/app/configuracoes/riscos) (este último exigido antes do primeiro uso da candidatura automatizada).

## 1. Quem pode usar

1.1. O Serviço é destinado exclusivamente a pessoas físicas **maiores de 18 (dezoito) anos** e plenamente capazes. Não coletamos intencionalmente dados de menores; contas identificadas como de menores serão encerradas.

1.2. O Usuário é responsável por manter suas credenciais em sigilo e por toda atividade realizada em sua conta.

## 2. Natureza do Serviço: ferramenta que age em seu nome

2.1. O {{NOME_FANTASIA}} é uma **ferramenta de apoio à busca de emprego** que, **por sua instrução e em seu nome**, pode: encontrar e organizar vagas; preparar currículos e respostas; preencher formulários de candidatura em sites de terceiros por meio de um navegador na nuvem; ler e-mails relacionados às suas candidaturas (quando você conectar o Gmail); e registrar o andamento das candidaturas.

2.2. **Mandato.** Ao iniciar uma candidatura automatizada, o Usuário outorga ao {{NOME_FANTASIA}} poderes específicos e revogáveis para praticar, em seu nome e por sua conta, os atos necessários àquela candidatura (arts. 653 e seguintes do Código Civil), sempre nos limites das instruções do Usuário. **O envio final de cada candidatura depende da sua aprovação expressa do resumo apresentado, salvo se o Usuário tiver ativado o envio final automático com a confirmação adicional expressa prevista na cláusula 11 do Termo de Ciência e Aceite de Riscos da Automação, revogável a qualquer momento.** O mandato pode ser revogado a qualquer momento, cancelando a execução em andamento.

2.3. **O Usuário é o autor das candidaturas** e o único responsável pela veracidade, exatidão e atualização das informações e documentos fornecidos, inclusive respostas a perguntas de triagem.

2.4. **Obrigação de meio.** Empregamos esforços razoáveis e técnicas adequadas para executar o Serviço, **mas não garantimos** obtenção de emprego, entrevista, resposta de recrutadores, aprovação em processos seletivos, nem que todos os sites aceitem candidaturas automatizadas.

## 3. Sites e plataformas de terceiros

3.1. As candidaturas são feitas em sites de terceiros (ATS, portais de empresas, plataformas de vagas), que possuem termos e regras próprios, sobre os quais não temos controle.

3.2. **Alguns sites proíbem ou restringem o uso de robôs e automação. O uso do Serviço nesses sites pode levar ao bloqueio ou suspensão da sua conta no site, à recusa da candidatura ou a outras medidas do site. Você decide se quer usar a automação em cada site; mostramos alertas quando o site é conhecido como restritivo.**

3.3. **Nunca aceitamos termos, políticas de privacidade, comunicações de marketing ou consentimentos de sites de terceiros por você.** Quando um site exigir esse aceite, a execução pausa e você decide ("Aceito" ou "Cancelar"), com link para o texto do site. Sua decisão é registrada.

3.4. A integração com o LinkedIn para candidatura automatizada está **desativada**, em razão das regras daquela plataforma.

## 4. Uso de inteligência artificial

4.1. Utilizamos modelos de inteligência artificial de terceiros (por exemplo, Google Gemini) para interpretar páginas, sugerir respostas e classificar e-mails.

4.2. **A IA pode errar: pode interpretar mal uma pergunta, preencher um campo de forma incorreta ou classificar um e-mail de forma errada. Por isso você deve revisar o resumo antes de aprovar o envio; respostas de baixa confiança são destacadas na revisão.**

4.3. **Para sites desconhecidos, o Serviço pode aprender e reutilizar uma "receita" de preenchimento. Se o site mudar, a receita pode ficar desatualizada; nesses casos a execução tenta revalidar a etapa com IA e, quando não for seguro, pausa e pede sua confirmação.**

## 5. Contas em sites de terceiros e senhas

5.1. **Quando você autorizar, o Serviço pode criar uma conta em um site de candidatura com o seu e-mail e uma senha gerada automaticamente, armazenada de forma criptografada.** Você pode ver e redefinir essa senha em Configurações. A conta criada é sua e está sujeita aos termos do site.

## 6. Leitura de e-mail e abertura de links

6.1. **Com a sua autorização (conexão do Gmail em modo somente leitura), o Serviço lê e-mails para identificar respostas de candidaturas, códigos de verificação e links de confirmação. Somente e-mails ligados a candidaturas ativas ou conhecidas são tratados, e somente links do domínio do site da candidatura são abertos.** Instruções contidas em e-mails nunca são executadas.

6.2. O uso de dados do Gmail segue a Política de Privacidade, incluindo o compromisso de Uso Limitado (Limited Use) das Google API Services User Data Policy.

## 7. Provedores de infraestrutura e cotas

7.1. **O navegador na nuvem e outras partes do Serviço funcionam com provedores terceiros, alguns localizados fora do Brasil (por exemplo, nos Estados Unidos), conforme a Política de Privacidade.**

7.2. **Partes do Serviço podem depender de cotas gratuitas ou limitadas desses provedores. O Serviço pode ficar temporariamente indisponível, lento ou limitado quando essas cotas acabarem ou quando um provedor falhar.** Não há garantia de disponibilidade ininterrupta.

## 8. Condutas proibidas

É vedado: (a) fornecer dados falsos ou de terceiros sem autorização; (b) usar o Serviço para spam, fraude ou candidaturas em massa abusivas; (c) tentar contornar limites técnicos, de segurança ou de cobrança; (d) violar direitos de terceiros ou a lei.

## 9. Responsabilidades

9.1. **Responderemos pelos danos que comprovadamente decorrerem de falha do próprio Serviço**, nos termos do Código de Defesa do Consumidor.

9.2. **Não responderemos quando o dano decorrer de culpa exclusiva do Usuário (por exemplo, dados falsos ou desatualizados, aprovação de um resumo com erro visível, decisão de aceitar termos de um site) ou de culpa exclusiva de terceiro (por exemplo, decisões, bloqueios ou falhas de sites de vagas e de empregadores)**, conforme o art. 14, § 3º, do CDC.

9.3. **Nas hipóteses em que a lei permitir limitar a indenização (por exemplo, Usuário pessoa jurídica ou profissional em relação não consumerista), a indenização por danos materiais ficará limitada ao valor pago pelo Usuário ao {{NOME_FANTASIA}} nos 12 (doze) meses anteriores ao evento.** Nada nestes Termos exclui ou atenua responsabilidade que não possa ser excluída ou atenuada por lei, em especial perante consumidores (arts. 25 e 51, I, do CDC).

## 10. Planos, pagamento e cancelamento

10.1. Planos pagos, quando houver, são descritos em {{SITE_URL}}/precos. Contratações online podem ser canceladas em até 7 (sete) dias, com reembolso integral (art. 49 do CDC). O Usuário pode encerrar a conta a qualquer momento.

## 11. Suspensão e encerramento

Podemos suspender ou encerrar contas que violem estes Termos ou a lei, mediante aviso quando possível, preservados os direitos do Usuário quanto a seus dados (Política de Privacidade).

## 12. Registros (logs)

Mantemos registros de acesso a aplicações (data, hora, IP) pelo prazo mínimo de **6 (seis) meses**, sob sigilo, em ambiente controlado (art. 15 do Marco Civil da Internet, Lei nº 12.965/2014), e registros de aceite pelo prazo necessário à defesa de direitos.

## 13. Alterações destes Termos

13.1. Podemos alterar estes Termos. Alterações relevantes serão comunicadas com antecedência mínima de **15 (quinze) dias** por e-mail e/ou aviso no Serviço, indicando o que mudou. Quando a alteração afetar direitos ou riscos aceitos, **solicitaremos novo aceite**; sem ele, as funcionalidades afetadas ficam suspensas e você pode encerrar a conta sem custo.

## 14. Atendimento

Canal de atendimento: {{EMAIL_CONTATO}}. Respondemos em até 5 (cinco) dias úteis.

## 15. Lei aplicável, idioma e foro

15.1. Estes Termos são regidos pelas leis da República Federativa do Brasil e redigidos em língua portuguesa, que prevalece sobre qualquer tradução.

15.2. **Fica eleito o foro do domicílio do Usuário consumidor** (art. 101, I, do CDC). Para relações não consumeristas, o foro da comarca de {{CIDADE_UF}}.
$legal$, '70e9046b0b818dea8e3cfffade3825a0dd043c10bb371db47c3582ca4acffc38');
insert into public.legal_documents (slug, version, title, effective_date, body_md, template_sha256)
values ('politica-de-privacidade', '2026-10-23.1', 'Política de Privacidade', '23/10/2026', $legal$# Política de Privacidade — {{NOME_FANTASIA}}

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
$legal$, 'bf6cea4aacf36dfc620b904544a03372f5ebd4ea365bdf0366d080c0627d7f73');
insert into public.legal_documents (slug, version, title, effective_date, body_md, template_sha256)
values ('termo-riscos-automacao', '2026-10-23.1', 'Termo de Ciência e Aceite de Riscos da Automação', '23/10/2026', $legal$# Termo de Ciência e Aceite de Riscos da Automação — {{NOME_FANTASIA}}

> **MINUTA – revisar com advogado.** Versão {{VERSAO}} · vigência a partir de {{DATA_VIGENCIA}}. Rascunho técnico; não é parecer jurídico.

Este Termo complementa os [Termos de Uso]({{SITE_URL}}/termos) e a [Política de Privacidade]({{SITE_URL}}/privacidade) de {{RAZAO_SOCIAL}} (CNPJ {{CNPJ}}). Ele explica, em linguagem simples, **os riscos de usar a candidatura automatizada**. Leia até o final. Você só poderá usar a candidatura na nuvem depois de aceitar cada item separadamente. Você pode revogar este aceite a qualquer momento em Configurações → Riscos e responsabilidades; a candidatura na nuvem será desativada.

## O que a automação faz

Quando você pede, um navegador na nuvem abre o site da vaga, preenche o formulário com os seus dados e respostas, e para na revisão. **Nada é enviado sem a sua aprovação do resumo final.**

## Riscos e responsabilidades (leia com atenção)

**1. Sites que proíbem robôs.** Alguns sites de vagas proíbem automação nos seus termos. **Usar a automação nesses sites pode causar bloqueio da sua conta no site ou recusa da candidatura. Avisamos quando o site é conhecido como restritivo, mas a lista pode estar incompleta. A decisão de prosseguir é sua.**

**2. Termos de sites aceitos só por você.** **O sistema nunca marca, por conta própria, caixas de termos, privacidade, marketing ou consentimento.** Quando o site pedir, a execução pausa e mostra o link do texto; você escolhe "Aceito" ou "Cancelar". **Ao clicar em "Aceito", é você quem aceita os termos daquele site**, e sua decisão fica registrada com o endereço do texto e uma impressão digital (hash) dele.

**3. Criação de contas e senhas.** **Se você autorizar, o sistema pode criar uma conta no site com o seu e-mail e uma senha gerada, guardada criptografada.** A conta é sua. Você pode ver ou trocar a senha em Configurações.

**4. Leitura de e-mail e abertura de links.** **Com o Gmail conectado (somente leitura), o sistema lê e-mails ligados às suas candidaturas para achar respostas, códigos de verificação e links de confirmação, e abre apenas links do domínio do site da candidatura.** Instruções escritas em e-mails nunca são seguidas.

**5. Erros da inteligência artificial.** **A IA pode errar e preencher um dado incorreto. Respostas de baixa confiança aparecem destacadas na revisão. Revise sempre antes de aprovar: o que você aprovar será enviado em seu nome.**

**6. Receitas aprendidas podem ficar desatualizadas.** **Em sites novos, o sistema aprende os passos e os repete depois. Se o site mudar, a receita pode falhar; quando não for seguro, a execução pausa e pede sua confirmação.**

**7. LinkedIn.** A candidatura automatizada no LinkedIn está desativada, pois as regras daquela plataforma não permitem.

**8. Navegador na nuvem e provedores no exterior.** **Seus dados de candidatura passam por provedores de navegador na nuvem (Browserbase, Kernel, Steel, Browserless) e de infraestrutura (Supabase, Upstash, Netlify) e de IA (Google Gemini), localizados principalmente nos Estados Unidos.** Detalhes na Política de Privacidade (transferência internacional).

**9. Cotas e disponibilidade.** **Parte do serviço usa cotas gratuitas ou limitadas. Quando acabarem, a candidatura pode ficar indisponível ou atrasar.**

**10. Sua responsabilidade.** **Você é o autor das candidaturas e responde pela veracidade dos dados e respostas e pelos aceites que fizer. Não garantimos emprego, entrevista ou resposta.** Respondemos pelas falhas comprovadas do próprio serviço, nos termos da lei.

**11. Permissões permanentes (opcional).** Em Configurações → Permissões do agente você pode, se quiser, autorizar o sistema a realizar certas ações sem perguntar a cada vez: aceitar termos de sites, criar contas, abrir links e usar códigos recebidos por e-mail, aceitar caixas de marketing e, com confirmação adicional, enviar a candidatura final. A autorização pode valer para todos os sites ("Sempre permitir") ou só para os sites da sua lista ("Permitir em sites da lista"); uma lista de bloqueio sempre prevalece. **Ao ativar uma permissão permanente, você nomeia o VagaPilot seu mandatário para praticar aquela ação em seu nome, inclusive aceitar os termos daqueles sites e informar os dados das categorias que você marcar, e esses atos valem como se você mesmo os tivesse praticado.** A permissão vale **somente para as categorias de dados que você marcar uma a uma** (contato; documentos como CPF/RG; endereço; pretensão salarial; família/estado civil; diversidade; saúde/PcD; antecedentes, vínculos e compliance; termos do site; marketing/opt-in); nenhuma vem marcada. **Dados sensíveis (diversidade, saúde e deficiência — art. 11 da LGPD) só são cobertos se você marcar cada categoria em destaque e digitar uma confirmação própria; esse é o seu consentimento específico e destacado para que o agente os informe e consinta em seu nome nos sites cobertos.** Quando uma etapa envolver categoria que você não marcou, o agente pergunta. Mesmo com permissão ativa: **(a) marketing fica desmarcado até você confirmá-lo; (b) sites classificados como de alto risco sempre perguntam; e (c) o envio final automático fica desligado até você digitar a confirmação adicional — sem ela, cada envio depende da sua aprovação do resumo.** Após cada candidatura, e na revisão antes do envio, mostramos o relatório "Dados sensíveis enviados" (pergunta, resposta exata, categoria, origem da autorização e confiança da IA), guardado criptografado e visível só para você; administradores veem apenas contagens por categoria. Se você optar (desligado por padrão), avisamos por e-mail **apenas** quando um dado dessas categorias for preenchido por permissão permanente, sem incluir os dados no assunto. Cada ativação, alteração e revogação fica registrada no histórico de aceites, e cada ação automática fica registrada com o site, o endereço dos termos e o hash do texto, visível no histórico de atividade. **Você pode revogar qualquer permissão ou categoria a qualquer momento**, com efeito para as próximas ações; para corrigir um dado já enviado, siga as instruções "Corrigir/contestar" do relatório (o site terceiro decide se permite edição).

## Registro do aceite

Ao aceitar, registramos: data e hora (servidor, UTC), IP, navegador, sessão, a versão e o hash deste texto e cada item marcado. Você recebe uma cópia e pode baixá-la em Configurações. Guardamos esse registro enquanto durar a conta e pelo prazo necessário à defesa de direitos; registros de acesso por no mínimo 6 meses (Marco Civil da Internet, art. 15).

Dúvidas: {{EMAIL_CONTATO}}.
$legal$, 'c47a90283c072abcbbc4a2f9561c05f31985d2afaade46dd69c96aa82dc86dcc');
