# Portal de Chamados de TI — São Camilo

Fundação do monorepo para o portal que atenderá as três unidades do São Camilo. O produto terá
somente os perfis `FUNCIONARIO` e `TI`, com um único administrador de TI. Esta etapa prepara a
estrutura, API, interface inicial, banco MySQL e migrations; não implementa login nem fluxo de
chamados.

## Requisitos locais

- Node.js 20.19+ (recomendado: versão LTS atual) e npm.
- MySQL Server 8.0+, ativo e acessível pela máquina.
- MySQL Shell para a configuração inicial; MySQL Workbench é opcional e serve para administração
  visual.

## Instalação

1. Copie `.env.example` para `.env` e informe uma URL `DATABASE_URL` de um usuário local dedicado
   ao projeto. Não use nem versione credenciais de produção. Um exemplo de URL é
   `mysql://portal_app:SENHA@127.0.0.1:3306/sao_camilo_portal`.
2. Crie o schema e o usuário de desenvolvimento no MySQL (em MySQL Workbench ou MySQL Shell):

   ```sql
   CREATE DATABASE sao_camilo_portal
     CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
   CREATE USER 'portal_app'@'localhost' IDENTIFIED BY 'SENHA_FORTE_LOCAL';
   GRANT ALL PRIVILEGES ON sao_camilo_portal.* TO 'portal_app'@'localhost';
   ```

   Use a mesma senha em `DATABASE_URL`. Em produção, separe as credenciais de migração e de
   execução, concedendo à aplicação somente os privilégios necessários.

3. Instale os pacotes e gere o Prisma Client:

   ```bash
   npm install
   npm run db:generate
   ```

4. Aplique as migrations e confirme a conexão:

   ```bash
   npm run db:deploy
   npm run db:check
   ```

5. Inicie a API e o frontend em modo de desenvolvimento:

   ```bash
   npm run dev
   ```

Frontend: `http://localhost:5173`. API: `http://localhost:3000/api/v1/health/live` e
`http://localhost:3000/api/v1/health/ready`.

## Comandos úteis

| Comando                | Finalidade                                    |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Inicia frontend e API juntos.                 |
| `npm run build`        | Compila os dois workspaces.                   |
| `npm test`             | Executa os testes unitários básicos.          |
| `npm run lint`         | Verifica o código com ESLint.                 |
| `npm run format:check` | Verifica formatação com Prettier.             |
| `npm run db:generate`  | Gera o Prisma Client.                         |
| `npm run db:migrate`   | Cria/aplica migrations em desenvolvimento.    |
| `npm run db:deploy`    | Aplica migrations já versionadas.             |
| `npm run db:status`    | Exibe o estado das migrations.                |
| `npm run db:check`     | Confirma conexão e consulta simples ao MySQL. |

## Organização

- `frontend/`: React, Vite, rotas e estilos.
- `backend/`: API Express, configuração, health checks e Prisma.
- `docs/`: arquitetura, modelo de dados e operação futura.
- `backend/prisma/migrations/`: histórico versionado do schema.

## Etapa atual e limites

O endpoint de prontidão executa `SELECT 1` no banco. A tela inicial serve apenas para validar a
integração com a API. Cadastro, autenticação, OAuth, chamadas, notificações, scheduler, anexos e
relatórios ainda não foram implementados. Os modelos do Prisma registram a estrutura planejada;
ter uma tabela ou rota de saúde não significa que esses fluxos estejam prontos.

Consulte [arquitetura](docs/architecture.md), [modelo de dados](docs/database.md) e
[operação e recuperação](docs/operations.md).
