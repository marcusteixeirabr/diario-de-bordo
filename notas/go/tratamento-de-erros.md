# Tratamento de erros

Em Go, erro não é um evento especial que "explode" e sai voando pela pilha: é um **valor comum**, devolvido pela função junto com o resultado. Esta nota explica por que a linguagem escolheu esse caminho, como criar, embrulhar e inspecionar erros, quando `panic` faz sentido, e como organizar erros num programa de várias camadas.

## Filosofia

### Erros são valores

Uma função que pode falhar devolve o erro como **último** valor de retorno:

```go
func LerConfig(caminho string) (Config, error) {
    dados, err := os.ReadFile(caminho)
    if err != nil {
        return Config{}, fmt.Errorf("ler config: %w", err)
    }

    var cfg Config
    if err := json.Unmarshal(dados, &cfg); err != nil {
        return Config{}, fmt.Errorf("interpretar config: %w", err)
    }
    return cfg, nil
}
```

Cada ponto onde algo pode dar errado está **escrito** no código. Quem lê sabe exatamente quais linhas podem falhar e o que acontece em cada caso. Não existe um caminho escondido por onde a execução pula de repente para outro lugar.

### Por que esse desenho

1. **Fluxo visível.** O erro segue o mesmo caminho de qualquer outro valor: é devolvido, testado com `if`, repassado. Ler a função de cima para baixo mostra tudo o que ela faz.
2. **Erro é parte da assinatura.** `func LerConfig(...) (Config, error)` avisa, no próprio tipo, que a função pode falhar. Quem chama não tem como "não saber".
3. **Erro é programável.** Por ser um valor, dá para guardar numa variável, comparar, juntar vários, embrulhar com contexto, passar por canal. O artigo *Errors are values* (nas referências) mostra truques que só são possíveis por isso.
4. **Custo previsível.** Devolver um erro é um `return` como outro qualquer. O caminho sem erro não paga nada extra.

### Os trade-offs

| Critério | Como fica em Go |
|---|---|
| **Visibilidade** | Total: todo ponto de falha aparece no código e na assinatura. |
| **Verbosidade** | Alta: o `if err != nil { return ... }` se repete muito. |
| **Controle de fluxo** | Linear e previsível: nada pula camadas sozinho. |
| **Performance** | Barata: erro é um valor de retorno comum. |
| **Contexto** | Não vem de graça: não há rastro automático de onde o erro nasceu. Você acrescenta contexto a cada camada com `fmt.Errorf("...: %w", err)`. |

> [!NOTE]
> A repetição do `if err != nil` é o preço assumido. Em troca, ninguém precisa adivinhar o que acontece quando algo falha: está escrito ali.

## Interface error

### O tipo `error`

`error` é uma interface da própria linguagem, com um método só:

```go
type error interface {
    Error() string
}
```

Qualquer tipo com um método `Error() string` é um erro. É por isso que dá para criar erros próprios com structs (parte 5).

### O idioma `if err != nil`

```go
valor, err := buscarCotacao("USD")
if err != nil {
    return fmt.Errorf("atualizar painel: %w", err)
}
usar(valor)
```

Convenções que aparecem em todo código Go:

- O erro é sempre o **último** valor de retorno e se chama `err`.
- Trate o erro **logo** depois da chamada, antes de usar os outros valores.
- Retorne cedo. O caminho feliz fica alinhado à esquerda, e os desvios de erro ficam dentro dos `if`s:

```go
// bom: retorno cedo
func processar(id int) error {
    p, err := carregar(id)
    if err != nil {
        return err
    }
    if err := validar(p); err != nil {
        return err
    }
    return salvar(p)
}
```

- Quando `err != nil`, os outros valores normalmente são o zero value e **não devem ser usados**. A exceção é documentada: `io.Reader.Read`, por exemplo, pode devolver bytes lidos **e** `io.EOF` ao mesmo tempo.
- `if err := f(); err != nil { ... }` limita o `err` ao bloco do `if`, evitando reaproveitar a variável por engano.

### A armadilha da interface não-nil

Uma interface guarda um par (tipo, valor). Ela só é `nil` quando **os dois** estão vazios:

```go
type MeuErro struct{}

func (e *MeuErro) Error() string { return "deu ruim" }

func fazer() error {
    var e *MeuErro // ponteiro nil
    return e       // a interface error recebe (tipo=*MeuErro, valor=nil)
}

err := fazer()
fmt.Println(err == nil) // false!
```

