import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History, LogIn, ShieldAlert, ShieldCheck, Monitor, Smartphone } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { isAdmin } from '../services/auth';
import { EsqueletoLista, Vazio, Falha } from '../components/Estados';

/**
 * Atividade — quem fez o quê, quando e de onde. Cada um vê o próprio; o admin
 * vê todos e filtra por pessoa (o botão "Atividade" em Usuários abre aqui).
 * Logins recusados ficam em vermelho: é o que mostra alguém tentando entrar.
 */

const quando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const diaDe = d => new Date(d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

function aparelho(ua = '') {
  const celular = /Mobile|Android|iPhone|iPad/i.test(ua);
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  const so = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return { celular, texto: [nav, so].filter(Boolean).join(' · ') || (ua ? ua.slice(0, 40) : '') };
}

function tom(acao) {
  if (/errad|Tentativa/i.test(acao)) return { cor: 'var(--mf-danger-500)', Icone: ShieldAlert };
  if (/^Entrou/.test(acao)) return { cor: 'var(--mf-success-500)', Icone: LogIn };
  if (/dois fatores|reserva/i.test(acao)) return { cor: 'var(--mf-primary-500)', Icone: ShieldCheck };
  return { cor: 'var(--mf-text-3)', Icone: History };
}

export default function Atividade() {
  const admin = isAdmin();
  const [params, setParams] = useSearchParams();
  const usuario = params.get('usuario') || '';
  const [itens, setItens] = useState(null);
  const [fim, setFim] = useState(false);
  const [erro, setErro] = useState('');
  const [retencao, setRetencao] = useState(90);
  const [pessoas, setPessoas] = useState([]);
  const [soLogins, setSoLogins] = useState(false);

  const buscar = useCallback(async (antesDe = null) => {
    const { data } = await api.get('/atividade', { params: { usuario: usuario || undefined, antesDe: antesDe || undefined, limite: 100 } });
    setRetencao(data.retencaoDias);
    setFim(data.itens.length < 100);
    return data.itens;
  }, [usuario]);

  useEffect(() => {
    setItens(null);
    buscar().then(setItens).catch(e => setErro(e.response?.data?.error || e.message));
  }, [buscar]);

  useEffect(() => {
    if (admin) api.get('/usuarios').then(r => setPessoas(r.data.usuarios || [])).catch(() => {});
  }, [admin]);

  const mais = async () => {
    const ultimo = itens?.[itens.length - 1];
    if (ultimo) setItens([...itens, ...(await buscar(ultimo.id))]);
  };

  const visiveis = useMemo(() => (itens || []).filter(i => !soLogins || /Entrou|login|Tentativa/i.test(i.acao)), [itens, soLogins]);
  const grupos = useMemo(() => {
    const g = [];
    for (const i of visiveis) {
      const d = diaDe(i.quando);
      if (!g.length || g[g.length - 1].dia !== d) g.push({ dia: d, itens: [] });
      g[g.length - 1].itens.push(i);
    }
    return g;
  }, [visiveis]);

  return (
    <PageShell icon={<History size={18} />} title="Atividade" subtitle={`Logins e ações ${admin ? 'de cada usuário' : 'da sua conta'} — últimos ${retencao} dias`}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 'var(--mf-4)' }}>
        {admin && (
          <select className="inp" style={{ maxWidth: 280 }} value={usuario} data-filtro-usuario
            onChange={e => setParams(e.target.value ? { usuario: e.target.value } : {})}>
            <option value="">Todos os usuários</option>
            {pessoas.map(p => <option key={p.id} value={p.id}>{p.nome}{p.email ? ` — ${p.email}` : ''}</option>)}
          </select>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={soLogins} onChange={e => setSoLogins(e.target.checked)} /> Só logins
        </label>
      </div>

      {erro && <Falha descricao={erro} />}
      {!erro && !itens && <EsqueletoLista itens={6} />}
      {itens && !visiveis.length && <Vazio icone={<History size={22} />} titulo="Nada registrado ainda" descricao="Logins e ações aparecem aqui conforme acontecem." />}

      <div style={{ display: 'grid', gap: 'var(--mf-4)' }} data-atividade>
        {grupos.map(g => (
          <section key={g.dia} className="mf-card" style={{ padding: 'var(--mf-3) var(--mf-4)' }}>
            <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--mf-text-3)', marginBottom: 6 }}>{g.dia}</div>
            {g.itens.map(i => {
              const { cor, Icone } = tom(i.acao);
              const ap = aparelho(i.aparelho);
              return (
                <div key={i.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderTop: '1px solid var(--mf-border)' }}>
                  <Icone size={15} style={{ color: cor, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 650, color: cor === 'var(--mf-text-3)' ? 'var(--mf-text)' : cor }}>{i.acao}</div>
                    <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {admin && !usuario && i.usuario && <span style={{ color: 'var(--mf-text-2)', fontWeight: 600 }}>{i.usuario.nome || i.usuario.email || (i.usuario.papel === 'admin' ? 'Administrador' : '—')}</span>}
                      {i.ip && <span>IP {i.ip}</span>}
                      {ap.texto && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>{ap.celular ? <Smartphone size={11} /> : <Monitor size={11} />}{ap.texto}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{quando(i.quando)}</span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {itens && !fim && (
        <div style={{ textAlign: 'center', marginTop: 'var(--mf-4)' }}>
          <button className="btn btn-ghost" onClick={mais}>Carregar mais</button>
        </div>
      )}
    </PageShell>
  );
}
