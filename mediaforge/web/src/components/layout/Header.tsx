import { useQueryClient } from '@tanstack/react-query';
import { Clock, Cpu, Database, HardDrive, Radio, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/api';
import type { ConnectionState } from '../../lib/events';
import { formatBytes, formatDateTime } from '../../lib/format';
import { useSession, useSystem } from '../../lib/queries';
import { Button } from '../ui/Button';
import { Badge } from '../ui/feedback';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/toast';

export function Header({ connection }: { connection: ConnectionState }) {
  const { data: session } = useSession();
  const { data: system } = useSystem();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const ffmpegOk = system?.ffmpeg.available && system?.ffprobe.available;
  const caps = system?.capabilities;
  const capList = caps
    ? Object.entries({ H264: caps.h264, HEVC: caps.hevc, VP9: caps.vp9, AV1: caps.av1, Opus: caps.opus, WEBP: caps.webp, Textos: caps.drawtext, Legendas: caps.subtitles, SEI: caps.filterUnits })
        .map(([k, v]) => `${v ? '✓' : '✗'} ${k}`)
        .join('  ')
    : '';

  const resetSession = async () => {
    setBusy(true);
    try {
      await api.newSession();
      await qc.invalidateQueries();
      toast.push('success', 'Nova sessão iniciada', ['Arquivos, tarefas e resultados da sessão anterior foram apagados.']);
      setConfirm(false);
    } catch (err) {
      toast.error(err, 'Não foi possível encerrar a sessão');
    } finally {
      setBusy(false);
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1800px] items-center gap-3 px-3 sm:px-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-accent/40 bg-gradient-to-br from-accent/30 to-accent/5 shadow-[0_0_24px_-6px_rgb(47_123_255/0.8)]">
            <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden>
              <path d="M7 23V9l9 7 9-7v14" fill="none" stroke="#7FB0FF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold tracking-tight text-ink">
              Media<span className="text-accent-soft">Forge</span>
            </h1>
            <p className="hidden text-[11px] text-ink-3 sm:block">Processamento, limpeza de metadados e versões editoriais</p>
          </div>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 overflow-x-auto">
          <Badge tone={ffmpegOk ? 'ok' : 'bad'} icon={ffmpegOk ? Cpu : TriangleAlert} title={ffmpegOk ? capList : system?.ffmpeg.error ?? 'FFmpeg não detectado'}>
            {ffmpegOk ? `FFmpeg ${system?.ffmpeg.version?.split('-')[0]}` : 'FFmpeg ausente'}
          </Badge>
          <Badge
            tone={connection === 'open' ? 'accent' : connection === 'connecting' ? 'warn' : 'bad'}
            icon={Radio}
            title="Atualizações em tempo real (SSE)"
            className="hidden md:inline-flex"
          >
            {connection === 'open' ? 'Ao vivo' : connection === 'connecting' ? 'Conectando…' : 'Desconectado'}
          </Badge>
          {session && (
            <>
              <Badge tone="neutral" icon={ShieldCheck} title="Identificador da sessão (arquivos isolados por sessão)" className="hidden sm:inline-flex">
                <span className="font-mono">{session.id}</span>
              </Badge>
              <Badge tone="neutral" icon={HardDrive} title="Espaço ocupado pela sessão" className="hidden sm:inline-flex">
                {formatBytes(session.storageBytes)}
              </Badge>
              <Badge tone="neutral" icon={Database} title="Arquivos importados · tarefas concluídas / total" className="hidden lg:inline-flex">
                {session.counts.assets} arq. · {session.counts.completed}/{session.counts.jobs} tarefas
              </Badge>
              <Badge tone="neutral" icon={Clock} title="A sessão e seus arquivos são apagados automaticamente após este horário sem atividade" className="hidden xl:inline-flex">
                expira {formatDateTime(session.expiresAt)}
              </Badge>
            </>
          )}
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => setConfirm(true)} data-testid="new-session">
            <span className="hidden sm:inline">Nova sessão</span>
          </Button>
        </div>
      </div>

      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Encerrar a sessão atual?"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Manter
            </Button>
            <Button variant="danger" loading={busy} onClick={resetSession} data-testid="confirm-new-session">
              Apagar e iniciar nova
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">
          Tarefas em andamento serão canceladas e todos os arquivos importados, resultados e relatórios desta sessão serão apagados do disco. Perfis salvos são mantidos.
        </p>
      </Modal>
    </header>
  );
}
