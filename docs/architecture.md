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

Autenticação local e a estrutura OIDC Google/Apple foram implementadas na Etapa 3. Os provedores
externos permanecem desativados até receberem credenciais reais; veja
[autenticação](authentication.md). Abertura, portal do funcionário, mensagens públicas, transições
de atendimento e anexos privados estão descritos em [ticket-workflow.md](ticket-workflow.md). Os
dashboards operacionais de funcionário e TI estão descritos em [dashboards.md](dashboards.md). O
fechamento automático e relatórios analíticos avançados permanecem fora do escopo atual.

## Decisões de segurança

- Somente `FUNCIONARIO` e `TI` são papéis válidos.
- A tabela singleton `AdminAccount` reserva um único slot administrativo; `admin:provision` cria a
  conta no backend, dentro de transação, e recusa um segundo administrador.
- A API centraliza erros, aplica Helmet, CORS configurável, limite inicial de JSON e rate limit
  básico por IP.
- Segredos ficam em `.env`, ignorado pelo Git. O frontend recebe apenas variáveis `VITE_*` públicas.
- O log de auditoria registra o provisionamento TI e associação de métodos de acesso; operações
  administrativas futuras devem registrar ator, ação, entidade e diferenças sanitizadas, sem
  tokens, senhas ou segredos.

## Agendamento futuro

O fechamento após três dias úteis deverá usar uma data de vencimento persistida no chamado e um
job idempotente do backend. Calcular dias no fuso IANA `America/Sao_Paulo`, excluir sábado e
domingo e consultar um calendário de feriados configurável. O job deverá registrar o fechamento
automático no histórico e evitar duplicidade em reinícios ou múltiplas instâncias. Nenhum job está
ativo nesta etapa.

## E-mail

Verificação de cadastro e redefinição de senha usam SMTP configurado no backend por variáveis de
ambiente. Sem credenciais, essas ações ficam desabilitadas; não se simula envio. Notificações de
chamados dependerão do mesmo serviço quando essa funcionalidade for implementada.
