# Abertura transacional de chamados

## Endpoint disponível

`POST /api/v1/tickets` abre chamado para o funcionário da sessão. Requer cookie de sessão válido,
origem permitida e cabeçalho `x-csrf-token`. O corpo JSON aceita somente:

```json
{
  "title": "Computador não inicia",
  "description": "O equipamento não liga mesmo conectado à energia.",
  "categoryId": "id-da-categoria-ativa",
  "priority": "MEDIA"
}
```

Título: 5–200 caracteres. Descrição: 10–10.000 caracteres. Prioridade: `BAIXA`, `MEDIA`, `ALTA`
ou `CRITICA`. Campos extras, inclusive IDs/perfil/nome/e-mail/unidade/setor do solicitante, são
rejeitados. O backend usa o usuário da sessão, relê seu perfil no banco e verifica que a unidade e o
setor relacionados estão ativos e pertencem um ao outro.

## Atomicidade e protocolo

Na mesma transação, o backend valida os registros com locks compartilhados, incrementa a linha do
ano em `ticket_protocol_counters`, cria o ticket com status `ABERTO` e prioridade sugerida, grava
os snapshots e registra o evento `ABERTURA`. Qualquer erro reverte todas essas operações,
inclusive o incremento do contador.

O ano é calculado com `America/Sao_Paulo`, independentemente do fuso do processo. O contador é
incrementado por `UPDATE lastNumber = lastNumber + 1` sobre a chave anual, serializando concorrentes
na mesma linha; o índice único de `tickets.number` é a proteção final contra duplicidade. A
sequência usa no mínimo cinco dígitos (`SC-2026-00001`).

Para executar os testes de integração MySQL em PowerShell, use um banco local de desenvolvimento
com as migrations aplicadas:

```powershell
$env:RUN_MYSQL_INTEGRATION = '1'
npm run test --workspace @sao-camilo/backend
Remove-Item Env:RUN_MYSQL_INTEGRATION
```

O conjunto usa fixtures efêmeros e o ano de teste 2098 para não alterar a sequência do ano atual.
Ele se recusa a executar se `NODE_ENV=production` ou se o host do banco não for local.

## Fora desta entrega

Listagem, detalhe, mensagens, anexos, transições de status após a abertura e painel TI permanecem
para entregas posteriores.
