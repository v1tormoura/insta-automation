import CaptionEditor from './CaptionEditor';

/**
 * Editor do primeiro comentário da campanha.
 *
 * Reusa o CaptionEditor para os quatro modos por chave: a estrutura de dados é
 * a mesma (global + byAccount + byContent + byAccountContent) e o planner
 * resolve comentário pela mesma prioridade das legendas. Duplicar o editor
 * criaria dois lugares para corrigir cada ajuste de interface.
 *
 * O que é próprio do comentário e mora aqui: o modo "desativado" — que não
 * existe em legenda — e o atraso até publicá-lo.
 */

export default function CommentEditor({
  mode,                 // 'disabled' | 'global' | 'per_account' | 'per_content' | 'per_account_content'
  onModeChange,
  comments = {},
  onChange,
  accounts = [],
  contents = [],
}) {
  const ativo = mode !== 'disabled';

  // Ao ligar, cai em 'global' — o modo mais simples e o que a maioria usa.
  // Ao desligar, os textos são preservados: desligar por engano não pode
  // apagar o que foi escrito.
  const alternar = () => onModeChange(ativo ? 'disabled' : 'global');

  return (
    <div>
      {/* Liga/desliga */}
      <div style={{
        display:'flex', alignItems:'center', gap:12, flexWrap:'wrap',
        background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid oklch(1 0 0 / 0.08)',
        borderRadius:14, padding:'13px 16px', marginBottom: ativo ? 14 : 0,
      }}>
        <button onClick={alternar} role="switch" aria-checked={ativo} style={{
          width:42, height:24, borderRadius:12, padding:2, flexShrink:0, cursor:'pointer',
          display:'flex', justifyContent: ativo ? 'flex-end' : 'flex-start',
          background: ativo ? 'rgba(0,212,255,.3)' : 'oklch(1 0 0 / 0.08)',
          border: `1px solid ${ativo ? 'rgba(0,212,255,.5)' : 'oklch(1 0 0 / 0.12)'}`,
          transition:'all .18s',
        }}>
          <span style={{
            width:18, height:18, borderRadius:'50%',
            background: ativo ? 'var(--cyan)' : 'var(--text3)', transition:'all .18s',
          }} />
        </button>

        <div style={{ flex:1, minWidth:180 }}>
          <div style={{ fontSize:13, fontWeight:700 }}>Primeiro comentário</div>
          <div style={{ fontSize:10.5, color:'var(--text3)', marginTop:2, lineHeight:1.45 }}>
            {ativo
              ? 'Publicado automaticamente depois do post.'
              : 'Desativado — nenhum comentário será publicado.'}
          </div>
        </div>
      </div>

      {ativo && (
        <>
          <CaptionEditor
            mode={mode}
            onModeChange={onModeChange}
            captions={comments}
            onChange={onChange}
            accounts={accounts}
            contents={contents}
            titulo="Texto do comentário"
            placeholder="Link na bio 👆"
          />

          {/* Atraso */}
          <div style={{
            background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid oklch(1 0 0 / 0.08)',
            borderRadius:14, padding:16,
          }}>
            <label style={{ display:'block', fontSize:12, fontWeight:700, marginBottom:6 }}>
              Publicar o comentário depois de
            </label>
            <div style={{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap' }}>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                style={{ width:100 }}
                value={comments.delayMinutes ?? 2}
                onChange={e => {
                  // Campo vazio vira 0 em vez de NaN, que o backend rejeitaria.
                  const n = parseInt(e.target.value, 10);
                  onChange({ ...comments, delayMinutes: Number.isFinite(n) ? Math.max(0, n) : 0 });
                }}
              />
              <span style={{ fontSize:12, color:'var(--text2)' }}>minutos</span>
            </div>
            <div style={{ fontSize:10.5, color:'var(--text3)', marginTop:8, lineHeight:1.5 }}>
              Contado a partir da publicação do post. Zero comenta logo em seguida —
              um intervalo de poucos minutos se parece mais com uso normal.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
