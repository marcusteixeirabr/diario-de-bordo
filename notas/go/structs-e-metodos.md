# Structs e métodos

Go não tem classes. Para agrupar dados existe a `struct`, e para dar comportamento a um tipo existem os **métodos**. Com essas duas peças, mais as interfaces e a composição, Go resolve tudo o que a programação orientada a objetos costuma resolver, só que com menos regras. Esta nota vai do básico até os exercícios.

## Structs

### O que é uma struct?

Uma struct é um tipo que junta vários campos com nome. É a forma central de modelar dados em Go.

```go
type Pessoa struct {
    Nome  string
    Idade int
    Email string
}
```

### Criando valores

```go
p1 := Pessoa{Nome: "Ana", Idade: 30, Email: "ana@go.dev"} // por nome (prefira)
p2 := Pessoa{"Bruno", 25, "b@go.dev"}                     // por posição (evite)
var p3 Pessoa                                             // zero value: "", 0, ""
p4 := &Pessoa{Nome: "Carla"}                              // ponteiro para uma Pessoa nova

fmt.Println(p1.Nome) // Ana
p4.Idade = 40        // o Go acessa o campo através do ponteiro sozinho
```

> [!TIP]
> Use sempre o literal **com nomes de campo**. Se alguém acrescentar um campo na struct, o literal por posição quebra (ou, pior, preenche o campo errado). Com nomes, os campos omitidos simplesmente ficam com o zero value.

### Struct é valor: atribuir copia

```go
a := Pessoa{Nome: "Ana"}
b := a          // b é uma cópia inteira
b.Nome = "Bia"
fmt.Println(a.Nome) // Ana: a não mudou
```

Para compartilhar o mesmo valor, use ponteiro (`&a`). Atenção: se a struct tem um slice ou map dentro, a cópia copia só o "cabeçalho", e as duas passam a apontar para os mesmos dados.

### Comparação

Duas structs podem ser comparadas com `==` quando todos os campos são comparáveis (números, strings, booleanos, ponteiros, outras structs comparáveis). Com slice, map ou função dentro, não compila. Uma struct comparável também pode ser chave de `map`:

```go
type Par struct{ De, Para string }

taxas := map[Par]float64{
    {"USD", "BRL"}: 5.43,
}
```

### Struct anônima

Para dados que só existem num lugar (muito comum em testes), não precisa declarar um tipo:

```go
casos := []struct {
    entrada  string
    esperado int
}{
    {"a", 1},
    {"abc", 3},
}
```

### Tags

Texto entre crases depois do campo. Não muda nada na linguagem, mas pacotes como `encoding/json` leem essas tags:

```go
type Cotacao struct {
    Moeda string  `json:"moeda"`
    Valor float64 `json:"valor,omitempty"`
}
```

## Zero value

Em Go, **toda variável começa com um valor definido**, o zero value do tipo. Nunca existe "lixo de memória" nem variável não inicializada.

| Tipo | Zero value |
|---|---|
| `int`, `float64` e outros números | `0` |
| `string` | `""` |
| `bool` | `false` |
| ponteiro, slice, map, canal, função, interface | `nil` |
| struct | cada campo com seu próprio zero value |

```go
var p Pessoa
fmt.Printf("%+v\n", p) // {Nome: Idade:0 Email:}
```

### Onde o `nil` morde

Os tipos que valem `nil` não se comportam todos igual:

```go
var s []int
fmt.Println(len(s)) // 0: ler um slice nil é seguro
s = append(s, 1)    // append num slice nil funciona

var m map[string]int
fmt.Println(m["x"]) // 0: ler um map nil é seguro
m["x"] = 1          // panic: assignment to entry in nil map
```

> [!WARNING]
> Map precisa ser criado antes de receber escrita: `m := make(map[string]int)` ou `m := map[string]int{}`. Se uma struct tem um campo map, alguém precisa criá-lo (normalmente o construtor, veja a parte 4).