> [!CAUTION]
> Ao devolver "sem erro", escreva `return nil`, nunca uma variável de tipo concreto que por acaso vale `nil`. Esse é um dos bugs mais difíceis de enxergar quando se está começando.

## Criação

### `errors.New`: mensagem fixa

```go
var ErrSaldoInsuficiente = errors.New("saldo insuficiente")
```

Cada chamada de `errors.New` cria um valor **único**, mesmo com o texto igual. Por isso ele é usado para erros sentinela (parte 4), declarados uma vez no nível do pacote.

### `fmt.Errorf`: mensagem com dados

```go
return fmt.Errorf("moeda %q não suportada", codigo)
```

### `%w`: embrulhar (wrapping)

Quando o erro vem de uma chamada que você fez, acrescente o que **você** estava fazendo e embrulhe o original com `%w`:

```go
func (s *Servico) Cotar(codigo string) (float64, error) {
    v, err := s.api.Buscar(codigo)
    if err != nil {
        return 0, fmt.Errorf("cotar %s: %w", codigo, err)
    }
    return v, nil
}
```

O `%w` faz duas coisas: coloca a mensagem do erro original no texto **e** guarda o original dentro do novo. Assim quem chama ainda consegue perguntar "lá no fundo, foi timeout?" com `errors.Is` (parte 4).

As camadas se empilham e a mensagem final conta a história inteira:

```text
atualizar painel: cotar USD: buscar na API: context deadline exceeded
```

### `%w` ou `%v`?

| Verbo | Mensagem | Quem chama consegue inspecionar o original? |
|---|---|---|
| `%w` | igual | sim, com `errors.Is` / `errors.As` |
| `%v` | igual | não: o original vira só texto |

> [!IMPORTANT]
> Embrulhar com `%w` torna o erro de dentro **parte da sua API**: quem chama pode passar a depender dele. Se você não quer expor um detalhe de implementação (por exemplo, um erro específico do driver do banco), use `%v` ou traduza para um erro seu (parte 7).

### Convenções da mensagem

- Minúscula, sem ponto final, sem quebra de linha: ela vai ser concatenada.
- Diga **o que estava sendo feito**, de forma curta: `"ler config: ..."`, não `"falha ao tentar ler o arquivo de configuração: ..."`. As camadas se acumulam, e "falha ao" repetido cinco vezes não ajuda ninguém.
- Não repita o que o erro de dentro já diz.

### Vários erros de uma vez

```go
err := errors.Join(errNome, errEmail, errIdade) // nils são ignorados
// errors.Is funciona em cada um deles

err = fmt.Errorf("salvar: %w; auditar: %w", errBanco, errLog) // mais de um %w
```

## Inspeção

### Erros sentinela

Um erro sentinela é uma variável exportada, criada com `errors.New`, que representa uma condição conhecida. O nome começa com `Err`:

```go
var (
    ErrNaoEncontrado     = errors.New("não encontrado")
    ErrSaldoInsuficiente = errors.New("saldo insuficiente")
)
```

A biblioteca padrão tem vários: `io.EOF`, `os.ErrNotExist`, `sql.ErrNoRows`, `context.DeadlineExceeded`.

### `errors.Is`: "é este erro, em algum lugar da corrente?"

```go
err := conta.Sacar(500)
if errors.Is(err, ErrSaldoInsuficiente) {
    fmt.Println("sem saldo")
}
```

Não use `==`. Com `==`, só o erro do topo é comparado; se alguém embrulhou com `%w` no caminho, a comparação falha. O `errors.Is` percorre a corrente inteira.

### `errors.As`: "existe um erro deste tipo na corrente?"

Quando o erro é de um tipo com campos (parte 5) e você quer ler esses campos:

```go
var errVal *ValidacaoError
if errors.As(err, &errVal) {
    fmt.Println("campo inválido:", errVal.Campo)
}
```

Repare no `&errVal`: o `As` recebe um **ponteiro** para a variável que vai preencher.

### `errors.AsType` (Go 1.26+)

Nas versões novas existe a forma genérica, mais curta e sem a variável declarada antes. A documentação do pacote `errors` recomenda preferi-la:

```go
if errVal, ok := errors.AsType[*ValidacaoError](err); ok {
    fmt.Println("campo inválido:", errVal.Campo)
}
```

### Por que não um type assertion direto?

```go
if errVal, ok := err.(*ValidacaoError); ok { ... }
```

