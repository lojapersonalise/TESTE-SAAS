# Atualizar o banco de uma única empresa

A atualização mantém a conta atual e seus cadastros. Não cria empresas,
assinaturas ou equipes. O projeto continua sendo `copinha-8292b`, com o
proprietário `OJqtwDYPETUWegYndXmSnRiyNXR2`.

## O que já funciona antes da migração

O site atualizado continua lendo as sete listas atuais. As gravações agora
usam transações: se outra aba ou dispositivo tiver alterado os dados, a operação
é recusada e os campos ficam preenchidos para conferência e nova tentativa.
Isso também funciona com as regras antigas que autorizam somente seu UID.

O armazenamento por registro só é ativado pela ferramenta abaixo. Publicar o
código ou as regras, por si só, não copia nem apaga nenhum registro.

## Passo a passo no navegador

1. Espere a versão nova aparecer no GitHub Pages. Feche o sistema nos outros
   dispositivos e reserve um momento sem novos lançamentos.
2. Entre no Firebase Console, escolha **copinha-8292b → Firestore Database →
   Regras**. Substitua as regras pelo conteúdo completo de
   [firestore.rules](firestore.rules) e clique em **Publicar**. Essas regras são
   para este banco dedicado ao OrganiFin; não mantenha permissões antigas
   amplas em paralelo.
3. Abra a ferramenta no mesmo site:
   [Atualizar banco](https://lojapersonalise.github.io/TESTE-SAAS/migracao.html).
   Entre com a mesma conta proprietária usada no sistema. Nenhuma senha precisa
   ser enviada para terceiros ou para o chat.
4. Clique em **Verificar situação**. Com as regras publicadas, ela informa que
   o banco antigo está ativo e pronto para exportar.
5. Clique em **Exportar backup** e guarde o JSON no computador, preferencialmente
   também em outro local seguro. Esse arquivo contém os dados comerciais;
   não o publique no GitHub. A exportação lê um conjunto consistente de dados.
6. No campo de arquivo, selecione o JSON que acabou de guardar. A ferramenta
   confere o projeto, os identificadores, as contagens e o SHA-256 do conteúdo.
7. Marque **Guardei o backup e ninguém está fazendo lançamentos**. Clique em
   **Iniciar ou retomar atualização** e mantenha a página aberta.
8. Espere **Atualização concluída e conferida**. Só então volte ao sistema,
   atualize a página em todos os dispositivos e confira saldos, pedidos,
   recebimentos, clientes e estoque antes de retomar os lançamentos.

## Se houver interrupção

- Ao iniciar, a ferramenta verifica se os dados ainda correspondem ao backup.
  Se alguém fez lançamentos depois da exportação, ela não inicia a migração:
  exporte e guarde um backup novo.
- Depois do início, as regras bloqueiam gravações nas listas antigas, inclusive
  de versões antigas do site. Os originais permanecem disponíveis para leitura.
- Se a conexão cair ou a aba fechar, abra novamente a ferramenta, selecione o
  mesmo backup e use **Iniciar ou retomar atualização**. A cópia é idempotente:
  retomar não duplica os registros.
- Uma cópia incompleta ou diferente do backup nunca é ativada.
- **Cancelar atualização incompleta** reabre o banco antigo, sem apagar seus
  registros. A cópia parcial fica inativa. Ela não é apagada automaticamente.
- Depois de ativada a versão nova, o botão de cancelamento deixa de permitir
  retorno ao banco antigo. Isso evita perder lançamentos novos. Uma eventual
  restauração posterior exige um plano separado e um backup atualizado.

## Como os dados ficam armazenados

- `banco_personalise/{categoria}`: listas originais preservadas, somente leitura
  depois do início da migração.
- `organifin_config/estado`: formato ativo, identificador da cópia, contagens,
  hash do backup inicial e revisão de concorrência. Não contém listas de dados.
- `organifin_dados/{copia}/{categoria}/{registro}`: um documento por cliente,
  lançamento, pedido, coluna ou item de estoque. Os IDs e os campos originais
  são preservados dentro de `registro`.

Cada alteração compara a revisão carregada com a revisão do servidor dentro de
uma transação. Os documentos afetados e a revisão são gravados juntos.
Adicionar um lançamento não regrava os lançamentos antigos. Se houver conflito,
nenhuma parte da operação é aplicada e o usuário deve conferir e tentar de novo.

As consultas são lidas em páginas de 250 documentos e só são apresentadas quando
a revisão anterior e posterior à leitura coincide. Os relatórios ainda carregam
o conjunto completo de registros em memória; não foi implementada paginação de
histórico no servidor para cada tela. A limitação de 1 MiB de uma lista inteira
é removida; o limite individual de um documento do Firestore continua existindo.
A revisão única é adequada a uma empresa, mas pode gerar tentativas adicionais
se muitos dispositivos fizerem alterações ao mesmo tempo.

Para manter cada ação atômica, alterações acima de 450 documentos são recusadas,
sem dividir silenciosamente a operação. Mudanças em massa devem ser planejadas
em lotes específicos. A migração inicial usa lotes de 100 com retomada segura.

## Índices

O funcionamento usa a ordenação simples por `ordem`, atendida pelo índice padrão
do Firestore. [firestore.indexes.json](firestore.indexes.json) também fornece
isenções de índice para o mapa `registro` nas sete categorias, evitando indexar
campos que a aplicação não consulta. Essas isenções são recomendadas para
reduzir indexação desnecessária; não exigem mudar os cadastros.

Quem utiliza Firebase CLI pode publicar regras e isenções com autenticação
própria, depois de conferir o projeto:

```sh
firebase deploy --only firestore:rules,firestore:indexes --project copinha-8292b
```

Esse comando não é executado pelos testes nem pela instalação de dependências.

## Verificação de desenvolvimento

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run test:integration
```

Os testes de integração exigem Java 21 ou superior. Eles usam exclusivamente o
emulador local, com o projeto `demo-organifin`. Não use credenciais ou registros
de produção nos testes. `CHROMIUM_PATH` pode indicar um Chromium já instalado.
Os testes cobrem concorrência entre clientes, regras, preservação dos dados,
retomada, cancelamento, integridade, crescimento acima de 1 MiB em conjunto e
os fluxos completos do navegador para o sistema e para a migração.

Nenhuma configuração ou dado do Firebase de produção foi alterado pelo agente.
A publicação das regras e a execução da migração no seu projeto são etapas
separadas, feitas por você na conta proprietária.
