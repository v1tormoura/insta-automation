import { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { useServerEvents } from '../services/useServerEvents';

const STATUS_META = {
  concluido:        { label: 'Concluído',   color: '#22c55e', bg: 'rgba(34,197,94,.12)'  },
  erro:             { label: 'Erro',        color: '#f87171', bg: 'rgba(248,113,113,.12)' },
  processando:      { label: 'Processando', color: '#818cf8', bg: 'rgba(129,140,248,.12)' },
  agendado:         { label: 'Agendado',    color: '#f59e0b', bg: 'rgba(245,158,11,.12)'  },
  pendente:         { label: 'Pendente',    color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  done:             { label: 'Concluído',   color: '#22c55e', bg: 'rgba(34,197,94,.12)'  },
  done_with_errors: { label: 'Com erros',   color: '#f59e0b', bg: 'rgba(245,158,11,.12)' },
  running:          { label: 'Executando',  color: '#818cf8', bg: 'rgba(129,140,248,.12)' },
  error:            { label: 'Erro',        color: '#f87171', bg: 'rgba(248,113,113,.12)' },
};

const TYPE_ICON = {
  post:         { icon: '🖼️', label: 'Post'           },
  reel:         { icon: '🎬', label: 'Reel'           },
  story:        { icon: '⭕', label: 'Story'          },
  profile_edit: { icon: '✏️', label: 'Edição de perfil' },
  account:      { icon: '👤', label: 'Conta'          },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pendente;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: m.color,
      background: m.bg, padding: '3px 10px', borderRadius: 999,
    }}>
      {m.label}
    </span>
  );
}

function borderColor(status) {
  return STATUS_META[status]?.color || 'var(--border)';
}

export default function Logs() {
  const [posts,       setPosts]       = useState([]);
  const [profileJobs, setProfileJobs] = useState([]);
  const [filter,      setFilter]      = useState('all');
  const [loading,     setLoading]     = useState(true);

  const load = useCallback(async () => {
    try {
      const [postsRes, jobsRes] = await Promise.allSettled([
        api.get('/posts'),
        api.get('/profile-edit/jobs'),
      ]);
      if (postsRes.status === 'fulfilled') {
        setPosts(postsRes.value.data.posts || postsRes.value.data || []);
      }
      if (jobsRes.status === 'fulfilled') {
        setProfileJobs(Array.isArray(jobsRes.value.data) ? jobsRes.value.data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => { load(); }, [load]);

  // Poll every 10 s as fallback when SSE is idle
  useEffect(() => {
    const id = setInterval(() => loadRef.current?.(), 10_000);
    return () => clearInterval(id);
  }, []);

  useServerEvents(['posts', 'profile_edit', 'accounts'], load);

  // Montar timeline unificada
  const timeline = [
    ...posts.map(p => ({
      _id:      p._id,
      type:     p.postType || 'post',
      status:   p.status,
      date:     p.createdAt,
      accounts: p.accounts?.map(a => a.username).join(', ') || '—',
      media:    p.media || '—',
      caption:  p.caption,
      error:    p.error,
    })),
    ...profileJobs.map(j => {
      const hasErrors = j.results?.some(r => r.status === 'error');
      return {
        _id:      j.jobId,
        type:     'profile_edit',
        status:   j.status === 'done' && hasErrors ? 'done_with_errors' : j.status,
        date:     j.startedAt,
        accounts: j.username || (j.results?.map(r => r.username).join(', ')) || '—',
        error:    j.error,
        results:  j.results,
      };
    }),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  const FILTERS = ['all', 'concluido', 'erro', 'processando', 'agendado', 'pendente'];
  const statusMap = { concluido: ['concluido','done'], erro: ['erro','error','done_with_errors'], processando: ['processando','running'] };
  const filtered = filter === 'all'
    ? timeline
    : timeline.filter(e => (statusMap[filter] || [filter]).includes(e.status));

  return (
    <div>
      <div className="page-header">
        <div className="page-header-left">
          <div className="eyebrow">Monitoramento</div>
          <h1>Logs do Sistema</h1>
          <p>Histórico completo de publicações e automações.</p>
        </div>
        <div className="page-header-right">
          <span className="badge badge-green"><span className="dot" />Tempo real</span>
        </div>
      </div>

      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f} className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todos' : f}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text2)', lineHeight: '30px' }}>
          {filtered.length} registro(s)
        </span>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', color: 'var(--text2)', padding: 40, fontSize: 13 }}>Carregando…</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filtered.map(entry => {
          const tm = TYPE_ICON[entry.type] || TYPE_ICON.post;
          return (
            <div key={entry._id} style={{
              background: 'var(--card)', border: `1px solid var(--border)`,
              borderLeft: `3px solid ${borderColor(entry.status)}`,
              borderRadius: 10, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>{tm.icon}</span>
                  <div>
                    <strong style={{ fontSize: 13, color: 'var(--text)' }}>{tm.label}</strong>
                    <span style={{ fontSize: 11, color: 'var(--text2)', display: 'block' }}>
                      {entry.date ? new Date(entry.date).toLocaleString('pt-BR') : '—'}
                    </span>
                  </div>
                </div>
                <StatusBadge status={entry.status} />
              </div>

              <div style={{ fontFamily: "'Courier New',monospace", fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3, color: 'var(--text2)' }}>
                <span><span style={{ color: 'var(--text3)' }}>conta: </span>{entry.accounts}</span>
                {entry.media    && <span><span style={{ color: 'var(--text3)' }}>mídia: </span>{entry.media}</span>}
                {entry.caption  && <span><span style={{ color: 'var(--text3)' }}>legenda: </span>{entry.caption.slice(0, 80)}{entry.caption.length > 80 ? '…' : ''}</span>}
                {entry.error    && <span style={{ color: '#f87171' }}><span style={{ color: 'var(--text3)' }}>erro: </span>{entry.error}</span>}
                {entry.results?.length > 0 && entry.results.map((r, i) => {
                  const ok = r.status === 'ok';
                  let errorMsg = r.error || 'falhou';
                  if (!ok && /challenge|checkpoint/i.test(errorMsg)) {
                    errorMsg = 'Challenge Instagram — use Reconectar para resolver';
                  }
                  return (
                    <span key={i} style={{ color: ok ? '#22c55e' : '#f87171' }}>
                      <span style={{ color: 'var(--text3)' }}>resultado [{r.username}]: </span>
                      {ok ? '✓ ' + (r.message || 'ok') : '✗ ' + errorMsg}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}

        {!loading && !filtered.length && (
          <div style={{
            textAlign: 'center', padding: '48px 20px',
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>Nenhum registro ainda</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>
              Os logs aparecem aqui assim que você publicar posts, editar perfis ou executar automações.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