Isso só olha o erro do **topo**. Se ele foi embrulhado, o assertion falha. `errors.As` e `errors.AsType` descem pela corrente.

### Quando usar cada um

- **Sentinela + `errors.Is`**: a condição não carrega dados ("não encontrado", "sem saldo").
- **Tipo próprio + `errors.As`**: o erro carrega informação útil (qual campo, qual código HTTP).
- **Erro opaco** (só `err != nil`): quem chama não precisa distinguir nada, só saber que falhou. É o caso mais comum, e o mais simples de manter.

## Erros customizados

Qualquer struct com `Error() string` é um erro:

```go
type ValidacaoError struct {
    Campo  string
    Motivo string
}

func (e *ValidacaoError) Error() string {
    return fmt.Sprintf("campo %s: %s", e.Campo, e.Motivo)
}

func ValidarEmail(email string) error {
    if !strings.Contains(email, "@") {
        return &ValidacaoError{Campo: "email", Motivo: "sem @"}
    }
    return nil
}
```

> [!TIP]
> Use receiver **ponteiro** no `Error()` e devolva `&ValidacaoError{...}`. Assim o tipo usado em todo lugar é sempre `*ValidacaoError`, e o `errors.As` com `var e *ValidacaoError` funciona sem surpresas.

### Embrulhando outro erro: `Unwrap`

Se o seu erro carrega um erro de dentro, implemente `Unwrap() error` para o `errors.Is` e o `errors.As` conseguirem descer:

```go
type HTTPError struct {
    Status int
    Err    error
}

func (e *HTTPError) Error() string {
    return fmt.Sprintf("http %d: %v", e.Status, e.Err)
}

func (e *HTTPError) Unwrap() error { return e.Err }

err := &HTTPError{Status: 404, Err: ErrNaoEncontrado}
fmt.Println(errors.Is(err, ErrNaoEncontrado)) // true, graças ao Unwrap
```

### Pergunte pelo comportamento, não pelo tipo

Às vezes quem chama não quer saber o tipo exato, só se o erro "tem uma característica". Uma interface pequena resolve sem acoplar os pacotes:

```go
type temporario interface {
    error
    Temporario() bool
}

func deveTentarDeNovo(err error) bool {
    t, ok := errors.AsType[temporario](err) // ou errors.As com var t temporario
    return ok && t.Temporario()
}
```

Qualquer erro, de qualquer pacote, que tenha `Temporario() bool` passa a ser reconhecido.

## panic e recover

### O que é um `panic`

`panic` interrompe a função atual, executa os `defer`s pendentes subindo pela pilha da goroutine e, se ninguém recuperar, **derruba o programa inteiro** com a mensagem e o rastro da pilha.

O próprio runtime dispara panics para erros de programação:

```go
var m map[string]int
m["x"] = 1 // panic: assignment to entry in nil map

s := []int{1, 2, 3}
_ = s[10]  // panic: index out of range

var p *Pessoa
_ = p.Nome // panic: nil pointer dereference
```

### Quando `panic` é aceitável

1. **Bug / invariante quebrada**: uma situação que "não pode acontecer" se o código estiver certo. Não há o que o chamador fazer além de corrigir o código.
2. **Funções `Must`** na inicialização: falha ali significa que o programa está mal escrito, não que o usuário errou.

```go
var reEmail = regexp.MustCompile(`^[^@]+@[^@]+$`) // panic se a regex for inválida
var tmpl = template.Must(template.ParseFiles("pagina.html"))
```

3. **Inicialização impossível**: sem a configuração mínima o programa não tem como começar. Mesmo assim, no `main` é mais comum `log.Fatal` ou imprimir e `os.Exit(1)`.

> [!WARNING]
> Arquivo que não existe, usuário que digitou errado, API fora do ar, registro não encontrado: tudo isso é **erro normal** e vira `return err`. `panic` não é um jeito de "lançar" erros para alguém tratar lá em cima.

### `recover`

`recover()` só funciona **dentro de uma função adiada com `defer`**, na mesma goroutine do panic. Ele para o pânico e devolve o valor passado ao `panic`:

```go
func seguro(f func()) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("pânico recuperado: %v", r)
        }
    }()
    f()
    return nil
}
```

O retorno **nomeado** (`err error`) é o que permite o `defer` alterar o valor devolvido.

### Recovery em servidor HTTP

O uso clássico é uma camada que impede um bug em um handler de derrubar o servidor inteiro:

```go
func Recuperar(proximo http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if v := recover(); v != nil {
                slog.Error("panic no handler", "valor", v, "rota", r.URL.Path,
                    "pilha", string(debug.Stack()))
                http.Error(w, "erro interno", http.StatusInternalServerError)
            }
        }()
        proximo.ServeHTTP(w, r)
    })
}
```

> [!IMPORTANT]
> Um `recover` só pega o panic da **própria** goroutine. Se o handler dispara `go func() { ... }()` e essa goroutine entra em pânico, o programa cai do mesmo jeito. Cada goroutine que pode entrar em pânico precisa do seu próprio `defer`/`recover`, se for o caso.

### `defer` para limpeza

O `defer` é a forma de garantir que algo rode na saída da função, com erro ou sem:

```go
f, err := os.Open(caminho)
if err != nil {
    return err
}
defer f.Close()
```

Ao **escrever** num arquivo, o erro do `Close` importa (é ali que o sistema pode avisar que a gravação falhou). Com retorno nomeado dá para não perdê-lo:

```go
func salvar(caminho string, dados []byte) (err error) {
    f, err := os.Create(caminho)
    if err != nil {
        return err
    }
    defer func() {
        err = errors.Join(err, f.Close())
    }()
    _, err = f.Write(dados)
    return err
}
```

## Camadas

Um caso real: uma API de cotações com três camadas. Cada uma tem um papel diferente com os erros.

```text
banco de dados  →  repositório  →  serviço  →  handler HTTP  →  resposta
```

### Repositório: traduz o erro técnico para o domínio

```go
var ErrNaoEncontrado = errors.New("não encontrado")

func (r *RepoMoedas) Buscar(ctx context.Context, codigo string) (Moeda, error) {
    var m Moeda
    err := r.db.QueryRowContext(ctx,
        "SELECT codigo, valor FROM moedas WHERE codigo = $1", codigo,
    ).Scan(&m.Codigo, &m.Valor)

    if errors.Is(err, sql.ErrNoRows) {
        return Moeda{}, ErrNaoEncontrado // as camadas de cima não precisam saber que existe SQL
    }
    if err != nil {
        return Moeda{}, fmt.Errorf("buscar moeda %s: %w", codigo, err)
    }
    return m, nil
}
```

### Serviço: acrescenta contexto e regras

```go
func (s *Servico) Converter(ctx context.Context, de string, valor float64) (float64, error) {
    if valor <= 0 {
        return 0, &ValidacaoError{Campo: "valor", Motivo: "precisa ser positivo"}
    }
    m, err := s.repo.Buscar(ctx, de)
    if err != nil {
        return 0, fmt.Errorf("converter %s: %w", de, err)
    }
    return valor * m.Valor, nil
}
```

### Handler: decide a resposta e registra uma vez só

```go
func (h *Handler) Converter(w http.ResponseWriter, r *http.Request) {
    valor, _ := strconv.ParseFloat(r.URL.Query().Get("valor"), 64)
    res, err := h.svc.Converter(r.Context(), r.URL.Query().Get("de"), valor)
    if err != nil {
        h.responderErro(w, r, err)
        return
    }
    json.NewEncoder(w).Encode(map[string]float64{"resultado": res})
}

func (h *Handler) responderErro(w http.ResponseWriter, r *http.Request, err error) {
    var errVal *ValidacaoError
    switch {
    case errors.As(err, &errVal):
        http.Error(w, errVal.Error(), http.StatusBadRequest)
    case errors.Is(err, ErrNaoEncontrado):
        http.Error(w, "moeda não encontrada", http.StatusNotFound)
    case errors.Is(err, context.DeadlineExceeded):
        http.Error(w, "tempo esgotado", http.StatusGatewayTimeout)
    default:
        slog.Error("erro inesperado", "rota", r.URL.Path, "erro", err)
        http.Error(w, "erro interno", http.StatusInternalServerError)
    }
}
```

### As regras que fazem isso funcionar

1. **Cada camada acrescenta o que ela sabe**, com `%w`: o repositório diz qual moeda, o serviço diz qual operação.
2. **Traduza na fronteira**: o repositório transforma `sql.ErrNoRows` em `ErrNaoEncontrado`. Assim dá para trocar de banco sem mexer no handler.
3. **Registre o erro uma vez só, na borda** (handler, `main`, worker). As camadas do meio só devolvem.
4. **Não vaze detalhes internos** na resposta: o cliente recebe "erro interno"; o log recebe a corrente completa.