### Zero value útil

A pergunta de design mais importante ao criar uma struct: **"se alguém declarar `var x MeuTipo` e usar direto, funciona?"** Se funcionar, ninguém precisa lembrar de chamar um construtor.

A biblioteca padrão faz isso o tempo todo:

```go
var mu sync.Mutex       // pronto para usar, já destravado
var buf bytes.Buffer    // buffer vazio, pronto para escrever
var sb strings.Builder  // idem

buf.WriteString("olá")
```

Um exemplo próprio:

```go
type Contador struct {
    mu    sync.Mutex
    total int
}

func (c *Contador) Somar() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.total++
}

var c Contador // não precisa de NewContador
c.Somar()
```

## Métodos

Um método é uma função com um **receiver**: o valor sobre o qual ele age, escrito entre parênteses antes do nome.

```go
// Receiver por valor: recebe uma cópia, não altera o original
func (p Pessoa) Saudacao() string {
    return "Olá, " + p.Nome
}

// Receiver por ponteiro: altera o original
func (p *Pessoa) FazerAniversario() {
    p.Idade++
}

p := Pessoa{Nome: "Ana", Idade: 30}
fmt.Println(p.Saudacao()) // Olá, Ana
p.FazerAniversario()      // o Go faz (&p).FazerAniversario() sozinho
fmt.Println(p.Idade)      // 31
```

Métodos podem ser definidos em qualquer tipo declarado no **mesmo pacote**, não só em structs:

```go
type Celsius float64

func (c Celsius) Fahrenheit() float64 { return float64(c)*9/5 + 32 }
```

### Valor ou ponteiro?

Use **ponteiro** quando:

1. O método precisa alterar o receiver.
2. A struct é grande e copiá-la a cada chamada seria desperdício.
3. A struct tem algo que não pode ser copiado, como um `sync.Mutex`.

Use **valor** quando o tipo é pequeno, o método só lê, e faz sentido o valor ser tratado como um dado imutável (um `Ponto`, uma `Moeda`, um `time.Time`).

> [!IMPORTANT]
> Escolha um e seja consistente no tipo inteiro. Se algum método precisa de ponteiro, o costume é fazer **todos** os métodos daquele tipo com ponteiro. Misturar confunde quem lê e afeta quais interfaces o tipo satisfaz (parte 6).

### Receiver nil

Um método com receiver ponteiro pode ser chamado mesmo quando o ponteiro é `nil`. Se o método tratar esse caso, isso vira um recurso:

```go
type No struct {
    Valor int
    Prox  *No
}

func (n *No) Soma() int {
    if n == nil {
        return 0
    }
    return n.Valor + n.Prox.Soma()
}
```

### Método como valor

Um método pode ser passado como função comum:

```go
f := p.Saudacao      // "method value": já amarrado ao p
fmt.Println(f())     // Olá, Ana

botao.OnTapped = c.Somar // muito usado em callbacks de interface gráfica
```

## Construtores

Go não tem construtor como recurso da linguagem. A convenção é uma função comum chamada `NewTipo` (ou só `New`, quando o pacote tem um tipo principal, como `list.New()`).

Ela serve quando o zero value não basta: validar dados, criar um map, definir valores padrão.

```go
type Conta struct {
    titular string
    saldo   float64
    extrato map[string]float64
}

func NewConta(titular string) (*Conta, error) {
    if titular == "" {
        return nil, errors.New("titular vazio")
    }
    return &Conta{
        titular: titular,
        extrato: make(map[string]float64),
    }, nil
}
```

Repare nos campos **minúsculos**: fora do pacote ninguém consegue criar uma `Conta` com saldo inventado nem mexer no extrato. O único caminho é o `NewConta` e os métodos que você exportar. É assim que Go faz encapsulamento.

