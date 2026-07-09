import { Pressable, Text, View } from 'react-native';
import { chatStyles } from './chatStyles';
import { formatMessageTime } from './chatUtils';
import { MessageStatus } from './MessageStatus';
import { ReactionRow } from './ReactionRow';
import { ReplyQuote } from './ReplyQuote';
import { type LocalChatMessage } from './types';

export function TextBubble({
  message,
  mine,
  currentUserId,
  onLongPress,
  onToggleReaction,
  onRetry,
}: {
  message: LocalChatMessage;
  mine: boolean;
  currentUserId: string | null;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
  onRetry: () => void;
}) {
  return (
    <View style={[chatStyles.messageBlock, mine && chatStyles.messageMine, message._status === 'sending' && { opacity: 0.6 }]}>
      <Pressable
        style={[chatStyles.bubble, mine ? chatStyles.bubbleMine : chatStyles.bubbleOther]}
        onLongPress={message._status !== 'sending' ? onLongPress : undefined}
      >
        {message.replyTo && <ReplyQuote preview={message.replyTo} maxLines={2} />}
        <Text style={chatStyles.bubbleText}>{message.content}</Text>
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
