/**
 * Oito propostas de identidade visual — apenas DADOS, nenhuma é aplicada.
 *
 * ── Por que oklch e não hex
 *
 * Em oklch, mexer só na luminosidade preserva a percepção de matiz. É o que
 * permite gerar uma escala inteira a partir de uma cor e ter todos os degraus
 * parecendo a mesma família. Em hex, cada degrau precisa ser acertado na mão,
 * e é assim que uma paleta ganha três cinzas que não conversam.
 *
 * ── Por que cada paleta declara os DOIS modos por extenso
 *
 * Modo claro não é modo escuro invertido. Sombra no claro é sombra de verdade;
 * no escuro ela quase não aparece e a profundidade vem de um filete de luz na
 * borda de cima. Um acento que canta sobre fundo escuro costuma sumir sobre
 * branco, porque a luminosidade que o destacava agora compete com o papel.
 * Inverter mecanicamente produz o segundo tema pior que o primeiro.
 *
 * ── O que cada campo significa
 *
 * A hierarquia é a mesma em todas as oito, e é o que impede o painel de virar
 * uma parede colorida:
 *
 *   primary      ação principal, CTA, item ativo da navegação
 *   secondary    ação secundária, apoio
 *   accent       destaque pontual — o que é excepcional, não o que é comum
 *   success/warning/destructive/info   estado, nunca decoração
 *   bg           a estrutura
 *   surface1..3  três degraus de painel; o passo carrega a hierarquia
 *   fg/fg2/fg3   três níveis de texto; um quarto vira decisão sem critério
 *   border       separação; `borderForte` para o que precisa ser notado
 *   grafico      série de dados, harmônica dentro da própria paleta
 *
 * As luminosidades foram escolhidas para render contraste medido, não por
 * gosto. A conferência roda em `conferirContraste()`, no fim do arquivo.
 */

/** Mínimos do WCAG AA. */
export const MINIMO_TEXTO = 4.5;   // texto pequeno
export const MINIMO_UI    = 3.0;   // texto grande e componentes interativos