> [!TIP]
> Devolver `*Conta` ou `Conta`? Se o tipo tem métodos com receiver ponteiro, devolva ponteiro. Se é um valor pequeno e imutável, devolva valor.

### Opções com valor padrão

Quando há muitos parâmetros opcionais, uma saída simples é uma struct de configuração, onde o zero value de cada campo significa "use o padrão":

```go
type Config struct {
    Timeout time.Duration // 0 = padrão de 5s
    Moeda   string        // "" = "BRL"
}

func NewCliente(cfg Config) *Cliente {
    if cfg.Timeout == 0 {
        cfg.Timeout = 5 * time.Second
    }
    if cfg.Moeda == "" {
        cfg.Moeda = "BRL"
    }
    return &Cliente{cfg: cfg}
}

c := NewCliente(Config{Moeda: "USD"})
```

## Composição

Go não tem herança. Para reaproveitar uma struct dentro de outra existem duas formas.

### Campo com nome

```go
type Endereco struct {
    Rua, Cidade string
}

type Cliente struct {
    Nome     string
    Endereco Endereco
}

c.Endereco.Cidade = "Itajaí"
```

### Embedding: campo sem nome

Se você escreve só o tipo, sem nome de campo, ele fica **embutido**, e seus campos e métodos são **promovidos**: dá para usá-los direto pelo tipo de fora.

```go
type Pessoa struct {
    Nome string
}

func (p Pessoa) Apresentar() string {
    return "Sou " + p.Nome
}

type Funcionario struct {
    Pessoa         // embutido
    Cargo   string
}

f := Funcionario{Pessoa: Pessoa{Nome: "Ana"}, Cargo: "Inspetora"}
fmt.Println(f.Nome)         // promovido: igual a f.Pessoa.Nome
fmt.Println(f.Apresentar()) // promovido: igual a f.Pessoa.Apresentar()
```

O tipo de fora pode ter um método com o mesmo nome. Ele "esconde" o promovido, mas o original continua acessível:

```go
func (f Funcionario) Apresentar() string {
    return f.Pessoa.Apresentar() + ", " + f.Cargo
}
```

### Embedding não é herança

Esse é o ponto que mais confunde. O método promovido continua sendo **da `Pessoa`**: o receiver dele é a `Pessoa` de dentro, e ele não sabe que existe um `Funcionario` em volta.

```go
func (p Pessoa) Cartao() string {
    return "[" + p.Apresentar() + "]" // chama SEMPRE Pessoa.Apresentar
}

fmt.Println(f.Cartao()) // [Sou Ana]  (não usa o Apresentar do Funcionario)
```

Também não dá para usar um `Funcionario` onde se espera uma `Pessoa`: são tipos diferentes. Quando você precisa de "qualquer coisa que se apresente", a ferramenta certa é uma **interface** (próxima parte).

> [!NOTE]
> Pense no embedding como "**tem um**, com atalho", e não como "**é um**". O `Funcionario` tem uma `Pessoa` dentro, e o Go deixa você chamar os métodos dela sem escrever `f.Pessoa.` toda vez.

### Embutindo para delegar

Um uso muito comum é embutir algo e ganhar os métodos de graça:

```go
type Cache struct {
    sync.Mutex // Cache ganha Lock() e Unlock()
    dados map[string]float64
}

c.Lock()
c.dados["USD"] = 5.43
c.Unlock()
```

(Isso exporta `Lock` e `Unlock` para quem usa o `Cache`. Se não quiser, use um campo com nome: `mu sync.Mutex`.)

## Interfaces

Uma interface é um conjunto de assinaturas de métodos. Ela descreve um **comportamento**, não dados.

```go
type Forma interface {
    Area() float64
    Perimetro() float64
}
```

### Implementação implícita

Não existe palavra para "implementa". Um tipo satisfaz a interface **automaticamente** se tiver todos os métodos dela:

