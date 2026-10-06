import { useEffect, useState } from 'react';
import { DatabaseBackup, Download, CheckCircle2, AlertTriangle, Database, Images } from 'lucide-react';
import PageShell from '../components/PageShell';
import api from '../services/api';
import { getToken } from '../services/auth';

/**
 * Backups — o que o ./backup.sh guardou na VPS (banco + mídias, últimos 7) e o
 * download de cada arquivo. Baixar de vez em quando é o que protege contra
 * perder a VPS inteira.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const tamanho = b => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const quando = d => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const horasDesde = d => (Date.now() - new Date(d).getTime()) / 3_600_000;
const link = nome => `${API_URL}/backups/${encodeURIComponent(nome)}?token=${encodeURIComponent(getToken() || '')}`;

export default function Backups() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api.get('/backups').then(r => setDados(r.data)).catch(e => setErro(e.response?.data?.error || e.message));
  }, []);

  const u = dados?.ultimo;
  const atrasado = u?.ok && horasDesde(u.quando) > 36;
  const situacao = !dados ? null
    : !u ? { cor: 'var(--mf-warning-500)', Icone: AlertTriangle, titulo: 'Nenhum backup ainda', texto: 'Ligue o backup automático na VPS (passo abaixo).' }
      : !u.ok ? { cor: 'var(--mf-danger-500)', Icone: AlertTriangle, titulo: 'O último backup falhou', texto: `${quando(u.quando)} — ${u.erro || 'veja o log na VPS'}` }
        : atrasado ? { cor: 'var(--mf-warning-500)', Icone: AlertTriangle, titulo: 'Backup atrasado', texto: `O último foi em ${quando(u.quando)} — confira se o timer está ligado.` }
          : { cor: 'var(--mf-success-500)', Icone: CheckCircle2, titulo: 'Backup em dia', texto: `Último em ${quando(u.quando)}: banco ${tamanho(u.bancoBytes)} · mídias ${tamanho(u.midiasBytes)}. Guarda os últimos ${u.manter}.` };

  return (
    <PageShell icon={<DatabaseBackup size={18} />} title="Backups" subtitle="Banco e mídias, todo dia, guardando os últimos 7">
      {erro && <div className="mf-card" style={{ padding: 'var(--mf-4)', color: 'var(--mf-danger-500)' }}>{erro}</div>}

      {situacao && (
        <section className="mf-card" data-status-backup style={{ padding: 'var(--mf-4)', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 'var(--mf-4)',
          borderColor: `color-mix(in oklch, ${situacao.cor} 40%, var(--mf-border))` }}>
          <situacao.Icone size={22} style={{ color: situacao.cor, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)' }}>{situacao.titulo}</div>
            <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-2)', marginTop: 2 }}>{situacao.texto}</div>
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gap: 'var(--mf-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', alignItems: 'start' }}>
        <section className="mf-card" style={{ padding: 'var(--mf-4)' }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 'var(--mf-3)' }}>Arquivos guardados na VPS</div>
          {dados && !dados.arquivos.length && <div style={{ fontSize: 'var(--mf-t-xs)', color: 'var(--mf-text-3)' }}>Nenhum ainda.</div>}
          <div style={{ display: 'grid', gap: 6 }}>
            {(dados?.arquivos || []).map(a => (
              <div key={a.arquivo} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)' }}>
                {a.tipo === 'banco' ? <Database size={15} style={{ color: 'var(--mf-text-3)' }} /> : <Images size={15} style={{ color: 'var(--mf-text-3)' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{a.tipo === 'banco' ? 'Banco de dados' : 'Mídias'} · {quando(a.quando)}</div>
                  <div className="mf-trunc" style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)' }}>{a.arquivo} · {tamanho(a.bytes)}</div>
                </div>
                <a className="btn btn-ghost btn-sm" href={link(a.arquivo)} style={{ gap: 5 }}><Download size={13} /> Baixar</a>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-3)', marginTop: 'var(--mf-3)', lineHeight: 1.6 }}>
            Baixe o do banco de vez em quando e guarde fora da VPS (Drive, PC): se a VPS for perdida, ele traz de volta contas, envios, legendas e vendas.
          </div>
        </section>

        <section className="mf-card" style={{ padding: 'var(--mf-4)' }}>
          <div style={{ fontSize: 'var(--mf-t-sm)', fontWeight: 700, color: 'var(--mf-text)', marginBottom: 'var(--mf-3)' }}>Na VPS</div>
          {[
            ['Ligar o backup automático (uma vez)', 'cd /root/insta-nova && ./instalar-backup-automatico.sh', 'Todo dia às 03:15, e já faz o primeiro na hora.'],
            ['Fazer um backup agora', 'cd /root/insta-nova && ./backup.sh', ''],
            ['Restaurar o banco', './restaurar-backup.sh banco backups/banco-AAAA-MM-DD_HHMM.sql.gz', 'Pede confirmação e recria as tabelas por cima das atuais.'],
            ['Restaurar as mídias', './restaurar-backup.sh midias backups/midias-AAAA-MM-DD_HHMM.tgz', ''],
          ].map(([t, cmd, obs]) => (
            <div key={t} style={{ marginBottom: 'var(--mf-3)' }}>
              <div style={{ fontSize: 'var(--mf-t-xs)', fontWeight: 650, color: 'var(--mf-text)' }}>{t}</div>
              <code style={{ display: 'block', marginTop: 4, padding: '7px 9px', borderRadius: 'var(--mf-r-sm)', background: 'var(--mf-surface-2)', fontSize: 'var(--mf-t-micro)', color: 'var(--mf-text-2)', overflowX: 'auto', whiteSpace: 'nowrap' }}>{cmd}</code>
              {obs && <div style={{ fontSize: 'var(--mf-t-nano)', color: 'var(--mf-text-3)', marginTop: 3 }}>{obs}</div>}
            </div>
          ))}
          {dados && !dados.pastaMontada && (
            <div style={{ fontSize: 'var(--mf-t-micro)', color: 'var(--mf-warning-500)' }}>A pasta de backups ainda não está ligada ao painel — rode ./deploy.sh.</div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
