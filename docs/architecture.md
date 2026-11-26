# Arquitetura inicial

## Componentes

```text
Navegador
   │ HTTP / JSON
   ▼
React + Vite (frontend/, porta 5173)
   │ /api → proxy de desenvolvimento
   ▼
Express + TypeScript (backend/, porta 3000)
   │ Prisma Client
   ▼
MySQL 8 (schema sao_camilo_portal)
```

O frontend não acessa o banco. O backend valida as entradas e será a única camada com acesso ao
Prisma. Prisma 7 usa o driver adapter MariaDB oficial para a conexão MySQL e `prisma.config.ts`
para configurar migrations. `GET /api/v1/health/live` verifica o processo da API;
`GET /api/v1/health/ready` consulta o banco e informa se a aplicação está pronta.

## Limites desta fundação

As pastas e os modelos de dados preparam a evolução, mas não implementam autenticação, regras de
chamados, scheduler, envio de e-mails, upload ou relatórios. Nenhuma credencial de Google ou Apple
é necessária ou simulada nesta etapa. Variáveis e endpoints não devem ser tratados como recursos
funcionais sem a implementação correspondente.

## Decisões de segurança

- Somente `FUNCIONARIO` e `TI` são papéis válidos.
- A tabela singleton `AdminAccount` reserva um único slot administrativo; o futuro provisionamento
  deverá criá-lo no backend, dentro de transação, e recusar segundo administrador.
- A API centraliza erros, aplica Helmet, CORS configurável, limite inicial de JSON e rate limit
  básico por IP.
- Segredos ficam em `.env`, ignorado pelo Git. O frontend recebe apenas variáveis `VITE_*` públicas.
- O log de auditoria será append-only pela API; alterações administrativas deverão registrar ator,
  ação, entidade e diferenças sanitizadas, sem tokens, senhas ou segredos.

## Agendamento futuro

O fechamento após três dias úteis deverá usar uma data de vencimento persistida no chamado e um
job idempotente do backend. Calcular dias no fuso IANA `America/Sao_Paulo`, excluir sábado e
domingo e consultar um calendário de feriados configurável. O job deverá registrar o fechamento
automático no histórico e evitar duplicidade em reinícios ou múltiplas instâncias. Nenhum job está
ativo nesta etapa.

## E-mail futuro

Verificação de cadastro, redefinição de senha e notificações devem usar um serviço SMTP/API
configurado pelo backend via variáveis de ambiente. Em ambiente sem credenciais, a integração deve
ser explicitamente desabilitada; não se deve simular envio.
