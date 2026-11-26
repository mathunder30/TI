# Mensagens, status e anexos de chamados

## Endpoints

Todos os endpoints requerem sessão válida. Operações de escrita também exigem `Origin` permitido e
`x-csrf-token` da sessão.

| Endpoint                                            | Acesso                           | Efeito                                                                                                                            |
| --------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/tickets/:id/messages`                  | Funcionário dono ou TI singleton | Lista apenas mensagens públicas em ordem cronológica.                                                                             |
| `POST /api/v1/tickets/:id/messages`                 | Funcionário dono ou TI singleton | Cria mensagem imutável e evento `MENSAGEM`; resposta do funcionário ao TI aguardando retorno muda o status para `EM_ATENDIMENTO`. |
| `POST /api/v1/tickets/:id/request-information`      | TI singleton                     | Cria mensagem pública e muda o chamado para `AGUARDANDO_FUNCIONARIO` na mesma transação.                                          |
| `PATCH /api/v1/tickets/:id/status`                  | TI singleton                     | Inicia triagem ou atendimento conforme a máquina de estados.                                                                      |
| `POST /api/v1/tickets/:id/resolve`                  | TI singleton                     | Registra solução e muda para `RESOLVIDO`, com histórico e auditoria.                                                              |
| `POST /api/v1/tickets/:id/confirm-resolution`       | Funcionário dono                 | Confirma solução e encerra como `FECHADO`.                                                                                        |
| `POST /api/v1/tickets/:id/reopen`                   | Funcionário dono                 | Solicita reabertura de chamado `RESOLVIDO` com justificativa de 10 a 2.000 caracteres.                                            |
| `GET /api/v1/tickets/:id/attachments`               | Funcionário dono ou TI singleton | Lista metadados dos anexos autorizados.                                                                                           |
| `POST /api/v1/tickets/:id/attachments`              | Funcionário dono ou TI singleton | Recebe um arquivo no campo multipart `file`.                                                                                      |
| `GET /api/v1/tickets/:id/attachments/:attachmentId` | Funcionário dono ou TI singleton | Baixa o arquivo após validar chamado e anexo.                                                                                     |
| `GET /api/v1/tickets/ti`                            | TI singleton                     | Lista a fila global de atendimento com paginação.                                                                                 |

O formulário de solução exige de 10 a 5.000 caracteres. Mensagens públicas aceitam de 1 a 5.000
caracteres. Mensagens, eventos e alterações relacionadas são persistidos na mesma transação. Não há
endpoints para edição ou exclusão de mensagens/histórico. Comentários com visibilidade `INTERNA` não
são retornados ao funcionário.

## Transições implementadas

| Origem                                               | Operação                                          | Destino                  |
| ---------------------------------------------------- | ------------------------------------------------- | ------------------------ |
| `ABERTO`                                             | TI inicia triagem                                 | `EM_TRIAGEM`             |
| `EM_TRIAGEM`                                         | TI inicia atendimento                             | `EM_ATENDIMENTO`         |
| `REABERTO`                                           | TI retoma pela triagem                            | `EM_TRIAGEM`             |
| `AGUARDANDO_FUNCIONARIO`                             | TI retoma atendimento                             | `EM_ATENDIMENTO`         |
| `ABERTO`, `EM_TRIAGEM`, `EM_ATENDIMENTO`, `REABERTO` | TI solicita informação com mensagem               | `AGUARDANDO_FUNCIONARIO` |
| `AGUARDANDO_FUNCIONARIO`                             | Funcionário responde por mensagem                 | `EM_ATENDIMENTO`         |
| `EM_ATENDIMENTO`                                     | TI registra solução                               | `RESOLVIDO`              |
| `RESOLVIDO`                                          | Funcionário confirma a solução                    | `FECHADO`                |
| `RESOLVIDO`                                          | Funcionário solicita reabertura com justificativa | `REABERTO`               |

As transições são serializadas com lock da linha do chamado e falham com `409` quando o status de
origem não é permitido. A autorização de funcionário consulta simultaneamente o ID do chamado e o
solicitante da sessão. A fila e ações de TI exigem papel `TI` e vínculo ao único slot em
`admin_accounts`.

Uma mensagem comum do TI não altera status; somente o endpoint de solicitação de informações e as
transições explícitas mudam o fluxo. A resposta do funcionário a um chamado em
`AGUARDANDO_FUNCIONARIO` o retorna a `EM_ATENDIMENTO`. Não há operação de reabertura após
`FECHADO` nem operação de cancelamento nesta entrega; a reabertura implementada é a solicitação do
funcionário enquanto o chamado está `RESOLVIDO`.

## Anexos privados

Os formatos aceitos são JPG/JPEG, PNG e PDF. A API compara extensão, MIME enviado e assinatura
detectada nos bytes. O limite padrão é 10 MiB por arquivo e cinco anexos por chamado; configure
`ATTACHMENT_MAX_SIZE_BYTES`, `ATTACHMENT_MAX_PER_TICKET` e `ATTACHMENT_STORAGE_DIR` no ambiente do
backend. A pasta padrão `private-attachments/` fica fora de `frontend/public`, não é servida como
estático e está excluída do Git. Os nomes físicos usam UUID aleatório; o nome original é apenas
metadado para exibição.

O upload grava em disco um arquivo temporário privado (sem manter o arquivo inteiro em memória),
move para uma chave aleatória sob lock do chamado e grava metadados e evento de histórico na mesma
transação MySQL. Em falhas observadas da transação, o backend remove o temporário e o arquivo final.
Como filesystem e MySQL não oferecem transação distribuída, queda abrupta do processo entre
gravação e commit, ou resposta de commit ambígua por perda de conexão, ainda pode deixar um arquivo
órfão ou metadados sem arquivo; implantação deve incluir rotina periódica de reconciliação das
chaves e dos arquivos sem referência.

Antes de produção, os arquivos devem passar por análise antimalware/quarentena e políticas de
retenção compatíveis com backup. Configure ACLs restritivas no volume de armazenamento, mantenha-o
fora do diretório público e inclua-o nos backups privados documentados em
[`operations.md`](operations.md). Download sempre passa pelo endpoint autenticado; o servidor
define `Content-Disposition: attachment` e `X-Content-Type-Options: nosniff`.

## Banco e migrations

Não foi necessária migration nesta entrega: `TicketComment`, `TicketAttachment`, `TicketHistory`,
`AuditLog`, os enums de status/evento e a relação singleton `AdminAccount` já estavam presentes nas
migrations aplicadas. As operações reutilizam essas tabelas e mantêm comentário/evento e estado
consistentes em transação.
