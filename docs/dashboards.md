# Indicadores dos dashboards

## Funcionário

`GET /api/v1/tickets/dashboard/employee` calcula os dados a partir do solicitante da sessão; não
aceita IDs de usuário como filtro.

| Indicador                          | Status considerados                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Chamados ativos                    | `ABERTO`, `EM_TRIAGEM`, `EM_ATENDIMENTO`, `AGUARDANDO_FUNCIONARIO`, `RESOLVIDO`, `REABERTO` |
| Em atendimento                     | `EM_ATENDIMENTO`                                                                            |
| Aguardando resposta do funcionário | `AGUARDANDO_FUNCIONARIO`                                                                    |
| Resolvidos                         | `RESOLVIDO`, `FECHADO`                                                                      |

Ativos significa todos os chamados que ainda não chegaram a `FECHADO` ou `CANCELADO`. Por isso,
os indicadores de atendimento e espera se sobrepõem ao total de ativos; `RESOLVIDO` também permanece
ativo enquanto aguarda confirmação ou reabertura. O indicador de resolvidos inclui chamados fechados,
então também há interseção com ativos em `RESOLVIDO`. Os quatro valores não devem ser somados para
obter um total único.

## TI

`GET /api/v1/tickets/dashboard/ti` exige sessão TI e vínculo do usuário ao registro administrativo
singleton. O total inclui todos os status. Os cartões por status são `ABERTO`, `EM_TRIAGEM`,
`EM_ATENDIMENTO`, `AGUARDANDO_FUNCIONARIO`, `REABERTO` e `RESOLVIDO`/`FECHADO`; `CANCELADO` só
aparece no total. A distribuição por prioridade inclui todos os chamados, inclusive fechados e
cancelados.

Os dois endpoints usam uma agregação por status e prioridade e uma busca limitada para os chamados
recentes. As respostas contêm somente os campos necessários às respectivas interfaces.
