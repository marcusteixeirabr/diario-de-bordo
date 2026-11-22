# Verbos de formatação (`fmt`)

As funções de formatação do pacote `fmt` recebem um texto modelo com "verbos", marcadores que começam com `%`, como `%v`, `%d` e `%s`. Cada verbo é trocado por um dos argumentos, na ordem. Um detalhe importante: **o compilador não confere se o verbo combina com o argumento**. O erro só aparece na execução (ou no `go vet`, que veremos no fim).

## Família %v

Esses quatro são os que mais uso para inspecionar valores:

```go
type Ponto struct {
    X, Y int
}

p := Ponto{1, 2}

fmt.Printf("%v\n", p)  // {1 2}
fmt.Printf("%+v\n", p) // {X:1 Y:2}
fmt.Printf("%#v\n", p) // main.Ponto{X:1, Y:2}
fmt.Printf("%T\n", p)  // main.Ponto
```

| Verbo | O que mostra |
|-------|--------------|
| `%v`  | o formato padrão do valor |
| `%+v` | como `%v`, mas com os nomes dos campos |
| `%#v` | o valor escrito como código Go (dá para colar no programa) |
| `%T`  | o tipo do valor |

O `%+v` é o que uso para depurar struct: mostra os nomes dos campos sem o barulho do nome do pacote. O `%#v` sai numa linha só; ele não "embeleza" o resultado.

## Texto e números

```go
nome := "Marcus"
fmt.Printf("%s\n", nome)   // Marcus
fmt.Printf("%q\n", nome)   // "Marcus"  (com aspas e escapes)
fmt.Printf("%q\n", "a\tb") // "a\tb"
fmt.Printf("%q\n", 'é')    // 'é'       (rune vira caractere entre aspas simples)

n := 42
fmt.Printf("%d\n", n)    // 42
fmt.Printf("%5d|\n", n)  // "   42|"  largura 5, alinhado à direita
fmt.Printf("%-5d|\n", n) // "42   |"  alinhado à esquerda
fmt.Printf("%05d\n", n)  // 00042
fmt.Printf("%x %X %o %b\n", n, n, n, n) // 2a 2A 52 101010

cotacao := 5.4321
fmt.Printf("%.2f\n", cotacao)   // 5.43
fmt.Printf("%8.2f|\n", cotacao) // "    5.43|"

fmt.Printf("%t\n", true) // true
fmt.Printf("%p\n", &n)   // 0xc000012345 (endereço)
fmt.Printf("100%%\n")    // 100%
```

O `%q` é ótimo para log: deixa visível espaço sobrando, string vazia (`""`) e caractere invisível, coisas que o `%s` esconde.

Lendo `%8.2f`: o `8` é a largura mínima do campo, o `.2` é a quantidade de casas decimais, e o `-` (em `%-5d`) alinha à esquerda.

### Bônus: índice de argumento

Para repetir o mesmo argumento sem passá-lo duas vezes:

```go
fmt.Printf("%[1]d em hexa é %[1]x\n", 255) // 255 em hexa é ff
```

## String()

### Como um tipo controla o próprio `%v` e `%s`

Se o tipo tem o método `String() string`, ele satisfaz a interface `fmt.Stringer`, e o `fmt` usa esse método no `%v` e no `%s`:

```go
func (p Ponto) String() string {
    return fmt.Sprintf("(%d, %d)", p.X, p.Y)
}

fmt.Println(p)         // (1, 2)
fmt.Printf("%v\n", p)  // (1, 2)
fmt.Printf("%+v\n", p) // (1, 2)  ← também usa String()
fmt.Printf("%#v\n", p) // main.Ponto{X:1, Y:2}  ← %#v ignora String()
```

Para erros vale o mesmo com `Error() string`: o `%v` e o `%s` de um `error` chamam esse método.

> [!CAUTION]
> Uma armadilha clássica: dentro de `String()`, formatar o próprio valor com `%v` faz o `fmt` chamar `String()` de novo, e o programa entra em recursão infinita.

```go
func (p Ponto) String() string {
    return fmt.Sprintf("%v", p) // estouro de pilha!
}
```

