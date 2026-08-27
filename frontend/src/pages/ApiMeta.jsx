import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { toast } from 'sonner';
import { EsqueletoLista } from '../components/Estados';

const REDIRECT_URI = `${window.location.protocol}//${window.location.hostname}:5200/oauth-callback`;
const BACKEND_URL  = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const EMPTY_FORM = { name: '', appId: '', appSecret: '', loginConfigId: '', instagramAppId: '', instagramAppSecret: '' };

function IcoPlus()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>; }
function IcoKey()   { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3M17 6l3 3"/></svg>; }
function IcoCheck() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>; }
function IcoTrash() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>; }
function IcoEdit()  { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>; }
function IcoCopy()  { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>; }

function copyText(text, label) {
  navigator.clipboard.writeText(text);
  toast.success(`${label} copiado!`);
}

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
          width: '100%', boxSizing: 'border-box', padding: '9px 12px',
          borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)',
          background: 'var(--bg3)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)',
          fontFamily: 'var(--mf-mono)', outline: 'none',
        }}
      />
      {hint && <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 4 }}>{hint}</div>}
    </div>
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

  const loadApps = useCallback(async () => {
    try {
      const res = await api.get('/meta-apps');
      setApps(res.data);
    } catch (err) {
      toast.error('Erro ao carregar apps: ' + (err.response?.data?.error || err.message));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadApps(); }, [loadApps]);

  function openNew() { setEditId(null); setForm(EMPTY_FORM); setShowForm(true); }
  function openEdit(app) {
    setEditId(app._id);
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

  const configRows = [
    { label: 'Redirect URI principal',       value: `${BACKEND_URL}/api/oauth/callback` },
    { label: 'Redirect URI alternativa',     value: `${window.location.protocol}//${window.location.hostname === 'localhost' ? 'localhost:5200' : window.location.host}/oauth-callback` },
    { label: 'Site URL / App Domains',       value: window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname },
  ];

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

      {/* ── Configuração para o painel Meta ─────────────────── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }}>
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-lg)', padding: '20px 22px', marginBottom: 24 }}>
          <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 800, color: 'var(--mf-mod-publicar)', letterSpacing: 1, marginBottom: 4, textTransform: 'uppercase' }}>Configuração do App Meta</div>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 4 }}>Copie esses valores no painel Meta Developers</div>
          <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginBottom: 16 }}>
            Em <strong style={{ color: 'var(--mf-text-2)' }}>developers.facebook.com → Seu App → Configurações → Básico / OAuth</strong>, use os valores abaixo.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {configRows.map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--mf-r-md)', padding: '10px 14px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 'var(--mf-t-xs)', fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
                </div>
                <button
                  onClick={() => copy(value, label)}
                  style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 'var(--mf-r-sm)', border: '1px solid var(--border)', background: copiedKey === label ? 'color-mix(in oklch, var(--mf-success-500) 15%, transparent)' : 'var(--bg2)', color: copiedKey === label ? 'var(--mf-success-500)' : 'var(--mf-text-3)', fontSize: 'var(--mf-t-micro)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, transition: 'all var(--mf-normal) var(--mf-ease-out)' }}
                >
                  {copiedKey === label ? <><IcoCheck /> Copiado</> : <><IcoCopy /> Copiar</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

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
          <button onClick={openNew} style={{ padding: '10px 22px', borderRadius: 'var(--mf-r-md)', border: 'none', background: 'var(--mf-mod-publicar)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: 'pointer' }}>Adicionar primeiro app</button>
        </motion.div>
      )}

      {!loading && apps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apps.map((app, i) => (
            <motion.div key={app._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}>
              <div style={{
                background: 'var(--card)', border: `1px solid ${app.isDefault ? 'color-mix(in oklch, var(--mf-mod-publicar) 40%, transparent)' : 'var(--border)'}`,
                borderRadius: 'var(--mf-r-lg)', padding: '18px 20px',
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
                      {app.loginConfigId && (
                        <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)' }}>
                          Login Config: <code style={{ fontFamily: 'var(--mf-mono)', color: 'var(--mf-text-2)' }}>{app.loginConfigId}</code>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* actions */}
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>
                    {!app.isDefault && (
                      <button
                        onClick={() => setDefault(app._id)}
                        style={{ padding: '6px 12px', borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 35%, transparent)', background: 'color-mix(in oklch, var(--mf-mod-publicar) 8%, transparent)', color: 'var(--mf-mod-publicar)', fontSize: 'var(--mf-t-micro)', fontWeight: 700, cursor: 'pointer' }}
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
                      onClick={() => deleteApp(app._id, app.name)}
                      disabled={deleting === app._id}
                      style={{ width: 32, height: 32, borderRadius: 'var(--mf-r-sm)', border: '1px solid color-mix(in oklch, var(--mf-danger-500) 30%, transparent)', background: 'color-mix(in oklch, var(--mf-danger-500) 6%, transparent)', color: 'var(--mf-danger-500)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: deleting === app._id ? .5 : 1 }}
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
        <div style={{ marginTop: 20, background: 'color-mix(in oklch, var(--mf-mod-publicar) 6%, transparent)', border: '1px solid color-mix(in oklch, var(--mf-mod-publicar) 15%, transparent)', borderRadius: 'var(--mf-r-md)', padding: '14px 16px', fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--mf-text-2)' }}>Como usar múltiplos apps:</strong> O app marcado como <strong>Padrão</strong> é usado automaticamente no fluxo OAuth. Ao conectar uma conta em <strong>Contas</strong>, você pode escolher qual app usar no dropdown que aparece no modal de conexão.
        </div>
      )}

      {/* ── Modal: Criar / Editar ────────────────────────────── */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 'min(540px,100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0 }}>{editId ? 'Editar App' : 'Novo App Meta'}</h3>
                <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)', marginTop: 3 }}>Credenciais do painel Meta Developers</div>
              </div>
              <button onClick={closeForm} style={{ background: 'none', border: 'none', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-h1)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <FormField label="Nome do App" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Ex: App Principal, App Backup, App KaiikyFlow..." required />
            <FormField label="Meta App ID" value={form.appId} onChange={v => setForm(f => ({ ...f, appId: v }))} placeholder="1611952840654185" required hint="developers.facebook.com → Seu App → Configurações → Básico → App ID" />
            <FormField label={editId ? 'Meta App Secret (deixe vazio para não alterar)' : 'Meta App Secret'} value={form.appSecret} onChange={v => setForm(f => ({ ...f, appSecret: v }))} placeholder="••••••••••••••••" type="password" required={!editId} hint="developers.facebook.com → Configurações → Básico → App Secret → Mostrar" />

            <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0' }} />
            <div style={{ fontSize: 'var(--mf-t-micro)', fontWeight: 700, color: 'var(--mf-text-3)', letterSpacing: .5, marginBottom: 14, textTransform: 'uppercase' }}>Campos opcionais</div>

            <FormField label="Instagram App ID (sub-app separado)" value={form.instagramAppId} onChange={v => setForm(f => ({ ...f, instagramAppId: v }))} placeholder="1760567911642665" hint="Se você tem um sub-app exclusivo para Instagram Business Login" />
            <FormField label={editId ? 'Instagram App Secret (deixe vazio para não alterar)' : 'Instagram App Secret'} value={form.instagramAppSecret} onChange={v => setForm(f => ({ ...f, instagramAppSecret: v }))} placeholder="••••••••••••••••" type="password" />
            <FormField label="Meta Login Config ID (opcional)" value={form.loginConfigId} onChange={v => setForm(f => ({ ...f, loginConfigId: v }))} placeholder="deixe vazio para login padrão" hint="Apenas necessário se você criou uma configuração de login customizada" />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
              <button onClick={closeForm} style={{ padding: '9px 20px', borderRadius: 'var(--mf-r-md)', border: '1px solid var(--border)', background: 'transparent', color: 'var(--mf-text-2)', fontSize: 'var(--mf-t-sm)', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
              <button
                onClick={saveForm}
                disabled={saving}
                style={{ padding: '9px 22px', borderRadius: 'var(--mf-r-md)', border: 'none', background: 'var(--mf-mod-publicar)', color: 'var(--mf-text)', fontSize: 'var(--mf-t-sm)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}
              >
                {saving ? <><span style={{ width:14, height:14, border:'2px solid var(--mf-border-strong)', borderTopColor:'var(--mf-text)', borderRadius: 'var(--mf-r-full)', display:'inline-block', animation:'spin .7s linear infinite' }} /> Salvando...</> : `${editId ? 'Salvar alterações' : 'Criar app'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