```go
type Retangulo struct{ Largura, Altura float64 }

func (r Retangulo) Area() float64      { return r.Largura * r.Altura }
func (r Retangulo) Perimetro() float64 { return 2 * (r.Largura + r.Altura) }

var f Forma = Retangulo{4, 6} // ok: Retangulo tem os dois métodos
```

Consequência prática: um tipo de outro pacote, que nunca ouviu falar da sua interface, pode satisfazê-la. Você define a interface do lado de quem **usa**, com só os métodos de que precisa.

Para o compilador conferir isso logo na declaração (e dar erro claro se faltar algo):

```go
var _ Forma = Retangulo{} // não gera código; só checa
```

### Interfaces pequenas

As interfaces mais usadas da biblioteca padrão têm um método só: `io.Reader`, `io.Writer`, `fmt.Stringer`, `error`. Interfaces maiores se montam juntando as pequenas:

```go
type ReadWriter interface {
    io.Reader
    io.Writer
}
```

> [!TIP]
> Quanto menor a interface, mais tipos a satisfazem e mais fácil é testar. Comece com o mínimo de métodos que a função realmente usa.

### Valor ou ponteiro faz diferença aqui

Se os métodos têm receiver **ponteiro**, só o ponteiro satisfaz a interface:

```go
type Circulo struct{ Raio float64 }

func (c *Circulo) Area() float64      { return math.Pi * c.Raio * c.Raio }
func (c *Circulo) Perimetro() float64 { return 2 * math.Pi * c.Raio }

var f Forma = &Circulo{5} // ok
var g Forma = Circulo{5}  // erro: Circulo does not implement Forma
                          // (method Area has pointer receiver)
```

A regra (chamada *method set*): o tipo `T` tem só os métodos com receiver `T`; o tipo `*T` tem os dois, `T` e `*T`.

### Descobrindo o tipo concreto

```go
// type assertion: "isso é um Circulo?"
if c, ok := f.(*Circulo); ok {
    fmt.Println("raio:", c.Raio)
}

// type switch: vários casos
switch v := f.(type) {
case *Circulo:
    fmt.Println("círculo de raio", v.Raio)
case Retangulo:
    fmt.Println("retângulo", v.Largura, "x", v.Altura)
default:
    fmt.Println("outra forma")
}
```

Sem o `, ok`, uma assertion errada causa pânico.

### `any`

`any` (o mesmo que `interface{}`) é a interface sem métodos: todo tipo a satisfaz. Útil em casos como `fmt.Println(args ...any)`, mas abre mão da checagem de tipos. Prefira interfaces com métodos ou generics.

> [!CAUTION]
> **Interface com ponteiro nil dentro não é nil.** Uma interface guarda um par (tipo, valor). Se você coloca um `*Circulo` nil numa `Forma`, o tipo está preenchido, então `f == nil` é `false`. O caso clássico é devolver um ponteiro de erro nil como `error`: quem chama vê `err != nil`. Ao devolver "sem erro", devolva `nil` literal.

## POO em Go

Os quatro pilares da orientação a objetos, e a peça de Go que resolve cada um:

| Pilar | Como Go resolve |
|---|---|
| **Encapsulamento** | Campos e funções com inicial minúscula ficam invisíveis fora do pacote. A fronteira é o pacote, não o tipo. |
| **Abstração** | Interfaces pequenas descrevem o comportamento que uma função precisa, sem dizer nada sobre a implementação. |
| **Polimorfismo** | Qualquer tipo com os métodos certos satisfaz a interface; a chamada `f.Area()` vai para a implementação do tipo real. |
| **Reaproveitamento** | Composição: campos e embedding. Não há herança nem hierarquia de tipos. |

### O que muda na forma de pensar

Em vez de começar perguntando "qual é a hierarquia dos meus tipos?", a pergunta em Go é:

