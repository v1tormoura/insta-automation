import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldOff, Copy, Download, KeyRound, History } from 'lucide-react';
import api from '../services/api';

/**
 * Minha Conta → Login em dois fatores.
 *
 * Desligado → "Ligar" mostra o QR; a pessoa lê no app e digita o 1º código;
 * só então liga, e aparecem os 8 códigos de reserva (uma vez só — a tela diz).
 * Ligado → códigos de reserva novos, ou desligar (senha + código).
 */

const pequeno = { fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', lineHeight: 1.65 };
const erroDe = e => e.response?.data?.error || e.message;

export default function DoisFatores({ aviso }) {
  const [estado, setEstado] = useState(null);
  const [config, setConfig] = useState(null);     // { qr, segredo } enquanto liga
  const [codigos, setCodigos] = useState(null);   // reserva recém-gerada
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [desligando, setDesligando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { api.get('/conta/2fa').then(r => setEstado(r.data)).catch(() => {}); }, []);

  const chamar = async (fn) => {
    setOcupado(true);
    try { await fn(); } catch (e) { aviso('error', 'Não deu certo', erroDe(e)); } finally { setOcupado(false); }
  };

  const iniciar = () => chamar(async () => {
    const r = await api.post('/conta/2fa/iniciar');
    setConfig(r.data); setCodigo('');
  });
  const ativar = () => chamar(async () => {
    const r = await api.post('/conta/2fa/ativar', { codigo });
    const { codigos: c, ...resto } = r.data;
    setEstado(resto); setCodigos(c); setConfig(null); setCodigo('');
    aviso('success', 'Dois fatores ligado', 'Guarde os códigos de reserva.');
  });
  const desativar = () => chamar(async () => {
    const r = await api.post('/conta/2fa/desativar', { senha, codigo });
    setEstado(r.data); setDesligando(false); setSenha(''); setCodigo(''); setCodigos(null);
    aviso('success', 'Dois fatores desligado', '');
  });
  const novaReserva = () => chamar(async () => {
    const r = await api.post('/conta/2fa/reserva', { codigo });
    const { codigos: c, ...resto } = r.data;
    setEstado(resto); setCodigos(c); setCodigo('');
  });

  const texto = codigos ? `Códigos de reserva — Nexora\n${codigos.join('\n')}\n\nCada um vale uma vez.` : '';
  const copiar = () => navigator.clipboard?.writeText(texto).then(() => aviso('success', 'Copiado', ''));
  const baixar = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    a.download = 'nexora-codigos-de-reserva.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (!estado) return <div style={pequeno}>Carregando…</div>;

  const campoCodigo = (
    <input className="inp" inputMode="numeric" autoComplete="one-time-code" placeholder="Código de 6 dígitos"
      value={codigo} onChange={e => setCodigo(e.target.value)} maxLength={12} data-codigo-2fa />
  );

  return (
    <div data-dois-fatores style={{ display: 'grid', gap: 'var(--mf-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {estado.ativo
          ? <ShieldCheck size={16} style={{ color: 'var(--mf-success-500)' }} />
          : <ShieldOff size={16} style={{ color: 'var(--mf-text-3)' }} />}
        <span style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>
          {estado.ativo ? 'Ligado' : 'Desligado'}
        </span>
        {estado.ativo && (
          <span style={pequeno}>· {estado.reservaRestante} código(s) de reserva sobrando</span>
        )}
      </div>
      <div style={pequeno}>
        Além da senha, o login pede o código de 6 dígitos do app autenticador do celular (Google Authenticator,
        Authy, 1Password…). Quem descobrir sua senha não entra sem o seu celular.
      </div>

      {codigos && (
        <div data-codigos-reserva style={{ padding: 'var(--mf-3)', borderRadius: 'var(--mf-r-md)',
          background: 'color-mix(in oklch, var(--mf-warning-500) 8%, transparent)',
          border: '1px solid color-mix(in oklch, var(--mf-warning-500) 26%, transparent)' }}>
          <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, color: 'var(--mf-warning-500)', marginBottom: 6 }}>
            Guarde estes códigos agora — eles não aparecem de novo
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4,
            fontFamily: 'var(--mf-mono)', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)' }}>
            {codigos.map(c => <span key={c}>{c}</span>)}
          </div>
          <div style={{ ...pequeno, marginTop: 6 }}>Se perder o celular, cada um entra uma vez no lugar do código do app.</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={copiar}><Copy size={12} /> Copiar</button>
            <button className="btn btn-ghost btn-sm" onClick={baixar}><Download size={12} /> Baixar .txt</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCodigos(null)}>Já guardei</button>
          </div>
        </div>
      )}

      {!estado.ativo && !config && (
        <button className="btn-primary" onClick={iniciar} disabled={ocupado}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <ShieldCheck size={13} /> Ligar dois fatores
        </button>
      )}

      {config && (
        <div style={{ display: 'grid', gap: 'var(--mf-2)' }}>
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>
            1. No app autenticador, toque em <b>+</b> e leia o QR code:
          </div>
          <img src={config.qr} alt="QR code do dois fatores" width={180} height={180}
            style={{ borderRadius: 'var(--mf-r-sm)', background: '#fff', padding: 6, justifySelf: 'start' }} />
          <div style={pequeno}>
            Não dá para ler? Digite a chave: <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{config.segredo}</code>
          </div>
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)' }}>2. Digite o código que o app mostra:</div>
          {campoCodigo}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-primary" onClick={ativar} disabled={ocupado || codigo.replace(/\D/g, '').length !== 6} style={{ flex: 1 }}>
              Confirmar e ligar
            </button>
            <button className="btn btn-ghost" onClick={() => setConfig(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {estado.ativo && !desligando && (
        <div style={{ display: 'grid', gap: 6 }}>
          {campoCodigo}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost btn-sm" onClick={novaReserva} disabled={ocupado || !codigo}>
              <KeyRound size={12} /> Gerar códigos de reserva novos
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDesligando(true)} style={{ color: 'var(--mf-danger-500)' }}>
              <ShieldOff size={12} /> Desligar
            </button>
          </div>
          <div style={pequeno}>Para gerar códigos novos, digite o código atual do app.</div>
        </div>
      )}

      {estado.ativo && desligando && (
        <div style={{ display: 'grid', gap: 6 }}>
          <input className="inp" type="password" autoComplete="current-password" placeholder="Sua senha"
            value={senha} onChange={e => setSenha(e.target.value)} />
          {campoCodigo}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn-primary" onClick={desativar} disabled={ocupado || !senha || !codigo}
              style={{ flex: 1, background: 'var(--mf-danger-500)' }}>Desligar dois fatores</button>
            <button className="btn btn-ghost" onClick={() => setDesligando(false)}>Cancelar</button>
          </div>
          <div style={pequeno}>Vale o código do app ou um de reserva.</div>
        </div>
      )}

      <Link to="/atividade" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4,
        fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-primary-500)', textDecoration: 'none' }}>
        <History size={13} /> Ver a atividade da conta (logins e ações)
      </Link>
    </div>
  );
}
