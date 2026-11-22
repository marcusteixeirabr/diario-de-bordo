# Ponteiros

Um ponteiro guarda o **endereço** de um valor, e não o valor em si. Em Go eles aparecem o tempo todo (receivers, construtores, campos opcionais), mas de um jeito bem mais simples do que a fama sugere: não há aritmética de ponteiros, o coletor de lixo cuida da memória, e o compilador decide sozinho onde cada valor vive. Tudo gira em torno de dois símbolos, `&` e `*`.

## Memória

Cada variável ocupa um espaço na memória, e esse espaço tem um **endereço**. Um ponteiro é uma variável cujo valor é um desses endereços.

```go
var x int = 42
var p *int = &x // p guarda o endereço de x
var y int = 99
```

| Endereço (exemplo) | Variável | Valor |
|---|---|---|
| `0xc000014088` | `x` (`int`) | `42` |
| `0xc000014090` | `p` (`*int`) | `0xc000014088` |
| `0xc000014098` | `y` (`int`) | `99` |

> [!NOTE]
> `p` não guarda `42`. Guarda o **endereço** de `x`. Pense numa seta que aponta para onde o valor mora.

```go
fmt.Println(x)  // 42            o valor
fmt.Println(&x) // 0xc000014088  o endereço de x
fmt.Println(p)  // 0xc000014088  p guarda esse endereço
fmt.Println(*p) // 42            o valor que está naquele endereço
```

Os endereços mudam a cada execução; o que importa é a relação entre eles.

### Para que serve

1. **Alterar algo que pertence a outra função.** Em Go, todo argumento é passado por **cópia**. Para uma função mudar a variável de quem chamou, ela precisa do endereço.
2. **Evitar copiar valores grandes.** Passar o endereço de uma struct grande custa o tamanho de um endereço.
3. **Representar "pode não existir".** Um ponteiro pode ser `nil` (parte 3).

## * e &

Dois símbolos, três papéis:

| Onde aparece | Escrita | Significado |
|---|---|---|
| num **tipo** | `*int`, `*Pessoa` | "ponteiro para int", "ponteiro para Pessoa" |
| antes de uma **variável** | `&x` | "o endereço de x" |
| antes de um **ponteiro**, numa expressão | `*p` | "o valor para onde p aponta" (desreferenciar) |

```go
func dobrar(n *int) { // o parâmetro é do tipo "ponteiro para int"
    *n = *n * 2       // lê e escreve no valor apontado
}

x := 10
dobrar(&x)     // passa o endereço de x
fmt.Println(x) // 20
```

Sem o ponteiro, a função receberia uma cópia:

```go
func dobrarCopia(n int) { n = n * 2 } // altera só a cópia local

x := 10
dobrarCopia(x)
fmt.Println(x) // 10
```

### Criando ponteiros

```go
p1 := &x                // endereço de uma variável que já existe
p2 := new(int)          // uma variável int nova, com zero value; devolve *int
p3 := &Pessoa{Nome: "Ana"} // endereço de uma struct criada na hora (muito comum)
```

Não dá para tirar o endereço de qualquer coisa. Só de algo **endereçável** (variável, campo de struct, elemento de slice ou array):

```go
&42            // erro: constante não tem endereço
&soma(1, 2)    // erro: resultado de função não tem endereço
&m["chave"]    // erro: elemento de map não é endereçável
```

> [!TIP]
> No Go 1.26 o `new` passou a aceitar uma expressão como valor inicial: `new(42)` cria um `int` valendo 42 e devolve o ponteiro. Muito útil para campos opcionais (parte 6). Em versões anteriores, o jeito era criar uma variável e pegar o endereço dela.

### O Go desreferencia sozinho em dois lugares

```go
p := &Pessoa{Nome: "Ana"}
fmt.Println(p.Nome) // o Go faz (*p).Nome por você
p.Nome = "Bia"

var c Contador
c.Inc() // se Inc tem receiver *Contador, o Go faz (&c).Inc()
```

Fora esses dois casos (campo de struct e chamada de método), a desreferência é sempre explícita com `*`.

### O que não existe em Go

- **Aritmética de ponteiros**: não dá para fazer `p + 1` para andar na memória. Para percorrer dados em sequência, use slices.
- **Liberar memória à mão**: não há `free`. Quando nada mais aponta para um valor, o coletor de lixo recolhe.
- **Ponteiro inválido**: enquanto existir um ponteiro para um valor, aquele valor continua vivo. Não existe "ponteiro para algo que já foi apagado".

## nil e zero value

O zero value de qualquer tipo ponteiro é `nil`: um ponteiro que não aponta para lugar nenhum.