1. Quais **dados** eu tenho? (structs)
2. Quais **comportamentos** as funções precisam? (interfaces pequenas, do lado de quem usa)
3. Como **componho** as structs para entregar esses comportamentos? (campos e embedding)

### Polimorfismo na prática

```go
func AreaTotal(formas []Forma) float64 {
    total := 0.0
    for _, f := range formas {
        total += f.Area() // cada forma calcula do seu jeito
    }
    return total
}
```

`AreaTotal` não sabe e não precisa saber que tipos existem. Uma forma nova criada amanhã, em outro pacote, funciona sem mudar uma linha aqui. A solução completa está na parte 10.

### Como o Go faz a chamada certa

Uma variável de interface guarda internamente dois ponteiros: um para a **tabela de métodos** do tipo concreto e outro para o **valor**. Ao chamar `f.Area()`, o runtime olha a tabela e pula para a `Area` do tipo que está ali dentro. Por isso o custo é pequeno e não precisa de hierarquia.

## Go idiomático

Um resumo das convenções que aparecem em código Go de verdade.

### Accept interfaces, return structs

Funções recebem interfaces (o mínimo de que precisam) e devolvem tipos concretos (tudo o que têm):

```go
func Salvar(w io.Writer, c Cotacao) error { ... } // recebe interface
func NewCliente(cfg Config) *Cliente     { ... } // devolve struct
```

### A interface mora com quem usa

Não crie uma interface "por precaução" ao lado da struct. Crie no pacote que consome, com os métodos que ele usa. Uma interface com um único tipo que a implementa geralmente é desnecessária.

### Nomes

- Interface de um método: nome do método + `-er` (`Reader`, `Notificador`).
- Getter sem `Get`: `c.Saldo()`, não `c.GetSaldo()`. Setter com `Set`: `c.SetLimite(v)`.
- Receiver curto e sempre o mesmo: `func (c *Conta)`, nunca `this` ou `self`.
- Construtor `NewTipo`.

### `String()` para imprimir bonito

```go
func (c Conta) String() string {
    return fmt.Sprintf("%s: R$ %.2f", c.titular, c.saldo)
}

fmt.Println(conta) // Ana: R$ 150.00
```

### Não use ponteiro para tudo

Ponteiro não é "mais rápido" automaticamente. Para structs pequenas, passar por valor é simples, seguro e costuma ser igualmente barato. Use ponteiro pelos motivos da parte 3: alterar, tamanho, ou campos que não podem ser copiados.

### Zero value útil > construtor obrigatório

Se der para o zero value funcionar, prefira isso. Um construtor só deve existir quando há algo que **precisa** ser feito antes do uso.

## Exercícios

Do mais simples ao mais aberto. Escreva um teste (`_test.go`) para cada um, se quiser treinar junto.

### 1. Conta bancária

Crie um pacote `banco` com:

- `type Conta struct` com campos **não exportados** `titular` e `saldo`.
- `NewConta(titular string) (*Conta, error)`, que recusa titular vazio.
- Métodos `Depositar(v float64) error` (recusa valor ≤ 0), `Sacar(v float64) error` (recusa saldo insuficiente com um erro sentinela `ErrSaldoInsuficiente`) e `Saldo() float64`.
- Teste no `main` que `errors.Is(err, banco.ErrSaldoInsuficiente)` funciona.

### 2. Formas geométricas

Interface `Forma` com `Area()`, `Perimetro()` e `Nome()`, implementada por `Circulo`, `Retangulo` e `Triangulo`. Uma função `RelatorioFormas([]Forma)` imprime uma tabela com todas. A solução está na próxima parte.

### 3. Funcionário com embedding

`Funcionario` embute `Pessoa`. Faça `Apresentar()` existir nas duas, com o do `Funcionario` reaproveitando o da `Pessoa`. Depois escreva o método `Cartao()` na `Pessoa` e veja na prática que ele chama o `Apresentar` da `Pessoa` (parte 5).

### 4. Stringer

