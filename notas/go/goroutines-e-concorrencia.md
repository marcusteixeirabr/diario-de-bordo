# Goroutines e concorrência

Em Go, começar uma tarefa concorrente é trivial: basta uma palavra, `go`. A parte difícil é outra: o compilador **não impede** que duas tarefas mexam na mesma variável ao mesmo tempo. Essa responsabilidade é minha, com ajuda de algumas ferramentas.

## Goroutine não é thread

```go
go buscarCotacao("USD") // dispara e segue em frente
```

Uma goroutine é uma função rodando de forma concorrente, gerenciada pelo **runtime do Go**, não diretamente pelo sistema operacional.

| | Thread do sistema operacional | Goroutine |
|---|---|---|
| Quem agenda | o sistema operacional | o scheduler do runtime do Go |
| Pilha inicial | grande e fixa (MBs) | poucos KB, cresce sob demanda |
| Custo de criar | alto, centenas já pesam | baixo, dezenas de milhares é normal |
| Modelo | 1 para 1 | M para N: muitas goroutines sobre poucas threads |

O runtime mantém algumas threads do sistema (por padrão, uma por núcleo, via `GOMAXPROCS`) e vai encaixando as goroutines nelas. Quando uma goroutine fica esperando (rede, disco, canal), outra assume a thread. Por isso dá para escrever código bloqueante normal dentro de uma goroutine sem travar o programa inteiro.

### Duas regras que pegam todo iniciante

**1. Quando `main` retorna, o programa acaba**, com todas as goroutines junto, terminadas ou não.

```go
func main() {
    go fmt.Println("oi")
} // provavelmente não imprime nada
```

O jeito simples de esperar é o `sync.WaitGroup`:

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

`Add(1)` conta uma tarefa a mais, `Done()` avisa que uma terminou, e `Wait()` espera o contador voltar a zero. Nas versões recentes (Go 1.25+) existe o atalho `wg.Go(func() { ... })`, que já faz o `Add` e o `Done`.

**2. Os argumentos de `go f(x)` são avaliados na hora**, na goroutine que chamou. Só a execução de `f` vai para outra goroutine.

E desde o Go 1.22, a variável do `for` é nova a cada volta, então o `codigo` capturado no exemplo acima é seguro. Em código antigo você vai ver `codigo := codigo` dentro do laço, que era o remendo para isso.

## Canais

> Não comunique compartilhando memória; compartilhe memória comunicando.

Um canal é um cano tipado por onde goroutines passam valores umas para as outras:

```go
resultados := make(chan float64) // sem buffer
fila := make(chan string, 10)    // com buffer de 10

go func() { resultados <- 5.43 }() // envia
valor := <-resultados              // recebe (bloqueia até chegar)
```

- **Sem buffer**: envio e recebimento se encontram. Quem envia espera alguém receber. É um ponto de sincronização.
- **Com buffer**: o envio só bloqueia quando o buffer está cheio.

Fechar e percorrer:

```go
func produzir(saida chan<- int) { // chan<- : só envia
    for i := range 3 {
        saida <- i
    }
    close(saida) // quem envia é quem fecha
}

func main() {
    ch := make(chan int)
    go produzir(ch)
    for v := range ch { // <-chan seria "só recebe"
        fmt.Println(v)
    }
    // o for termina quando o canal é fechado
}
```

Comportamentos para decorar:

| Operação | Canal aberto | Canal fechado | Canal `nil` |
|---|---|---|---|
| enviar | bloqueia até ter espaço/receptor | **pânico** | bloqueia para sempre |
| receber | bloqueia até ter valor | devolve o zero do tipo, na hora | bloqueia para sempre |

Para saber se o zero veio de verdade ou do fechamento: `v, ok := <-ch` (`ok == false` significa fechado).

O `close` é explícito: se quem envia esquecer de fechar, um `for v := range ch` do outro lado fica esperando para sempre.

## `select`

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

- Se mais de um caso está pronto, o Go **sorteia** um. Não conte com ordem.
- Um `default` torna o `select` não bloqueante: se nada está pronto, cai no `default`.
- Como canal `nil` nunca fica pronto, atribuir `nil` a uma variável de canal "desliga" aquele `case`. Truque útil quando um dos canais já fechou.

