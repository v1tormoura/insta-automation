import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { toast } from 'sonner';
import { EsqueletoLista } from '../components/Estados';


const EMPTY_FORM = { name: '', appId: '', appSecret: '', loginConfigId: '', instagramAppId: '', instagramAppSecret: '' };

function IcoPlus()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IcoKey()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3M17 6l3 3"/></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoTrash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>; }
function IcoEdit()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IcoCopy()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>; }

function FormField({ label, value, onChange, placeholder, type = 'text', hint, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: .5, textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: 'var(--mf-mod, var(--mf-accent-500))', marginLeft: 3 }}>*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 12px',
          borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)',
          background: 'var(--bg3)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)',
          fontFamily: 'var(--mf-mono)', outline: 'none',
        }}
      />
      {hint && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const cartao = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-lg)', padding: '20px 24px', marginTop: 20 };
const tituloCartao = { fontSize: 'var(--mf-t-body)', fontWeight: 750, color: 'var(--mf-text)', marginBottom: 4 };
const textoCartao = { fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.7 };
const forte = { color: 'var(--mf-text-2)', fontWeight: 650 };
const codigo = { fontFamily: 'var(--mf-code)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-micro)' };

function LinhaCopiar({ rotulo, valor, copiar, copiado }) {
  const feito = copiado === rotulo;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-md)', padding: '8px 12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 2 }}>{rotulo}</div>
        <div style={{ ...codigo, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{valor || '—'}</div>
      </div>
      <button type="button" onClick={() => valor && copiar(valor, rotulo)}
        style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: feito ? 'color-mix(in oklch, var(--mf-success-500) 15%, transparent)' : 'var(--bg2)', color: feito ? 'var(--mf-success-500)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
        {feito ? <><IcoCheck /> Copiado</> : <><IcoCopy /> Copiar</>}
      </button>
    </div>
  );
}

/** Estado do token de cada conta: válido, vencendo, vencido ou sem token. */
function estadoDoToken(c) {
  if (!c.hasApiToken || c.healthStatus === 'token_invalido') return { rotulo: 'Reconectar', cor: 'var(--mf-danger-500)' };
  if (!c.tokenExpiresAt) return { rotulo: 'Válido', cor: 'var(--mf-success-500)' };
  const dias = Math.ceil((new Date(c.tokenExpiresAt) - Date.now()) / 86_400_000);
  if (dias < 0) return { rotulo: 'Vencido', cor: 'var(--mf-danger-500)' };
  if (dias <= 7) return { rotulo: `Vence em ${dias} d`, cor: 'var(--mf-warning-500)' };
  return { rotulo: `Válido · ${dias} d`, cor: 'var(--mf-success-500)' };
}

/* Guia do painel da Meta: endereços para colar, legenda cortada, e o estado
   dos tokens. Os endereços vêm do servidor (/meta-apps/config) — são os que
   ele usa de verdade. */
