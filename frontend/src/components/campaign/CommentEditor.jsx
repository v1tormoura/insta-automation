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
        background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid var(--mf-border)',
        borderRadius: 'var(--mf-r-lg)', padding:'13px 16px', marginBottom: ativo ? 14 : 0,
      }}>
        <button onClick={alternar} role="switch" aria-checked={ativo} style={{
          width:42, height:24, borderRadius: 'var(--mf-r-md)', padding:2, flexShrink:0, cursor:'pointer',
          display:'flex', justifyContent: ativo ? 'flex-end' : 'flex-start',
          background: ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : 'var(--mf-border)',
          border: `1px solid ${ativo ? 'color-mix(in oklch, var(--mf-mod-contas) 50%, transparent)' : 'var(--mf-border-strong)'}`,
          transition:'all .18s',
        }}>
          <span style={{
            width:18, height:18, borderRadius: 'var(--mf-r-full)',
            background: ativo ? 'var(--mf-mod, var(--mf-accent-500))' : 'var(--mf-text-3)', transition:'all .18s',
          }} />
        </button>

        <div style={{ flex:1, minWidth:180 }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight:700 }}>Primeiro comentário</div>
          <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:2, lineHeight:1.45 }}>
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
            background:'oklch(0.16 0.05 235 / 0.55)', border:'1px solid var(--mf-border)',
            borderRadius: 'var(--mf-r-lg)', padding:16,
          }}>
            <label style={{ display:'block', fontSize: 'var(--mf-t-xs)', fontWeight:700, marginBottom:6 }}>
              Publicar o comentário depois de
            </label>
            {/* Faixa, não valor fixo: o atraso é sorteado entre o mínimo e o
                máximo a cada publicação. Um número fixo faz o comentário sair
                sempre no mesmo delta do post — padrão exato em série. */}
            <div style={{ display:'flex', alignItems:'center', gap:9, flexWrap:'wrap' }}>
              <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>entre</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                style={{ width:88 }}
                value={comments.delayMinutes ?? 2}
                onChange={e => {
                  // Campo vazio vira 0 em vez de NaN, que o backend rejeitaria.
                  const n = parseInt(e.target.value, 10);
                  const piso = Number.isFinite(n) ? Math.max(0, n) : 0;
                  const teto = Number(comments.delayMaxMinutes ?? 6);
                  onChange({
                    ...comments,
                    delayMinutes: piso,
                    // Teto abaixo do piso vira atraso fixo no backend; subir o
                    // teto junto evita a faixa invertida sem avisar.
                    delayMaxMinutes: teto < piso ? piso : teto,
                  });
                }}
              />
              <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-3)' }}>e</span>
              <input
                className="input"
                type="number"
                min={0}
                max={1440}
                style={{ width:88 }}
                value={comments.delayMaxMinutes ?? 6}
                onChange={e => {
                  const n = parseInt(e.target.value, 10);
                  const piso = Number(comments.delayMinutes ?? 2);
                  const teto = Number.isFinite(n) ? Math.max(0, n) : 0;
                  onChange({ ...comments, delayMaxMinutes: Math.max(piso, teto) });
                }}
              />
              <span style={{ fontSize: 'var(--mf-t-xs)', color:'var(--mf-text-2)' }}>minutos</span>
            </div>
            <div style={{ fontSize: 'var(--mf-t-nano)', color:'var(--mf-text-3)', marginTop:8, lineHeight:1.5 }}>
              Contado a partir da publicação do post. O atraso é sorteado dentro da faixa
              a cada publicação — máximo igual ao mínimo deixa o atraso fixo.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
