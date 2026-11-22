# Goroutines e concorrência

Em Go, começar uma tarefa concorrente é trivial: basta uma palavra, `go`. A parte difícil é outra: o compilador **não impede** que duas tarefas mexam na mesma variável ao mesmo tempo. Essa nota segue um roteiro de 10 partes, do básico ao que dá errado, e termina com um caso prático no Fyne.

## Goroutines

### O que é uma goroutine?

Uma goroutine é uma função executada de forma concorrente, gerenciada pelo **runtime do Go**, não diretamente pelo sistema operacional. É a unidade básica de concorrência da linguagem.

| | Thread do sistema operacional | Goroutine |
|---|---|---|
| Pilha | fixa, na casa dos MB | começa com poucos KB e cresce sob demanda |
| Quem gerencia | o kernel | o scheduler do runtime do Go |
| Troca entre elas | cara (passa pelo kernel) | barata (acontece dentro do programa) |
| Limite prático | milhares | centenas de milhares |
| Criação | lenta | muito rápida |

> [!NOTE]
> **Modelo M:N.** O Go distribui M goroutines sobre N threads do sistema. Você escreve goroutines; o runtime decide em qual thread cada uma roda.

### Como o scheduler funciona

1. O Go usa `GOMAXPROCS` threads para rodar código Go ao mesmo tempo (o padrão é o número de CPUs).
2. Cada uma tem uma fila local de goroutines prontas para rodar.
3. Quando uma goroutine bloqueia (rede, disco, canal), o scheduler coloca outra no lugar.
4. Uma thread que fica sem trabalho "rouba" goroutines da fila de outra (*work stealing*).

Por isso dá para escrever código bloqueante normal, linha após linha, dentro de uma goroutine: enquanto ela espera, outras continuam rodando.

## A palavra go

```go
go buscarCotacao("USD") // dispara e segue em frente
```

A instrução `go` começa a função numa nova goroutine e **não espera** ela terminar. A linha seguinte já roda.

Também vale com função anônima, que é o jeito mais comum:

```go
go func() {
    valor, err := buscarCotacao("USD")
    if err != nil {
        log.Println("falhou:", err)
        return
    }
    log.Println("USD:", valor)
}()
```

### Três regras que pegam todo iniciante

**1. Quando `main` retorna, o programa acaba**, com todas as goroutines junto, terminadas ou não.

```go
func main() {
    go fmt.Println("oi")
} // provavelmente não imprime nada
```

Para esperar, use `sync.WaitGroup` (parte 7) ou canais (parte 4).

**2. Os argumentos de `go f(x)` são avaliados na hora**, na goroutine que chamou. Só a execução de `f` vai para outra goroutine.

**3. O valor de retorno se perde.** `go` não devolve nada: se a goroutine produz um resultado, ela precisa entregá-lo por um canal ou gravá-lo num lugar protegido.

> [!TIP]
> Desde o Go 1.22, a variável do `for` é nova a cada volta, então capturar `codigo` dentro de `for _, codigo := range codigos` numa goroutine é seguro. Em código antigo você vai ver `codigo := codigo` dentro do laço, que era o remendo para isso.

## Race condition

Data race acontece quando duas goroutines acessam a mesma memória ao mesmo tempo, pelo menos uma escreve, e não há sincronização entre elas. Go compila isso sem reclamar:

```go
contador := 0
var wg sync.WaitGroup
for range 1000 {
    wg.Add(1)
    go func() {
        defer wg.Done()
        contador++ // corrida!
    }()
}
wg.Wait()
fmt.Println(contador) // raramente 1000
```

### Por que memória compartilhada é perigosa

`contador++` parece uma operação só, mas são três: **ler**, **somar**, **escrever**. Duas goroutines podem ler o mesmo valor, somar 1 cada uma, e uma escrita apaga a outra. O resultado muda a cada execução, e o bug pode passar meses sem aparecer.

### As duas correções mais comuns

