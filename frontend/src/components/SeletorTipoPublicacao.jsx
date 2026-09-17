/**
 * Escolha do tipo de publicação em cartões grandes.
 *
 * Substitui o segmentado de três abas. A diferença não é só estética: o tipo
 * decide o formato do arquivo, se existe capa e qual caminho de publicação o
 * worker usa — é a primeira decisão da tela e a que muda mais coisa depois.
 * Num segmentado de 90px isso tinha o mesmo peso visual de um filtro.
 *
 * Cada cartão diz o que o tipo É (o subtítulo), porque "Reel/Post/Story" só é
 * óbvio para quem já publica todo dia.
 */

const TIPOS = [
  {
    id: 'reel',
    titulo: 'Reel',
    desc: 'Vídeo curto e dinâmico',
    icone: (
      <>
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </>
    ),
  },
  {
    id: 'post',
    titulo: 'Post',
    desc: 'Imagem ou carrossel',
    icone: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" />
      </>
    ),
  },
  {
    id: 'story',
    titulo: 'Story',
    desc: 'Conteúdo rápido',
    icone: (
      <>
        <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
        <circle cx="12" cy="12" r="3.4" />
      </>
    ),
  },
];

export default function SeletorTipoPublicacao({ valor, onChange, mod = 'publicar' }) {
  const cor = `var(--mf-mod-${mod}, var(--mf-primary-500))`;

  return (
    <div role="radiogroup" aria-label="Tipo de publicação"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {TIPOS.map(t => {
        const ativo = valor === t.id;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={ativo}
            onClick={() => onChange(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left',
              padding: '13px 14px', cursor: 'pointer',
              borderRadius: 'var(--mf-r-lg)',
              border: `1.5px solid ${ativo ? cor : 'var(--mf-border)'}`,
              background: ativo
                ? `color-mix(in oklch, ${cor} 10%, var(--mf-surface-2))`
                : 'var(--mf-surface-2)',
              boxShadow: ativo ? `0 0 0 3px color-mix(in oklch, ${cor} 15%, transparent)` : 'none',
              transition: 'border-color var(--mf-fast) var(--mf-ease-out), background var(--mf-fast), box-shadow var(--mf-fast)',
            }}>
            <span style={{
              flexShrink: 0, width: 38, height: 38, borderRadius: 'var(--mf-r-md)',
              display: 'grid', placeItems: 'center',
              background: ativo ? `color-mix(in oklch, ${cor} 18%, transparent)` : 'var(--mf-surface-3)',
              border: `1px solid ${ativo ? `color-mix(in oklch, ${cor} 34%, transparent)` : 'var(--mf-border)'}`,
              color: ativo ? cor : 'var(--mf-text-3)',
              transition: 'all var(--mf-fast) var(--mf-ease-out)',
            }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{t.icone}</svg>
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 'var(--mf-t-body)', fontWeight: 750,
                color: ativo ? 'var(--mf-text)' : 'var(--mf-text-2)', lineHeight: 1.25 }}>
                {t.titulo}
              </span>
              <span style={{ display: 'block', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 2 }}>
                {t.desc}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