export const PALETAS = [
  {
    id: 'nocturno',
    nome: 'Nocturno',
    conceito:
      'Turno da noite. Azul-índigo profundo com ciano elétrico — a leitura de ' +
      'sala de operações, onde o dado brilha e a estrutura recua. É a direção ' +
      'atual do produto, levada ao ponto.',
    dark: {
      bg: 'oklch(0.17 0.028 265)',
      surface1: 'oklch(0.21 0.030 265)',
      surface2: 'oklch(0.25 0.032 265)',
      surface3: 'oklch(0.30 0.034 265)',
      fg: 'oklch(0.97 0.008 265)',
      fg2: 'oklch(0.77 0.020 265)',
      fg3: 'oklch(0.66 0.022 265)',
      border: 'oklch(1 0 0 / 0.10)',
      borderForte: 'oklch(1 0 0 / 0.19)',
      primary: 'oklch(0.78 0.19 213)',
      primaryFg: 'oklch(0.17 0.028 265)',
      secondary: 'oklch(0.66 0.24 275)',
      secondaryFg: 'oklch(0.98 0.01 275)',
      accent: 'oklch(0.86 0.16 195)',
      accentFg: 'oklch(0.17 0.028 265)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.78 0.19 213)', 'oklch(0.66 0.24 275)', 'oklch(0.82 0.16 195)',
        'oklch(0.72 0.15 240)', 'oklch(0.60 0.18 290)',
      ],
    },
    light: {
      bg: 'oklch(0.985 0.004 265)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.965 0.005 265)',
      surface3: 'oklch(0.935 0.007 265)',
      fg: 'oklch(0.22 0.020 265)',
      fg2: 'oklch(0.44 0.018 265)',
      fg3: 'oklch(0.535 0.016 265)',
      border: 'oklch(0.22 0.02 265 / 0.12)',
      borderForte: 'oklch(0.22 0.02 265 / 0.22)',
      primary: 'oklch(0.510 0.15 213)',
      primaryFg: 'oklch(0.99 0.004 213)',
      secondary: 'oklch(0.50 0.20 275)',
      secondaryFg: 'oklch(0.99 0.004 275)',
      accent: 'oklch(0.515 0.13 195)',
      accentFg: 'oklch(0.99 0.004 195)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.54 0.15 213)', 'oklch(0.50 0.20 275)', 'oklch(0.58 0.13 195)',
        'oklch(0.56 0.13 240)', 'oklch(0.46 0.16 290)',
      ],
    },
  },

  {
    id: 'grafite',
    nome: 'Grafite',
    conceito:
      'Neutro de verdade, com um único sinal quente. Cinza-grafite sem viés de ' +
      'cor carrega a estrutura inteira, e o âmbar aparece só onde há ação. ' +
      'A disciplina de ferramenta de engenharia: quase nada tem cor, então o ' +
      'que tem cor importa.',
    dark: {
      bg: 'oklch(0.165 0.004 265)',
      surface1: 'oklch(0.205 0.005 265)',
      surface2: 'oklch(0.245 0.006 265)',
      surface3: 'oklch(0.295 0.007 265)',
      fg: 'oklch(0.97 0.003 265)',
      fg2: 'oklch(0.76 0.005 265)',
      fg3: 'oklch(0.645 0.006 265)',
      border: 'oklch(1 0 0 / 0.11)',
      borderForte: 'oklch(1 0 0 / 0.20)',
      primary: 'oklch(0.80 0.16 68)',
      primaryFg: 'oklch(0.165 0.004 265)',
      secondary: 'oklch(0.62 0.008 265)',
      secondaryFg: 'oklch(0.98 0.003 265)',
      accent: 'oklch(0.72 0.17 38)',
      accentFg: 'oklch(0.98 0.01 38)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.80 0.16 68)', 'oklch(0.72 0.17 38)', 'oklch(0.66 0.06 265)',
        'oklch(0.86 0.11 85)', 'oklch(0.55 0.04 265)',
      ],
    },
    light: {
      bg: 'oklch(0.98 0.002 265)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.96 0.003 265)',
      surface3: 'oklch(0.925 0.004 265)',
      fg: 'oklch(0.21 0.004 265)',
      fg2: 'oklch(0.43 0.004 265)',
      fg3: 'oklch(0.535 0.004 265)',
      border: 'oklch(0.21 0.004 265 / 0.13)',
      borderForte: 'oklch(0.21 0.004 265 / 0.24)',
      primary: 'oklch(0.56 0.14 62)',
      primaryFg: 'oklch(0.99 0.004 62)',
      secondary: 'oklch(0.46 0.006 265)',
      secondaryFg: 'oklch(0.99 0.002 265)',
      accent: 'oklch(0.53 0.17 35)',
      accentFg: 'oklch(0.99 0.004 35)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.56 0.14 62)', 'oklch(0.53 0.17 35)', 'oklch(0.50 0.04 265)',
        'oklch(0.64 0.12 85)', 'oklch(0.36 0.03 265)',
      ],
    },
  },

  {
    id: 'aurora',
    nome: 'Aurora',
    conceito:
      'Verde-abissal com jade. Um escuro que não é azul nem cinza — raro em ' +
      'painel, e por isso reconhecível na primeira olhada. O verde carrega a ' +
      'marca, então crescimento e sucesso falam a mesma língua.',
    dark: {
      bg: 'oklch(0.175 0.022 190)',
      surface1: 'oklch(0.215 0.024 190)',
      surface2: 'oklch(0.255 0.026 190)',
      surface3: 'oklch(0.305 0.028 190)',
      fg: 'oklch(0.97 0.008 190)',
      fg2: 'oklch(0.77 0.016 190)',
      fg3: 'oklch(0.66 0.018 190)',
      border: 'oklch(1 0 0 / 0.10)',
      borderForte: 'oklch(1 0 0 / 0.19)',
      primary: 'oklch(0.80 0.17 168)',
      primaryFg: 'oklch(0.175 0.022 190)',
      secondary: 'oklch(0.70 0.13 205)',
      secondaryFg: 'oklch(0.16 0.02 205)',
      accent: 'oklch(0.86 0.15 148)',
      accentFg: 'oklch(0.175 0.022 190)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.80 0.17 168)', 'oklch(0.70 0.13 205)', 'oklch(0.86 0.15 148)',
        'oklch(0.66 0.12 228)', 'oklch(0.74 0.14 128)',
      ],
    },
    light: {
      bg: 'oklch(0.985 0.006 190)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.963 0.008 190)',
      surface3: 'oklch(0.932 0.010 190)',
      fg: 'oklch(0.21 0.020 190)',
      fg2: 'oklch(0.43 0.018 190)',
      fg3: 'oklch(0.535 0.016 190)',
      border: 'oklch(0.21 0.02 190 / 0.13)',
      borderForte: 'oklch(0.21 0.02 190 / 0.23)',
      primary: 'oklch(0.50 0.13 168)',
      primaryFg: 'oklch(0.99 0.004 168)',
      secondary: 'oklch(0.51 0.11 205)',
      secondaryFg: 'oklch(0.99 0.004 205)',
      accent: 'oklch(0.53 0.14 148)',
      accentFg: 'oklch(0.99 0.004 148)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.50 0.13 168)', 'oklch(0.51 0.11 205)', 'oklch(0.53 0.14 148)',
        'oklch(0.47 0.11 228)', 'oklch(0.56 0.13 128)',
      ],
    },
  },

  {
    id: 'cobalto',
    nome: 'Cobalto',
    conceito:
      'Azul-marinho e cobalto com coral. A dupla mais legível que existe em ' +
      'painel: o azul organiza, o coral interrompe. É o vocabulário do ' +
      'software corporativo, mas com o coral no lugar do vermelho genérico.',
    dark: {
      bg: 'oklch(0.185 0.034 258)',
      surface1: 'oklch(0.225 0.036 258)',
      surface2: 'oklch(0.265 0.038 258)',
      surface3: 'oklch(0.315 0.040 258)',
      fg: 'oklch(0.97 0.008 258)',
      fg2: 'oklch(0.77 0.022 258)',
      fg3: 'oklch(0.665 0.024 258)',
      border: 'oklch(1 0 0 / 0.10)',
      borderForte: 'oklch(1 0 0 / 0.19)',
      primary: 'oklch(0.68 0.19 260)',
      primaryFg: 'oklch(0.185 0.034 258)',
      secondary: 'oklch(0.76 0.10 245)',
      secondaryFg: 'oklch(0.18 0.03 258)',
      accent: 'oklch(0.75 0.17 32)',
      accentFg: 'oklch(0.18 0.03 258)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.68 0.19 260)', 'oklch(0.75 0.17 32)', 'oklch(0.76 0.10 245)',
        'oklch(0.72 0.14 300)', 'oklch(0.80 0.13 205)',
      ],
    },
    light: {
      bg: 'oklch(0.985 0.005 258)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.963 0.007 258)',
      surface3: 'oklch(0.932 0.009 258)',
      fg: 'oklch(0.215 0.024 258)',
      fg2: 'oklch(0.435 0.022 258)',
      fg3: 'oklch(0.535 0.020 258)',
      border: 'oklch(0.215 0.024 258 / 0.13)',
      borderForte: 'oklch(0.215 0.024 258 / 0.23)',
      primary: 'oklch(0.51 0.20 260)',
      primaryFg: 'oklch(0.99 0.005 260)',
      secondary: 'oklch(0.53 0.11 245)',
      secondaryFg: 'oklch(0.99 0.004 245)',
      accent: 'oklch(0.55 0.18 32)',
      accentFg: 'oklch(0.99 0.005 32)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.51 0.20 260)', 'oklch(0.55 0.18 32)', 'oklch(0.53 0.11 245)',
        'oklch(0.50 0.15 300)', 'oklch(0.55 0.12 205)',
      ],
    },
  },

  {
    id: 'vinho',
    nome: 'Vinho',
    conceito:
      'Ameixa profunda com ouro-rosado. Editorial, não corporativo: a paleta ' +
      'de revista impressa aplicada a um painel. É a proposta mais arriscada ' +
      'das oito e a mais difícil de confundir com outro produto.',
    dark: {
      bg: 'oklch(0.175 0.030 340)',
      surface1: 'oklch(0.215 0.033 340)',
      surface2: 'oklch(0.255 0.036 340)',
      surface3: 'oklch(0.305 0.039 340)',
      fg: 'oklch(0.97 0.008 340)',
      fg2: 'oklch(0.77 0.020 340)',
      fg3: 'oklch(0.665 0.022 340)',
      border: 'oklch(1 0 0 / 0.11)',
      borderForte: 'oklch(1 0 0 / 0.20)',
      primary: 'oklch(0.72 0.20 8)',
      primaryFg: 'oklch(0.175 0.030 340)',
      secondary: 'oklch(0.615 0.15 330)',
      secondaryFg: 'oklch(0.99 0.006 330)',
      accent: 'oklch(0.83 0.11 62)',
      accentFg: 'oklch(0.175 0.030 340)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.72 0.20 8)', 'oklch(0.83 0.11 62)', 'oklch(0.60 0.15 330)',
        'oklch(0.78 0.14 30)', 'oklch(0.66 0.12 300)',
      ],
    },
    light: {
      bg: 'oklch(0.985 0.006 340)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.963 0.008 340)',
      surface3: 'oklch(0.932 0.011 340)',
      fg: 'oklch(0.215 0.024 340)',
      fg2: 'oklch(0.435 0.022 340)',
      fg3: 'oklch(0.540 0.020 340)',
      border: 'oklch(0.215 0.024 340 / 0.13)',
      borderForte: 'oklch(0.215 0.024 340 / 0.23)',
      primary: 'oklch(0.52 0.19 8)',
      primaryFg: 'oklch(0.99 0.005 8)',
      secondary: 'oklch(0.48 0.16 330)',
      secondaryFg: 'oklch(0.99 0.005 330)',
      accent: 'oklch(0.55 0.11 62)',
      accentFg: 'oklch(0.99 0.004 62)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.52 0.19 8)', 'oklch(0.55 0.11 62)', 'oklch(0.48 0.16 330)',
        'oklch(0.54 0.15 30)', 'oklch(0.47 0.13 300)',
      ],
    },
  },

  {
    id: 'ardosia',
    nome: 'Ardósia',
    conceito:
      'Ardósia fria com lima. O contraste mais alto das oito: o verde-limão ' +
      'sobre cinza-azulado é quase impossível de ignorar, então funciona onde ' +
      'o painel precisa gritar um número. Exige disciplina — usado demais, cansa.',
    dark: {
      bg: 'oklch(0.185 0.014 250)',
      surface1: 'oklch(0.225 0.016 250)',
      surface2: 'oklch(0.265 0.018 250)',
      surface3: 'oklch(0.315 0.020 250)',
      fg: 'oklch(0.97 0.006 250)',
      fg2: 'oklch(0.77 0.014 250)',
      fg3: 'oklch(0.66 0.016 250)',
      border: 'oklch(1 0 0 / 0.11)',
      borderForte: 'oklch(1 0 0 / 0.20)',
      primary: 'oklch(0.87 0.19 128)',
      primaryFg: 'oklch(0.185 0.014 250)',
      secondary: 'oklch(0.70 0.09 242)',
      secondaryFg: 'oklch(0.17 0.014 250)',
      accent: 'oklch(0.80 0.14 196)',
      accentFg: 'oklch(0.185 0.014 250)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.87 0.19 128)', 'oklch(0.80 0.14 196)', 'oklch(0.70 0.09 242)',
        'oklch(0.82 0.15 92)', 'oklch(0.62 0.10 262)',
      ],
    },
    light: {
      bg: 'oklch(0.983 0.004 250)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.961 0.005 250)',
      surface3: 'oklch(0.930 0.007 250)',
      fg: 'oklch(0.215 0.016 250)',
      fg2: 'oklch(0.435 0.014 250)',
      fg3: 'oklch(0.530 0.013 250)',
      border: 'oklch(0.215 0.016 250 / 0.13)',
      borderForte: 'oklch(0.215 0.016 250 / 0.24)',
      primary: 'oklch(0.52 0.15 128)',
      primaryFg: 'oklch(0.99 0.004 128)',
      secondary: 'oklch(0.50 0.09 242)',
      secondaryFg: 'oklch(0.99 0.004 242)',
      accent: 'oklch(0.52 0.12 196)',
      accentFg: 'oklch(0.99 0.004 196)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.52 0.15 128)', 'oklch(0.52 0.12 196)', 'oklch(0.50 0.09 242)',
        'oklch(0.56 0.13 92)', 'oklch(0.44 0.11 262)',
      ],
    },
  },

  {
    id: 'papel',
    nome: 'Papel',
    conceito:
      'Claro por natureza, escuro por cortesia. Off-white de papel, tinta ' +
      'quase preta e um único vermelho-vermelhão. Inverte a premissa do ' +
      'produto: em vez de sala escura, mesa de trabalho. Quem usa o painel de ' +
      'dia lê melhor aqui do que em qualquer uma das outras sete.',
    dark: {
      bg: 'oklch(0.185 0.008 70)',
      surface1: 'oklch(0.225 0.009 70)',
      surface2: 'oklch(0.265 0.010 70)',
      surface3: 'oklch(0.315 0.011 70)',
      fg: 'oklch(0.965 0.008 70)',
      fg2: 'oklch(0.77 0.012 70)',
      fg3: 'oklch(0.66 0.013 70)',
      border: 'oklch(1 0 0 / 0.11)',
      borderForte: 'oklch(1 0 0 / 0.20)',
      primary: 'oklch(0.72 0.18 34)',
      primaryFg: 'oklch(0.185 0.008 70)',
      secondary: 'oklch(0.68 0.05 70)',
      secondaryFg: 'oklch(0.17 0.008 70)',
      accent: 'oklch(0.82 0.13 78)',
      accentFg: 'oklch(0.185 0.008 70)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.72 0.18 34)', 'oklch(0.82 0.13 78)', 'oklch(0.68 0.10 122)',
        'oklch(0.70 0.11 246)', 'oklch(0.62 0.09 70)',
      ],
    },
    light: {
      bg: 'oklch(0.982 0.010 84)',
      surface1: 'oklch(0.998 0.004 84)',
      surface2: 'oklch(0.958 0.012 84)',
      surface3: 'oklch(0.925 0.015 84)',
      fg: 'oklch(0.205 0.012 60)',
      fg2: 'oklch(0.425 0.012 60)',
      fg3: 'oklch(0.530 0.011 60)',
      border: 'oklch(0.205 0.012 60 / 0.14)',
      borderForte: 'oklch(0.205 0.012 60 / 0.26)',
      primary: 'oklch(0.53 0.19 32)',
      primaryFg: 'oklch(0.99 0.005 32)',
      secondary: 'oklch(0.44 0.02 60)',
      secondaryFg: 'oklch(0.99 0.004 60)',
      accent: 'oklch(0.55 0.12 74)',
      accentFg: 'oklch(0.99 0.004 74)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.53 0.19 32)', 'oklch(0.55 0.12 74)', 'oklch(0.47 0.10 122)',
        'oklch(0.49 0.12 246)', 'oklch(0.38 0.05 60)',
      ],
    },
  },

  {
    id: 'obsidiana',
    nome: 'Obsidiana',
    conceito:
      'Quase preto neutro com duotone violeta→ciano. O escuro mais fundo das ' +
      'oito, e o único onde a marca é uma TRANSIÇÃO e não uma cor: violeta de ' +
      'um lado, ciano do outro, e o meio pertence ao produto. Superfície de ' +
      'vidro vulcânico — sem cor própria, devolvendo a luz que recebe.',
    dark: {
      bg: 'oklch(0.145 0.008 285)',
      surface1: 'oklch(0.190 0.010 285)',
      surface2: 'oklch(0.235 0.012 285)',
      surface3: 'oklch(0.290 0.014 285)',
      fg: 'oklch(0.975 0.004 285)',
      fg2: 'oklch(0.765 0.010 285)',
      fg3: 'oklch(0.645 0.012 285)',
      border: 'oklch(1 0 0 / 0.12)',
      borderForte: 'oklch(1 0 0 / 0.22)',
      primary: 'oklch(0.68 0.26 292)',
      primaryFg: 'oklch(0.145 0.008 285)',
      secondary: 'oklch(0.80 0.18 208)',
      secondaryFg: 'oklch(0.145 0.008 285)',
      accent: 'oklch(0.78 0.20 328)',
      accentFg: 'oklch(0.145 0.008 285)',
      success: 'oklch(0.79 0.208 150)',
      warning: 'oklch(0.79 0.155 75)',
      destructive: 'oklch(0.79 0.121 25)',
      info: 'oklch(0.79 0.108 245)',
      grafico: [
        'oklch(0.68 0.26 292)', 'oklch(0.80 0.18 208)', 'oklch(0.78 0.20 328)',
        'oklch(0.74 0.18 258)', 'oklch(0.84 0.14 182)',
      ],
    },
    light: {
      bg: 'oklch(0.982 0.003 285)',
      surface1: 'oklch(1 0 0)',
      surface2: 'oklch(0.960 0.004 285)',
      surface3: 'oklch(0.928 0.006 285)',
      fg: 'oklch(0.205 0.010 285)',
      fg2: 'oklch(0.425 0.010 285)',
      fg3: 'oklch(0.530 0.009 285)',
      border: 'oklch(0.205 0.010 285 / 0.13)',
      borderForte: 'oklch(0.205 0.010 285 / 0.24)',
      primary: 'oklch(0.50 0.24 292)',
      primaryFg: 'oklch(0.99 0.005 292)',
      secondary: 'oklch(0.52 0.14 208)',
      secondaryFg: 'oklch(0.99 0.004 208)',
      accent: 'oklch(0.54 0.20 328)',
      accentFg: 'oklch(0.99 0.005 328)',
      success: 'oklch(0.51 0.142 150)',
      warning: 'oklch(0.51 0.099 75)',
      destructive: 'oklch(0.51 0.191 25)',
      info: 'oklch(0.51 0.125 245)',
      grafico: [
        'oklch(0.50 0.24 292)', 'oklch(0.52 0.14 208)', 'oklch(0.54 0.20 328)',
        'oklch(0.48 0.18 258)', 'oklch(0.55 0.11 182)',
      ],
    },
  },
];

