import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import api from '../services/api';
import PageShell from '../components/PageShell';
import Segmentado from '../components/Segmentado';
import ConfirmModal from '../components/ConfirmModal';
import PortalModal from '../components/PortalModal';
import { EsqueletoLista, Vazio, Falha } from '../components/Estados';
import { useServerEvents } from '../services/useServerEvents';

/**
 * Usuários da plataforma — só o admin chega aqui.
 *
 * Quem se cadastra entra como "pendente" e só acessa depois de aprovado.
 * Bloquear corta o acesso na hora e pausa os envios e campanhas da pessoa;
 * apagar leva tudo dela e pede o e-mail digitado, porque não tem volta.
 */

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const FILTROS = [
  { value: 'pendente',  label: 'Pendentes' },
  { value: 'ativo',     label: 'Ativos' },
  { value: 'bloqueado', label: 'Bloqueados' },
  { value: 'recusado',  label: 'Recusados' },
  { value: '',          label: 'Todos' },
];

const STATUS = {
  pendente:  { rotulo: 'Pendente',  cor: 'var(--mf-warning-500)' },
  ativo:     { rotulo: 'Ativo',     cor: 'var(--mf-success-500)' },
  bloqueado: { rotulo: 'Bloqueado', cor: 'var(--mf-danger-500)' },
  recusado:  { rotulo: 'Recusado',  cor: 'var(--mf-text-3)' },
};

const data = d => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

const icone = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/><path d="M16 11l2 2 4-4"/>
  </svg>
);

