import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Check, AlertTriangle } from 'lucide-react';
import { useTarefas, obter, progredir, concluir } from '../services/tarefas';
import { useServerEvents } from '../services/useServerEvents';
import { baixarTodos } from '../services/downloads';

/**
 * O que está rodando em segundo plano, visível em qualquer tela — e o ouvinte
 * da importação, que precisa estar SEMPRE montado: o progresso chega pelo SSE
 * e, se só a tela do Importar escutasse, sair dela perderia o fim (e os
 * downloads do destino "Baixar").
 */
export default function IndicadorDeTarefas() {
  const tarefas = useTarefas();
  const { pathname } = useLocation();
  const navegar = useNavigate();

  useServerEvents(['media'], d => {
    const t = obter('importar');
    if (!t || t.fase !== 'rodando' || !t.dados?.servidor) return;
    if (d?.action === 'importacao') progredir('importar', { feitas: d.feitas, total: d.total, etapa: 'Processando' });
    if (d?.action === 'importacao_fim') {
      const arquivos = d.arquivos || [];
      concluir('importar', { dados: { importados: d.importados, erros: d.erros, detalhes: d.detalhes || [], arquivos } });
      const destino = t.dados.destino;
      if (destino && destino !== 'biblioteca' && arquivos.length) baixarTodos(arquivos, destino === 'baixar');
    }
  });

  // A própria tela mostra o seu progresso; aqui só o que está em outra tela.
  const visiveis = tarefas.filter(t => !t.consumida && t.rota !== pathname);
  if (!visiveis.length) return null;

  return (
    <div aria-live="polite" className="mf-tarefas" style={{ position: 'fixed', bottom: 16, zIndex: 'var(--mf-z-toast)',
      display: 'grid', gap: 8, width: 'min(320px, calc(100vw - 32px))' }}>
      <style>{'.mf-tarefas{left:calc(var(--mf-sidebar-c, 72px) + 16px)}@media (max-width:900px){.mf-tarefas{left:16px}}'}</style>
      {visiveis.map(t => {
        const pct = t.pct != null ? t.pct : t.total ? Math.round((t.feitas / t.total) * 100) : null;
        const cor = t.fase === 'erro' ? 'var(--mf-danger-500)' : t.fase === 'ok' ? 'var(--mf-success-500)' : 'var(--mf-primary-500)';
        return (
          <button key={t.chave} type="button" onClick={() => t.rota && navegar(t.rota)}
            style={{ textAlign: 'left', cursor: t.rota ? 'pointer' : 'default', padding: '10px 12px', borderRadius: 'var(--mf-r-md)',
              background: 'var(--mf-surface-1)', border: `1px solid color-mix(in oklch, ${cor} 40%, var(--mf-border))`,
              boxShadow: 'var(--mf-shadow-3)', color: 'var(--mf-text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {t.fase === 'rodando' ? <Loader2 size={14} className="mf-spin" style={{ color: cor }} />
                : t.fase === 'ok' ? <Check size={14} style={{ color: cor }} /> : <AlertTriangle size={14} style={{ color: cor }} />}
              <span style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 700, flex: 1, minWidth: 0 }} className="mf-trunc">{t.rotulo}</span>
              <span style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', whiteSpace: 'nowrap' }}>
                {t.fase === 'rodando' ? (pct != null ? `${pct}%` : t.total ? `${t.feitas}/${t.total}` : '') : t.fase === 'ok' ? 'Concluído' : 'Falhou'}
              </span>
            </div>
            {t.fase === 'rodando' && (
              <div style={{ height: 3, borderRadius: 2, background: 'var(--mf-surface-3)', marginTop: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct ?? 15}%`, background: cor, transition: 'width .3s' }} />
              </div>
            )}
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 5 }}>
              {t.fase === 'rodando' ? `${t.etapa || 'Em andamento'} — pode usar outras telas.` : t.mensagem || 'Toque para ver.'}
            </div>
          </button>
        );
      })}
    </div>
  );
}