/* ── Aferição ───────────────────────────────────────────────────────────────

   As cores de estado são IGUAIS nas oito paletas, e isso é decisão, não
   preguiça: vermelho de erro que muda de tom conforme o tema deixa de ser
   sinal e vira decoração. Elas foram resolvidas por busca, não escolhidas:
   matiz fixo por significado (150 sucesso, 75 atenção, 25 erro, 245 info),
   croma em 85% do que o sRGB permite naquela luminosidade, e a luminosidade
   escolhida como a mais próxima do alvo que ainda entrega 4,6:1 sobre o
   fundo. Resultado medido: entre 5,09 e 11,07.

   O teste de gamut não é "a cor parou de mudar quando subi o croma" — esse
   foi o erro da primeira tentativa, e ele produziu um AMARELO que renderizava
   vermelho, porque em luminosidade baixa o matiz 75 estoura o gamut e recorta
   para outro lugar do espectro. O teste certo converte o sRGB renderizado de
   volta para oklch e confere se matiz, croma e luminosidade sobreviveram.
   `estaNoGamut()` faz isso.  */

/**
 * Converte uma cor CSS para [r,g,b] usando o próprio navegador como
 * autoridade. Nenhuma fórmula nossa de oklch→sRGB: o que importa é o que a
 * tela mostra, e quem decide isso é o motor de renderização.
 */
