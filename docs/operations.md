# Operação, backups e restauração

Esta fundação ainda não executa backups. O procedimento operacional de produção deverá armazenar
backup do MySQL e dos anexos em destino protegido, separado do servidor, com criptografia,
retenção definida e acesso restrito.

## Consistência

Anexos futuros devem usar chaves imutáveis. Em cada backup, registrar um identificador e horário de
referência comuns para o dump do MySQL e o snapshot/backup dos arquivos. Use `mysqldump
--single-transaction` para tabelas InnoDB e captura versionada dos anexos; se o destino de arquivos
não suportar snapshot/versionamento, pausar gravações durante a captura para manter o par
consistente. Nunca salvar backups dentro da pasta pública do frontend.

## Restauração

1. Isolar um ambiente de recuperação e verificar a integridade dos artefatos e a chave de
   criptografia.
2. Restaurar o schema e os dados MySQL no mesmo ponto de referência dos arquivos.
3. Restaurar anexos para armazenamento privado e conferir chaves/contagens referenciadas.
4. Aplicar migrations pendentes de forma controlada, validar `npm run db:check` e os health checks.
5. Fazer amostragem de chamados, histórico e downloads com autorização; documentar horário e
   resultado do ensaio.

Antes da produção, definir RPO/RTO, retenção, monitoramento de falhas e executar restaurações
periódicas. Não considerar um backup válido sem teste de restauração.
