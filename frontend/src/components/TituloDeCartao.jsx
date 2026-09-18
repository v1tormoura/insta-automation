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
  fila:       <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
};

export default function TituloDeCartao({ icone, children, mod = 'publicar' }) {
  const cor = `var(--mf-mod-${mod}, var(--mf-primary-500))`;
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
