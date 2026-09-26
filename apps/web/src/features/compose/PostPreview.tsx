import { POST_TYPE_INFO, type AccountDTO } from '@nexora/shared';
import { Bookmark, Film, Heart, ImageIcon, MessageCircle, Send } from 'lucide-react';
import { useState } from 'react';
import { AccountAvatar } from '@/components/AccountAvatar';
import { cn } from '@/lib/utils';
import type { ContentDraft } from './contentState';

/** Prévia aproximada de como o post aparece no feed/Reels/Stories. */
export function PostPreview({ draft, account }: { draft: ContentDraft; account?: AccountDTO }) {
  const [index, setIndex] = useState(0);
  const media = draft.media[Math.min(index, Math.max(0, draft.media.length - 1))];
  const vertical = draft.type === 'REEL' || draft.type === 'STORY';
  const username = account?.username ?? 'sua_conta';
  const cover = draft.type === 'REEL' && draft.coverMode === 'image' ? draft.coverImage : null;
  const shown = cover ?? media;

  return (
    <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[1.6rem] border-[6px] border-foreground/10 bg-card shadow-xl">
      {!vertical && (
        <div className="flex items-center gap-2 px-3 py-2">
          <AccountAvatar username={username} src={account?.profilePictureUrl} className="size-7" />
          <span className="text-xs font-semibold">{username}</span>
        </div>
      )}
      <div className={cn('relative bg-muted', vertical ? 'aspect-[9/16]' : 'aspect-[4/5]')}>
        {shown?.thumbnailUrl || shown?.kind === 'image' ? (
          shown.kind === 'video' && !cover ? (
            <video src={shown.previewUrl} className="size-full object-cover" muted playsInline loop autoPlay poster={shown.thumbnailUrl ?? undefined} />
          ) : (
            <img src={shown.kind === 'image' ? shown.previewUrl : shown.thumbnailUrl!} alt="" className="size-full object-cover" />
          )
        ) : shown ? (
          <video src={shown.previewUrl} className="size-full object-cover" muted playsInline loop autoPlay />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            {vertical ? <Film className="size-8" aria-hidden /> : <ImageIcon className="size-8" aria-hidden />}
          </div>
        )}
        {vertical && (
          <div className="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/50 to-transparent p-3">
            <AccountAvatar username={username} src={account?.profilePictureUrl} className="size-7" />
            <span className="text-xs font-semibold text-white">{username}</span>
          </div>
        )}
        {draft.type === 'CAROUSEL' && draft.media.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
            {draft.media.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setIndex(i)}
                className={cn('size-1.5 rounded-full', i === index ? 'bg-white' : 'bg-white/45')}
                aria-label={`Ver item ${i + 1}`}
              />
            ))}
          </div>
        )}
        {draft.type === 'REEL' && draft.caption && (
          <p className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 text-xs text-white">{draft.caption}</p>
        )}
      </div>
      {!vertical && (
        <div className="space-y-1.5 px-3 py-2.5">
          <div className="flex items-center gap-3 text-foreground">
            <Heart className="size-4" aria-hidden />
            <MessageCircle className="size-4" aria-hidden />
            <Send className="size-4" aria-hidden />
            <Bookmark className="ml-auto size-4" aria-hidden />
          </div>
          <p className="line-clamp-3 text-xs whitespace-pre-line">
            <span className="font-semibold">{username}</span> {draft.caption || <span className="text-muted-foreground">Sua legenda aparece aqui.</span>}
          </p>
        </div>
      )}
      <p className="border-t px-3 py-1.5 text-center text-[10px] text-muted-foreground">Prévia · {POST_TYPE_INFO[draft.type].label}</p>
    </div>
  );
}