```go
// 1. mutex: só uma goroutine por vez passa entre Lock e Unlock
var mu sync.Mutex
mu.Lock()
contador++
mu.Unlock()

// 2. atômico: a operação inteira acontece de uma vez
var contador atomic.Int64
contador.Add(1)
```

O `sync.Mutex` não fica "preso" ao dado que protege: nada impede de esquecer o `Lock`. A convenção é declarar o mutex logo acima dos campos que ele protege:

```go
type Carteira struct {
    mu     sync.Mutex // protege os campos abaixo
    moedas map[string]float64
}
```

### O detector de corridas

```bash
go run -race .
go test -race ./...
```

Ele só acha corridas que de fato acontecem durante a execução, então vale rodar os testes com `-race` sempre.

> [!WARNING]
> Escrever num `map` a partir de duas goroutines pode derrubar o programa com `fatal error: concurrent map writes`. Não é exceção que dá para tratar: o programa morre.

A filosofia do Go para fugir disso tudo é a frase: *"não comunique compartilhando memória; compartilhe memória comunicando"*. Em vez de várias goroutines mexerem no mesmo dado, uma entrega o dado para a outra por um canal.

## Channels

Um canal é um cano tipado por onde goroutines passam valores umas para as outras, com a sincronização embutida:

```go
resultados := make(chan float64)

go func() {
    valor, _ := buscarCotacao("USD")
    resultados <- valor // envia
}()

valor := <-resultados // recebe (bloqueia até chegar)
```

O canal resolve dois problemas de uma vez: **transporta** o valor e **sincroniza** as duas goroutines. Quem recebe enxerga tudo o que o remetente fez antes de enviar (parte 11 explica por quê).

### Direção

Na assinatura de uma função dá para restringir o que ela pode fazer com o canal. O compilador cobra:

```go
func produzir(saida chan<- int)  // só envia
func consumir(entrada <-chan int) // só recebe
```

### Fechar e percorrer

```go
func produzir(saida chan<- int) {
    for i := range 3 {
        saida <- i
    }
    close(saida) // quem envia é quem fecha
}

func main() {
    ch := make(chan int)
    go produzir(ch)
    for v := range ch {
        fmt.Println(v)
    }
    // o for termina quando o canal é fechado
}
```

| Operação | Canal aberto | Canal fechado | Canal `nil` |
|---|---|---|---|
| enviar | bloqueia até ter espaço/receptor | **pânico** | bloqueia para sempre |
| receber | bloqueia até ter valor | devolve o zero do tipo, na hora | bloqueia para sempre |

Para saber se o zero veio de verdade ou do fechamento: `v, ok := <-ch` (`ok == false` significa fechado).

> [!IMPORTANT]
> Quem fecha é sempre quem envia, e só quando não vai mais enviar nada. Quem recebe nunca fecha: não tem como saber se o outro lado ainda vai mandar algo, e enviar num canal fechado é pânico.

## Buffered

```go
semBuffer := make(chan string)     // capacidade 0
comBuffer := make(chan string, 10) // capacidade 10
```

### Sem buffer: aperto de mão

O envio só termina quando alguém recebe. As duas goroutines se encontram naquele ponto. É a forma mais forte de sincronização: quando o envio terminou, você **sabe** que o outro lado pegou o valor.

### Com buffer: caixa de correio

O envio só bloqueia quando o buffer está cheio; o recebimento só bloqueia quando está vazio. Quem envia pode seguir adiante sem esperar.

`len(ch)` diz quantos valores estão esperando e `cap(ch)` diz a capacidade, mas não tome decisões com base no `len`: entre ler e agir, ele já pode ter mudado.

### Quando usar buffer

- **Tamanho conhecido de resultados**: se você vai disparar N goroutines e cada uma manda um resultado, `make(chan T, N)` garante que nenhuma fica presa esperando alguém ler (evita vazamento, parte 10).
- **Limitar concorrência (semáforo)**:

