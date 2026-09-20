import { horaCurta } from '../services/useCotas';

/**
 * "32/50 hoje" — a cota da API de uma conta, em um chip.
 *
 * Três estados, três cores: folga (verde), perto do fim (âmbar, ≥ 80 %) e
 * cheia (vermelho, com a hora estimada de liberação). A cor é reforço; o
 * número está sempre escrito — identidade nunca só pela cor.
 */
export default function ChipDeCota({ cota, compacto = false }) {
  if (!cota || !cota.disponivel) return null;
  const { usage, limite, cheia, libera } = cota;
  const frac = limite ? usage / limite : 0;
  const cor = cheia ? 'var(--mf-danger-500)' : frac >= 0.8 ? 'var(--mf-warning-500)' : 'var(--mf-success-500)';
  const texto = cheia
    ? (compacto ? `cheia${libera ? ` · ${horaCurta(libera)}` : ''}` : `cota cheia${libera ? ` · libera ${horaCurta(libera)}` : ''}`)
    : (compacto ? `${usage}/${limite}` : `${usage}/${limite} hoje`);
  const titulo = cheia
    ? `Cota da API do Instagram: ${usage}/${limite} em 24h — cheia${libera ? `, libera por volta de ${horaCurta(libera)}` : ''}`
    : `Cota da API do Instagram: ${usage} de ${limite} publicações nas últimas 24h · restam ${limite - usage}`;
  return (
    <span title={titulo} style={{
      fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.3px',
      padding: compacto ? '1px 6px' : '2px 8px', borderRadius: 'var(--mf-r-xl)', whiteSpace: 'nowrap',
      background: `color-mix(in oklch, ${cor} 12%, transparent)`, color: cor,
      border: `1px solid color-mix(in oklch, ${cor} 28%, transparent)`,
      display: 'inline-flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums',
    }}>
      {!compacto && <span aria-hidden style={{ width: 5, height: 5, borderRadius: '50%', background: cor }} />}
      {texto}
    </span>
  );
}
