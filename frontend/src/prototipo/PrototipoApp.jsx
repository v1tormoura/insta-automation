/**
 * PROTÓTIPO — casca de navegação do redesign.
 *
 * Isolado por completo: rota própria, CSS sob [data-mf], dados fictícios,
 * nenhuma chamada de rede. Nada aqui importa store, serviço ou model do
 * sistema real, e o sistema real não importa nada daqui.
 *
 * Navegação por estado local em vez de rota: assim o protótipo não interfere
 * no roteador da aplicação e continua um único ponto de entrada.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeft, Search, Menu, Bell, Check } from 'lucide-react';

import './tokens.css';
import './prototipo.css';
import { TELAS } from './telas';
import { MODULOS } from './dados';

/* Agrupamento por INTENÇÃO, não por ordem de implementação. A barra atual tem
   6 grupos e 27 itens, com "Contas" e "Saúde" dentro de CONFIGURAÇÃO — coisas
   que se usa todo dia escondidas atrás de um rótulo de ajuste. */
const GRUPOS = [
  { titulo: 'Principal', itens: ['dashboard'] },
  { titulo: 'Operação',  itens: ['contas', 'publicar', 'campanhas', 'jobs'] },
  { titulo: 'Analytics', itens: ['metricas'] },
  { titulo: 'Sistema',   itens: ['config'] },
];