```go
limite := make(chan struct{}, 3) // no máximo 3 ao mesmo tempo

for _, codigo := range codigos {
    go func() {
        limite <- struct{}{}        // ocupa uma vaga (bloqueia se já há 3)
        defer func() { <-limite }() // libera a vaga
        buscarCotacao(codigo)
    }()
}
```

- **Absorver picos**: o produtor é rápido em rajadas e o consumidor é constante.

> [!WARNING]
> Buffer não conserta problema de desenho. Se um programa trava sem buffer, colocar `make(chan T, 100)` geralmente só adia o travamento para a 101ª mensagem. Comece sem buffer e só adicione quando souber explicar o número escolhido.

## select

O `select` espera por várias operações de canal ao mesmo tempo e executa a primeira que ficar pronta:

```go
select {
case v := <-cotacoes:
    fmt.Println("nova cotação:", v)
case err := <-erros:
    fmt.Println("falhou:", err)
case <-time.After(5 * time.Second):
    fmt.Println("timeout")
case <-ctx.Done():
    return // alguém cancelou
}
```

- Se mais de um caso está pronto, o Go **sorteia** um. Isso é proposital: evita que um canal muito movimentado deixe os outros sem vez.
- Um `default` torna o `select` não bloqueante: se nada está pronto, cai no `default`.

```go
select {
case fila <- tarefa:
    // entrou na fila
default:
    log.Println("fila cheia, descartando")
}
```

- Como canal `nil` nunca fica pronto, atribuir `nil` a uma variável de canal "desliga" aquele `case`. Truque útil quando um dos canais já fechou e você quer continuar ouvindo os outros.

### `select` em laço

O formato mais comum é um `for` com `select` dentro, que fica reagindo a eventos até alguém mandar parar:

```go
for {
    select {
    case v := <-cotacoes:
        atualizar(v)
    case <-ctx.Done():
        return
    }
}
```

## WaitGroup

O `sync.WaitGroup` é um contador para esperar um grupo de goroutines terminar:

```go
var wg sync.WaitGroup
for _, codigo := range []string{"USD", "EUR", "BTC"} {
    wg.Add(1)
    go func() {
        defer wg.Done()
        buscarCotacao(codigo)
    }()
}
wg.Wait()
```

1. `Add(1)` conta uma tarefa a mais.
2. `Done()` avisa que uma terminou (é um `Add(-1)`).
3. `Wait()` bloqueia até o contador voltar a zero.

Nas versões recentes (Go 1.25+) existe o atalho `wg.Go(func() { ... })`, que já faz o `Add` e o `Done`.

### Os erros mais comuns

> [!CAUTION]
> **`Add` dentro da goroutine.** Se o `wg.Add(1)` fica dentro do `go func()`, o `Wait()` pode rodar antes de qualquer `Add` e passar direto. O `Add` vem sempre **antes** do `go`.

- **Esquecer o `Done`**: o `Wait()` espera para sempre. O `defer wg.Done()` na primeira linha da goroutine evita isso até quando ela retorna cedo por erro.
- **Copiar o `WaitGroup`**: passar `wg` por valor para uma função cria um contador novo. Passe `*sync.WaitGroup` (ou use uma closure, como no exemplo). O `go vet` avisa.

### E os erros das goroutines?

O `WaitGroup` só espera; ele não coleta resultados nem erros. Para isso, junte com um canal ou use o pacote `golang.org/x/sync/errgroup`, que espera todas as goroutines e devolve o primeiro erro:

```go
g, ctx := errgroup.WithContext(ctx)
for _, codigo := range codigos {
    g.Go(func() error {
        _, err := buscarCotacao(ctx, codigo)
        return err
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("buscar cotações: %w", err)
}
```

## Context

Uma goroutine não pode ser "matada" de fora. Não existe `stop(goroutine)`. O jeito idiomático de pedir que ela pare é passar um `context.Context` e fazer a goroutine olhar para `ctx.Done()`, um canal que é fechado quando o contexto é cancelado.

