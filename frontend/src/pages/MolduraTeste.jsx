/* TEMPORÁRIO — conferência do texto do story sem passar pelo login.
   Remover junto com a rota /moldura-teste em App.jsx. */
import { useState, useRef } from 'react';
import StoryMoldura from './StoryMoldura';

export default function MolduraTeste() {
  const [texto, setTexto] = useState('');
  const [textoOn, setTextoOn] = useState(true);
  const [textoPos, setTextoPos] = useState({ x: 0.5, y: 0.35 });
  const [arrastando, setArrastando] = useState(null);
  const caixa = useRef(null);

  const coords = (el, cx, cy) => {
    const r = el.getBoundingClientRect();
    return {
      x: Number(Math.min(1, Math.max(0, (cx - r.left) / r.width)).toFixed(3)),
      y: Number(Math.min(1, Math.max(0, (cy - r.top) / r.height)).toFixed(3)),
    };
  };
  const iniciar = alvo => e => { e.stopPropagation(); e.currentTarget.setPointerCapture?.(e.pointerId); setArrastando(alvo); };
  const mover = e => {
    if (!arrastando || !caixa.current) return;
    setTextoPos(coords(caixa.current, e.clientX, e.clientY));
  };
  const soltar = e => { e.currentTarget.releasePointerCapture?.(e.pointerId); setArrastando(null); };

  return (
    <div style={{ padding: 20, background: '#0b0f14', minHeight: '100vh', display: 'flex', gap: 20 }}>
      <StoryMoldura
        media={null} figurinha={null} linkOn={false}
        textoOn={textoOn} texto={texto} textoPos={textoPos}
        textoTam="medio" textoCor="branco"
        arrastando={arrastando} refMoldura={caixa}
        onClicar={() => {}} onIniciarLink={iniciar('link')} onIniciarTexto={iniciar('texto')}
        onMover={mover} onSoltar={soltar}
      />
      <div style={{ color: '#cfe', fontFamily: 'monospace', fontSize: 12 }}>
        <textarea id="campo" value={texto} onChange={e => setTexto(e.target.value)} rows={4}
          style={{ width: 260, background: '#111', color: '#fff', border: '1px solid #345' }} />
        <div>textoOn: {String(textoOn)}</div>
        <div>len: {texto.length}</div>
        <button onClick={() => setTextoOn(v => !v)}>toggle</button>
      </div>
    </div>
  );
}
