import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { chatStyles } from './chatStyles';
import { formatMessageTime } from './chatUtils';
import { MessageStatus } from './MessageStatus';
import { ReactionRow } from './ReactionRow';
import { ReplyQuote } from './ReplyQuote';
import { type LocalChatMessage } from './types';

export function ImageBubble({
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
  return (
    <View style={[chatStyles.messageBlock, mine && chatStyles.messageMine, message._status === 'sending' && { opacity: 0.6 }]}>
      {message.replyTo && (
        <View style={[chatStyles.bubble, mine ? chatStyles.bubbleMine : chatStyles.bubbleOther, chatStyles.replyQuoteWrapper]}>
          <ReplyQuote preview={message.replyTo} />
        </View>
      )}
      <Pressable
        onPress={!message._status ? onPress : undefined}
        onLongPress={message._status !== 'sending' ? onLongPress : undefined}
      >
        <Image source={{ uri: message.content }} style={chatStyles.imageBubble} contentFit="cover" />
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