```go
var p *int
fmt.Println(p == nil) // true
fmt.Println(*p)       // panic: invalid memory address or nil pointer dereference
```

> [!WARNING]
> Desreferenciar `nil` derruba o programa. Sempre que um ponteiro **pode** ser nil, confira antes de usar.

```go
func nomeOuPadrao(p *Pessoa) string {
    if p == nil {
        return "(sem nome)"
    }
    return p.Nome
}
```

### Ponteiro nil como "valor ausente"

Às vezes zero é um valor válido e você precisa diferenciar "zero" de "não informado". Um ponteiro resolve:

```go
type Filtro struct {
    IdadeMinima *int // nil = sem filtro; &0 = idade mínima 0
}

func (f Filtro) Aceita(idade int) bool {
    return f.IdadeMinima == nil || idade >= *f.IdadeMinima
}
```

Com `encoding/json`, isso também diferencia campo ausente (`nil`) de campo com valor zero.

### Comparando ponteiros

```go
a, b := 5, 5
pa, pb := &a, &b

fmt.Println(pa == pb)   // false: endereços diferentes
fmt.Println(*pa == *pb) // true: valores iguais
fmt.Println(pa == &a)   // true: mesmo endereço
```

`==` entre ponteiros compara **endereços**. Para comparar o conteúdo, desreferencie.

## Valor ou ponteiro

### Tudo em Go é passado por cópia

Toda atribuição e todo argumento copia o valor. A diferença está em **o que** é copiado:

| Tipo | O que a cópia leva | Mudança dentro da função aparece fora? |
|---|---|---|
| `int`, `string`, `bool`, struct, array | o valor inteiro | não |
| ponteiro `*T` | o endereço | sim, ao escrever em `*p` |
| slice | um "cabeçalho" (ponteiro para os dados, tamanho, capacidade) | elementos: sim; `append`: não |
| map, canal | uma referência interna | sim |

O caso do slice é o que mais confunde:

```go
func zerarPrimeiro(s []int) { s[0] = 0 }        // muda o array compartilhado
func acrescentar(s []int)   { s = append(s, 4) } // muda só o cabeçalho local

nums := []int{1, 2, 3}
zerarPrimeiro(nums)
acrescentar(nums)
fmt.Println(nums) // [0 2 3]: o 0 apareceu, o 4 não
```

Para uma função aumentar um slice, o idioma é **devolver** o slice novo, como faz o próprio `append`: `nums = acrescentar(nums)`.

### Struct: valor ou ponteiro?

```go
type Contador struct{ n int }

func (c Contador) IncValor()    { c.n++ } // altera a cópia
func (c *Contador) IncPonteiro() { c.n++ } // altera o original

var c Contador
c.IncValor()
c.IncPonteiro()
fmt.Println(c.n) // 1
```

Use **ponteiro** quando:

1. A função ou método precisa alterar o valor.
2. A struct é grande.
3. A struct contém algo que não pode ser copiado, como `sync.Mutex`.
4. Faz sentido existir "nenhum" (`nil`).

Use **valor** quando o tipo é pequeno, só lido, e deve se comportar como um dado (um ponto, uma data, uma moeda).

> [!IMPORTANT]
> Ponteiro não é automaticamente "mais rápido". Para structs pequenas, copiar costuma ser tão barato quanto passar o endereço, e evita trabalho para o coletor de lixo (parte 5). Escolha pelo significado, não por otimização imaginada.

### A armadilha do `range`

A variável do `for range` é uma **cópia** do elemento:

```go
pessoas := []Pessoa{{Nome: "Ana"}, {Nome: "Bia"}}

for _, p := range pessoas {
    p.Nome = "X" // altera a cópia; pessoas não muda
}

for i := range pessoas {
    pessoas[i].Nome = "X" // altera o elemento de verdade
}

ptr := &pessoas[0] // ponteiro para o elemento dentro do slice
```

## Stack e heap

### Pode devolver o endereço de uma variável local?

Pode, e é comum:

```go
func NovaPessoa(nome string) *Pessoa {
    p := Pessoa{Nome: nome}
    return &p // seguro
}
```

O compilador percebe que `p` precisa continuar existindo depois que a função termina e a coloca no **heap**, a área de memória gerenciada pelo coletor de lixo. Isso se chama **escape analysis** (análise de escape): o valor "escapa" da função.

- **Stack (pilha)**: memória de cada chamada de função. Muito barata e liberada automaticamente quando a função retorna.
- **Heap**: memória que sobrevive à função. Custa mais para alocar e o coletor de lixo precisa recolher depois.

Você não escolhe: o compilador decide. Mas dá para ver a decisão:

```bash
go build -gcflags=-m .
```

```text
./main.go:8:2: moved to heap: p
./main.go:14:9: &Config{...} escapes to heap
```

### Por que isso importa

Na maior parte do tempo, não importa: o código fica correto de qualquer jeito. Só vale olhar quando um trecho muito usado está lento e o perfil mostra muitas alocações. Nesse caso, trocar ponteiros por valores pode reduzir o trabalho do coletor de lixo.

> [!TIP]
> Primeiro escreva o código mais claro. Só olhe o `-gcflags=-m` quando uma medição mostrar que vale a pena.

## Idiomas Go

### Construtor devolve ponteiro

```go
func NewConta(titular string) *Conta {
    return &Conta{titular: titular}
}
```

### `(*T, error)` para "talvez encontre"

```go
func (r *Repo) Buscar(id int) (*Pessoa, error) {
    p, ok := r.dados[id]
    if !ok {
        return nil, ErrNaoEncontrado
    }
    return &p, nil
}
```

Se `err != nil`, o ponteiro é `nil` e não deve ser usado.

### Receivers ponteiro para quem tem estado

Tipos com estado mutável (contadores, conexões, caches) usam receiver `*T` em **todos** os métodos, por consistência.

### Campos opcionais

```go
type Atualizacao struct {
    Nome  *string `json:"nome,omitempty"`
    Idade *int    `json:"idade,omitempty"`
}

idade := 31
a := Atualizacao{Idade: &idade}  // até Go 1.25
a = Atualizacao{Idade: new(31)}  // Go 1.26+
```

### Não use ponteiro para o que já é referência

Em geral, **não** use `*[]T`, `*map[K]V`, `*chan T` ou ponteiro para interface. Slices, maps e canais já carregam uma referência interna, e uma interface pode guardar um ponteiro dentro dela. A exceção é quando a função precisa trocar o slice inteiro de quem chamou, e mesmo assim devolver o slice costuma ser mais claro.

### Não copie o que tem `sync.Mutex`

Uma struct com mutex deve ser passada sempre por ponteiro. O `go vet` avisa quando um mutex é copiado.

### Prefira devolver valores a escrever em parâmetros

```go
// menos claro
func calcular(entrada int, resultado *int) { *resultado = entrada * 2 }

// mais claro: Go tem múltiplos retornos
func calcular(entrada int) int { return entrada * 2 }
```

Ponteiro como parâmetro de saída só vale quando há um motivo real, como preencher uma struct grande (é o que o `json.Unmarshal(dados, &v)` faz).

## Exercícios

### 1. Troca

Escreva `swap(a, b *int)` que troca os valores de duas variáveis. Teste com `x, y := 1, 2; swap(&x, &y)`. A solução comentada está na próxima parte.

### 2. Dobrar de dois jeitos

Escreva `dobrarPonteiro(n *int)` e `dobrarValor(n int) int`. Use os dois e escreva num comentário qual você prefere e por quê.

### 3. Lista encadeada

```go
type No struct {
    Valor int
    Prox  *No
}

type Lista struct {
    inicio *No
    tam    int
}
```

Implemente `InserirInicio(v int)`, `InserirFim(v int)`, `Remover(v int) bool` e `String() string` (que imprime `1 -> 2 -> 3`). Cuidado com a lista vazia e com remover o primeiro nó.

### 4. Valor ou ponteiro no receiver

Crie `Contador` com `IncValor()` (receiver valor) e `IncPonteiro()` (receiver ponteiro). Chame cada um 3 vezes e imprima o resultado. Depois tente colocar um `Contador` (não `*Contador`) numa interface `interface{ IncPonteiro() }` e leia a mensagem de erro do compilador.

### 5. Escape analysis

Escreva uma função que devolve `*Pessoa` e outra que devolve `Pessoa`. Rode `go build -gcflags=-m .` e identifique as linhas com `moved to heap` e `escapes to heap`.

### 6. Campos opcionais com JSON

Crie a struct `Atualizacao` da parte 6. Decodifique `{"nome":"Ana"}` e `{"nome":"Ana","idade":0}` e mostre que dá para diferenciar "idade não enviada" de "idade zero".

### 7. A armadilha do range

Monte um slice de 3 structs e tente alterar um campo de todas com `for _, p := range`. Confira que nada mudou e corrija de duas formas: pelo índice e com `p := &s[i]`.

## Solução: swap

```go
package main

import "fmt"

func swap(a, b *int) {
    *a, *b = *b, *a
}

func main() {
    x, y := 1, 2
    swap(&x, &y)
    fmt.Println(x, y) // 2 1
}
```

