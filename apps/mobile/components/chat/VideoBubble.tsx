import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { chatStyles } from './chatStyles';
import { formatMessageTime } from './chatUtils';
import { MessageStatus } from './MessageStatus';
import { ReactionRow } from './ReactionRow';
import { ReplyQuote } from './ReplyQuote';
import { type LocalChatMessage } from './types';

export function VideoBubble({
  message,
  mine,
  currentUserId,
  onPress,
  onLongPress,
  onToggleReaction,
  onRetry,
}: {
  message: LocalChatMessage;
  mine: boolean;
  currentUserId: string | null;
  onPress: () => void;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
  onRetry: () => void;
}) {
  const dur = message.durationSec ?? 0;
  const durLabel = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
  return (
    <View style={[chatStyles.messageBlock, mine && chatStyles.messageMine, message._status === 'sending' && { opacity: 0.6 }]}>
      {message.replyTo && (
        <View style={[chatStyles.bubble, mine ? chatStyles.bubbleMine : chatStyles.bubbleOther, chatStyles.replyQuoteWrapper]}>
          <ReplyQuote preview={message.replyTo} />
        </View>
      )}
      <Pressable
        style={chatStyles.videoBubble}
        onPress={!message._status ? onPress : undefined}
        onLongPress={message._status !== 'sending' ? onLongPress : undefined}
      >
        <View style={chatStyles.videoOverlay}>
          <Ionicons name="play-circle" size={48} color="#FFFFFF" />
          {dur > 0 && <Text style={chatStyles.videoDuration}>{durLabel}</Text>}
        </View>
      </Pressable>
      <ReactionRow reactions={message.reactions} currentUserId={currentUserId} onToggle={onToggleReaction} />
      <Text style={[chatStyles.messageTime, mine && chatStyles.timeMine]}>
        {formatMessageTime(message.createdAt)}
        {mine ? `  ${message.isRead ? '✓✓' : '✓'}` : ''}
      </Text>
      <MessageStatus status={message._status} mine={mine} onRetry={onRetry} />
    </View>
  );
}
