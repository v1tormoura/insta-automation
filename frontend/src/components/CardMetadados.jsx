/**
 * Card "Metadados removidos automaticamente".
 *
 * Só EXIBE o que o backend já faz em TODA publicação: o `videoProcessor`
 * reconverte o vídeo com `-map_metadata -1`, remove os NAL units SEI do
 * bitstream e regrava só uma hora de gravação plausível; a imagem passa por
 * `marcarImagem`/reencode sem os metadados de origem. Ou seja, não é um botão a
 * ligar — é a garantia de que já está ligado, em todo Postar, Loop, Campanha,
 * Reel e Story. Ver services/midiaPorConta.js e services/videoProcessor.js.
 *
 * @param {'video'|'imagem'|'ambos'} tipo  qual texto mostrar (padrão: 'ambos')
 * @param {object} [style]  estilo extra do contêiner (margem, etc.)
 */
const TEXTOS = {
  video: 'Todo vídeo é reconvertido antes de publicar, saindo sem EXIF, sem localização de GPS e sem as marcas do aparelho que gravou. Não precisa configurar nada.',
  imagem: 'Suas imagens são publicadas sem EXIF, sem localização de GPS e sem as marcas do aparelho que tirou a foto. Não precisa configurar nada — e a qualidade da imagem não é alterada.',
  ambos: 'Toda mídia é reprocessada antes de publicar, saindo sem EXIF, sem localização de GPS e sem as marcas do aparelho de origem. Não precisa configurar nada.',
};

export default function CardMetadados({ tipo = 'ambos', style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      background: 'var(--mf-surface-1)',
      border: '1px solid var(--mf-border)',
      borderRadius: 'var(--mf-r-lg)',
      padding: '13px 16px',
      ...style,
    }}>
      <div style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 'var(--mf-r-md)',
        display: 'grid', placeItems: 'center', marginTop: 1,
        background: 'color-mix(in oklch, var(--mf-mod, var(--mf-primary-500)) 15%, transparent)',
        border: '1px solid color-mix(in oklch, var(--mf-mod, var(--mf-primary-500)) 30%, transparent)',
        color: 'var(--mf-mod, var(--mf-primary-500))',
      }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" />
        </svg>
      </div>
      <div style={{ minWidth: 0, fontSize: 'var(--mf-t-xs)', lineHeight: 1.6, color: 'var(--mf-text-2)' }}>
        <strong style={{ color: 'var(--mf-text)', fontWeight: 700 }}>Metadados removidos automaticamente.</strong>{' '}
        {TEXTOS[tipo] || TEXTOS.ambos}
      </div>
    </div>
  );
}