> [!TIP]
> Regra de bolso: **ou trata, ou devolve, nunca os dois.** "Tratar" é tomar uma decisão (responder, tentar de novo, usar um valor padrão) ou registrar no log. Devolver é passar para cima com contexto.

## Code smells

Os vícios mais comuns de quem está aprendendo erros em Go, cada um com a correção.

### 1. Ignorar o erro

```go
// ruim
dados, _ := os.ReadFile("config.json")

// bom
dados, err := os.ReadFile("config.json")
if err != nil {
    return fmt.Errorf("ler config: %w", err)
}
```

Se for proposital (raro), deixe um comentário dizendo por quê.

### 2. Registrar e devolver

```go
// ruim: o mesmo erro aparece no log em cada camada
if err != nil {
    log.Printf("erro ao buscar: %v", err)
    return err
}

// bom: devolve com contexto; quem está na borda registra
if err != nil {
    return fmt.Errorf("buscar: %w", err)
}
```

### 3. `panic` para erro comum

```go
// ruim
func Carregar(caminho string) Config {
    dados, err := os.ReadFile(caminho)
    if err != nil {
        panic(err)
    }
    ...
}

// bom
func Carregar(caminho string) (Config, error) { ... }
```

### 4. Simular "tentar e capturar" com `panic`/`recover`

```go
// ruim: usar panic como desvio de fluxo
func Processar(itens []Item) (err error) {
    defer func() {
        if r := recover(); r != nil {
            err = fmt.Errorf("%v", r)
        }
    }()
    for _, it := range itens {
        validarOuPanic(it)
        salvarOuPanic(it)
    }
    return nil
}

// bom: o fluxo de erro é explícito
func Processar(itens []Item) error {
    for _, it := range itens {
        if err := validar(it); err != nil {
            return fmt.Errorf("item %d: %w", it.ID, err)
        }
        if err := salvar(it); err != nil {
            return fmt.Errorf("salvar item %d: %w", it.ID, err)
        }
    }
    return nil
}
```

### 5. Comparar pelo texto

```go
// ruim: quebra se a mensagem mudar ou for embrulhada
if err.Error() == "não encontrado" { ... }
if strings.Contains(err.Error(), "timeout") { ... }

// bom
if errors.Is(err, ErrNaoEncontrado) { ... }
if errors.Is(err, context.DeadlineExceeded) { ... }
```

### 6. `==` em vez de `errors.Is`

```go
// ruim: falha se alguém embrulhou com %w no caminho
if err == io.EOF { ... }

// bom
if errors.Is(err, io.EOF) { ... }
```

### 7. Contexto que não diz nada

```go
// ruim
return fmt.Errorf("erro: %w", err)
return fmt.Errorf("Falha ao executar a operação.: %w", err)

// bom
return fmt.Errorf("salvar pedido %d: %w", id, err)
```

### 8. Um tipo de erro genérico para tudo

Criar um `AppError` gigante com código, mensagem, causa, nível, stack... e usá-lo em todo lugar. Na maioria dos casos, um sentinela ou um `fmt.Errorf` com `%w` resolve. Crie tipos só quando alguém realmente precisa **ler** os campos.

## Exercícios

### 1. Leitor de configuração

Escreva `LerConfig(caminho string) (Config, error)` que lê um JSON. Diferencie três casos para quem chama:

- arquivo não existe (`errors.Is(err, fs.ErrNotExist)`),
- JSON malformado (`errors.As` com `*json.SyntaxError`, mostrando o `Offset`),
- campo obrigatório vazio (um `ErrConfigIncompleta` seu).

No `main`, imprima uma mensagem diferente para cada caso.

### 2. Validação com vários erros

`ValidarCadastro(c Cadastro) error` confere nome, e-mail e idade e devolve **todos** os problemas de uma vez com `errors.Join`, cada um sendo um `*ValidacaoError`. Escreva um teste que confere que `errors.As` encontra o erro do campo `email`.

### 3. Erro com comportamento

Crie dois tipos de erro, `ErrRede` e `ErrLimite`, que implementam `Temporario() bool`. Escreva `ComRetentativa(f func() error, n int) error` que tenta de novo só quando o erro é temporário, e desiste na hora quando não é.

### 4. Três camadas

Monte o exemplo da parte 7 com um repositório em memória (um `map`), e teste o handler com `net/http/httptest`, conferindo os status 400, 404 e 500.

### 5. Must e recovery

