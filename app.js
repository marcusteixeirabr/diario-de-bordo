// Diário de Bordo: lê o manifesto.json, monta a navegação e renderiza as notas em Markdown.
// Rotas no formato #/<stack>/<nota>, onde <nota> é o nome do arquivo sem ".md".

const estado = {
  manifesto: null,
  pedido: 0, // evita que uma nota lenta sobrescreva uma clicada depois
};

const $ = (id) => document.getElementById(id);

function slugDaNota(nota) {
  return nota.arquivo.split("/").pop().replace(/\.md$/, "");
}

function normalizar(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function formatarData(iso) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function escapar(texto) {
  const div = document.createElement("div");
  div.textContent = texto;
  return div.innerHTML;
}

async function iniciar() {
  try {
    const resposta = await fetch("manifesto.json", { cache: "no-cache" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    estado.manifesto = await resposta.json();
  } catch (erro) {
    mostrarErroDeCarregamento(erro);
    return;
  }

  montarLateral();
  $("busca").addEventListener("input", buscar);
  window.addEventListener("hashchange", rotear);
  rotear();
}

function mostrarErroDeCarregamento(erro) {
  $("stack-titulo").textContent = "Não deu para carregar";
  const viaArquivo = location.protocol === "file:";
  $("nota").innerHTML = `
    <div class="aviso">
      <h2>O manifesto não carregou</h2>
      ${viaArquivo
        ? `<p>Você abriu o <code>index.html</code> direto do disco (<code>file://</code>), e o navegador bloqueia o <code>fetch()</code> dos arquivos nesse modo.</p>
           <p>Sirva a pasta por HTTP:</p>
           <ul>
             <li>No VS Code: botão direito no <code>index.html</code> → <strong>Open with Live Server</strong>.</li>
             <li>Ou no terminal, dentro da pasta: <code>python -m http.server</code> e abra <code>http://localhost:8000</code>.</li>
           </ul>`
        : `<p>Erro: <code>${escapar(String(erro.message || erro))}</code>. Confira se o <code>manifesto.json</code> existe e é um JSON válido.</p>`}
    </div>`;
}

function montarLateral() {
  const nav = $("stacks");
  nav.innerHTML = "";
  for (const stack of estado.manifesto.stacks) {
    const link = document.createElement("a");
    link.className = "stack-link" + (stack.notas.length ? "" : " sem-notas");
    link.href = `#/${stack.id}`;
    link.dataset.stack = stack.id;
    link.innerHTML = `<span>${escapar(stack.nome)}</span><span class="contador">${stack.notas.length}</span>`;
    nav.appendChild(link);
  }
}

function rotear() {
  const { stacks } = estado.manifesto;
  const [, idStack, idNota] = location.hash.replace(/^#/, "").split("/");

  let stack = stacks.find((s) => s.id === idStack);
  if (!stack) stack = stacks.find((s) => s.notas.length) || stacks[0];
  if (!stack) return;

  let nota = stack.notas.find((n) => slugDaNota(n) === idNota);
  if (!nota) nota = stack.notas[0];

  // Normaliza a URL sem criar entrada extra no histórico
  const esperado = nota ? `#/${stack.id}/${slugDaNota(nota)}` : `#/${stack.id}`;
  if (location.hash !== esperado) history.replaceState(null, "", esperado);

  marcarStackAtiva(stack);
  montarAbas(stack, nota);
  if (nota) carregarNota(stack, nota);
  else mostrarStackVazia(stack);
}

function marcarStackAtiva(stack) {
  $("stack-titulo").textContent = stack.nome;
  for (const link of document.querySelectorAll(".stack-link")) {
    link.classList.toggle("ativo", link.dataset.stack === stack.id);
  }
}

function montarAbas(stack, notaAtual) {
  const abas = $("abas");
  abas.innerHTML = "";
  for (const nota of stack.notas) {
    const aba = document.createElement("a");
    aba.className = "aba" + (nota === notaAtual ? " ativa" : "");
    aba.href = `#/${stack.id}/${slugDaNota(nota)}`;
    aba.setAttribute("role", "tab");
    aba.setAttribute("aria-selected", nota === notaAtual ? "true" : "false");
    aba.textContent = nota.titulo;
    abas.appendChild(aba);
  }
}

function mostrarStackVazia(stack) {
  document.title = `${stack.nome} · Diário de Bordo`;
  $("nota").innerHTML = `
    <h2>Ainda sem notas de ${escapar(stack.nome)}</h2>
    <p class="vazio">A pasta já está pronta. Esta é uma das próximas paradas do diário.</p>`;
}

async function carregarNota(stack, nota) {
  const meuPedido = ++estado.pedido;
  const alvo = $("nota");
  alvo.innerHTML = `<p class="vazio">Carregando…</p>`;

  try {
    const resposta = await fetch(nota.arquivo, { cache: "no-cache" });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const markdown = await resposta.text();
    if (meuPedido !== estado.pedido) return;

    const data = nota.data ? `<span class="data">Escrita em ${formatarData(nota.data)}</span>` : "";
    alvo.innerHTML = data + marked.parse(markdown);
    alvo.querySelectorAll("pre code").forEach((bloco) => hljs.highlightElement(bloco));
    document.title = `${nota.titulo} · ${stack.nome} · Diário de Bordo`;
    window.scrollTo({ top: 0 });
  } catch (erro) {
    if (meuPedido !== estado.pedido) return;
    alvo.innerHTML = `
      <h2>Não achei esta nota</h2>
      <p>O manifesto aponta para <code>${escapar(nota.arquivo)}</code>, mas o arquivo não carregou (${escapar(String(erro.message || erro))}).</p>`;
  }
}

function buscar() {
  const termo = normalizar($("busca").value.trim());
  const nav = $("stacks");
  const caixa = $("resultados");

  if (!termo) {
    caixa.hidden = true;
    nav.hidden = false;
    return;
  }

  const achados = [];
  for (const stack of estado.manifesto.stacks) {
    for (const nota of stack.notas) {
      if (normalizar(nota.titulo).includes(termo)) achados.push({ stack, nota });
    }
  }

  nav.hidden = true;
  caixa.hidden = false;
  caixa.innerHTML = achados.length
    ? achados.map(({ stack, nota }) => `
        <a class="resultado" href="#/${stack.id}/${slugDaNota(nota)}">
          <span>${escapar(nota.titulo)}</span>
          <small>${escapar(stack.nome)}</small>
        </a>`).join("")
    : `<p class="sem-resultado">Nenhuma nota com esse título.</p>`;
}

// Limpa a busca ao escolher um resultado, voltando para a lista de assuntos
$("resultados").addEventListener("click", (evento) => {
  if (evento.target.closest(".resultado")) {
    $("busca").value = "";
    buscar();
  }
});

iniciar();
