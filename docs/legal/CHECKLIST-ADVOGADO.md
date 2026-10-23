# Checklist para revisão jurídica

> Documento técnico de apoio para o advogado de Bruno. **Não é parecer nem aconselhamento jurídico** e não afirma a validade de nenhuma cláusula ou do mecanismo de aceite.

## Textos envolvidos (MINUTAS)
- `termos-de-uso.md`, `politica-de-privacidade.md`, `termo-riscos-automacao.md` (tags em `TAGS.md`, valores em `LEGAL_VARS`, `packages/core/src/legal.ts`).

## Decisões de desenho adotadas (validar)
1. **Mandato (CC arts. 653 e ss.)**: o serviço age em nome e por instrução do usuário; envio final sempre depende da aprovação do resumo. Validar se a caracterização de mandato é adequada (vs. mera ferramenta) e efeitos perante terceiros (sites/empregadores).
2. **Obrigação de meio**: sem garantia de emprego, resposta ou sucesso.
3. **Cláusulas limitativas destacadas (CDC art. 54, § 4º)**: em negrito no texto e com checkbox separada por risco no aceite.
4. **Limitação de responsabilidade**: sem exclusão total (CDC arts. 25 e 51, I); exclusão só por culpa exclusiva do usuário ou de terceiro (CDC art. 14, § 3º); teto (12 meses de valores pagos) apenas onde a lei permitir (relações não consumeristas). Validar redação e se o teto deve existir.
5. **Foro**: domicílio do consumidor (CDC art. 101, I); foro da sede só para não consumidores.
6. **Arrependimento** de 7 dias (CDC art. 49) para contratação online.
7. **Alterações**: aviso de 15 dias e re-aceite quando afetar direitos/riscos. Validar prazo.
8. **Bases legais LGPD por finalidade** (tabela da Política); legítimo interesse com nota de balanceamento (sem LIA formal documentada — **pendente**).
9. **Dados sensíveis (art. 11)**: só se o usuário fornecer, com consentimento específico; IA nunca preenche sozinha.
10. **Transferência internacional (art. 33)**: fundamento escolhido (cláusulas contratuais dos provedores + consentimento específico). Verificar a Resolução ANPD nº 19/2024 (cláusulas-padrão) e os contratos (DPA) de cada provedor.
11. **Gmail – Limited Use**: texto de divulgação incluído para verificação OAuth do Google; validar alinhamento com a política vigente do Google.
12. **Logs (Marco Civil art. 15)**: mínimo de 6 meses; aceite guardado pelo prazo prescricional (definir prazo exato — CDC art. 27 = 5 anos?).
13. **Menores**: proibido < 18 anos (sem verificação de idade além da declaração).

## Mecanismo de aceite eletrônico (validar força probatória)
- Clickwrap: texto integral com rolagem obrigatória até o fim, checkboxes separadas e não pré-marcadas, confirmação digitada opcional ("ACEITO" ou nome), botão "Li e aceito", sessão recente (< 5 min) exigida.
- Evidência append-only (trigger bloqueia UPDATE/DELETE) com: usuário, e-mail, documento/versão/hash SHA-256 do **texto renderizado**, estado de cada checkbox, confirmação digitada, data/hora do servidor (UTC), IP, user agent, sessão, idioma, versão da UI, encadeamento de hashes (prev_hash).
- Certificado JSON por aceite (download do usuário e do admin) e cópia por e-mail (Gmail do usuário somente se ele aprovar; senão e-mail transacional, se configurado).
- Referências citadas no projeto (a confirmar): MP 2.200-2/2001 art. 10 § 2º; Lei 14.063/2020 (assinatura eletrônica simples); CPC art. 411 (autenticidade de documento eletrônico).
- **Riscos residuais**: o hash chain é interno (sem carimbo de tempo de terceiro/ICP-Brasil); o operador do banco poderia, em tese, reconstruir a cadeia. Avaliar carimbo do tempo (ACT) ou ancoragem externa periódica.

## Pontos que exigem validação específica
- Aceite de termos de **sites de terceiros** sempre feito pelo usuário (cada decisão registrada com URL e hash do texto do site). Avaliar responsabilidade se o site considerar a automação violação dos seus termos.
- Criação de contas em sites de terceiros em nome do usuário e guarda de senha.
- Leitura de e-mails e abertura automática de links (allowlist por domínio).
- Responsabilidade por erros de IA aprovados pelo usuário.
- Uso de provedores com cotas gratuitas (disponibilidade; contratos de nível de serviço inexistentes).
- Revogação de consentimento: desativa a candidatura na nuvem; definir o que acontece com execuções em andamento (hoje: bloqueia novas e retomadas).
- **Permissões permanentes (cláusula 11 do Termo de Riscos — MINUTA):** mandato por ação e por site (curingas como *.gupy.io) para aceitar termos de terceiros, criar contas, abrir links/códigos de e-mail, marketing e envio final. Validar: (i) se o mandato genérico e antecipado é suficiente para aceitar termos de terceiros em nome do usuário (arts. 653 ss. CC) e como isso se opõe ao site; (ii) se a marcação por categoria + confirmação digitada ("AUTORIZO DADOS SENSIVEIS") atende ao consentimento "específico e destacado" do art. 11, I da LGPD para dados de diversidade e saúde/PcD, inclusive quando o agente consente em nome do titular perante o controlador terceiro; (iii) prazo/escopo do mandato e efeito da revogação sobre aceites já praticados; (iv) registro da ciência na cadeia de hashes como prova (não afirmamos validade jurídica).
- **Conflito com os Termos de Uso, cláusula 2.2:** hoje diz que "o envio final de cada candidatura depende da sua aprovação expressa do resumo". O envio final automático (desligado por padrão, exige digitar "ENVIAR SEM REVISAR") contradiz esse texto — ajustar a 2.2 para ressalvar a permissão permanente antes de publicar, ou manter o envio automático desativado.
- **Relatório "Dados sensíveis enviados":** guardado criptografado, visível só ao titular; administradores veem só contagens por categoria. Avaliar prazo de retenção, inclusão no RIPD e o aviso por e-mail opcional (desligado por padrão; assunto sem dados, mas o corpo lista as respostas preenchidas automaticamente — avaliar se o corpo deve trazer só categorias).

## O que NÃO está coberto
- Conformidade com os **Termos de Uso do LinkedIn** (automação está desativada; não avaliado).
- Responsabilidade da plataforma **perante os sites/ATS terceiros** (violação de termos, scraping, concorrência desleal, Lei 9.610/98 sobre bases de dados).
- Questões trabalhistas e de discriminação em processos seletivos.
- Tributação, emissão de notas, regras de cobrança e Código de Defesa do Consumidor em planos pagos além do básico.
- Legislação estrangeira (GDPR, CCPA) caso haja usuários fora do Brasil.
- Contratos (DPA) com cada operador — precisam ser obtidos e arquivados.
- Política de cookies detalhada e RIPD (Relatório de Impacto, art. 38) — recomendável dado o uso de IA e dados sensíveis.
