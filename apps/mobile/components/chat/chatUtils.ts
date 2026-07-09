import { type ReplyPreview } from '@/lib/api';

export function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function getReplyPreviewText(msg: ReplyPreview): string {
  if (msg.recalledAt) return 'Message recalled';
  switch (msg.messageType) {
    case 'IMAGE': return '📷 Photo';
    case 'VIDEO': return '🎬 Video';
    case 'VOICE': return '🎤 Voice message';
    case 'GIF': return '🎞 GIF';
    default: return msg.content.length > 60 ? `${msg.content.slice(0, 60)}…` : msg.content;
  }
}
