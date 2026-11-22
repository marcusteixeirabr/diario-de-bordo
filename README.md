# Diário de Bordo

Meu caderno de estudos de programação, publicado em
<https://marcusteixeirabr.github.io/diario-de-bordo/>.

As notas crescem uma a uma, conforme vou aprendendo, organizadas por linguagem ou framework.

## Como funciona

- `notas/<stack>/<assunto>.md`: uma nota por arquivo, em Markdown puro.
- `manifesto.json`: lista as stacks e suas notas (título, arquivo, data). É o único arquivo que muda quando entra nota nova.
- `index.html` + `estilo.css` + `app.js`: lê o manifesto e renderiza o Markdown no navegador com `marked` e `highlight.js`. Sem build.

## Rodar localmente

Abrir o `index.html` com dois cliques não funciona: o navegador bloqueia o `fetch()` em `file://`.

- VS Code: botão direito no `index.html` → **Open with Live Server**.
- Ou: `python -m http.server` dentro da pasta e abrir <http://localhost:8000>.

## Nova nota

1. Criar `notas/<stack>/<assunto>.md`.
2. Adicionar a entrada em `manifesto.json` (e a stack, se for nova).
