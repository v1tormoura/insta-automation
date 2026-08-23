/**
 * DADOS FICTÍCIOS — exclusivos do protótipo.
 *
 * Arquivo isolado de propósito: nada aqui toca API, store ou modelo real. Se o
 * protótipo for aprovado, some junto; se for descartado, não deixa rastro.
 * Nenhum outro arquivo do sistema importa este.
 */

export const MODULOS = {
  contas:    'var(--mf-mod-contas)',
  publicar:  'var(--mf-mod-publicar)',
  campanhas: 'var(--mf-mod-campanhas)',
  jobs:      'var(--mf-mod-jobs)',
  metricas:  'var(--mf-mod-metricas)',
  sistema:   'var(--mf-mod-sistema)',
};

export const KPIS = [
  { id: 'alcance',  label: 'Alcance total',  valor: '184.２K', bruto: '184.2K', delta: +12.8, modulo: 'metricas',  vs: 'vs. 30 dias' },
  { id: 'segs',     label: 'Seguidores',     bruto: '9.847',   delta: +3.4,  modulo: 'contas',    vs: 'vs. 30 dias' },
  { id: 'pubs',     label: 'Publicações',    bruto: '312',     delta: +21.0, modulo: 'publicar',  vs: 'vs. 30 dias' },
  { id: 'stories',  label: 'Views em story', bruto: '27.3K',   delta: -4.2,  modulo: 'campanhas', vs: 'vs. 30 dias' },
];

/** Série de 14 dias — alcance e publicações. */
export const SERIE = Array.from({ length: 14 }, (_, i) => ({
  dia: `${String(i + 8).padStart(2, '0')}/08`,
  alcance: Math.round(9000 + Math.sin(i / 2.1) * 2600 + i * 320 + (i % 3) * 480),
  publicacoes: Math.round(14 + Math.sin(i / 1.7) * 5 + (i % 4)),
}));

export const CONTAS = [
  { id: 1, user: 'rosielepimenta328',  nome: 'Rosiele Pimenta',  segs: 4210, status: 'conectado',   posts: 42, ultima: 'há 12 min', saude: 96, ip: '187.44.x.x' },
  { id: 2, user: 'elizamacastro.375',  nome: 'Eliza Castro',     segs: 3180, status: 'conectado',   posts: 38, ultima: 'há 34 min', saude: 91, ip: '201.17.x.x' },
  { id: 3, user: 'nataliabrandalise',  nome: 'Natália Brandalise',segs: 1290, status: 'processando',posts: 11, ultima: 'agora',     saude: 74, ip: '189.90.x.x' },
  { id: 4, user: 'marcos.oficial',     nome: 'Marcos Lima',      segs: 890,  status: 'atencao',     posts: 24, ultima: 'há 4 h',    saude: 58, ip: '191.55.x.x' },
  { id: 5, user: 'studio.aurora',      nome: 'Studio Aurora',    segs: 277,  status: 'desconectado',posts: 6,  ultima: 'há 2 dias', saude: 12, ip: '—' },
];

export const STATUS = {
  conectado:    { rotulo: 'Conectado',    tom: 'success' },
  processando:  { rotulo: 'Processando',  tom: 'info'    },
  atencao:      { rotulo: 'Atenção',      tom: 'warning' },
  desconectado: { rotulo: 'Desconectado', tom: 'danger'  },
  agendado:     { rotulo: 'Agendado',     tom: 'info'    },
  publicado:    { rotulo: 'Publicado',    tom: 'success' },
  pausado:      { rotulo: 'Pausado',      tom: 'warning' },
  erro:         { rotulo: 'Erro',         tom: 'danger'  },
};

export const JOBS = [
  { id: 'j-812', nome: 'Reels — lote agosto', tipo: 'Postar', contas: 4, progresso: 72, status: 'processando', proxima: 'em 3 min' },
  { id: 'j-809', nome: 'Loop institucional',  tipo: 'Loop',   contas: 2, progresso: 100, status: 'publicado',  proxima: '—' },
  { id: 'j-807', nome: 'Stories da semana',   tipo: 'Story',  contas: 5, progresso: 40, status: 'pausado',     proxima: 'pausado' },
  { id: 'j-804', nome: 'Reels — teste A/B',   tipo: 'Postar', contas: 3, progresso: 12, status: 'erro',        proxima: '—' },
];

export const CAMPANHAS = [
  { id: 'c-31', nome: 'Lançamento Setembro', contas: 4, conteudos: 6, publicacoes: 24, feitas: 9,  status: 'processando' },
  { id: 'c-28', nome: 'Recorrente — Dicas',  contas: 2, conteudos: 8, publicacoes: 16, feitas: 16, status: 'publicado' },
  { id: 'c-25', nome: 'Black Friday',        contas: 5, conteudos: 4, publicacoes: 20, feitas: 0,  status: 'agendado' },
];

export const ATIVIDADE = [
  { t: 'agora',      txt: 'Story publicado em @rosielepimenta328', tom: 'success' },
  { t: 'há 3 min',   txt: 'Job "Reels — lote agosto" iniciou rodada 5', tom: 'info' },
  { t: 'há 12 min',  txt: 'Legenda gerada por IA em Campanha #31', tom: 'info' },
  { t: 'há 26 min',  txt: 'Proxy da conta @marcos.oficial sem resposta', tom: 'warning' },
  { t: 'há 1 h',     txt: 'Sessão de @studio.aurora expirou', tom: 'danger' },
];

export const ETAPAS_CAMPANHA = [
  'Informações', 'Contas', 'Conteúdos', 'Estratégia',
  'Agendamento', 'Legendas', 'Comentários', 'Revisão',
];