### Passo a passo na memória

1. `swap(&x, &y)`: a função recebe **cópias dos endereços**. `a` aponta para `x`, `b` aponta para `y`.
2. O lado direito `*b, *a` é avaliado inteiro primeiro: lê `2` e `1`.
3. Só então as escritas acontecem: `*a = 2` (em `x`) e `*b = 1` (em `y`).
4. A função termina; `a` e `b` somem, mas `x` e `y` foram alterados de verdade.

### Por que o ponteiro é obrigatório aqui

Sem ponteiros, `swap(a, b int)` receberia cópias dos números. A troca aconteceria nas variáveis locais e desapareceria quando a função retornasse.

### Por que não precisa de variável temporária

Na atribuição múltipla, Go avalia **todo** o lado direito antes de escrever qualquer coisa do lado esquerdo. Por isso `*a, *b = *b, *a` funciona direto.

### A alternativa sem ponteiro

```go
func trocar(a, b int) (int, int) { return b, a }

x, y = trocar(x, y)
```

Com múltiplos retornos, essa versão costuma ser a mais idiomática para casos simples. E, para duas variáveis locais, nem precisa de função: `x, y = y, x`.

## Referências

### Documentação oficial (inglês)

- [A Tour of Go: Pointers](https://go.dev/tour/moretypes/1): o tour interativo, com código para rodar no navegador.
- [Go FAQ: passagem por valor](https://go.dev/doc/faq#pass_by_value), [stack ou heap](https://go.dev/doc/faq#stack_or_heap), [métodos em valores ou ponteiros](https://go.dev/doc/faq#methods_on_values_or_pointers) e [por que não há aritmética de ponteiros](https://go.dev/doc/faq#no_pointer_arithmetic).
- [Especificação: Address operators](https://go.dev/ref/spec#Address_operators): a definição exata de `&` e `*` e do que é endereçável.
- [Notas do Go 1.26](https://go.dev/doc/go1.26): o `new` com valor inicial.

### Sites

- [Go by Example: Pointers](https://gobyexample.com/pointers) (inglês).
- [DigitalOcean: Entendendo ponteiros em Go](https://www.digitalocean.com/community/conceptual-articles/understanding-pointers-in-go-pt) (português).
- [Aprenda Go com Testes: Ponteiros e erros](https://larien.gitbook.io/aprenda-go-com-testes/primeiros-passos-com-go/ponteiros-e-erros) (português).

### Vídeos em português

- [Aprenda a trabalhar com ponteiros usando Golang](https://www.youtube.com/watch?v=-FiBp1OeZF0), Full Cycle (21 min).
- [Como funcionam os PONTEIROS em Go? (Explicação clara e prática!)](https://www.youtube.com/watch?v=32b1uiARn04), Rocketseat (19 min).
- [Cap. 14 – Ponteiros – 1. O que são ponteiros?](https://www.youtube.com/watch?v=l2YJ-5GpGr8), Aprenda Go (6 min). Primeiro vídeo de um capítulo inteiro sobre ponteiros.

### Vídeos em inglês

- [Go Class: 14 Reference & Value Semantics](https://www.youtube.com/watch?v=904pyovPvXM), Matt KØDVB (24 min).
- [Golang pointers explained, once and for all](https://www.youtube.com/watch?v=2XEQsJLsLN0), JamieGo (14 min).
- [Go Pointers: When & How To Use Them Efficiently](https://www.youtube.com/watch?v=3WsEDZRif6U), Anthony GG (14 min).
- [Escape Analysis in Go: Stack or Heap?](https://www.youtube.com/watch?v=BanG_wLnSfE), Phuong Le (25 min).

## Resumo

- Ponteiro guarda um endereço. `*T` é o tipo, `&x` pega o endereço, `*p` lê ou escreve o valor apontado.
- Go passa tudo por cópia; ponteiro é como uma função altera algo de quem chamou.
- Só dá para tirar endereço de algo endereçável (variável, campo, elemento de slice). `new(T)` cria um valor novo e devolve o ponteiro.
- O zero value de ponteiro é `nil`; desreferenciar `nil` é pânico.
- `==` entre ponteiros compara endereços.
- Slice: elementos são compartilhados, `append` não. Devolva o slice novo.
- Ponteiro para alterar, para struct grande, com mutex ou para "pode não existir". Valor para dado pequeno.
- Devolver `&local` é seguro: o compilador põe no heap (escape analysis, `-gcflags=-m`).
- Não use ponteiro para slice, map, canal ou interface sem motivo.
- Sem aritmética de ponteiros e sem `free`: o coletor de lixo cuida da memória.