Crie `MustCarregarTaxas(caminho string) map[string]float64`, que dá `panic` se o arquivo não carregar, e use numa variável de pacote. Depois escreva o middleware `Recuperar` e um handler que dá pânico de propósito. Confirme que o servidor continua no ar e devolve 500.

### 6. Erros são valores

Leia o artigo *Errors are values* e reescreva uma função que faz 5 escritas seguidas num `io.Writer` (cada uma com seu `if err != nil`) usando uma struct que guarda o primeiro erro e ignora as escritas seguintes.

## Referências

### Documentação oficial (inglês)

- [Error handling and Go](https://go.dev/blog/error-handling-and-go): o texto clássico do blog oficial sobre a interface `error`.
- [Working with Errors in Go 1.13](https://go.dev/blog/go1.13-errors): wrapping, `%w`, `errors.Is` e `errors.As`, e quando embrulhar ou não.
- [Errors are values](https://go.dev/blog/errors-are-values): Rob Pike mostrando como programar **com** erros para reduzir a repetição.
- [Defer, Panic, and Recover](https://go.dev/blog/defer-panic-and-recover): os três mecanismos explicados com exemplos.
- [Pacote errors](https://pkg.go.dev/errors): a referência de `New`, `Is`, `As`, `AsType`, `Join` e `Unwrap`.

### Artigos e sites

- [Don't just check errors, handle them gracefully](https://dave.cheney.net/2016/04/27/dont-just-check-errors-handle-them-gracefully), Dave Cheney (inglês): sentinelas, tipos e erros opacos, e a ideia de perguntar pelo comportamento.
- [Go by Example: Errors](https://gobyexample.com/errors) (inglês). No mesmo site há *Custom Errors*, *Panic* e *Recover*.
- [DigitalOcean: Tratamento de erros em Go](https://www.digitalocean.com/community/tutorials/handling-errors-in-go-pt), [Criando erros personalizados em Go](https://www.digitalocean.com/community/tutorials/creating-custom-errors-in-go-pt) e [Lidando com panics em Go](https://www.digitalocean.com/community/tutorials/handling-panics-in-go-pt) (português).
- [Aprenda Go com Testes: Ponteiros e erros](https://larien.gitbook.io/aprenda-go-com-testes/primeiros-passos-com-go/ponteiros-e-erros) (português).

### Vídeos em português

- [Essa é a técnica para tratar erros em Golang](https://www.youtube.com/watch?v=f--pS45o_zg), Full Cycle (14 min).
- [Aprenda Error handling em Go agora! (com exemplos reais!)](https://www.youtube.com/watch?v=D37pvHk3jts), Rocketseat (12 min).
- [Cap. 23 – Tratamento de Erros – 1. Entendendo erros](https://www.youtube.com/watch?v=lkWhk-vr08k), Aprenda Go (9 min). Primeiro vídeo de um capítulo inteiro sobre erros.
- [Closures, defer e panic/recover](https://www.youtube.com/watch?v=9KP3chi4MAE), Golang Na Prática (26 min).

### Vídeos em inglês

- [Go Class: 32 Error Handling](https://www.youtube.com/watch?v=oIxXp0OgK_0), Matt KØDVB (34 min).
- [errors.AsType in Go 1.26 makes Error Handling better!](https://www.youtube.com/watch?v=vIt-gutcWjo), Flo Woelki (10 min).
- [Golang Error Handling Isn't ACTUALLY Bad](https://www.youtube.com/watch?v=OpXBERpnzPE), Melkey (8 min).

## Resumo

- Erro é um valor: último retorno, chamado `err`, testado logo com `if err != nil`.
- Retorne cedo; o caminho feliz fica à esquerda.
- Devolva `nil` literal quando não houver erro, nunca um ponteiro nil de tipo concreto.
- `errors.New` para mensagens fixas e sentinelas; `fmt.Errorf` com `%w` para acrescentar contexto sem perder o original.
- `errors.Is` para comparar com sentinelas; `errors.As` / `errors.AsType` para extrair um tipo. Nunca compare pelo texto.
- Erro customizado: struct com `Error()` (receiver ponteiro) e `Unwrap()` se embrulhar outro.
- `panic` é para bug e inicialização impossível; `recover` só funciona em `defer`, na mesma goroutine.
- Em camadas: cada uma acrescenta contexto, a fronteira traduz erros técnicos, e o log acontece uma vez, na borda.
- Ou trata, ou devolve, nunca os dois.
