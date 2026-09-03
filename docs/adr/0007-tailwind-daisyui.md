# ADR 0007 — Tailwind CSS + DaisyUI como camada de estilo

- **Data:** 2026-09-03
- **Status:** Aceito

## Contexto

Definição dada como requisito do projeto: acelerar o desenvolvimento visual e
padronizar a aparência sem gastar tempo de MVP escrevendo CSS. O tempo economizado
aqui é tempo investido na concorrência e nos testes, que é onde o projeto é
avaliado.

## Decisão

**Tailwind CSS** como sistema de utilitários e **DaisyUI** como camada de
componentes sobre ele.

- DaisyUI fornece as classes semânticas prontas (`btn`, `card`, `badge`,
  `alert`, `modal`, `skeleton`, `toast`) e um sistema de temas via CSS
  variables — inclusive dark mode sem trabalho adicional.
- Tailwind cobre o que for específico (grade de slots, densidade, espaçamento).

### Convenções

- Componentes **presentational** em `features/*/ui` e `shared/ui` carregam as
  classes; componentes **container** não têm estilo. Isso mantém a decisão
  visual num lugar só.
- Nada de `@apply` espalhado: se um padrão se repete, vira componente Angular,
  não classe CSS. Um componente `<slot-cell>` é mais reusável e mais testável
  que uma classe utilitária composta.
- Estados da UI têm mapeamento visual fixo, declarado uma vez:

| Estado do slot | Tratamento |
|---|---|
| Livre | `btn-primary`, habilitado |
| Parcialmente ocupado | `btn-primary` + `badge` com vagas restantes |
| Esgotado | `btn-disabled` + `badge-error` |
| Reservado por você | `btn-success` + ícone de confirmação |
| Reserva em voo | `btn` + `loading loading-spinner`, desabilitado (ADR 0006) |

O estado "em voo" é parte do sistema visual, não uma gambiarra local — é a
implementação da prevenção de clique duplo do ADR 0006.

## Alternativas consideradas

- **Angular Material.** Componentes mais completos e acessibilidade madura, mas
  o custo de customização visual é alto e o resultado tem cara de Material.
  Recusado por velocidade.
- **Tailwind puro.** Máxima flexibilidade, porém exigiria construir botões,
  cards, alerts e skeletons do zero. Recusado pelo mesmo motivo do requisito.
- **PrimeNG / Spartan.** Boas opções, mas nenhuma agrega sobre a combinação
  escolhida num escopo deste tamanho.

## Consequências

- **Custo:** DaisyUI é uma dependência de terceiros sobre outra dependência; um
  upgrade major do Tailwind pode exigir esperar o DaisyUI acompanhar. Ambas
  ficam pinadas.
- **Custo:** acessibilidade não vem de graça como no Material — foco visível,
  `aria-busy` no botão em loading e `aria-live` nos toasts precisam ser feitos à
  mão e entram no checklist de revisão.
- **Ganho:** dark mode, tokens de cor e consistência visual sem escrever um
  arquivo de tema. O tempo de UI cai para o mínimo necessário.
