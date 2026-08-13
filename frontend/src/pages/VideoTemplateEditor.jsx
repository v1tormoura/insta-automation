import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../services/api';
import Toast from '../components/Toast';
import PageShell from '../components/PageShell';

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 8); }

function extractVars(elements) {
  const found = new Map();
  for (const el of elements) {
    const targets = [el.source, el.text].filter(Boolean);
    for (const t of targets) {
      const matches = t.matchAll(/\{\{(\w+)\}\}/g);
      for (const m of matches) {
        const name = m[1];
        if (!found.has(name)) {
          found.set(name, {
            name,
            type: el.type === 'video' ? 'video' : el.type === 'image' ? 'image' : 'text',
            label: name.charAt(0) + name.slice(1).toLowerCase(),
            required: el.type === 'video',
            defaultValue: '',
          });
        }
      }
    }
  }
  return Array.from(found.values());
}

const DEFAULT_TEMPLATE = {
  name: '',
  description: '',
  canvas: { width: 1080, height: 1920, fps: 30, background: '#000000' },
  output: { crf: 20, preset: 'medium' },
  elements: [
    { id: uid(), type: 'video', label: 'Vídeo principal', source: '{{VIDEO}}', fit: 'cover', zIndex: 0 },
  ],
  audio: { keepOriginal: true, originalVolume: 1.0, musicTrack: '', musicVolume: 0.3 },
};

const CARD = {
  background: 'oklch(0.16 0.05 235 / 0.85)',
  border: '1px solid oklch(1 0 0 / 0.07)',
  borderRadius: 14,
  backdropFilter: 'blur(12px)',
  overflow: 'hidden',
};

const INP = { display: 'block', width: '100%', boxSizing: 'border-box' };