## Data race

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

`contador++` parece uma operação só, mas são três: ler, somar, escrever. Duas goroutines podem ler o mesmo valor e uma escrita apaga a outra.

As duas correções mais comuns:

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

O `sync.Mutex` não fica "preso" ao dado que protege: nada impede de esquecer o `Lock`. A convenção é declarar o mutex logo acima dos campos que ele protege, para deixar a relação visível.

A ferramenta que compensa é o **detector de corridas**:

```bash
go run -race .
go test -race ./...
```

Ele só acha corridas que de fato acontecem durante a execução, então vale rodar os testes com `-race` sempre. Outro aviso que o próprio runtime dá: escrever num `map` a partir de duas goroutines pode derrubar o programa com `fatal error: concurrent map writes`.

## O modelo de memória do Go

Essa parte é a que mais me esclareceu. Sem sincronização, **não existe garantia de que uma goroutine enxergue o que outra escreveu**, nem na ordem em que foi escrito. O compilador e o processador podem reordenar instruções e manter valores em cache.

O que dá garantia é a relação *acontece antes* (*happens before*). As regras principais:

1. **`go f()` só ordena o que veio antes dele.** Tudo que a goroutine-mãe escreveu antes da instrução `go` é visível dentro de `f`. Mas o fim da goroutine **não** está sincronizado com nada: o que `f` escreve não fica garantido para mais ninguém, a menos que haja um canal, mutex ou `WaitGroup` no meio.
2. **Um envio num canal acontece antes do recebimento correspondente terminar.** Então quem recebe enxerga tudo o que o remetente escreveu antes de enviar.
3. **Fechar um canal acontece antes de um recebimento que retorna porque ele foi fechado.**
4. **Num canal sem buffer, o recebimento acontece antes do envio terminar** (é por isso que ele serve de "aperto de mão").
5. **O `Unlock` de um mutex acontece antes do próximo `Lock`.**
6. `sync.WaitGroup`: tudo antes de um `Done()` é visível depois do `Wait()` retornar.

Exemplo da regra 1, o caso que funciona:

```go
var msg string

func imprimir() { fmt.Println(msg) }

func main() {
    msg = "olá"
    go imprimir() // a escrita de msg veio antes do go: imprimir vê "olá"
    time.Sleep(time.Second) // só para o exemplo; o certo seria um WaitGroup
}
```

E o caso que **não** funciona, mesmo parecendo inocente:

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

Dois detalhes do modelo:

- As operações do pacote `sync/atomic` são sempre totalmente ordenadas entre si. Não há "níveis" de ordenação para escolher.
- Uma leitura com corrida de um valor simples (um `int`) devolve algum valor que foi escrito por alguém. Mas uma corrida em valores compostos (strings, slices, interfaces) pode ler pedaços misturados e derrubar o programa. Ou seja: corrida nunca é "inofensiva".

## Caso prático: `fyne.Do`

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
- Nunca faça a chamada de rede **dentro** do `fyne.Do`: ela travaria a janela inteira.

E aqui o modelo de memória aparece de novo: `valor` e `err` foram escritos na goroutine de fundo e lidos na goroutine da interface. Isso é seguro porque o `fyne.Do` entrega a função por um mecanismo sincronizado, o que cria a relação *acontece antes* entre as duas goroutines.

## Resumo

- `go f()` é barato; goroutine não é thread do sistema.
- `main` termina, tudo termina. Espere com `WaitGroup` ou canais.
- Canal sem buffer sincroniza; quem envia fecha; enviar em canal fechado dá pânico.
- `select` espera vários canais; `default` deixa não bloqueante; `time.After` e `ctx.Done()` dão timeout e cancelamento.
- Go compila data race sem reclamar. Rode `-race`.
- Sem canal, mutex, atomic ou `WaitGroup`, não há garantia de visibilidade entre goroutines. O `go f()` só garante o que veio antes dele.
- No Fyne 2.6+, widget só se mexe dentro de `fyne.Do` / `fyne.DoAndWait`.