> [!NOTE]
> **Por que assim?** Só a própria goroutine sabe em que ponto é seguro parar: fechar arquivo, devolver conexão, não deixar dado pela metade. O `context` só **avisa**; quem para é ela.

```go
func acompanhar(ctx context.Context, codigo string, saida chan<- float64) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return // pediram para parar
        case <-ticker.C:
            valor, err := buscarCotacao(ctx, codigo)
            if err != nil {
                continue
            }
            select {
            case saida <- valor:
            case <-ctx.Done(): // não fica preso se ninguém mais lê
                return
            }
        }
    }
}

func main() {
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()

    cotacoes := make(chan float64)
    go acompanhar(ctx, "USD", cotacoes)
    // ... quando quiser parar: cancel()
}
```

### `WithCancel` e `WithTimeout`

- `context.WithCancel(pai)`: cancela quando você chama `cancel()`.
- `context.WithTimeout(pai, 5*time.Second)`: cancela sozinho quando o tempo acaba (ou antes, se chamar `cancel()`).

```go
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
// se passar de 5s, a requisição é abortada e o erro é context.DeadlineExceeded
```

Depois que o contexto termina, `ctx.Err()` diz o motivo: `context.Canceled` ou `context.DeadlineExceeded`.

Contextos formam uma árvore: cancelar um pai cancela todos os filhos. Assim, um `cancel()` no topo desliga tudo que nasceu dele.

### Convenções

- `ctx` é sempre o **primeiro parâmetro**, com esse nome: `func buscar(ctx context.Context, ...)`.
- Não guarde contexto dentro de struct; passe como argumento.
- Sempre chame o `cancel` (normalmente com `defer`), mesmo no `WithTimeout`. Senão os recursos do contexto ficam presos até o tempo acabar. O `go vet` avisa quando o `cancel` é descartado.

## Padrões

Três padrões aparecem em quase todo programa concorrente de verdade: fan-out, fan-in e worker pool.

### Fan-out: várias goroutines lendo do mesmo canal

Um canal pode ter vários receptores. Cada valor enviado vai para **um** deles só, então o trabalho se divide sozinho entre quem estiver livre.

### Fan-in: juntar vários canais num só

```go
func juntar(ctx context.Context, entradas ...<-chan float64) <-chan float64 {
    saida := make(chan float64)
    var wg sync.WaitGroup

    for _, ch := range entradas {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for v := range ch {
                select {
                case saida <- v:
                case <-ctx.Done():
                    return
                }
            }
        }()
    }

    go func() {
        wg.Wait()
        close(saida) // só fecha quando todas as entradas acabaram
    }()

    return saida
}
```

Repare na goroutine extra que espera o `WaitGroup` e fecha a saída. Ela existe porque nenhuma das goroutines de cópia sabe se é a última; só o `WaitGroup` sabe.

### Worker pool: N goroutines fixas consumindo uma fila

É fan-out com limite. Em vez de abrir uma goroutine por tarefa, você abre poucas e deixa elas puxarem trabalho de um canal. Serve para não estourar o recurso do outro lado: limite de requisições de uma API, conexões do banco, arquivos abertos.

```go
type resultado struct {
    codigo string
    valor  float64
    err    error
}

func buscarTodas(ctx context.Context, codigos []string, nWorkers int) map[string]float64 {
    tarefas := make(chan string)
    resultados := make(chan resultado)

    // 1. os workers
    var wg sync.WaitGroup
    for range nWorkers {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for codigo := range tarefas {
                v, err := buscarCotacao(ctx, codigo)
                resultados <- resultado{codigo, v, err}
            }
        }()
    }

    // 2. quem distribui o trabalho
    go func() {
        defer close(tarefas) // avisa os workers que acabou
        for _, c := range codigos {
            select {
            case tarefas <- c:
            case <-ctx.Done():
                return
            }
        }
    }()

    // 3. quem fecha os resultados quando todos os workers terminarem
    go func() {
        wg.Wait()
        close(resultados)
    }()

    // 4. coleta
    cotacoes := make(map[string]float64)
    for r := range resultados {
        if r.err == nil {
            cotacoes[r.codigo] = r.valor
        }
    }
    return cotacoes
}
```