export default function PrototipoApp() {
  const [tela, setTela]           = useState('dashboard');
  const [recolhida, setRecolhida] = useState(false);
  const [gaveta, setGaveta]       = useState(false);
  const [paleta, setPaleta]       = useState(false);
  const [avisos, setAvisos]       = useState([]);

  const Atual = TELAS[tela].Comp;

  /* Ctrl/Cmd+K abre a paleta em qualquer lugar. Esc fecha o que estiver aberto
     — é o reflexo que todo mundo tem, e não atendê-lo faz a interface parecer
     presa. */
  useEffect(() => {
    const aoTeclar = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaleta(p => !p);
      }
      if (e.key === 'Escape') { setPaleta(false); setGaveta(false); }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, []);

  const irPara = (id) => {
    setTela(id);
    setGaveta(false);
    setPaleta(false);
  };

  const avisar = (titulo, descricao, tom = 'primary') => {
    const id = Date.now();
    setAvisos(a => [...a, { id, titulo, descricao, tom }]);
    setTimeout(() => setAvisos(a => a.filter(x => x.id !== id)), 4000);
  };

  return (
    <div data-mf>
      <div className="mf-app" data-collapsed={recolhida} data-drawer={gaveta}>

        {gaveta && <div className="mf-scrim" onClick={() => setGaveta(false)} aria-hidden="true" />}

        {/* ── Barra lateral ── */}
        <aside className="mf-side" aria-label="Navegação principal">
          <div className="mf-side__brand">
            <div className="mf-side__mark">MF</div>
            <span className="mf-side__name">MouraFlow</span>
          </div>

          <nav className="mf-side__nav">
            {GRUPOS.map(g => (
              <div key={g.titulo} className="mf-side__group">
                <div className="mf-side__label">{g.titulo}</div>
                {g.itens.map(id => {
                  const t = TELAS[id];
                  const Icone = t.icone;
                  return (
                    <button key={id} className="mf-nav-item"
                      style={{ '--mf-mod': MODULOS[t.modulo] }}
                      aria-current={tela === id ? 'page' : undefined}
                      title={recolhida ? t.titulo : undefined}
                      onClick={() => irPara(id)}>
                      <Icone className="mf-nav-item__ico" size={18} />
                      <span className="mf-nav-item__txt">
                        <span className="mf-nav-item__t">{t.titulo}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div style={{ padding: 'var(--mf-3)', borderTop: '1px solid var(--mf-border)' }}>
            <button className="mf-nav-item" onClick={() => setRecolhida(r => !r)}>
              {recolhida ? <PanelLeft className="mf-nav-item__ico" size={18} />
                         : <PanelLeftClose className="mf-nav-item__ico" size={18} />}
              <span className="mf-nav-item__txt"><span className="mf-nav-item__t">Recolher</span></span>
            </button>
          </div>
        </aside>

        {/* ── Área principal ── */}
        <div className="mf-main">
          <header className="mf-top">
            <button className="mf-btn mf-btn--ghost mf-btn--icon mf-only-mobile"
              onClick={() => setGaveta(true)} aria-label="Abrir menu">
              <Menu size={18} />
            </button>

            <button className="mf-cmd-trigger" onClick={() => setPaleta(true)}
              style={{ width: 'min(280px, 42vw)' }}>
              <Search size={14} />
              <span className="mf-trunc" style={{ flex: 1, textAlign: 'left' }}>Buscar…</span>
              <kbd className="mf-kbd">Ctrl K</kbd>
            </button>

            <div className="mf-top__spacer" />

            <button className="mf-btn mf-btn--ghost mf-btn--icon"
              onClick={() => avisar('Publicação concluída', 'Reel enviado para 3 contas.', 'success')}
              aria-label="Notificações">
              <Bell size={17} />
            </button>
            <div style={{
              width: 30, height: 30, borderRadius: 'var(--mf-r-full)',
              background: 'linear-gradient(135deg, var(--mf-primary-500), var(--mf-accent-500))',
              display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
              color: 'var(--mf-primary-fg)', flexShrink: 0,
            }}>VM</div>
          </header>

          <main className="mf-container" style={{ flex: 1, paddingBottom: 'var(--mf-10)' }}>
            <Atual />
          </main>
        </div>
      </div>

      {paleta && <Paleta aoEscolher={irPara} aoFechar={() => setPaleta(false)} />}

      <div className="mf-toasts">
        {avisos.map(a => (
          <div key={a.id} className="mf-toast" style={{ '--mf-tone': `var(--mf-${a.tom}-500)` }} role="status">
            <Check size={16} style={{ color: `var(--mf-${a.tom}-500)`, flexShrink: 0, marginTop: 2 }} />
            <div style={{ minWidth: 0 }}>
              <div className="mf-toast__t">{a.titulo}</div>
              <div className="mf-toast__d">{a.descricao}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Paleta de comandos ────────────────────────────────────────────────────
   Construída sobre o que já existe no projeto. `cmdk` resolveria isso, mas
   são ~40 linhas para navegar por teclado numa lista filtrada — não vale uma
   dependência a mais no bundle. */
function Paleta({ aoEscolher, aoFechar }) {
  const [busca, setBusca] = useState('');
  const [ativo, setAtivo] = useState(0);
  const campoRef = useRef(null);

  useEffect(() => { campoRef.current?.focus(); }, []);

  const itens = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return Object.entries(TELAS)
      .map(([id, t]) => ({ id, ...t }))
      .filter(t => !termo || t.titulo.toLowerCase().includes(termo));
  }, [busca]);

  useEffect(() => { setAtivo(0); }, [busca]);

  const aoTeclar = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo(i => Math.min(itens.length - 1, i + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setAtivo(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter' && itens[ativo]) aoEscolher(itens[ativo].id);
  };

  return (
    <div className="mf-cmd-backdrop" onClick={e => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div className="mf-cmd" role="dialog" aria-modal="true" aria-label="Paleta de comandos">
        <input ref={campoRef} className="mf-cmd__input" placeholder="Ir para, buscar conta, iniciar ação…"
          value={busca} onChange={e => setBusca(e.target.value)} onKeyDown={aoTeclar} />
        <div className="mf-cmd__list">
          <div className="mf-cmd__group">Navegar</div>
          {itens.map((t, i) => {
            const Icone = t.icone;
            return (
              <button key={t.id} className="mf-cmd__item" data-active={i === ativo}
                style={{ '--mf-mod': MODULOS[t.modulo] }}
                onMouseEnter={() => setAtivo(i)} onClick={() => aoEscolher(t.id)}>
                <Icone className="mf-nav-item__ico" size={16} />
                <span className="mf-trunc" style={{ flex: 1 }}>{t.titulo}</span>
                {i === ativo && <kbd className="mf-kbd">↵</kbd>}
              </button>
            );
          })}
          {itens.length === 0 && (
            <div style={{ padding: 'var(--mf-6)', textAlign: 'center', color: 'var(--mf-text-3)', fontSize: 'var(--mf-t-sm)' }}>
              Nada encontrado para “{busca}”.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
