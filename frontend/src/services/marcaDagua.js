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
  opacidade: 40,
  posicao: 'centro',
  tamanho: 'pequena',
};

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
