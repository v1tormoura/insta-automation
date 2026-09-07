/**
 * A marca d'água, do lado do navegador.
 *
 * Só o vocabulário: o padrão e as opções. O desenho acontece no servidor, com
 * ffmpeg, e o texto é o @ de cada conta — resolvido lá, na hora de publicar.
 *
 * Ficam num módulo próprio por duas razões. A primeira é que três telas usam os
 * mesmos valores (Postar, Loop e campanha), e um padrão diferente em cada uma
 * viraria três comportamentos para a mesma opção. A segunda é mecânica: exportar
 * constante do mesmo arquivo de um componente quebra o fast refresh do Vite, e o
 * lint aponta.
 *
 * Estes valores espelham `backend/src/services/marcaDagua.js`. São dois
 * processos, então o número é repetido em vez de importado; o servidor
 * normaliza tudo de novo, e é ele quem manda.
 */

export const MARCA_PADRAO = {
  ativa: false,
  opacidade: 45,
  posicao: 'centro',
  tamanho: 'pequena',
};

/* ── O piso de opacidade ──────────────────────────────────────────────────

   Era 5%, e isso foi um erro. Medido no servidor, com a marca na faixa
   inferior de um fundo cinza liso:

     desligada      brilho 125,00
     10% pequena    brilho 125,04   ← delta 0,04 numa escala de 0 a 255
     45% pequena    brilho 125,25
     45% grande     brilho 126,10

   A 10% a marca É desenhada e não é vista por ninguém. A tela dizia "Marca
   d'água ativa — 10%" e o vídeo saía sem marca aparente, o que parece defeito.
   Um controle que deixa escolher o que não funciona é pior que um que não
   existe.

   O servidor normaliza de novo com o mesmo piso — ele é quem manda. */
export const OPACIDADE_MIN = 20;

/* Corpo da letra por tamanho, num 1080 de largura — espelha o servidor.
   A prévia precisa deles para desenhar na mesma proporção; sem isso ela
   mostraria um tamanho e o vídeo sairia com outro. */
export const CORPO_POR_TAMANHO = { pequena: 46, media: 64, grande: 88 };

/* A moldura do reel e o que o Instagram cobre — também espelhados, e pelo
   mesmo motivo: é o que põe a marca da prévia no lugar onde ela vai sair. */
export const REEL = { largura: 1080, altura: 1920, margemTopo: 150, margemBase: 270 };

/**
 * Onde a marca cai, em fração da altura (0 = topo, 1 = base).
 *
 * Mesma conta do servidor, em proporção em vez de pixels — a prévia tem
 * qualquer altura, e o que importa é a posição relativa.
 */
export function alturaRelativa(posicao, tamanho) {
  const corpo = CORPO_POR_TAMANHO[tamanho] ?? CORPO_POR_TAMANHO.pequena;
  if (posicao === 'superior') return REEL.margemTopo / REEL.altura;
  if (posicao === 'inferior') return (REEL.altura - REEL.margemBase - corpo) / REEL.altura;
  return 0.5 - (corpo / 2) / REEL.altura;
}

export const POSICOES = [
  { value: 'superior', label: 'Superior' },
  { value: 'centro',   label: 'Centro'   },
  { value: 'inferior', label: 'Inferior' },
];

export const TAMANHOS = [
  { value: 'pequena', label: 'Pequena' },
  { value: 'media',   label: 'Média'   },
  { value: 'grande',  label: 'Grande'  },
];
