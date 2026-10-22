/**
 * FICTITIOUS CV with 3 experiences (CA2.1 fixture). Every person, company, e-mail and
 * phone number here is invented; domains use the reserved `.test` TLD.
 */
export const FICTITIOUS_CV_PT = `Juliana Ficticia Ramos
Engenheira de Software Sênior · São Paulo, SP
juliana.ramos@exemplo.test · (11) 90000-0000

Resumo
Engenheira de software com 9 anos de experiência em plataformas de pagamento e infraestrutura em nuvem.

Experiência

Empresa Alfa Pagamentos — Engenheira de Software Sênior
03/2021 – atual · São Paulo · CLT
- Liderou a migração de 40 serviços para Kubernetes, reduzindo custos de infraestrutura em 30%.
- Coordenou um time de 6 engenheiros na construção da nova API de conciliação.
- Implantou observabilidade com OpenTelemetry e Grafana em todos os serviços críticos.

Beta Logística S.A. — Engenheira de Software Pleno
02/2018 – 02/2021 · Campinas · CLT
- Desenvolveu o roteirizador de entregas em Go, atendendo 12 mil pedidos por dia.
- Reduziu o tempo médio de deploy de 2 horas para 15 minutos com pipelines de CI/CD.

Gama Consultoria — Desenvolvedora
01/2016 – 01/2018 · Remoto · PJ
- Entregou 8 projetos de integração de sistemas para clientes do varejo.
- Automatizou relatórios financeiros com Python, economizando 20 horas mensais.

Formação
Bacharelado em Ciência da Computação — Universidade Exemplo (2011–2015)

Idiomas
Inglês — avançado (C1)
Espanhol — intermediário (B1)

Competências
Kubernetes, Go, Python, PostgreSQL, Terraform

Certificações
AWS Certified Solutions Architect – Associate (2022)
`

export const FICTITIOUS_CV_EXPERIENCES = [
  "Empresa Alfa Pagamentos",
  "Beta Logística S.A.",
  "Gama Consultoria",
] as const
