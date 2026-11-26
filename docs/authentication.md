# Autenticação e acesso

## Métodos e perfis

A API aceita conta local por e-mail e senha, Google OIDC e Sign in with Apple. Há somente os perfis
`FUNCIONARIO` e `TI`. O cadastro público força `FUNCIONARIO`; a única conta TI é criada pela rotina
de provisionamento. Nenhuma autenticação exige domínio institucional.

Google e Apple são ativados somente quando todas as variáveis necessárias estão preenchidas. Sem
credenciais, a API informa o provedor como indisponível e não simula uma autenticação. O envio de
verificação e recuperação também requer configuração SMTP completa.

## Variáveis de ambiente

`SESSION_SECRET` deve ser um segredo aleatório exclusivo do ambiente com ao menos 32 caracteres.
Ele cifra dados temporários de OAuth e de CSRF armazenados no banco. Rotacioná-lo invalida esses
dados; ao planejar a rotação, encerre as sessões e transações OAuth existentes.

Configure os seguintes campos em `.env` ou no secret manager do ambiente de execução:

| Integração | Variáveis                                                                                     | Configuração externa                                                                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google     | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`                             | Cadastre a URL de callback como redirect URI autorizado no cliente OAuth. Callback local padrão: `http://localhost:3000/api/v1/auth/oauth/google/callback`.                                                                                |
| Apple      | `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_REDIRECT_URI` | Configure o Services ID, domínio e URL de retorno no Apple Developer. O segredo do cliente é assinado ES256 pelo backend a partir da chave privada `.p8`. Callback local padrão: `http://localhost:3000/api/v1/auth/oauth/apple/callback`. |
| E-mail     | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`            | Utilize uma conta de serviço SMTP. `SMTP_SECURE=true` é apropriado para TLS implícito, normalmente porta 465; em STARTTLS, use a configuração recomendada pelo provedor.                                                                   |

`FRONTEND_URL` deve ser a origem pública do frontend; a mesma origem precisa constar em
`CORS_ORIGINS`. Em produção, configure HTTPS e credenciais em um gerenciador de segredos. O `.env`
local não deve ser commitado. Endereços Apple Private Relay podem exigir domínio e remetente
autorizados pela Apple.

## Associação de provedores

O identificador estável do provedor (`sub`) é vinculado à conta após autenticação. A API não une
contas automaticamente apenas porque seus e-mails coincidem. Se o e-mail do provedor já pertence a
outra conta, a pessoa deve entrar pelo método existente e vincular o provedor autenticado em
**Métodos de acesso**. Isso evita apropriação de contas por e-mail não verificado. Operações de
vínculo registram auditoria sem guardar tokens ou credenciais.

As sessões usam token opaco em cookie `HttpOnly`, `SameSite=Lax`, `Secure` em produção, persistido
no banco somente como hash. O token CSRF é mantido em memória no frontend e enviado em cabeçalho
nas operações mutáveis autenticadas. Cada início OAuth também cria um cookie de estado separado,
`HttpOnly`, `SameSite=None`, `Secure` e de curta duração, para vincular o retorno do provedor ao
navegador que iniciou o fluxo (incluindo o callback `form_post` da Apple). A API valida origem,
limita tentativas por IP e invalida todas as sessões ao redefinir uma senha. Senhas são armazenadas
com Argon2id.

Os limites por IP usam o armazenamento em memória do processo Express. Em uma implantação com
mais de uma instância, configure um armazenamento compartilhado para que o limite seja global.

## Primeiro administrador TI

O provisionamento é uma operação local/operacional, nunca um endpoint público. Antes de executá-lo,
aplique as migrations, prepare os dados iniciais e carregue temporariamente no ambiente do processo:

- `TI_ADMIN_NAME`, `TI_ADMIN_EMAIL`, `TI_ADMIN_PASSWORD` (mínimo 16 caracteres);
- `INITIAL_UNIT_CODE`, `INITIAL_UNIT_NAME`;
- `INITIAL_DEPARTMENT_CODE`, `INITIAL_DEPARTMENT_NAME`.

Use o secret manager ou um terminal administrativo confiável para injetar os valores. Não passe a
senha como argumento de linha de comando, não a registre no shell e não a inclua em arquivos do
repositório. O comando valida que não existe administrador TI, cria perfil verificado com Argon2id
e grava o slot administrativo e a auditoria na mesma transação. Se já houver conta TI, o comando
falha sem criar outra.

```bash
npm run admin:provision --workspace @sao-camilo/backend
```

Em PowerShell, defina as variáveis no processo da sessão usando um cofre de segredos aprovado pela
organização, execute o comando e remova as variáveis ao terminar. Não execute o bootstrap novamente
para alterar dados; alterações administrativas futuras devem ser realizadas por fluxo autenticado
e auditado.

## Rotas da interface

- `/auth/login`: senha, Google/Apple quando ativados e recuperação de senha.
- `/auth/register`: cadastro FUNCIONARIO com nome, e-mail, senha, unidade e setor ativos.
- `/auth/verify-email` e `/auth/reset-password`: links de uso único enviados por e-mail.
- `/auth/complete`: conclusão do cadastro social com seleção de unidade e setor.
- `/auth/connections`: associação autenticada de métodos de acesso.

As unidades e setores são carregados de registros ativos no MySQL. O administrador inicial pode
inserir os cadastros necessários antes de abrir o cadastro de funcionários.