Faça `Conta` (exercício 1) satisfazer `fmt.Stringer`, e veja o `fmt.Println(conta)` mudar. Tente também cair na armadilha de chamar `fmt.Sprintf("%v", c)` dentro do próprio `String()` para ver o estouro de pilha.

### 5. Notificador

Interface `Notificador` com `Notificar(msg string) error`. Implemente `Email` e `Terminal` (que só imprime). Uma função `Avisar(ns []Notificador, msg string) error` tenta todos e junta os erros com `errors.Join`.

### 6. Zero value útil

Crie `type Placar struct` que conta pontos por nome (`map[string]int`) e é seguro para várias goroutines, **sem construtor**: `var p Placar; p.Somar("Ana", 3)` tem que funcionar. Dica: crie o map na primeira escrita.

### 7. Com testes

Siga o capítulo "Estruturas, métodos e interfaces" do *Aprenda Go com Testes* (link nas referências). Ele constrói o exercício das formas a partir dos testes.

## Solução: Formas

```go
package main

import (
    "fmt"
    "math"
)

type Forma interface {
    Nome() string
    Area() float64
    Perimetro() float64
}

type Circulo struct{ Raio float64 }

func (c Circulo) Nome() string       { return "Círculo" }
func (c Circulo) Area() float64      { return math.Pi * c.Raio * c.Raio }
func (c Circulo) Perimetro() float64 { return 2 * math.Pi * c.Raio }

type Retangulo struct{ Largura, Altura float64 }

func (r Retangulo) Nome() string       { return "Retângulo" }
func (r Retangulo) Area() float64      { return r.Largura * r.Altura }
func (r Retangulo) Perimetro() float64 { return 2 * (r.Largura + r.Altura) }

type Triangulo struct{ A, B, C float64 }

func (t Triangulo) Nome() string       { return "Triângulo" }
func (t Triangulo) Perimetro() float64 { return t.A + t.B + t.C }
func (t Triangulo) Area() float64 {
    s := t.Perimetro() / 2 // fórmula de Heron
    return math.Sqrt(s * (s - t.A) * (s - t.B) * (s - t.C))
}

// Checagens em tempo de compilação
var (
    _ Forma = Circulo{}
    _ Forma = Retangulo{}
    _ Forma = Triangulo{}
)

func RelatorioFormas(formas []Forma) {
    fmt.Printf("%-10s %10s %10s\n", "Forma", "Área", "Perímetro")
    total := 0.0
    for _, f := range formas {
        fmt.Printf("%-10s %10.2f %10.2f\n", f.Nome(), f.Area(), f.Perimetro())
        total += f.Area()
    }
    fmt.Printf("%-10s %10.2f\n", "Total", total)
}

func main() {
    formas := []Forma{
        Circulo{Raio: 5},
        Retangulo{Largura: 4, Altura: 6},
        Triangulo{A: 3, B: 4, C: 5},
    }
    RelatorioFormas(formas)
}
```

Saída:

```text
Forma            Área  Perímetro
Círculo         78.54      31.42
Retângulo       24.00      20.00
Triângulo        6.00      12.00
Total          108.54
```

### As decisões por trás

- **Por que `Nome()` na interface?** O relatório precisa identificar cada forma. Se amanhã surgir a necessidade de salvar em JSON, a saída idiomática é outra interface pequena, e não engordar a `Forma`.
- **Por que receiver por valor?** As três structs são pequenas e os métodos só leem. Por valor, tanto `Circulo{}` quanto `&Circulo{}` entram na `Forma`.
- **Onde está o polimorfismo?** Na linha `f.Area()` dentro do `for`: cada elemento do slice carrega o seu tipo real, e a chamada vai para a implementação certa.
- **Por que as linhas `var _ Forma = ...`?** Se alguém mudar uma assinatura e um tipo deixar de satisfazer a interface, o erro aparece ali, com uma mensagem clara, e não lá longe onde o slice é montado.

