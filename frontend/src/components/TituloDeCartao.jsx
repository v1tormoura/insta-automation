/**
 * Cabeçalho de cartão: chip de ícone + título.
 *
 * Os cartões do painel de publicação tinham só um `<h3>` de texto. Numa coluna
 * com seis deles seguidos, todos com o mesmo peso e a mesma cor, a varredura do
 * olho não achava onde uma seção termina e a outra começa — a pessoa lia tudo
 * ou não lia nada. O chip dá a cada cartão uma âncora visual reconhecível de
 * relance, sem precisar ler o título.
 *
 * O ícone vem do catálogo abaixo pelo `nome`: quem usa não passa SVG, então
 * duas telas que mostram "Legenda" não acabam com desenhos diferentes.
 */

const ICONES = {
  midia:      <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></>,
  capa:       <><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></>,
  legenda:    <><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></>,
  comentario: <><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></>,
  processo:   <><path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></>,
  simultaneo: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
  envio:      <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
  contas:     <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
  link:       <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></>,
  previa:     <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  resultado:  <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>,
  info:       <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>,
  relogio:    <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></>,
  limite:     <><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 7v5l3 2"/><path d="M4.5 4.5l15 15"/></>,
  plano:      <><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  config:     <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.2.63.77 1.05 1.43 1.05H21a2 2 0 110 4h-.09c-.66 0-1.23.42-1.51 1z"/></>,
  marca:      <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16l3.5-4.5 2.5 3 2-2.5L19 16"/><circle cx="8.5" cy="8.5" r="1.3"/></>,
  grafico:    <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
  proxy:      <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></>,
  teste:      <><path d="M9 2v6.5L4.2 17A2 2 0 006 20h12a2 2 0 001.8-3L15 8.5V2"/><line x1="8" y1="2" x2="16" y2="2"/><line x1="7.5" y1="13" x2="16.5" y2="13"/></>,
  automacao:  <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
  regras:     <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></>,
  venda:      <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></>,
  fila:       <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
};

export default function TituloDeCartao({ icone, children, mod = 'publicar' }) {
  /* `mod="auto"` herda a cor que a própria página define em `--mf-mod`. Telas
     genéricas (Proxies, Settings, Performance…) não pertencem a um módulo fixo,
     e fixar 'publicar' nelas pintaria tudo de ciano-publicar sem razão. */
  const cor = mod === 'auto'
    ? 'var(--mf-mod, var(--mf-primary-500))'
    : `var(--mf-mod-${mod}, var(--mf-primary-500))`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span aria-hidden="true" style={{
        flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--mf-r-md)',
        display: 'grid', placeItems: 'center',
        background: `color-mix(in oklch, ${cor} 14%, transparent)`,
        border: `1px solid color-mix(in oklch, ${cor} 28%, transparent)`,
        color: cor,
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {ICONES[icone] || ICONES.midia}
        </svg>
      </span>
      <h3 style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 700, color: 'var(--mf-text)', margin: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </h3>
    </div>
  );
}
