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
  const [, idStack, idNota, idSecao] = location.hash.replace(/^#/, "").split("/");

  let stack = stacks.find((s) => s.id === idStack);
  if (!stack) stack = stacks.find((s) => s.notas.length) || stacks[0];
  if (!stack) return;

  let nota = stack.notas.find((n) => slugDaNota(n) === idNota);
  if (!nota) nota = stack.notas[0];

  // Normaliza a URL sem criar entrada extra no histórico
  let esperado = nota ? `#/${stack.id}/${slugDaNota(nota)}` : `#/${stack.id}`;
  if (nota && idSecao) esperado += `/${idSecao}`;
  if (location.hash !== esperado) history.replaceState(null, "", esperado);

  marcarStackAtiva(stack);
  montarAbas(stack, nota);
  if (nota) carregarNota(stack, nota, idSecao);
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
  delete $("nota").dataset.arquivo;
  $("nota").innerHTML = `
    <h2>Ainda sem notas de ${escapar(stack.nome)}</h2>
    <p class="vazio">A pasta já está pronta. Esta é uma das próximas paradas do diário.</p>`;
}

// Guarda o Markdown já baixado para trocar de sub-aba sem buscar o arquivo de novo
const cacheMarkdown = new Map();

async function buscarMarkdown(arquivo) {
  if (cacheMarkdown.has(arquivo)) return cacheMarkdown.get(arquivo);
  const resposta = await fetch(arquivo, { cache: "no-cache" });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const texto = await resposta.text();
  cacheMarkdown.set(arquivo, texto);
  return texto;
}

function slugDoTitulo(texto) {
  return normalizar(texto).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "secao";
}

// Caixas de destaque no padrão do GitHub: "> [!NOTE]", "> [!TIP]", "> [!IMPORTANT]", "> [!WARNING]", "> [!CAUTION]"
const ROTULOS_DESTAQUE = {
  NOTE: "Nota",
  TIP: "Dica",
  IMPORTANT: "Importante",
  WARNING: "Atenção",
  CAUTION: "Cuidado",
};

function aplicarDestaques(raiz) {
  for (const citacao of raiz.querySelectorAll("blockquote")) {
    const primeiro = citacao.querySelector("p");
    if (!primeiro) continue;
    const achado = primeiro.innerHTML.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?\s*/i);
    if (!achado) continue;
    const tipo = achado[1].toUpperCase();
    primeiro.innerHTML = primeiro.innerHTML.slice(achado[0].length);
    if (!primeiro.innerHTML.trim()) primeiro.remove();
    citacao.classList.add("destaque", `destaque-${tipo.toLowerCase()}`);
    const rotulo = document.createElement("p");
    rotulo.className = "destaque-rotulo";
    rotulo.textContent = ROTULOS_DESTAQUE[tipo];
    citacao.prepend(rotulo);
  }
}

// Divide o HTML da nota pelos títulos "##": o que vem antes é a abertura (sempre visível),
// e cada "##" vira uma sub-aba.
function dividirEmSecoes(raiz) {
  const abertura = [];
  const secoes = [];
  const usados = new Set();
  let atual = null;

  for (const no of [...raiz.childNodes]) {
    if (no.nodeType === Node.ELEMENT_NODE && no.tagName === "H2") {
      let slug = slugDoTitulo(no.textContent);
      for (let n = 2; usados.has(slug); n++) slug = `${slugDoTitulo(no.textContent)}-${n}`;
      usados.add(slug);
      atual = { titulo: no.textContent, slug, nos: [no] };
      secoes.push(atual);
    } else if (atual) {
      atual.nos.push(no);
    } else {
      abertura.push(no);
    }
  }
  return { abertura, secoes };
}

function linkDaSecao(stack, nota, secao) {
  return `#/${stack.id}/${slugDaNota(nota)}/${secao.slug}`;
}

async function carregarNota(stack, nota, idSecao) {
  const meuPedido = ++estado.pedido;
  const alvo = $("nota");
  const mesmaNota = alvo.dataset.arquivo === nota.arquivo;
  if (!mesmaNota) alvo.innerHTML = `<p class="vazio">Carregando…</p>`;

  try {
    const markdown = await buscarMarkdown(nota.arquivo);
    if (meuPedido !== estado.pedido) return;

    const rascunho = document.createElement("div");
    rascunho.innerHTML = marked.parse(markdown);
    aplicarDestaques(rascunho);
    const { abertura, secoes } = dividirEmSecoes(rascunho);

    alvo.innerHTML = "";
    alvo.dataset.arquivo = nota.arquivo;
    if (nota.data) {
      const data = document.createElement("span");
      data.className = "data";
      data.textContent = `Escrita em ${formatarData(nota.data)}`;
      alvo.appendChild(data);
    }

    if (secoes.length < 2) {
      // Nota curta: mostra tudo de uma vez
      alvo.append(...abertura, ...secoes.flatMap((s) => s.nos));
    } else {
      let indice = secoes.findIndex((s) => s.slug === idSecao);
      if (indice < 0) indice = 0;
      const secao = secoes[indice];

      alvo.append(...abertura);

      const subabas = document.createElement("nav");
      subabas.className = "subabas";
      subabas.setAttribute("aria-label", "Partes desta nota");
      secoes.forEach((s, i) => {
        const link = document.createElement("a");
        link.className = "subaba" + (i === indice ? " ativa" : "");
        link.href = linkDaSecao(stack, nota, s);
        link.textContent = `${i + 1}. ${s.titulo}`;
        if (i === indice) link.setAttribute("aria-current", "page");
        subabas.appendChild(link);
      });
      alvo.appendChild(subabas);

      const corpo = document.createElement("section");
      corpo.className = "secao";
      corpo.append(...secao.nos);
      alvo.appendChild(corpo);

      const navegacao = document.createElement("nav");
      navegacao.className = "secao-nav";
      const anterior = secoes[indice - 1];
      const proxima = secoes[indice + 1];
      navegacao.innerHTML = `
        ${anterior ? `<a class="secao-anterior" href="${linkDaSecao(stack, nota, anterior)}">← ${escapar(anterior.titulo)}</a>` : "<span></span>"}
        <span class="secao-posicao">${indice + 1} de ${secoes.length}</span>
        ${proxima ? `<a class="secao-proxima" href="${linkDaSecao(stack, nota, proxima)}">${escapar(proxima.titulo)} →</a>` : "<span></span>"}`;
      alvo.appendChild(navegacao);
    }

    alvo.querySelectorAll("pre code").forEach((bloco) => hljs.highlightElement(bloco));
    document.title = `${nota.titulo} · ${stack.nome} · Diário de Bordo`;
    if (mesmaNota) {
      const topo = alvo.getBoundingClientRect().top + window.scrollY - 16;
      if (window.scrollY > topo) window.scrollTo({ top: topo });
    } else {
      window.scrollTo({ top: 0 });
    }
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
