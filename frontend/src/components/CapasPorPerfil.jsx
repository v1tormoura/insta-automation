import { useRef } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Capa por perfil — uma capa para cada conta selecionada.
 *
 * Só apresentação: recebe as contas, o que já foi escolhido para cada uma e
 * três ações (escolher da biblioteca, enviar arquivo, limpar). Quem monta o
 * formulário decide onde a escolha é guardada — no Postar é nome de arquivo
 * (e às vezes um File ainda não enviado), na Campanha é o id da Media. O
 * componente não sabe nem precisa saber.
 *
 * Lista, não grade: o que se lê aqui é "@conta → capa", um par por linha, e
 * a coluna do @ precisa de largura para nomes longos. A miniatura é vertical
 * (9:16) porque é assim que a capa aparece no Reel.
 */

function avatarUrl(acc) {
  if (!acc?.avatar) return null;
  if (acc.avatar.startsWith('http')) return `${API}/image-proxy?url=${encodeURIComponent(acc.avatar)}`;
  return `${API}${acc.avatar}`;
}

const mono = { fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' };

/**
 * @param {object[]} contas           as contas SELECIONADAS no formulário
 * @param {object}   capas            { [accountId]: { url?: string, rotulo?: string } } — o que já foi escolhido
 * @param {Function} onBiblioteca     (accountId) => abre o seletor da biblioteca para esta conta
 * @param {Function} [onArquivo]      (accountId, File) => upload direto; ausente = só biblioteca
 * @param {Function} onLimpar         (accountId) => remove a capa desta conta
 * @param {string}   [capaGeralUrl]   miniatura da capa geral, mostrada como "herdada" em quem não tem própria
 * @param {boolean}  [ocupado]        desabilita os botões (upload em andamento)
 */
export default function CapasPorPerfil({ contas = [], capas = {}, onBiblioteca, onArquivo, onLimpar, capaGeralUrl = '', ocupado = false }) {
  const inputRef = useRef(null);
  const alvoRef  = useRef(null);   // accountId que abriu o input de arquivo

  if (!contas.length) {
    return (
      <div style={{ ...mono, padding: '8px 0', textTransform: 'none' }}>
        Selecione as contas primeiro — a lista de capas aparece aqui, uma por perfil.
      </div>
    );
  }

  const comCapa = contas.filter(c => capas[String(c.id)]).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={mono}>{comCapa}/{contas.length} com capa própria</span>
        {capaGeralUrl
          ? <span style={{ ...mono, textTransform: 'none' }}>as outras usam a capa geral</span>
          : <span style={{ ...mono, textTransform: 'none' }}>as outras usam o primeiro frame</span>}
      </div>

      {onArquivo && (
        <input ref={inputRef} type="file" accept="image/*" hidden
          onChange={e => {
            const f = e.target.files?.[0];
            if (f && alvoRef.current) onArquivo(alvoRef.current, f);
            e.target.value = '';
            alvoRef.current = null;
          }} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {contas.map(c => {
          const id   = String(c.id);
          const capa = capas[id];
          const src  = capa?.url || (capaGeralUrl || null);
          const propria = !!capa;
          const av = avatarUrl(c);
          return (
            <div key={id} style={{
              display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) 36px auto', gap: 10, alignItems: 'center',
              padding: '6px 8px', borderRadius: 'var(--mf-r-sm)',
              background: propria ? 'color-mix(in oklch, var(--mf-mod-contas) 7%, var(--mf-surface-2))' : 'var(--mf-surface-2)',
              border: `1px solid ${propria ? 'color-mix(in oklch, var(--mf-mod-contas) 30%, transparent)' : 'var(--mf-border)'}`,
            }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', background: 'var(--mf-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--mf-t-nano)', fontWeight: 700, color: 'var(--mf-text-3)' }}>
                {av ? <img src={av} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (c.username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{c.username}</div>
                <div style={{ ...mono, textTransform: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {propria ? (capa.rotulo || 'capa própria') : (capaGeralUrl ? 'herda a capa geral' : 'sem capa · primeiro frame')}
                </div>
              </div>
              <div title={propria ? 'Capa deste perfil' : 'Sem capa própria'} style={{
                width: 36, height: 64, borderRadius: 4, overflow: 'hidden', background: 'var(--mf-border-subtle)',
                border: `1px solid ${propria ? 'color-mix(in oklch, var(--mf-mod-contas) 45%, transparent)' : 'var(--mf-border)'}`,
                opacity: propria ? 1 : (src ? .45 : 1), display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {src
                  ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mf-text-3)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => onBiblioteca?.(id)} title="Escolher da biblioteca">Biblioteca</button>
                {onArquivo && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} title="Enviar imagem do computador"
                    onClick={() => { alvoRef.current = id; inputRef.current?.click(); }}>Enviar</button>
                )}
                {propria && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado} onClick={() => onLimpar?.(id)} title="Remover a capa deste perfil"
                    style={{ color: 'var(--mf-danger-500)' }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