function Section({ title, children }) {
  return (
    <div style={CARD}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid oklch(1 0 0 / 0.07)' }}>
        <h3 style={{ margin: 0, fontSize: '.85rem', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
      </div>
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children, cols = 2 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <label style={{ marginBottom: 4, display: 'block' }}>{label}</label>
      {children}
    </div>
  );
}

// ── Image element row ─────────────────────────────────────────────────────────

function ImageElementRow({ el, onChange, onRemove }) {
  const upd = (k, v) => onChange({ ...el, [k]: v });
  return (
    <div style={{ background: 'oklch(0.12 0.04 235 / 0.6)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 600, color: '#60a5fa' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginRight: 5, verticalAlign: 'middle' }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          Imagem {el.label || ''}
        </span>
        <button type="button" className="btn-ghost" onClick={onRemove} style={{ padding: '2px 8px', borderRadius: 6, fontSize: '.72rem', color: '#f87171' }}>Remover</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <Field label="Variável (ex: {{LOGO}})">
          <input className="inp" style={INP} value={el.source} onChange={e => upd('source', e.target.value)} placeholder="{{LOGO}}" />
        </Field>
        <Field label="Rótulo">
          <input className="inp" style={INP} value={el.label} onChange={e => upd('label', e.target.value)} placeholder="Ex: Logo" />
        </Field>
        <Field label="X (px)">
          <input className="inp" style={INP} type="number" value={el.x || 0} onChange={e => upd('x', Number(e.target.value))} />
        </Field>
        <Field label="Y (px)">
          <input className="inp" style={INP} type="number" value={el.y || 0} onChange={e => upd('y', Number(e.target.value))} />
        </Field>
        <Field label="Largura (px)">
          <input className="inp" style={INP} type="number" value={el.width || 120} onChange={e => upd('width', Number(e.target.value))} />
        </Field>
        <Field label="Altura (0=auto)">
          <input className="inp" style={INP} type="number" value={el.height || 0} onChange={e => upd('height', Number(e.target.value))} />
        </Field>
        <Field label="Opacidade (0–1)">
          <input className="inp" style={INP} type="number" step="0.1" min="0" max="1" value={el.opacity ?? 1} onChange={e => upd('opacity', Number(e.target.value))} />
        </Field>
        <Field label="z-index">
          <input className="inp" style={INP} type="number" value={el.zIndex || 1} onChange={e => upd('zIndex', Number(e.target.value))} />
        </Field>
      </div>
    </div>
  );
}

// ── Text element row ──────────────────────────────────────────────────────────

function TextElementRow({ el, onChange, onRemove }) {
  const upd = (k, v) => onChange({ ...el, [k]: v });
  return (
    <div style={{ background: 'oklch(0.12 0.04 235 / 0.6)', border: '1px solid oklch(1 0 0 / 0.07)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 600, color: '#4ade80' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginRight: 5, verticalAlign: 'middle' }}><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
          Texto {el.label || ''}
        </span>
        <button type="button" className="btn-ghost" onClick={onRemove} style={{ padding: '2px 8px', borderRadius: 6, fontSize: '.72rem', color: '#f87171' }}>Remover</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <Field label="Texto ou {{VAR}}">
          <input className="inp" style={INP} value={el.text} onChange={e => upd('text', e.target.value)} placeholder="{{TITULO}} ou texto fixo" />
        </Field>
        <Field label="Rótulo">
          <input className="inp" style={INP} value={el.label} onChange={e => upd('label', e.target.value)} placeholder="Ex: Título" />
        </Field>
        <Field label="X (px)">
          <input className="inp" style={INP} type="number" value={el.x || 0} onChange={e => upd('x', Number(e.target.value))} />
        </Field>
        <Field label="Y (px)">
          <input className="inp" style={INP} type="number" value={el.y || 0} onChange={e => upd('y', Number(e.target.value))} />
        </Field>
        <Field label="Tamanho fonte">
          <input className="inp" style={INP} type="number" value={el.fontSize || 48} onChange={e => upd('fontSize', Number(e.target.value))} />
        </Field>
        <Field label="Cor do texto">
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="color" value={el.color || '#FFFFFF'} onChange={e => upd('color', e.target.value)} style={{ width: 36, height: 36, padding: 2, borderRadius: 6, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer' }} />
            <input className="inp" style={{ flex: 1 }} value={el.color || '#FFFFFF'} onChange={e => upd('color', e.target.value)} />
          </div>
        </Field>
        <Field label="Fundo (opcional)">
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="color" value={el.bgColor || '#000000'} onChange={e => upd('bgColor', e.target.value)} style={{ width: 36, height: 36, padding: 2, borderRadius: 6, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer' }} />
            <input className="inp" style={{ flex: 1 }} value={el.bgColor || ''} onChange={e => upd('bgColor', e.target.value)} placeholder="vazio = sem fundo" />
          </div>
        </Field>
        <Field label="z-index">
          <input className="inp" style={INP} type="number" value={el.zIndex || 2} onChange={e => upd('zIndex', Number(e.target.value))} />
        </Field>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideoTemplateEditor() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const isEdit   = Boolean(id);

  const [tmpl, setTmpl]   = useState(JSON.parse(JSON.stringify(DEFAULT_TEMPLATE)));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [toast, setToast] = useState(null);

  function showToast(type, title, message) { setToast({ type, title, message }); setTimeout(() => setToast(null), 3500); }

  useEffect(() => {
    if (!isEdit) return;
    api.get(`/video-templates/${id}`).then(r => {
      setTmpl(r.data);
    }).catch(() => {
      showToast('error', 'Erro', 'Template não encontrado.');
      navigate('/video-templates');
    }).finally(() => setLoading(false));
  }, [id]);

  // Getters / setters helpers
  const set = (path, val) => setTmpl(prev => {
    const copy = JSON.parse(JSON.stringify(prev));
    const keys = path.split('.');
    let obj = copy;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
    obj[keys[keys.length - 1]] = val;
    return copy;
  });

  const videoEl   = tmpl.elements.find(el => el.type === 'video') || {};
  const imageEls  = tmpl.elements.filter(el => el.type === 'image');
  const textEls   = tmpl.elements.filter(el => el.type === 'text');

  function updateElement(id, updated) {
    setTmpl(prev => ({ ...prev, elements: prev.elements.map(el => el.id === id ? updated : el) }));
  }

  function removeElement(id) {
    setTmpl(prev => ({ ...prev, elements: prev.elements.filter(el => el.id !== id) }));
  }

  function addImageElement() {
    const newEl = { id: uid(), type: 'image', label: `Imagem ${imageEls.length + 1}`, source: '{{LOGO}}', x: 900, y: 80, width: 120, height: 0, opacity: 1, zIndex: imageEls.length + 1 };
    setTmpl(prev => ({ ...prev, elements: [...prev.elements, newEl] }));
  }

  function addTextElement() {
    const newEl = { id: uid(), type: 'text', label: `Texto ${textEls.length + 1}`, text: '{{TITULO}}', x: 60, y: 200, fontSize: 64, color: '#FFFFFF', bgColor: '', zIndex: imageEls.length + textEls.length + 2 };
    setTmpl(prev => ({ ...prev, elements: [...prev.elements, newEl] }));
  }

  async function save(e) {
    e.preventDefault();
    if (!tmpl.name.trim()) return showToast('warning', 'Atenção', 'Informe o nome do template.');

    // Auto-derive variables
    const derived = extractVars(tmpl.elements);
    const payload = { ...tmpl, variables: derived };

    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/video-templates/${id}`, payload);
        showToast('success', 'Salvo', 'Template atualizado com sucesso.');
      } else {
        const res = await api.post('/video-templates', payload);
        showToast('success', 'Criado', 'Template criado com sucesso.');
        navigate(`/video-templates/${res.data._id}/edit`);
      }
    } catch (err) {
      showToast('error', 'Erro', err?.response?.data?.error || 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  }

  const derivedVars = extractVars(tmpl.elements);

  const pageIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/><path d="M8 2v20M16 2v20M2 8h6M16 8h6"/>
    </svg>
  );

  const pageActions = (
    <>
      <button type="button" className="btn-ghost" onClick={() => navigate('/video-templates')} style={{ padding: '5px 12px', borderRadius: 8, fontSize: '.82rem' }}>Cancelar</button>
      <button type="submit" form="tmpl-form" className="btn-primary" disabled={saving} style={{ padding: '6px 18px', borderRadius: 9, fontSize: '.83rem' }}>
        {saving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar template'}
      </button>
    </>
  );

  if (loading) {
    return (
      <PageShell title="Carregando template…" accent="purple">
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text3)' }}>Carregando…</div>
      </PageShell>
    );
  }

  return (
    <>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <PageShell
        icon={pageIcon}
        title={isEdit ? 'Editar Template' : 'Novo Template'}
        subtitle="Configure o layout e elementos do template de vídeo"
        accent="purple"
        actions={pageActions}
      >
        <form id="tmpl-form" onSubmit={save}>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* ── Informações gerais ── */}
            <Section title="Informações gerais">
              <Field label="Nome do template *">
                <input className="inp" style={INP} value={tmpl.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Reel Viral 9:16" required />
              </Field>
              <Field label="Descrição (opcional)">
                <input className="inp" style={INP} value={tmpl.description} onChange={e => set('description', e.target.value)} placeholder="Descreva o uso deste template" />
              </Field>
            </Section>

            {/* ── Canvas ── */}
            <Section title="Canvas">
              <Row cols={4}>
                <Field label="Largura (px)">
                  <input className="inp" style={INP} type="number" value={tmpl.canvas.width} onChange={e => set('canvas.width', Number(e.target.value))} />
                </Field>
                <Field label="Altura (px)">
                  <input className="inp" style={INP} type="number" value={tmpl.canvas.height} onChange={e => set('canvas.height', Number(e.target.value))} />
                </Field>
                <Field label="FPS">
                  <select className="inp" style={INP} value={tmpl.canvas.fps} onChange={e => set('canvas.fps', Number(e.target.value))}>
                    {[24, 25, 30, 60].map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </Field>
                <Field label="Cor de fundo">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="color" value={tmpl.canvas.background} onChange={e => set('canvas.background', e.target.value)} style={{ width: 36, height: 36, padding: 2, borderRadius: 6, border: '1px solid oklch(1 0 0 / 0.12)', background: 'none', cursor: 'pointer' }} />
                    <input className="inp" style={{ flex: 1 }} value={tmpl.canvas.background} onChange={e => set('canvas.background', e.target.value)} />
                  </div>
                </Field>
              </Row>
              <div style={{ fontSize: '.75rem', color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                Presets: Stories / Reels = 1080×1920 · Feed = 1080×1080 · Landscape = 1920×1080
              </div>
            </Section>

            {/* ── Output ── */}
            <Section title="Qualidade de saída">
              <Row>
                <Field label="CRF (qualidade — menor = melhor)">
                  <select className="inp" style={INP} value={tmpl.output.crf} onChange={e => set('output.crf', Number(e.target.value))}>
                    <option value={16}>16 — Alta qualidade</option>
                    <option value={20}>20 — Balanceado (padrão)</option>
                    <option value={26}>26 — Compacto (rápido)</option>
                  </select>
                </Field>
                <Field label="Preset FFmpeg">
                  <select className="inp" style={INP} value={tmpl.output.preset} onChange={e => set('output.preset', e.target.value)}>
                    {['ultrafast', 'superfast', 'veryfast', 'fast', 'medium', 'slow'].map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Field>
              </Row>
            </Section>

            {/* ── Vídeo principal ── */}
            <Section title="Vídeo principal">
              <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--text3)' }}>
                O vídeo principal é sempre fornecido via variável <code style={{ background: 'oklch(1 0 0 / 0.06)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{'{{VIDEO}}'}</code> ao criar o lote.
              </p>
              <Field label="Modo de enquadramento">
                <select className="inp" style={INP} value={videoEl.fit || 'cover'} onChange={e => updateElement(videoEl.id, { ...videoEl, fit: e.target.value })}>
                  <option value="cover">Cover — preenche o canvas (pode cortar)</option>
                  <option value="contain">Contain — todo o vídeo visível (com barras)</option>
                  <option value="blur">Blur — fundo borrado + vídeo centralizado</option>
                  <option value="stretch">Stretch — estica para preencher</option>
                </select>
              </Field>
            </Section>

            {/* ── Imagens / Overlays ── */}
            <Section title={`Imagens / Overlays (${imageEls.length})`}>
              {imageEls.length === 0 && (
                <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--text3)' }}>Nenhuma imagem adicionada. Use overlays para logos, marcas d'água ou molduras.</p>
              )}
              {imageEls.map(el => (
                <ImageElementRow key={el.id} el={el} onChange={u => updateElement(el.id, u)} onRemove={() => removeElement(el.id)} />
              ))}
              <button type="button" className="btn-ghost" onClick={addImageElement} style={{ padding: '7px 14px', borderRadius: 8, fontSize: '.82rem', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar imagem
              </button>
            </Section>

            {/* ── Textos ── */}
            <Section title={`Textos / Legendas (${textEls.length})`}>
              {textEls.length === 0 && (
                <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--text3)' }}>Nenhum texto adicionado. Adicione títulos, hashtags ou legendas.</p>
              )}
              {textEls.map(el => (
                <TextElementRow key={el.id} el={el} onChange={u => updateElement(el.id, u)} onRemove={() => removeElement(el.id)} />
              ))}
              <button type="button" className="btn-ghost" onClick={addTextElement} style={{ padding: '7px 14px', borderRadius: 8, fontSize: '.82rem', display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Adicionar texto
              </button>
            </Section>

            {/* ── Áudio ── */}
            <Section title="Áudio">
              <Row>
                <Field label="Áudio original">
                  <select className="inp" style={INP} value={tmpl.audio.keepOriginal ? 'true' : 'false'} onChange={e => set('audio.keepOriginal', e.target.value === 'true')}>
                    <option value="true">Manter áudio do vídeo</option>
                    <option value="false">Remover áudio (mudo)</option>
                  </select>
                </Field>
                <Field label="Volume do original (0–1)">
                  <input className="inp" style={INP} type="number" step="0.1" min="0" max="1" value={tmpl.audio.originalVolume} onChange={e => set('audio.originalVolume', Number(e.target.value))} disabled={!tmpl.audio.keepOriginal} />
                </Field>
              </Row>
              <Row>
                <Field label="Trilha de fundo (path do arquivo, opcional)">
                  <input className="inp" style={INP} value={tmpl.audio.musicTrack} onChange={e => set('audio.musicTrack', e.target.value)} placeholder="Ex: /app/uploads/musica.mp3" />
                </Field>
                <Field label="Volume da trilha (0–1)">
                  <input className="inp" style={INP} type="number" step="0.1" min="0" max="1" value={tmpl.audio.musicVolume} onChange={e => set('audio.musicVolume', Number(e.target.value))} disabled={!tmpl.audio.musicTrack} />
                </Field>
              </Row>
            </Section>

            {/* ── Variáveis derivadas ── */}
            {derivedVars.length > 0 && (
              <Section title="Variáveis detectadas automaticamente">
                <p style={{ margin: 0, fontSize: '.78rem', color: 'var(--text3)' }}>
                  Estas variáveis foram extraídas dos elementos e serão solicitadas ao criar um lote.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {derivedVars.map(v => (
                    <span key={v.name} style={{
                      fontSize: '.75rem', fontFamily: 'var(--font-mono)', borderRadius: 100,
                      padding: '3px 10px',
                      background: v.type === 'video' ? 'rgba(139,92,246,.1)' : v.type === 'image' ? 'rgba(96,165,250,.1)' : 'rgba(74,222,128,.1)',
                      color: v.type === 'video' ? '#a78bfa' : v.type === 'image' ? '#60a5fa' : '#4ade80',
                      border: `1px solid ${v.type === 'video' ? 'rgba(139,92,246,.25)' : v.type === 'image' ? 'rgba(96,165,250,.25)' : 'rgba(74,222,128,.25)'}`,
                    }}>
                      {'{{'}{ v.name }{'}}'}  · {v.type}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {/* ── Save row ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingBottom: 8 }}>
              <button type="button" className="btn-ghost" onClick={() => navigate('/video-templates')} style={{ padding: '9px 20px', borderRadius: 9, fontSize: '.85rem' }}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={saving} style={{ padding: '9px 24px', borderRadius: 9, fontSize: '.85rem' }}>
                {saving ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar template'}
              </button>
            </div>

          </div>
        </form>
      </PageShell>
    </>
  );
}