export function paraRGB(cor, ctx) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = cor;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

export function paraHex(cor, ctx) {
  return '#' + paraRGB(cor, ctx).map(v => v.toString(16).padStart(2, '0')).join('');
}

function luminancia([r, g, b]) {
  const c = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * sRGB → OKLCH. Matrizes canônicas de Björn Ottosson.
 *
 * Existe para responder UMA pergunta: a cor que pedi sobreviveu ao gamut?
 */
export function paraOklch([R, G, B]) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = f(R), g = f(G), b = f(B);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let H = Math.atan2(Bb, A) * 180 / Math.PI;
  if (H < 0) H += 360;
  return { L, C: Math.hypot(A, Bb), H };
}

/**
 * A cor cabe no sRGB?
 *
 * O teste ingênuo — "subi o croma e o resultado parou de mudar" — falha em
 * luminosidade baixa, onde a cor continua mudando já fora do gamut. Foi assim
 * que uma primeira tentativa produziu um amarelo (matiz 75) que renderizava
 * VERMELHO. Aqui a cor vai até a tela, volta convertida, e só passa se matiz,
 * croma e luminosidade tiverem sobrevivido à viagem.
 */
export function estaNoGamut(L, C, H, ctx) {
  const v = paraOklch(paraRGB(`oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H})`, ctx));
  const dH = Math.min(Math.abs(v.H - H), 360 - Math.abs(v.H - H));
  return Math.abs(v.C - C) < 0.012 && dH < 3.5 && Math.abs(v.L - L) < 0.02;
}

