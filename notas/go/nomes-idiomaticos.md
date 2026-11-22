# Nomes idiomáticos em Go

Em Go, nome não é só estilo: a **primeira letra decide quem enxerga o identificador**. Quase todas as convenções de nomes da linguagem giram em torno dessa regra.

## MixedCaps, sempre

Go usa `MixedCaps` (ou `mixedCaps`) para tudo: variáveis, funções, tipos, constantes, campos. Underscore praticamente não aparece em nome Go.

```go
var contadorDeTentativas int   // ok
var contador_de_tentativas int // funciona, mas ninguém escreve assim
```

| Coisa      | Exemplo idiomático |
|------------|--------------------|
| Função     | `buscarCotacao`, `BuscarCotacao` |
| Tipo       | `ClienteHTTP`, `Moeda` |
| Constante  | `maxTentativas`, `TimeoutPadrao` |
| Pacote     | `cotacao` |

## Maiúscula inicial = exportado

Esta é a regra central. Não existe palavra-chave de visibilidade em Go: quem decide é a caixa da primeira letra.

```go
package cotacao

type Moeda struct {
    Codigo string  // exportado: outros pacotes leem e escrevem
    valor  float64 // não exportado: só o pacote cotacao vê
}

func Buscar(codigo string) (Moeda, error) { ... } // exportada
func montarURL(codigo string) string     { ... } // interna do pacote
```

- **Exportado** (maiúscula): pode ser usado por outros pacotes, como `cotacao.Buscar(...)`.
- **Não exportado** (minúscula): só existe dentro do próprio pacote.

Um detalhe importante: a fronteira é o **pacote**, não o tipo. Um campo minúsculo de `Moeda` é visível para qualquer arquivo do pacote `cotacao`, não só para os métodos de `Moeda`.

Uma consequência prática: se um campo não aparece ao fazer `json.Marshal`, quase sempre é porque ele começa com minúscula e o pacote `encoding/json` não consegue enxergá-lo.

```go
type Resposta struct {
    Valor float64 `json:"valor"` // a tag dá o nome minúsculo no JSON
    data  string                 // ignorado pelo encoding/json
}
```

## Siglas ficam inteiras

Siglas mantêm a caixa uniforme: `URL`, `HTTP`, `ID`, `JSON`.

```go
func (s *Servidor) ServeHTTP(w http.ResponseWriter, r *http.Request)
var userID int        // não userId
var urlBase string    // minúscula inteira quando não exportado
type ClienteAPI struct{}
```

## Receivers curtos

Em Go, um método é uma função com um **receiver**: o valor sobre o qual o método age, escrito entre parênteses antes do nome. Você escolhe o nome do receiver, e a convenção é uma ou duas letras derivadas do tipo, sempre a mesma em todos os métodos:

```go
type Carteira struct{ moedas []Moeda }

func (c *Carteira) Adicionar(m Moeda) { c.moedas = append(c.moedas, m) }
func (c *Carteira) Total() float64    { ... }
```

Nada de nomes longos como `carteira` ou genéricos como `obj`. A ideia é que o tipo já está escrito logo ali, então um nome longo só repete informação.

Receiver por valor `(c Carteira)` ou por ponteiro `(c *Carteira)`? Use ponteiro quando o método altera o valor ou quando a struct é grande, e evite misturar os dois no mesmo tipo.

## Nomes de pacote

- Curtos, minúsculos, uma palavra só: `cotacao`, `strings`, `http`.
- Sem underscore e sem MixedCaps: `cotacaoapi`, não `cotacao_api` nem `cotacaoApi`.
- Evite nomes genéricos como `util`, `common`, `helpers`. Eles não dizem nada no ponto de uso.

O nome do pacote **faz parte do nome** de tudo que ele exporta, porque quem usa sempre escreve `pacote.Nome`. Por isso se evita a gagueira:

```go
http.Server             // bom
http.HTTPServer         // gagueja: "http ponto HTTP server"

cotacao.Buscar()        // bom
cotacao.BuscarCotacao() // repetido
```

## Getters sem `Get`

Getter tem o nome do campo, com maiúscula. Setter leva `Set`:

```go
func (c *Conta) Dono() string        { return c.dono }
func (c *Conta) SetDono(nome string) { c.dono = nome }
```

Nada de `GetDono()`.

## Interfaces de um método terminam em -er

```go
type Reader interface { Read(p []byte) (n int, err error) }
type Stringer interface { String() string }
type Notificador interface { Notificar(msg string) error }
```

Em Go, um tipo satisfaz uma interface **sem declarar isso**: qualquer tipo que tenha o método `String() string` já é um `Stringer`, automaticamente.

## Por que não existe SCREAMING_SNAKE_CASE?

Porque a caixa da primeira letra já tem significado. Uma constante escrita `MAX_TENTATIVAS` seria **exportada** só por começar com maiúscula, e o underscore brigaria com o estilo do resto da linguagem. Então constante se escreve como qualquer outro identificador:

```go
const maxTentativas = 3               // interna
const TimeoutPadrao = 5 * time.Second // exportada

const (
    StatusAberto Status = iota
    StatusFechado
)
```

O compilador já sabe que é constante; o nome não precisa gritar.

## Erros

- Variáveis de erro (sentinelas) começam com `Err`: `ErrNaoEncontrado`, como `io.EOF` e `os.ErrNotExist` da biblioteca padrão.
- Tipos de erro terminam em `Error`: `type ValidacaoError struct{...}`.
- Mensagens de erro em minúscula e sem ponto final, porque vão ser concatenadas: `"buscar cotação: timeout"`.

## Tamanho do nome acompanha o escopo

Variável que vive três linhas pode ser `i`, `r`, `buf`, `err`. Variável de pacote, que aparece longe da declaração, merece nome descritivo. É deliberado: `for i, m := range moedas` é mais legível que `for indice, moedaAtual := range moedas`.

## Quem cobra isso

- `gofmt` cuida da formatação, mas **não** dos nomes.
- `go vet` pega alguns problemas, poucos de nome.
- `staticcheck` (regra `ST1003`) avisa sobre underscores, siglas com caixa errada e afins. Vale instalar.

## Resumo para colar na parede

- `MixedCaps` sempre, underscore quase nunca.
- Maiúscula exporta, minúscula esconde, e a fronteira é o pacote.
- Siglas inteiras: `ID`, `URL`, `HTTP`.
- Receiver de 1 ou 2 letras, sempre o mesmo.
- Pacote curto e minúsculo, e o nome dele faz parte de tudo que exporta.
- Getter sem `Get`, interface de um método com `-er`.
- Constante é um nome comum; não existe `SCREAMING_SNAKE`.
