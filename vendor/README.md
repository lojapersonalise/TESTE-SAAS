# Bibliotecas distribuídas com a aplicação

Os arquivos JavaScript foram baixados por HTTPS com validação TLS e são
servidos pelo próprio site. As versões, URLs de origem e hashes SHA-384 estão
em `manifest.json`; `index.html` usa esses mesmos hashes em `integrity`.
Não há referência a `@latest` nem dependência de CDN para carregar as bibliotecas.
O acesso à internet continua necessário para os serviços do Firebase.

- Firebase compat 10.8.1: Apache-2.0; licença em `firebase.LICENSE`.
- Chart.js 4.4.4: MIT; licença em `chartjs.LICENSE.md`.
- SortableJS 1.15.7: MIT; licença em `sortablejs.LICENSE`.

A licença do Firebase foi obtida no tag `firebase@10.8.1` do repositório
oficial `firebase/firebase-js-sdk`. As demais acompanham as versões dos
pacotes usadas acima. Os avisos presentes nos scripts foram preservados.

Atualizações devem alterar os arquivos, os hashes do manifesto e os atributos
`integrity` juntos. O teste automatizado confere essa correspondência.