function GuiaDaMeta({ cfg, copiar, copiado }) {
  const [contas, setContas] = useState(null);
  useEffect(() => {
    api.get('/accounts', { params: { limit: 500 } })
      .then(r => setContas(r.data?.accounts || []))
      .catch(() => setContas([]));
  }, []);
  const dominio = cfg?.dominio || window.location.hostname;
  const site = cfg?.siteUrl || window.location.origin;

  return (
    <>
      <div style={cartao}>
        <div style={tituloCartao}>URL obrigatória no Meta (Invalid redirect_uri)</div>
        <div style={textoCartao}>O Instagram só aceita o login se esta URL estiver salva no <strong style={forte}>seu</strong> app. Cole no lugar certo e clique em Salvar:</div>
        <ol style={{ ...textoCartao, margin: '10px 0 14px', paddingLeft: 20, listStyle: 'decimal' }}>
          <li>Abra <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" style={{ color: 'var(--mf-primary-500)' }}>developers.facebook.com/apps</a> e entre no app</li>
          <li>Instagram → <strong style={forte}>Configuração da API com login do Instagram</strong> → <strong style={forte}>Configurações de login de empresa</strong></li>
          <li>Em <strong style={forte}>URIs de redirecionamento do OAuth</strong>, cole a URL abaixo (exata, sem barra no final)</li>
          <li>Em Configurações → Básico: Domínios do app = <span style={codigo}>{dominio}</span> e URL do site = <span style={codigo}>{site}</span></li>
          <li>Na mesma tela de login de empresa, cole as URLs de desautorização e de exclusão de dados</li>
          <li>Salve e conecte de novo em Contas</li>
        </ol>
        <div style={{ display: 'grid', gap: 8 }}>
          <LinhaCopiar rotulo="OAuth redirect URI (obrigatória)" valor={cfg?.redirectUri} copiar={copiar} copiado={copiado} />
          <LinhaCopiar rotulo="Adicione também (opcional)" valor={cfg?.redirectAlternativa} copiar={copiar} copiado={copiado} />
          <LinhaCopiar rotulo="Desautorização" valor={cfg?.desautorizacao} copiar={copiar} copiado={copiado} />
          <LinhaCopiar rotulo="Exclusão de dados" valor={cfg?.exclusaoDeDados} copiar={copiar} copiado={copiado} />
        </div>
      </div>

      <div style={cartao}>
        <div style={tituloCartao}>Reel sobe sem legenda?</div>
        <div style={textoCartao}>
          O Nexora envia a legenda. Se o vídeo publica e o texto some, o app da Meta ainda está em <strong style={forte}>modo de desenvolvimento</strong> para
          essa permissão — a Meta aceita o vídeo e corta a legenda até o acesso avançado.
        </div>
        <ol style={{ ...textoCartao, margin: '10px 0 8px', paddingLeft: 20, listStyle: 'decimal' }}>
          <li>No app → Revisão do app → Permissões e recursos → <strong style={forte}>instagram_business_content_publish</strong> → <strong style={forte}>Solicitar acesso avançado</strong></li>
          <li>Se o botão estiver cinza: Instagram → Configuração da API com login do Instagram → bloco <strong style={forte}>Concluir a análise do app</strong> → marque essa permissão</li>
          <li>Conclua a verificação da empresa, se a Meta pedir</li>
          <li>Espere o status mudar para <strong style={forte}>Acesso avançado</strong> e o app ficar <strong style={forte}>Live</strong></li>
          <li>Em <a href="/accounts" style={{ color: 'var(--mf-primary-500)' }}>Contas</a>, reconecte a conta aceitando todas as permissões</li>
        </ol>
        <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', lineHeight: 1.6 }}>
          Enquanto o app estiver em desenvolvimento, cada @ precisa estar em Funções do app → Testadores do Instagram, com o convite aceito.
          Reels já publicados sem texto não podem ser editados pela API — apague e publique de novo depois da aprovação.
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 16px', borderRadius: 'var(--mf-r-md)',
        background: 'color-mix(in oklch, var(--mf-mod-publicar) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 24%, transparent)',
        fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', lineHeight: 1.6 }}>
        <span aria-hidden="true" style={{ color: 'var(--mf-mod-publicar)', fontWeight: 800 }}>i</span>
        <span>As conexões são feitas pelo login oficial do Instagram (OAuth), sem senha e sem automação de navegador. Depois de configurar o app, vá em <a href="/accounts" style={{ color: 'var(--mf-primary-500)' }}>Contas</a> e clique em Conectar.</span>
      </div>

      <div style={cartao}>
        <div style={tituloCartao}>Status dos tokens por conta</div>
        {contas === null && <div style={textoCartao}>Carregando…</div>}
        {contas?.length === 0 && <div style={textoCartao}>Nenhuma conta do Instagram conectada ainda.</div>}
        {contas?.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {contas.map(c => {
              const e = estadoDoToken(c);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--mf-r-md)', background: 'var(--bg3)', border: '1px solid var(--border)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: e.cor, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>@{c.username}</span>
                  <span style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: e.cor, whiteSpace: 'nowrap' }}>{e.rotulo}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

export default function ApiMeta() {
  const [apps, setApps]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const [copiedKey, setCopiedKey] = useState('');
  const [doServidor, setDoServidor] = useState(null);

  const loadApps = useCallback(async () => {
    try {
      const res = await api.get('/meta-apps');
      setApps(res.data);
    } catch (err) {
      toast.error('Erro ao carregar apps: ' + (err.response?.data?.error || err.message));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);
  useEffect(() => { api.get('/meta-apps/config').then(r => setDoServidor(r.data)).catch(() => {}); }, []);

  function openNew() { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(app) {
    setEditId(app.id);
    setForm({ name: app.name, appId: app.appId, appSecret: '', loginConfigId: app.loginConfigId || '', instagramAppId: app.instagramAppId || '', instagramAppSecret: '' });
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditId(null); setForm(EMPTY_FORM); }

  async function saveForm() {
    if (!form.name.trim() || !form.appId.trim()) return toast.error('Nome e App ID são obrigatórios');
    if (!editId && !form.appSecret.trim()) return toast.error('App Secret é obrigatório');
    setSaving(true);
    try {
      if (editId) {
        await api.patch(`/meta-apps/${editId}`, form);
        toast.success('App atualizado!');
      } else {
        await api.post('/meta-apps', form);
        toast.success('App criado!');
      }
      closeForm();
      loadApps();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  }

  async function setDefault(id) {
    try {
      await api.post(`/meta-apps/${id}/set-default`);
      toast.success('App padrão alterado');
      loadApps();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
  }

  async function deleteApp(id, name) {
    if (!confirm(`Remover app "${name}"? Contas já conectadas continuam funcionando.`)) return;
    setDeleting(id);
    try {
      await api.delete(`/meta-apps/${id}`);
      toast.success('App removido');
      loadApps();
    } catch (err) { toast.error(err.response?.data?.error || err.message); }
    finally { setDeleting(null); }
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(''), 2000);
  }


  return (
    <PageShell
      icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--mf-mod-publicar)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1"/></svg>}
      title="API Meta"
      subtitle="Apps Meta"
      accent="purple"
      actions={
        <button
          onClick={openNew}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 'var(--mf-r-md)', border: 'none', background: 'var(--mf-mod-publicar)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: 'pointer' }}
        >
          <IcoPlus /> Adicionar App
        </button>
      }
    >

      {/* ── Lista de apps ───────────────────────────────────── */}
      <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 800, color: 'var(--mf-text-3)', letterSpacing: 1, marginBottom: 12, textTransform: 'uppercase' }}>
        Apps configurados
      </div>

      {loading && (
        <EsqueletoLista itens={3} />
      )}

      {!loading && apps.length === 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '48px 24px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-lg)' }}>
          <div style={{ fontSize: 'var(--mf-t-display)', marginBottom: 12 }}>🔑</div>
          <div style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 6 }}>Nenhum app configurado</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', color: 'var(--mf-text-3)', marginBottom: 20 }}>Adicione pelo menos um app Meta para usar o fluxo OAuth.</div>
          <button onClick={openNew} style={{ padding: '8px 24px', borderRadius: 'var(--mf-r-md)', border: 'none', background: 'var(--mf-mod-publicar)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: 'pointer' }}>Adicionar primeiro app</button>
        </motion.div>
      )}

      {!loading && apps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apps.map((app, i) => (
            <motion.div key={app.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
              <div style={{
                background: 'var(--card)', border: `1px solid ${app.isDefault ? 'color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)' : 'var(--border)'}`,
                borderRadius: 'var(--mf-r-lg)', padding: '16px 16px',
                boxShadow: app.isDefault ? '0 0 0 1px color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  {/* icon */}
                  <div style={{ width: 40, height: 40, borderRadius: 'var(--mf-r-md)', background: app.isDefault ? 'color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)' : 'var(--bg3)', border: `1px solid ${app.isDefault ? 'color-mix(in oklch, var(--mf-mod-publicar) 30%, transparent)' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <IcoKey />
                  </div>

                  {/* info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--mf-t-h2)', fontWeight: 700, color: 'var(--mf-text)' }}>{app.name}</span>
                      {app.isDefault && (
                        <span style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--mf-r-xl)', background: 'color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)', color: 'var(--mf-mod-publicar)', letterSpacing: .5 }}>PADRÃO</span>
                      )}
                      {/* Quantas contas este app carrega. Reputação de app é
                          real — quando várias contas do mesmo app caem, as
                          outras daquele app sentem. Ver a distribuição é o que
                          permite equilibrar antes de concentrar demais. */}
                      <span title="Contas conectadas por este app" style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--mf-r-xl)', fontFamily: 'var(--mf-mono)', background: 'var(--mf-surface-2)', border: '1px solid var(--mf-border)', color: 'var(--mf-text-2)' }}>
                        {app.contas || 0} conta{app.contas === 1 ? '' : 's'}
                      </span>
                      {app.comProblema > 0 && (
                        <span title="Contas deste app com sessão expirada, token inválido, restrita ou banida"
                          style={{ fontSize: 'var(--mf-t-nano)', fontWeight: 700, padding: '2px 9px', borderRadius: 'var(--mf-r-xl)', fontFamily: 'var(--mf-mono)', background: 'color-mix(in oklch, var(--mf-danger-500) 12%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', color: 'var(--mf-danger-500)' }}>
                          {app.comProblema} com problema
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                        App ID: <code style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)' }}>{app.appId}</code>
                      </span>
                      {app.instagramAppId && (
                        <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                          IG App ID: <code style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-mod, var(--mf-accent-500))' }}>{app.instagramAppId}</code>
                        </span>
                      )}
                      {app.clientIdDoLogin && (
                        <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                          Login usa: <code style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)' }}>{app.clientIdDoLogin}</code>
                        </span>
                      )}
                      {app.loginConfigId && (
                        <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                          Login Config: <code style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)' }}>{app.loginConfigId}</code>
                        </span>
                      )}
                    </div>
                    {/* Id do Instagram sem o segredo: o login cai no id do
                        Facebook, e o Instagram recusa com "Invalid redirect_uri". */}
                    {app.igSemSegredo && (
                      <div style={{ marginTop: 8, fontSize: 'var(--mf-t-micro)', color: 'var(--mf-warning-500)', lineHeight: 1.6 }}>
                        Falta o <strong>Instagram App Secret</strong>: sem ele o login usa o App ID do Facebook e o Instagram recusa. Edite e preencha.
                      </div>
                    )}
                  </div>

                  {/* actions */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                    {!app.isDefault && (
                      <button
                        onClick={() => setDefault(app.id)}
                        style={{ padding: '4px 12px', borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 35%, transparent)', background: 'color-mix(in oklch, var(--mf-mod-publicar) 8%, transparent)', color: 'var(--mf-mod-publicar)', fontSize: 'var(--mf-t-micro)', fontWeight: 700, cursor: 'pointer' }}
                      >
                        Usar como padrão
                      </button>
                    )}
                    <button
                      onClick={() => openEdit(app)}
                      style={{ width: 32, height: 32, borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--mf-text-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="Editar"
                    >
                      <IcoEdit />
                    </button>
                    <button
                      onClick={() => deleteApp(app.id, app.name)}
                      disabled={deleting === app.id}
                      style={{ width: 32, height: 32, borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', background: 'color-mix(in oklch, var(--mf-danger-500) 6%, transparent)', color: 'var(--mf-danger-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: deleting === app.id ? .5 : 1 }}
                      title="Remover"
                    >
                      <IcoTrash />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── Dica sobre múltiplos apps ─── */}
      {!loading && apps.length > 0 && (
        <div style={{ marginTop: 20, background: 'color-mix(in oklch, var(--mf-mod-publicar) 6%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)', borderRadius: 'var(--mf-r-md)', padding: '12px 16px', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--mf-text-2)' }}>Como usar múltiplos apps:</strong> O app marcado como <strong>Padrão</strong> é usado automaticamente no fluxo OAuth. Ao conectar uma conta em <strong>Contas</strong>, você pode escolher qual app usar no dropdown que aparece no modal de conexão.
        </div>
      )}

      <GuiaDaMeta cfg={doServidor} copiar={copy} copiado={copiedKey} />

      {/* ── Modal: Criar / Editar ──────────────────────────────
          Renderizado por PORTAL no <body> (com `data-mf` para os tokens
          resolverem): escapa do `isolation: isolate` do `.mf-app` e de qualquer
          contêiner de rolagem do PageShell, que era o que deixava tudo bugado
          ao abrir. Estilos explícitos (fixed/centralizado/rolável) em vez de
          depender do cascade das classes .modal, que aqui vinha sem padding e
          sem scroll próprio. */}
      {showForm && createPortal(
        <div data-mf onClick={closeForm}
          style={{ position: 'fixed', inset: 0, zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
            background: 'var(--mf-overlay, oklch(0.10 0.03 259 / 0.82))', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 'min(540px,100%)', maxHeight: '88vh', overflowY: 'auto',
              background: 'var(--mf-surface-1)', border: '1px solid var(--mf-border)', borderRadius: 'var(--mf-r-lg)',
              boxShadow: 'var(--mf-shadow-3)', padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>{editId ? 'Editar App' : 'Novo App Meta'}</h3>
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 3 }}>Credenciais do painel Meta Developers</div>
              </div>
              <button onClick={closeForm} style={{ background: 'none', border: 'none', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <FormField label="Nome do App" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: App Principal, App Backup, App KaiikyFlow..." required />
            <FormField label="Meta App ID" value={form.appId} onChange={v => setForm(f => ({ ...f, appId: v }))} placeholder="Ex: 1234567890123456" required hint="developers.facebook.com → Seu App → Configurações → Básico → App ID" />
            <FormField label={editId ? 'Meta App Secret (deixe vazio para não alterar)' : 'Meta App Secret'} value={form.appSecret} onChange={v => setForm(f => ({ ...f, appSecret: v }))} placeholder="••••••••••••••••" type="password" required={!editId} hint="developers.facebook.com → Configurações → Básico → App Secret → Mostrar" />

            <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
            <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: .5, marginBottom: 14, textTransform: 'uppercase' }}>Campos opcionais</div>

            <FormField label="Instagram App ID (sub-app separado)" value={form.instagramAppId} onChange={v => setForm(f => ({ ...f, instagramAppId: v }))} placeholder="Ex: 9876543210987654" hint="Se você tem um sub-app exclusivo para Instagram Business Login" />
            <FormField label={editId ? 'Instagram App Secret (deixe vazio para não alterar)' : 'Instagram App Secret'} value={form.instagramAppSecret} onChange={v => setForm(f => ({ ...f, instagramAppSecret: v }))} placeholder="••••••••••••••••" type="password" />
            <FormField label="Meta Login Config ID (opcional)" value={form.loginConfigId} onChange={v => setForm(f => ({ ...f, loginConfigId: v }))} placeholder="deixe vazio para login padrão" hint="Apenas necessário se você criou uma configuração de login customizada" />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={closeForm} style={{ padding: '8px 16px', borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button
                onClick={saveForm}
                disabled={saving}
                style={{ padding: '8px 24px', borderRadius: 'var(--mf-r-md)', border: 'none', background: 'var(--mf-mod-publicar)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                {saving ? <><span style={{ width:14, height:14, border:'2px solid var(--mf-border-strong)', borderTopColor:'var(--mf-text)', borderRadius: 'var(--mf-r-full)', display:'inline-block', animation:'spin .7s linear infinite' }} /> Salvando...</> : `${editId ? 'Salvar alterações' : 'Criar app'}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </PageShell>
  );
}
