# Modelo de dados inicial

O schema Prisma fica em `backend/prisma/schema.prisma`. IDs são gerados no backend, datas usam
`DateTime` e o MySQL armazena os horários em UTC. A aplicação deve converter para
`America/Sao_Paulo` ao exibir ou calcular dias úteis.

## Entidades e relações

- `Unit` 1—N `Department`, `User` e `Ticket`. Unidades e setores são desativados logicamente; não
  apagar registros que já tenham vínculos.
- `Department` pertence a uma `Unit`; usuários e chamados guardam também os nomes históricos do
  setor e da unidade no momento da abertura.
- `User` tem um dos dois papéis e pertence a uma unidade e um setor. Chamados guardam uma
  referência opcional ao usuário e cópias imutáveis de nome, e-mail, setor e unidade. Assim,
  alterações de perfil ou desativação não reescrevem o solicitante histórico.
- `AdminAccount` tem uma chave singleton e uma relação 1—1 com o usuário TI. O comando
  `admin:provision` reivindica esse único slot de forma atômica.
- `AuthAccount` permite associar provedores a uma conta. O vínculo por identidade do provedor é
  único; e-mail igual sozinho não deve associar contas.
- `TicketCategory` 1—N `Ticket`. Cada chamado mantém protocolo único, prioridade operacional,
  prioridade sugerida e snapshots do solicitante, categoria, unidade e setor. Categoria, unidade e
  setor relacionados usam referências opcionais para permitir arquivamento sem perder snapshots.
- `TicketProtocolCounter` mantém o último protocolo por ano civil de Brasília. O incremento ocorre
  dentro da transação de abertura e a unicidade final também é protegida pelo índice de `Ticket.number`.
- `TicketComment`, `TicketHistory` e `TicketAttachment` pertencem a um chamado. Comentários
  públicos e internos têm visibilidade explícita; histórico registra eventos e estados; anexos
  guardam metadados e chave privada de armazenamento, não conteúdo público.
- `SystemSetting` guarda configurações versionáveis. `Notification` reserva o identificador de
  deduplicação dos envios futuros.
- `AuditLog` registra operações administrativas, com ator e entidade preservados por snapshot.
  A aplicação futura não deve oferecer edição ou exclusão do log.

## Preservação e integridade

Unidades e setores usam `isActive` e timestamps em vez de exclusão em cascata. As relações de
chamados com usuário, unidade e setor são opcionais porque os snapshots históricos são a fonte
autoritativa para exibição antiga. Não apagar usuários em cascata. A restrição única do slot TI
impede dois administradores provisionados; a autorização ainda será validada no backend.

## Migrations

`prisma/migrations/` é a fonte versionada da estrutura aplicada. Gere mudanças em desenvolvimento
com `npm run db:migrate` e aplique mudanças revisadas em implantação com `npm run db:deploy`.
Não use `db push` como substituto de migrations versionadas.

As tabelas `Unit`, `Department` e `TicketCategory` já permitem múltiplos registros. A rotina
`catalogs:sync` carrega unidades/setores de JSON externo e o seed `db:seed:ticket-categories`
insere as nove categorias iniciais. Consulte [carga de catálogos](catalogs.md) para o contrato e
os comandos. Nenhuma migration foi necessária para esta entrega.
