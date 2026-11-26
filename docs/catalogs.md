# Carga inicial de unidades, setores e categorias

## Estado do sistema

O schema atual permite várias unidades e vários setores associados a cada unidade. O comando de
provisionamento TI, porém, só cria uma unidade e um setor iniciais e não pode ser repetido depois
que existe um administrador. Ele continua sendo exclusivamente o bootstrap do administrador.

A rotina `catalogs:sync` é independente e lê um arquivo JSON fornecido pelo operador. Os nomes e
códigos reais das unidades e setores não ficam fixos no código nem no repositório. O catálogo de
categorias é distinto e recebe as nove categorias iniciais pelo comando de seed.

## Formato do arquivo

Crie um arquivo privado fora do repositório, por exemplo `catalogo-inicial.json`, com este formato
versionado. Substitua os textos de exemplo pelos nomes e códigos oficiais fornecidos pelo São
Camilo; eles são apenas marcadores, não nomes reais de unidades:

```json
{
  "version": 1,
  "units": [
    {
      "code": "CODIGO_OFICIAL_UNIDADE_1",
      "name": "PREENCHER_NOME_OFICIAL_DA_UNIDADE_1",
      "departments": [
        { "code": "CODIGO_OFICIAL_SETOR_1", "name": "NOME_OFICIAL_DO_SETOR" },
        { "code": "CODIGO_OFICIAL_SETOR_2", "name": "NOME_OFICIAL_DO_SETOR" }
      ]
    },
    {
      "code": "CODIGO_OFICIAL_UNIDADE_2",
      "name": "PREENCHER_NOME_OFICIAL_DA_UNIDADE_2",
      "departments": []
    }
  ]
}
```

Inclua no mesmo arquivo todas as unidades e setores conhecidos. Cada unidade usa código e nome;
cada setor usa código e nome dentro da unidade. Códigos aceitam letras, números, hífen e sublinhado
(são normalizados para maiúsculas). Códigos e nomes não podem se repetir dentro do escopo definido
pelo schema. `isActive` é opcional; novos registros ficam ativos por padrão. Para desativar um
registro existente, use explicitamente `"isActive": false`. Campo omitido mantém o estado atual.

O sincronizador cria novos registros e atualiza nome/estado de registros com o mesmo código. Não
apaga registros ausentes do arquivo; use `isActive: false` para desativar sem romper vínculos
históricos. Toda a carga é transacional: conflito de unicidade interrompe a carga sem aplicar parte
do arquivo.

## Execução

Depois de configurar `.env` e aplicar as migrations, rode a carga passando o caminho do arquivo:

```powershell
npm run catalogs:sync --workspace @sao-camilo/backend -- --file "C:\caminho-protegido\catalogo-inicial.json"
```

O comando informa somente quantos registros processou; não imprime os nomes do catálogo. Pode ser
executado novamente com o mesmo arquivo sem duplicar linhas. Para adicionar outra unidade/setor,
atualize o arquivo e execute novamente. Preserve e proteja o arquivo conforme os controles internos
da instituição.

## Categorias iniciais

O seed usa códigos estáveis e cria somente categorias ausentes. Execuções repetidas não duplicam,
renomeiam nem reativam categorias que já tenham sido alteradas administrativamente.

```powershell
npm run db:seed:ticket-categories --workspace @sao-camilo/backend
```

As categorias iniciais são Hardware, Software, Internet e rede, Impressoras, Acessos e permissões,
Sistemas, Telefonia, Manutenção de equipamentos e Outros.

Nenhuma migration é necessária para estas rotinas: a Etapa 1 já criou as tabelas `units`,
`departments` e `ticket_categories` com as relações e restrições usadas pelos scripts. A próxima
entrega de chamados deverá criar uma migration própria para os campos/contador de protocolo que
forem aprovados; esta entrega não modifica migrations anteriores.