/** Maior croma que cabe no sRGB nesta luminosidade e matiz. Busca binária. */
export function cromaMaximo(L, H, ctx) {
  let baixo = 0, alto = 0.4;
  for (let i = 0; i < 22; i++) {
    const meio = (baixo + alto) / 2;
    if (estaNoGamut(L, meio, H, ctx)) baixo = meio; else alto = meio;
  }
  return Math.round(baixo * 1000) / 1000;
}

/** Razão de contraste WCAG entre duas cores CSS. */
export function contraste(a, b, ctx) {
  const l1 = luminancia(paraRGB(a, ctx));
  const l2 = luminancia(paraRGB(b, ctx));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Confere um modo inteiro e devolve o que reprova.
 *
 * Os pares aferidos são os que existem na tela de verdade — texto sobre o
 * fundo, texto sobre o card, rótulo do botão sobre o botão. Medir a cor
 * isolada não diz nada: contraste é sempre entre DUAS coisas.
 */
export function conferirContraste(modo, ctx) {
  const pares = [
    ['fg',          modo.fg,          modo.bg,        MINIMO_TEXTO],
    ['fg2',         modo.fg2,         modo.bg,        MINIMO_TEXTO],
    ['fg3',         modo.fg3,         modo.surface2,  MINIMO_TEXTO],
    ['primary',     modo.primary,     modo.bg,        MINIMO_TEXTO],
    ['rótulo CTA',  modo.primaryFg,   modo.primary,   MINIMO_TEXTO],
    ['secondary',   modo.secondary,   modo.bg,        MINIMO_TEXTO],
    ['accent',      modo.accent,      modo.bg,        MINIMO_TEXTO],
    ['success',     modo.success,     modo.bg,        MINIMO_TEXTO],
    ['warning',     modo.warning,     modo.bg,        MINIMO_TEXTO],
    ['destructive', modo.destructive, modo.bg,        MINIMO_TEXTO],
    ['info',        modo.info,        modo.bg,        MINIMO_TEXTO],
    /* Borda NÃO entra no critério de 3:1 da WCAG 1.4.11: aquele mínimo vale
       para o que IDENTIFICA um controle ou seu estado, e aqui a superfície
       já faz esse trabalho — o card se distingue do fundo por ser mais claro,
       não pela linha em volta. Exigir 3:1 de uma divisória produziria um
       traço branco gritante em volta de tudo, que é pior de olhar e não
       ajuda ninguém. O que importa é que ela seja PERCEPTÍVEL. */
    ['borda (perceptível)', modo.borderForte, modo.surface1, 1.25],
  ];
  return pares.map(([nome, frente, fundo, minimo]) => {
    const r = contraste(frente, fundo, ctx);
    return { nome, razao: Math.round(r * 100) / 100, minimo, passa: r >= minimo };
  });
}