> [!IMPORTANT]
> O que faz isso funcionar sem vazamento é a regra de quem fecha o quê: quem distribui fecha `tarefas`; quando os workers veem o canal fechado, saem do `range`; o `WaitGroup` chega a zero e fecha `resultados`; o `range` da coleta termina.

## Armadilhas

### Goroutine vazada

Uma goroutine que fica bloqueada para sempre nunca é recolhida. Ela continua ocupando memória, e o que ela segura (conexões, arquivos) também. O caso clássico:

```go
func primeiraResposta(urls []string) string {
    ch := make(chan string) // sem buffer
    for _, u := range urls {
        go func() { ch <- baixar(u) }()
    }
    return <-ch // pega a primeira...
} // ...e as outras goroutines ficam presas no envio para sempre
```

Correções possíveis: dar buffer do tamanho certo (`make(chan string, len(urls))`, assim todo envio cabe), ou passar um `context` e cancelar quando a primeira resposta chegar.

> [!TIP]
> Pergunta que evita quase todo vazamento: **"como essa goroutine termina?"** Se não dá para responder ao escrever o `go`, tem problema.

Para investigar: `runtime.NumGoroutine()` mostra quantas estão vivas, e nos testes a biblioteca `go.uber.org/goleak` falha o teste se sobrar goroutine.

### Deadlock

Deadlock é quando goroutines ficam esperando umas pelas outras e ninguém anda. Se **todas** as goroutines do programa travarem, o runtime percebe e derruba tudo:

```go
func main() {
    ch := make(chan int)
    ch <- 1 // ninguém vai receber
}
// fatal error: all goroutines are asleep - deadlock!
```

Mas se só algumas travarem, o runtime não avisa nada: o programa segue, com goroutines paradas (vira um vazamento). Causas comuns:

- Enviar num canal sem buffer sem ninguém do outro lado.
- `for v := range ch` num canal que ninguém fecha.
- `wg.Add(1)` dentro da goroutine, ou `Done()` esquecido.
- Travar o mesmo `sync.Mutex` duas vezes na mesma goroutine. O mutex do Go não é reentrante.
- Dois mutexes travados em ordem diferente por duas goroutines. A saída é sempre travar na mesma ordem.

## Modelo de memória

Essa parte é a que mais me esclareceu. Sem sincronização, **não existe garantia de que uma goroutine enxergue o que outra escreveu**, nem na ordem em que foi escrito. O compilador e o processador podem reordenar instruções e manter valores em cache.

O que dá garantia é a relação *acontece antes* (*happens before*). As regras principais:

1. **`go f()` só ordena o que veio antes dele.** Tudo que a goroutine-mãe escreveu antes da instrução `go` é visível dentro de `f`. Mas o fim da goroutine **não** está sincronizado com nada: o que `f` escreve não fica garantido para mais ninguém, a menos que haja um canal, mutex ou `WaitGroup` no meio.
2. **Um envio num canal acontece antes do recebimento correspondente terminar.** Então quem recebe enxerga tudo o que o remetente escreveu antes de enviar.
3. **Fechar um canal acontece antes de um recebimento que retorna porque ele foi fechado.**
4. **Num canal sem buffer, o recebimento acontece antes do envio terminar** (é por isso que ele serve de "aperto de mão").
5. **O `Unlock` de um mutex acontece antes do próximo `Lock`.**
6. **`sync.WaitGroup`**: tudo antes de um `Done()` é visível depois do `Wait()` retornar.

### O caso que funciona

