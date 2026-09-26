import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export function AccountAvatar({
  username,
  src,
  className,
  ring,
}: {
  username: string;
  src?: string | null;
  className?: string;
  ring?: boolean;
}) {
  return (
    <Avatar className={cn(ring && 'ring-2 ring-brand/40 ring-offset-2 ring-offset-card', className)}>
      {src && <AvatarImage src={src} alt={`@${username}`} referrerPolicy="no-referrer" />}
      <AvatarFallback>{username.slice(0, 2)}</AvatarFallback>
    </Avatar>
  );
}
