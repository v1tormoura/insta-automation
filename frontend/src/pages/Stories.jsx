import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

export default function Stories() {
  const [accounts, setAccounts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [imageUrl, setImageUrl] = useState('');
  const [linkUrl, setLinkUrl]   = useState('');
  const [linkText, setLinkText] = useState('Clique Aqui');
  const [loading, setLoading]   = useState(false);
  const [results, setResults]   = useState(null);
  const [imgOk, setImgOk]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const linkTextRef                 = useRef(null);

  useEffect(() => {
    api.get('/accounts')
      .then(r => setAccounts(r.data.accounts || []))
      .catch(() => {});
  }, []);

  function toggleAccount(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function toggleAll() {
    setSelected(
      selected.length === accounts.length && accounts.length > 0
        ? []
        : accounts.map(a => a._id)
    );
  }

  async function handlePost() {
    if (!selected.length) { alert('Selecione pelo menos uma conta'); return; }
    if (!imageUrl.trim()) { alert('Informe a URL da imagem'); return; }
    setLoading(true);
    setResults(null);
    try {
      const { data } = await api.post('/api/stories', {
        accountIds: selected,
        imageUrl:   imageUrl.trim(),
        linkUrl:    linkUrl.trim() || null,
        linkText:   linkText.trim() || 'Clique Aqui',
      });
      setResults(data);
    } catch (err) {
      alert(err.response?.data?.error || 'Erro ao postar story');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setImgOk(false);
    try {
      const form = new FormData();
      form.append('image', file);
      const { data } = await api.post('/api/stories/upload', form);
      setImageUrl(data.url);
    } catch (err) {
      alert('Erro ao fazer upload: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
    }
  }

  function insertEmoji(emoji) {
    const el = linkTextRef.current;
    if (!el) { setLinkText(prev => prev + emoji); setShowEmojis(false); return; }
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    const next  = linkText.slice(0, start) + emoji + linkText.slice(end);
    setLinkText(next);
    setShowEmojis(false);
    setTimeout(() => { el.focus(); el.setSelectionRange(start + emoji.length, start + emoji.length); }, 0);
  }

  const canPost = selected.length > 0 && imageUrl.trim().length > 0 && !loading;

  return (
    <div translate="no" style={{ padding: 24, maxWidth: 880, margin: '0 auto' }}>

      <h2 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>Stories</h2>
      <p style={{ margin: '0 0 24px', color: '#94a3b8', fontSize: 14 }}>
        Poste stories com figurinha de link em varias contas
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>

        {/* Coluna principal */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Card: Imagem */}
          <div style={CARD}>
            <div style={LABEL}>Imagem do Story *</div>

            {/* Botao upload */}
            <label style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              padding: '28px 16px', borderRadius: 10,
              border: '2px dashed #334155', cursor: 'pointer',
              background: '#0f172a', color: '#94a3b8', fontSize: 14, fontWeight: 500,
              marginBottom: 10,
            }}>
              <input type="file" accept="image/*" onChange={handleUpload} style={{ display: 'none' }} />
              {uploading ? 'Enviando...' : 'Clique para escolher imagem do PC'}
            </label>

            {/* Preview */}
            {imageUrl.length > 0 && (
              <img
                src={imageUrl}
                alt="preview"
                onLoad={() => setImgOk(true)}
                onError={() => setImgOk(false)}
                style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, display: imgOk ? 'block' : 'none', marginBottom: 10 }}
              />
            )}

            {/* URL manual (opcional) */}
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>Ou cole uma URL publica</div>
            <input
              type="text"
              placeholder="https://exemplo.com/foto.jpg"
              value={imageUrl}
              onChange={e => { setImageUrl(e.target.value); setImgOk(false); }}
              style={INPUT}
            />
          </div>

          {/* Card: Link */}
          <div style={CARD}>
            <div style={LABEL}>Figurinha de Link</div>

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>URL do link</div>
            <input
              type="text"
              placeholder="https://meusite.com.br"
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              style={INPUT}
            />

            <div style={{ fontSize: 12, color: '#64748b', margin: '12px 0 4px' }}>
              Texto da figurinha
              <span style={{ marginLeft: 8, color: '#475569' }}>(use Win+. para emojis do teclado)</span>
            </div>
            <input
              ref={linkTextRef}
              type="text"
              placeholder="Clique Aqui 🔥😈"
              value={linkText}
              onChange={e => setLinkText(e.target.value)}
              style={INPUT}
            />

            {linkText.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Preview:</div>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 20, padding: '5px 14px',
                  fontSize: 13, fontWeight: 600, color: '#fff',
                }}>
                  {linkText}
                </span>
              </div>
            )}
          </div>

          {/* Botao */}
          <button
            onClick={handlePost}
            disabled={!canPost}
            style={{
              padding: 13,
              background: canPost ? '#6366f1' : '#334155',
              color: '#fff', border: 'none', borderRadius: 10,
              fontSize: 14, fontWeight: 600,
              cursor: canPost ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? 'Postando...' : 'Postar Story (' + selected.length + ' conta' + (selected.length !== 1 ? 's' : '') + ')'}
          </button>

          {/* Resultados */}
          {results !== null && (
            <div style={CARD}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
                {results.successCount} de {results.total} publicados
              </div>
              {results.results.map(function(r, i) {
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: '1px solid #1e293b', fontSize: 13 }}>
                    <span>{r.status === 'success' ? '(ok)' : '(erro)'}</span>
                    <strong>{'@' + r.username}</strong>
                    <span style={{ color: '#94a3b8', flex: 1 }}>
                      {r.status === 'success'
                        ? (r.method === 'graph' ? 'Graph API' : 'API Privada') + (r.withLink ? ' + link' : '')
                        : r.error}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* Coluna: contas */}
        <div style={CARD}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Contas</div>
            <button
              onClick={toggleAll}
              style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              {selected.length === accounts.length && accounts.length > 0 ? 'Desmarcar todas' : 'Selecionar todas'}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 500, overflowY: 'auto' }}>
            {accounts.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13 }}>Carregando contas...</div>
            )}
            {accounts.map(function(acc) {
              const isSel    = selected.includes(acc._id);
              const hasOAuth = !!(acc.accessToken && acc.igUserId);
              const hasPass  = !!acc.password;
              const canClick = hasOAuth || hasPass;

              return (
                <div
                  key={acc._id}
                  onClick={function() { if (canClick) toggleAccount(acc._id); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8,
                    cursor: canClick ? 'pointer' : 'not-allowed',
                    opacity: canClick ? 1 : 0.4,
                    background: isSel ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                    border: '1px solid ' + (isSel ? '#6366f1' : 'transparent'),
                  }}
                >
                  <div style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    border: '2px solid ' + (isSel ? '#6366f1' : '#475569'),
                    background: isSel ? '#6366f1' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSel && <span style={{ color: '#fff', fontSize: 9, lineHeight: 1 }}>v</span>}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {'@' + acc.username}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {hasOAuth ? 'OAuth' : hasPass ? 'Senha' : 'Sem credenciais'}
                    </div>
                  </div>

                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: acc.healthStatus === 'ativa' ? '#4ade80' : '#64748b',
                  }} />
                </div>
              );
            })}
          </div>

          {selected.length > 0 && (
            <div style={{ marginTop: 10, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
              {selected.length + ' selecionada' + (selected.length !== 1 ? 's' : '')}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

const CARD = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 12,
  padding: '16px 18px',
};

const LABEL = {
  fontSize: 13,
  fontWeight: 600,
  color: '#cbd5e1',
  marginBottom: 8,
};

const INPUT = {
  width: '100%',
  padding: '9px 12px',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};