```go
var msg string

func imprimir() { fmt.Println(msg) }

func main() {
    msg = "olá"
    go imprimir() // a escrita de msg veio antes do go: imprimir vê "olá"
    time.Sleep(time.Second) // só para o exemplo; o certo seria um WaitGroup
}
```

### O caso que não funciona, mesmo parecendo inocente

```go
var msg string
var pronto bool

func preparar() {
    msg = "olá"
    pronto = true
}

func main() {
    go preparar()
    for !pronto { } // pode girar para sempre
    fmt.Println(msg) // e, se sair, pode imprimir ""
}
```

Nada liga o fim de `preparar` ao laço de `main`. O compilador pode ler `pronto` uma vez só e nunca mais, e mesmo que veja `true`, não há garantia de ver `msg` já escrito. A correção é usar um canal (`done := make(chan struct{})`, `close(done)` em `preparar`, `<-done` em `main`) ou um `atomic.Bool`.

> [!NOTE]
> As operações do pacote `sync/atomic` são sempre totalmente ordenadas entre si; não há "níveis" de ordenação para escolher. E uma corrida nunca é "inofensiva": numa leitura com corrida de um `int` você recebe algum valor que foi escrito, mas em valores compostos (strings, slices, interfaces) pode ler pedaços misturados e derrubar o programa.

## fyne.Do

A interface gráfica é o lugar onde isso tudo aparece na prática. No Fyne, a partir da versão 2.6, **todo acesso a widgets precisa acontecer na goroutine principal**, que roda o loop de eventos da janela. Se uma goroutine de fundo chama `label.SetText(...)` direto, o Fyne avisa no terminal com um erro dizendo que a chamada deveria estar em `fyne.Do` ou `fyne.DoAndWait`.

O padrão é: o trabalho lento fica na goroutine de fundo, e só a atualização da tela vai para `fyne.Do`:

```go
rotulo := widget.NewLabel("carregando…")

go func() {
    for range time.Tick(30 * time.Second) {
        valor, err := buscarCotacao("USD") // rede: fora da UI

        fyne.Do(func() { // agenda na goroutine da interface
            if err != nil {
                rotulo.SetText("erro: " + err.Error())
                return
            }
            rotulo.SetText(fmt.Sprintf("US$ 1 = R$ %.2f", valor))
        })
    }
}()
```

- `fyne.Do(f)` coloca `f` na fila e volta na hora.
- `fyne.DoAndWait(f)` espera `f` terminar antes de seguir.

> [!WARNING]
> Nunca faça a chamada de rede **dentro** do `fyne.Do`: ela travaria a janela inteira.

E aqui o modelo de memória aparece de novo: `valor` e `err` foram escritos na goroutine de fundo e lidos na goroutine da interface. Isso é seguro porque o `fyne.Do` entrega a função por um mecanismo sincronizado, o que cria a relação *acontece antes* entre as duas goroutines.

## Resumo

- `go f()` é barato; goroutine não é thread do sistema.
- `main` termina, tudo termina. Espere com `WaitGroup` ou canais.
- Go compila data race sem reclamar. Rode `-race`.
- Canal sem buffer sincroniza; quem envia fecha; enviar em canal fechado dá pânico.
- Buffer com tamanho que você sabe explicar; não use buffer para esconder travamento.
- `select` espera vários canais; `default` deixa não bloqueante; `time.After` e `ctx.Done()` dão timeout e cancelamento.
- `wg.Add` antes do `go`, `defer wg.Done()` dentro.
- Para parar uma goroutine, passe um `context` e ouça `ctx.Done()`. Sempre chame o `cancel`.
- Fan-out divide trabalho, fan-in junta resultados, worker pool limita a concorrência.
- Toda goroutine precisa de um jeito claro de terminar, senão vaza.
- Sem canal, mutex, atomic ou `WaitGroup`, não há garantia de visibilidade entre goroutines.
- No Fyne 2.6+, widget só se mexe dentro de `fyne.Do` / `fyne.DoAndWait`.