## Verbo errado

Um verbo errado não derruba o programa. Ele vira uma marcação no próprio texto:

```go
fmt.Printf("%d\n", "oi")  // %!d(string=oi)
fmt.Printf("%d %d\n", 1)  // 1 %!d(MISSING)
fmt.Printf("%d\n", 1, 2)  // 1
                          // %!(EXTRA int=2)
```

> [!TIP]
> Quem salva aqui é o `go vet`, que também roda automaticamente junto com o `go test`: ele avisa sobre `Printf` com verbo e argumento incompatíveis antes de você executar o programa.

## Funções

### `Print`, `Printf`, `Sprintf`, `Errorf`...

O nome diz tudo: o **prefixo** é o destino, o **sufixo** é o estilo.

| Função | O que faz |
|--------|-----------|
| `fmt.Printf(formato, args...)` | escreve na saída padrão, usando verbos |
| `fmt.Println(args...)` | escreve na saída padrão, com espaços entre os argumentos e `\n` no fim |
| `fmt.Print(args...)` | escreve na saída padrão, sem verbos e sem `\n` |
| `fmt.Sprintf(formato, args...)` | não escreve nada: **devolve** a `string` montada |
| `fmt.Fprintf(w, formato, args...)` | escreve em qualquer `io.Writer` (arquivo, resposta HTTP, `os.Stderr`) |
| `fmt.Errorf(formato, args...)` | devolve um valor `error` com a mensagem montada |

Detalhes que me pegaram:

- `Println` sempre põe espaço entre os argumentos e um `\n` no fim. `Print` só põe espaço entre dois argumentos quando nenhum deles é string.
- `Printf` **não** põe `\n` sozinho.
- O `log.Printf` usa os mesmos verbos, mas acrescenta data e hora.

## Erros com %w

### Embrulhar erros com `fmt.Errorf`

O `%w` só tem sentido no `Errorf`. Ele formata o erro como `%v` faria **e** guarda o erro original dentro do novo, formando uma corrente:

```go
var ErrNaoEncontrada = errors.New("moeda não encontrada")

func buscar(codigo string) (float64, error) {
    return 0, ErrNaoEncontrada
}

func atualizar(codigo string) error {
    _, err := buscar(codigo)
    if err != nil {
        return fmt.Errorf("atualizar %s: %w", codigo, err)
    }
    return nil
}

err := atualizar("XYZ")
fmt.Println(err)                              // atualizar XYZ: moeda não encontrada
fmt.Println(errors.Is(err, ErrNaoEncontrada)) // true
```

Se eu tivesse usado `%v` no lugar de `%w`, a mensagem seria idêntica, mas o `errors.Is` devolveria `false`: o erro original teria virado só texto.

- `errors.Is(err, alvo)` percorre a corrente procurando um valor igual (bom para sentinelas como `io.EOF`).
- `errors.As(err, &alvo)` procura um erro de um **tipo** específico e o extrai.
- `errors.Unwrap(err)` tira uma camada.
- Desde o Go 1.20, dá para usar mais de um `%w` no mesmo `Errorf`.

Na prática, cada `if err != nil` decide uma de três coisas: embrulhar com contexto (`%w`), só descrever (`%v`), ou devolver o erro como veio.

> [!NOTE]
> Convenção: a mensagem acrescentada é curta, minúscula, e diz **o que estava sendo feito**, porque as camadas se empilham: `"carregar config: abrir arquivo: permission denied"`.

## Resumo

- `%v` padrão, `%+v` com campos, `%#v` como código Go, `%T` o tipo.
- `%s` texto, `%q` texto entre aspas, `%d` inteiro, `%.2f` decimal com duas casas.
- O método `String()` define como o tipo aparece no `%v` e no `%s`; o `%#v` não usa ele.
- Verbo errado não impede a compilação; rode `go vet`.
- `S` devolve string, `F` escreve num `io.Writer`, `Errorf` cria `error`.
- Use `%w` no `Errorf` quando quem chama pode querer testar o erro original com `errors.Is`/`errors.As`.
