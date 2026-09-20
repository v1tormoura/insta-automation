import { useEffect, useState } from 'react';
import PortalModal from './PortalModal';

/**
 * "Nova versão disponível — Atualizar".
 *
 * ── O problema
 *
 * O app instalado no celular fica com o JavaScript carregado em memória
 * enquanto não for fechado de verdade — dias, às vezes. Cada deploy trocava
 * o bundle no servidor e o celular seguia no antigo; a pessoa via a mesma
 * tela quebrada depois de o conserto já estar no ar (aconteceu duas vezes em
 * 19–20/09/2026). O `index.html` sai com `no-store`, mas isso só vale para
 * quem RECARREGA — e no app instalado ninguém recarrega.
 *
 * ── Como funciona
 *
 * O bundle atual tem um hash no nome (`index-EtNCkhAX.js`). A cada minuto, e
 * sempre que o app volta para o primeiro plano, busca o `index.html` de novo
 * e compara o hash. Diferente = há versão nova; aparece um botão no rodapé.
 * Um clique recarrega. Nada de service worker com cache — o do app é só de
 * notificação, de propósito (ver public/sw.js).
 *
 * Só avisa; nunca recarrega sozinho. Um reload no meio de um upload do
 * Limpador ou de um formulário do Postar jogaria trabalho fora.
 */

const INTERVALO_MS = 60_000;

function hashAtual() {
  const s = [...document.scripts].map(x => x.src).find(x => /\/assets\/index-[\w-]+\.js/.test(x));
  const m = s && /\/assets\/(index-[\w-]+\.js)/.exec(s);
  return m ? m[1] : null;
}

async function hashNoServidor() {
  try {
    const r = await fetch('/index.html', { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return null;
    const html = await r.text();
    const m = /\/assets\/(index-[\w-]+\.js)/.exec(html);
    return m ? m[1] : null;
  } catch { return null; }
}

export function useVersaoNova() {
  const [nova, setNova] = useState(false);
  useEffect(() => {
    const atual = hashAtual();
    if (!atual) return undefined;
    let vivo = true;
    const checar = async () => {
      const remoto = await hashNoServidor();
      if (vivo && remoto && remoto !== atual) setNova(true);
    };
    const t = setInterval(checar, INTERVALO_MS);
    const aoVoltar = () => { if (document.visibilityState === 'visible') checar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', aoVoltar); window.removeEventListener('focus', aoVoltar); };
  }, []);
  return nova;
}

export default function AvisoDeVersao() {
  const nova = useVersaoNova();
  if (!nova) return null;
  return (
    <PortalModal>
      <div role="status" style={{
        position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)', zIndex: 1600,
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px 10px 16px',
        maxWidth: 'calc(100vw - 32px)', borderRadius: 'var(--mf-r-lg)',
        background: 'color-mix(in oklch, var(--mf-surface-1) 94%, transparent)',
        border: '1px solid color-mix(in oklch, var(--mf-primary-500) 45%, transparent)',
        boxShadow: 'var(--mf-shadow-2, 0 8px 24px rgba(0,0,0,.35))', backdropFilter: 'blur(12px)',
        color: 'var(--mf-text)', fontSize: 'var(--mf-t-xs)',
      }}>
        <span><strong>Nova versão disponível.</strong> <span style={{ color: 'var(--mf-text-3)' }}>Atualize para pegar as correções.</span></span>
        <button type="button" onClick={() => window.location.reload()} style={{
          padding: '6px 12px', borderRadius: 'var(--mf-r-sm)', border: 'none', cursor: 'pointer',
          background: 'var(--mf-primary-500)', color: 'var(--mf-bg)', fontWeight: 700, fontSize: 'var(--mf-t-xs)', whiteSpace: 'nowrap',
        }}>Atualizar</button>
      </div>
    </PortalModal>
  );
}