> [!TIP]
> Note os `%-10s` e `%10.2f` do relatório: largura fixa para alinhar a tabela. Veja a nota *Verbos de formatação*.

## Referências

### Documentação oficial (inglês)

- [A Tour of Go: Structs](https://go.dev/tour/moretypes/2) e [Methods](https://go.dev/tour/methods/1): o tour interativo, com código para rodar no navegador.
- [Effective Go: Methods](https://go.dev/doc/effective_go#methods) e [Embedding](https://go.dev/doc/effective_go#embedding): o guia de estilo clássico da linguagem.
- [Go FAQ: Is Go an object-oriented language?](https://go.dev/doc/faq#Is_Go_an_object-oriented_language): a resposta oficial sobre orientação a objetos em Go. Leia também a seção [sobre herança](https://go.dev/doc/faq#inheritance).
- [Go Code Review Comments: Receiver Type](https://go.dev/wiki/CodeReviewComments#receiver-type): o checklist de quando usar valor ou ponteiro.

### Sites com exemplos

- [Go by Example: Struct Embedding](https://gobyexample.com/struct-embedding) (inglês). No mesmo site há as páginas de *Structs*, *Methods* e *Interfaces*, cada uma com um exemplo curto e a saída.
- [Learn Go with Tests: Structs, methods & interfaces](https://quii.gitbook.io/learn-go-with-tests/go-fundamentals/structs-methods-and-interfaces) (inglês) e a tradução [Aprenda Go com Testes: Estruturas, métodos e interfaces](https://larien.gitbook.io/aprenda-go-com-testes/primeiros-passos-com-go/estruturas-metodos-e-interfaces) (português).
- [DigitalOcean: Definindo structs no Go](https://www.digitalocean.com/community/tutorials/defining-structs-in-go-pt) e [Definindo métodos em Go](https://www.digitalocean.com/community/tutorials/defining-methods-in-go-pt) (português).

### Vídeos em português

- [Structs, Métodos e Interfaces com Golang](https://www.youtube.com/watch?v=KSYXtqrVjm4), Full Cycle (27 min).
- [Structs, Composição e Json com Golang](https://www.youtube.com/watch?v=lAT_NNJ-vH8), Full Cycle (25 min).
- [Go #03 - Tudo sobre Structs, Receivers e Ponteiros!](https://www.youtube.com/watch?v=U3nj2IvQK6Y), Trilha Sênior (15 min).

### Vídeos em inglês

- [Go Class: 18 Methods and Interfaces](https://www.youtube.com/watch?v=W3ZWbhQF6wg), Matt KØDVB (44 min). Faz parte de um curso completo e bem aprofundado.
- [This is your last video about Golang Structs!](https://www.youtube.com/watch?v=c8H0w4yBL10), Flo Woelki (16 min).
- [Golang: The Last Interface Explanation You'll Ever Need](https://www.youtube.com/watch?v=SX1gT5A9H-U), Flo Woelki (18 min).

## Resumo

- `struct` agrupa dados; prefira literais com nome de campo. Atribuir copia.
- Toda variável começa com zero value. Map nil quebra na escrita; slice nil não.
- Projete o tipo para o zero value ser útil; use `NewTipo` só quando precisa validar ou preparar algo.
- Método = função com receiver. Ponteiro para alterar, para struct grande ou com mutex; valor para dado pequeno. Seja consistente no tipo.
- Campo minúsculo é privado ao pacote: é assim que Go encapsula.
- Embedding promove campos e métodos, mas **não é herança**: o método promovido continua sendo do tipo de dentro.
- Interfaces são satisfeitas implicitamente. Mantenha-as pequenas e no pacote que as usa.
- Método com receiver ponteiro: só `*T` satisfaz a interface.
- Interface com ponteiro nil dentro não é `nil`.
- Aceite interfaces, devolva structs.