function Avatar({ u }) {
  const iniciais = (u.nome || u.email || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
  return (
    <span style={{
      width: 40, height: 40, borderRadius: 'var(--mf-r-full)', flexShrink: 0, overflow: 'hidden',
      display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 'var(--mf-t-sm)',
      background: 'color-mix(in oklch, var(--mf-mod) 14%, transparent)', color: 'var(--mf-mod)',
    }}>
      {u.avatar ? <img src={`${API}${u.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : iniciais}
    </span>
  );
}

export default function Usuarios() {
  const [filtro, setFiltro] = useState('pendente');
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [agindo, setAgindo] = useState(null);           // id em ação
  const [confirmar, setConfirmar] = useState(null);     // { u, acao }
  const [apagar, setApagar] = useState(null);           // usuário
  const [digitado, setDigitado] = useState('');

  const carregar = useCallback(() => api.get('/usuarios', { params: filtro ? { status: filtro } : {} })
    .then(({ data: d }) => { setLista(d.usuarios || []); setErro(''); })
    .catch(e => setErro(e.response?.data?.error || e.message)), [filtro]);

  useEffect(() => { carregar(); }, [carregar]);
  useServerEvents(['usuarios'], carregar);

  async function agir(u, acao) {
    setAgindo(u.id);
    try {
      const { data: d } = await api.post(`/usuarios/${u.id}/${acao}`);
      const msg = {
        aprovar: `${u.nome} aprovado — já pode entrar.`,
        recusar: `Cadastro de ${u.nome} recusado.`,
        bloquear: `${u.nome} bloqueado${d.pausados ? ` — ${d.pausados.envios} envio(s) e ${d.pausados.campanhas} campanha(s) pausados` : ''}.`,
        reativar: `${u.nome} reativado.`,
      }[acao];
      toast.success(msg);
      await carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível concluir');
    } finally {
      setAgindo(null);
      setConfirmar(null);
    }
  }

  async function confirmarApagar() {
    const u = apagar;
    setAgindo(u.id);
    try {
      await api.delete(`/usuarios/${u.id}`, { data: { confirmacao: digitado.trim().toLowerCase() } });
      toast.success(`${u.nome} e tudo que era dele foram apagados.`);
      setApagar(null);
      setDigitado('');
      await carregar();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Não foi possível apagar');
    } finally {
      setAgindo(null);
    }
  }

  const botoes = u => {
    const b = (acao, rotulo, classe = 'mf-btn--secondary') => (
      <button key={acao} type="button" className={`mf-btn ${classe}`} disabled={agindo === u.id}
        onClick={() => (acao === 'bloquear' || acao === 'recusar' ? setConfirmar({ u, acao }) : agir(u, acao))}>
        {rotulo}
      </button>
    );
    if (u.papel === 'admin') return <span style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)' }}>Administrador</span>;
    return [
      u.status === 'pendente' && b('aprovar', 'Aprovar', 'mf-btn--primary'),
      u.status === 'pendente' && b('recusar', 'Recusar', 'mf-btn--ghost'),
      u.status === 'recusado' && b('aprovar', 'Aprovar mesmo assim'),
      u.status === 'ativo' && b('bloquear', 'Bloquear', 'mf-btn--ghost'),
      u.status === 'bloqueado' && b('reativar', 'Reativar'),
      <button key="apagar" type="button" className="mf-btn mf-btn--danger" disabled={agindo === u.id}
        onClick={() => { setApagar(u); setDigitado(''); }}>Apagar</button>,
    ].filter(Boolean);
  };

  return (
    <PageShell icon={icone} title="Usuários" subtitle="Aprove cadastros, bloqueie e gerencie quem usa a plataforma" accent="cyan">
      <div style={{ marginBottom: 'var(--mf-4)' }}>
        <Segmentado opcoes={FILTROS} valor={filtro} onChange={v => { setLista(null); setFiltro(v); }} mod="sistema" />
      </div>

      {erro ? (
        <Falha titulo="Não foi possível carregar os usuários" detalhe={erro} onTentar={carregar} />
      ) : lista === null ? (
        <EsqueletoLista itens={4} />
      ) : !lista.length ? (
        <Vazio icone={icone}
          titulo={filtro === 'pendente' ? 'Nenhum cadastro esperando aprovação' : 'Nenhum usuário aqui'}
          descricao={filtro === 'pendente' ? 'Quando alguém pedir acesso pela tela de login, o pedido aparece aqui — e você recebe um aviso.' : ''} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--mf-3)' }}>
          {lista.map(u => {
            const st = STATUS[u.status] || STATUS.recusado;
            return (
              <div key={u.id} className="mf-card" style={{
                display: 'flex', alignItems: 'center', gap: 'var(--mf-3)', flexWrap: 'wrap', padding: 'var(--mf-4)',
              }}>
                <Avatar u={u} />
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--mf-text)', fontSize: 'var(--mf-t-body)' }}>{u.nome || '—'}</strong>
                    <span style={{
                      fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--mf-r-full)',
                      color: st.cor, border: `1px solid color-mix(in oklch, ${st.cor} 35%, transparent)`,
                      background: `color-mix(in oklch, ${st.cor} 10%, transparent)`,
                    }}>{st.rotulo}</span>
                  </div>
                  <div style={{ color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email || '—'}</div>
                  <div style={{ color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>Cadastro: {data(u.criadoEm)}</span>
                    {u.status !== 'pendente' && <span>Último acesso: {data(u.ultimoLogin)}</span>}
                    <span>{u.contas} conta(s) · {u.publicacoes} publicação(ões)</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{botoes(u)}</div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!confirmar}
        title={confirmar?.acao === 'bloquear' ? `Bloquear ${confirmar?.u.nome}?` : `Recusar o cadastro de ${confirmar?.u.nome}?`}
        message={confirmar?.acao === 'bloquear'
          ? 'O acesso é cortado na hora, e os envios e campanhas dele são pausados. Dá para reativar depois.'
          : 'A pessoa não vai conseguir entrar. Se mudar de ideia, dá para aprovar depois.'}
        confirmLabel={confirmar?.acao === 'bloquear' ? 'Bloquear' : 'Recusar'}
        carregando={!!agindo}
        onConfirm={() => agir(confirmar.u, confirmar.acao)}
        onCancel={() => setConfirmar(null)}
      />

      {apagar && (
        <PortalModal>
          <div className="modal-overlay" onClick={() => setApagar(null)}>
          <div className="modal" style={{ width: 'min(440px,100%)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--mf-text)' }}>Apagar {apagar.nome}?</h3>
            <p style={{ margin: '0 0 12px', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', lineHeight: 1.6 }}>
              Sai tudo dele: contas conectadas, envios, campanhas, biblioteca e métricas. <strong>Não tem volta.</strong>
            </p>
            <label style={{ display: 'block', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-xs)', marginBottom: 6 }}>
              Digite <strong style={{ color: 'var(--mf-text)' }}>{apagar.email}</strong> para confirmar
            </label>
            <input value={digitado} onChange={e => setDigitado(e.target.value)} autoFocus
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 'var(--mf-r-md)',
                background: 'var(--mf-border-subtle)', border: '1px solid var(--mf-border)', color: 'var(--mf-text)',
                fontFamily: 'inherit', marginBottom: 'var(--mf-4)',
              }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="mf-btn mf-btn--ghost" onClick={() => setApagar(null)}>Cancelar</button>
              <button type="button" className="mf-btn mf-btn--danger"
                disabled={digitado.trim().toLowerCase() !== apagar.email || agindo === apagar.id}
                onClick={confirmarApagar}>
                Apagar para sempre
              </button>
            </div>
          </div>
          </div>
        </PortalModal>
      )}
    </PageShell>
  );
}
