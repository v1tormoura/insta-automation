import type { AccountStatus, CampaignStatus, JobStatus, PostStatus } from '@nexora/shared';
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Hourglass,
  KeyRound,
  Loader2,
  PauseCircle,
  RefreshCw,
  Send,
  Unplug,
  UploadCloud,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ACCOUNT_STATUS, CAMPAIGN_STATUS, JOB_STATUS, POST_STATUS, type Tone } from '@/lib/labels';
import { cn } from '@/lib/utils';

const toneVariant: Record<Tone, 'success' | 'warning' | 'destructive' | 'info' | 'muted' | 'default'> = {
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
  info: 'info',
  muted: 'muted',
  default: 'default',
};

function StatusPill({ icon: Icon, label, tone, spin, className }: { icon: LucideIcon; label: string; tone: Tone; spin?: boolean; className?: string }) {
  return (
    <Badge variant={toneVariant[tone]} className={className}>
      <Icon className={cn(spin && 'animate-spin')} aria-hidden />
      {label}
    </Badge>
  );
}

const ACCOUNT_ICON: Record<AccountStatus, LucideIcon> = {
  CONNECTED: CheckCircle2,
  SYNCING: RefreshCw,
  EXPIRED: KeyRound,
  ERROR: AlertTriangle,
  DISCONNECTED: Unplug,
};

export function AccountStatusBadge({ status, className }: { status: AccountStatus; className?: string }) {
  const s = ACCOUNT_STATUS[status];
  return <StatusPill icon={ACCOUNT_ICON[status]} label={s.label} tone={s.tone} spin={status === 'SYNCING'} className={className} />;
}

const JOB_ICON: Record<JobStatus, LucideIcon> = {
  SCHEDULED: CalendarClock,
  QUEUED: Hourglass,
  CREATING: UploadCloud,
  PROCESSING: Loader2,
  PUBLISHING: Send,
  PUBLISHED: CheckCircle2,
  FAILED: XCircle,
  CANCELED: Ban,
};

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const s = JOB_STATUS[status];
  return <StatusPill icon={JOB_ICON[status]} label={s.label} tone={s.tone} spin={status === 'PROCESSING'} className={className} />;
}

const POST_ICON: Record<PostStatus, LucideIcon> = {
  DRAFT: CircleDashed,
  SCHEDULED: CalendarClock,
  PUBLISHING: Send,
  PUBLISHED: CheckCircle2,
  PARTIAL: AlertTriangle,
  FAILED: XCircle,
  CANCELED: Ban,
};

export function PostStatusBadge({ status, className }: { status: PostStatus; className?: string }) {
  const s = POST_STATUS[status];
  return <StatusPill icon={POST_ICON[status]} label={s.label} tone={s.tone} className={className} />;
}

const CAMPAIGN_ICON: Record<CampaignStatus, LucideIcon> = {
  ACTIVE: Send,
  PAUSED: PauseCircle,
  COMPLETED: CheckCircle2,
  PARTIAL: AlertTriangle,
  FAILED: XCircle,
  CANCELED: Ban,
};

export function CampaignStatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const s = CAMPAIGN_STATUS[status];
  return <StatusPill icon={CAMPAIGN_ICON[status]} label={s.label} tone={s.tone} className={className} />;
}
