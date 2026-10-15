# OrganiFin — Organização & Finanças

Cópia de `lojapersonalise/gestao-personalise`, baseada no commit
`2d3d8f7fd16f3ca8cb33a102ff92e789a2e8a867`, configurada para o Firebase
`copinha-8292b`.

## Identidade e configuração do negócio

O OrganiFin utiliza azul, ciano e verde, com categorias gerais para produtos,
serviços, assinaturas e despesas operacionais. As categorias e as cores podem
ser ajustadas no bloco `APP_CONFIG` de `index.html`.

A coleção `banco_personalise` mantém seu nome técnico por compatibilidade com
os registros e regras de acesso existentes. Alterar a identidade visual não
modifica nem remove os dados já cadastrados.

## Executar localmente

Aplicação estática em HTML, CSS e JavaScript. Não exige npm nem build.
Com Python 3 instalado, execute na raiz deste repositório:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

O servidor deve entregar `index.html`, `app.js`, `style.css` e as imagens.
Firebase 10.8.1, Chart.js 4.4.4 e SortableJS 1.15.7 são servidos da pasta
`vendor`, com versões fixas e verificação de integridade. Os serviços de
autenticação e banco do Firebase precisam de internet.

## Firebase

A configuração web está em `FIREBASE_CONFIG`, no arquivo compartilhado
`firebase-config.js`. O sistema e a ferramenta de migração usam o mesmo projeto.
A aplicação mantém a API compat do Firebase já usada no código original;
não é necessário substituir os scripts por imports npm. O `measurementId`
foi incluído na configuração, mas o Analytics não é inicializado pelo sistema.

No console do projeto `copinha-8292b`, configure:

- Authentication com o provedor E-mail/senha e os usuários que poderão entrar.
- Os domínios de desenvolvimento e de hospedagem em Authentication → Settings → Authorized domains.
- Cloud Firestore com regras de acesso adequadas aos usuários autorizados.
  Antes da migração, a aplicação usa `banco_personalise`. A estrutura por
  registro e a ativação estão descritas em [ATUALIZAR-FIREBASE.md](ATUALIZAR-FIREBASE.md).

A cópia usa o novo projeto: usuários, registros, regras e configurações do
projeto antigo não são transferidos por esta alteração.

O arquivo `CNAME` do original foi omitido para não associar esta cópia ao
domínio `gestao.lojapersonalise.com.br`. Configure um domínio próprio caso
publique a cópia pelo GitHub Pages.

## Verificação

```sh
node --check app.js
curl --fail http://127.0.0.1:8000/
```

No navegador, confirme que a tela de login aparece, sem erros de JavaScript,
e que enviar o formulário vazio mostra “Preencha e-mail e senha.”.
Uma validação completa de login e sincronização exige um usuário autorizado
no novo Firebase. Não use credenciais do projeto original.


## Correções de confiabilidade e segurança

- Os cadastros são apresentados como texto; dados de usuários não são usados
  como código JavaScript em botões e atributos de eventos.
- O salvamento aguarda a confirmação do Firestore. Enquanto houver uma gravação
  em andamento, novas alterações ficam bloqueadas. Falhas mantêm os campos e
  não apresentam a operação como concluída.
- As partes de uma mesma ação são enviadas em uma transação do Firestore.
  Antes da migração, ela mantém o formato `{ lista: [...] }`; depois, grava
  apenas os documentos alterados e a revisão de concorrência.
- Sessões encerradas removem as assinaturas e os dados da interface. Respostas
  de uma sessão antiga não repovoam a memória de uma sessão nova.
- Quantidades, valores, sinal, datas, opções e e-mails são validados no cliente.
  Isso não substitui as regras de autorização e validação do Firebase.
- Baixas superiores ao estoque são recusadas antes de alterar pedidos ou
  recebimentos; o desfazimento usa a quantidade registrada na baixa.
- Exclusões de recebimentos atualizam pedidos abertos e arquivados, incluindo
  a cópia usada para restaurar um pedido. Itens com baixas arquivadas não podem
  ser excluídos enquanto o vínculo existir.
- Valores líquidos são arredondados por lançamento; os totais usam esses
  valores em centavos. Registros antigos com frações de centavo são arredondados
  na apresentação e nas somas, sem regravação automática do histórico.
- Novos vínculos usam `clienteId`. Clientes homônimos podem ser selecionados pelo
  cadastro; registros antigos com nome ambíguo não são atribuídos silenciosamente.
  Ao criar um segundo homônimo, vínculos antigos inequívocos são preservados.
- O e-mail do cliente é salvo e exibido, e os relatórios têm cinco colunas
  correspondentes ao cabeçalho.
- A recuperação de senha usa o fluxo de e-mail do Firebase Authentication. O
  envio real depende das configurações e da entrega de e-mail do projeto.

Estoque: o código não consegue deduzir quanto foi realmente abatido em uma
baixa antiga que já tenha sido registrada com quantidade incorreta. Esses
registros históricos precisam de conferência antes de serem desfeitos. Uma
baixa positiva sem o estoque anterior registrado é bloqueada no desfazimento,
para não aumentar o saldo com base em uma quantidade que não pode ser comprovada.

## Testes de regressão

A aplicação em produção continua estática e não exige npm. Para executar os
testes de desenvolvimento, use Node.js 22 ou superior:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

Se já houver Chromium no ambiente:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm test
```

O comando `npm test` usa um servidor local e um substituto determinístico do Firebase.
Eles não enviam e-mails, não autenticam usuários reais e não acessam registros
de produção. Cobrem falhas de gravação, entradas maliciosas, estoque, vínculos,
arredondamento, clientes, sessão, recuperação de senha, integridade das
bibliotecas e as telas em computador e celular.

## Banco de uma única empresa: transações e armazenamento por registro

A proteção contra gravações simultâneas também funciona no banco antigo, antes
mesmo da migração. O novo formato guarda um documento por registro e utiliza
transações com revisão para recusar alterações feitas sobre dados desatualizados.
As listas originais não são apagadas.

A mudança de formato não acontece automaticamente. Siga o guia
[ATUALIZAR-FIREBASE.md](ATUALIZAR-FIREBASE.md) para publicar as regras, guardar o
backup e executar a ferramenta [migracao.html](migracao.html). A ferramenta
confere a cópia antes de ativá-la e permite retomar uma atualização interrompida.

As regras prontas autorizam apenas o UID do proprietário já informado. O banco
continua sendo de uma única empresa; não há perfis de equipe ou auditoria.

As regras comerciais atuais de arquivar pedidos não pagos, registrar fiado no
saldo e editar recebimentos de pedidos pagos foram preservadas. A revisão
desses comportamentos continua sendo uma etapa separada.
