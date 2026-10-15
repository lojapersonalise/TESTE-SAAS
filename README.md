# TESTE-SAAS — Loja Personalise

Cópia de `lojapersonalise/gestao-personalise`, baseada no commit
`2d3d8f7fd16f3ca8cb33a102ff92e789a2e8a867`, configurada para o Firebase
`copinha-8292b`.

## Executar localmente

Aplicação estática em HTML, CSS e JavaScript. Não exige npm nem build.
Com Python 3 instalado, execute na raiz deste repositório:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

O servidor deve entregar `index.html`, `app.js`, `style.css` e as imagens.
A aplicação carrega Firebase 10.8.1, Chart.js e SortableJS pela internet.

## Firebase

A configuração web está em `FIREBASE_CONFIG`, no `index.html`.
A aplicação mantém a API compat do Firebase já usada no código original;
não é necessário substituir os scripts por imports npm. O `measurementId`
foi incluído na configuração, mas o Analytics não é inicializado pelo sistema.

No console do projeto `copinha-8292b`, configure:

- Authentication com o provedor E-mail/senha e os usuários que poderão entrar.
- Os domínios de desenvolvimento e de hospedagem em Authentication → Settings → Authorized domains.
- Cloud Firestore com regras de acesso adequadas aos usuários autorizados.
  A aplicação lê e grava documentos na coleção `banco_personalise`.

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
