import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/design/system';
import { chatStyles } from './chatStyles';
import { formatMessageTime } from './chatUtils';
import { MessageStatus } from './MessageStatus';
import { ReactionRow } from './ReactionRow';
import { ReplyQuote } from './ReplyQuote';
import { type LocalChatMessage } from './types';

export function VoiceBubble({
  message,
  mine,
  currentUserId,
  isPlaying,
  onPlay,
  onLongPress,
  onToggleReaction,
  onRetry,
}: {
  message: LocalChatMessage;
  mine: boolean;
  currentUserId: string | null;
  isPlaying: boolean;
  onPlay: () => void;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
  onRetry: () => void;
}) {
  const dur = message.durationSec ?? 0;
  const durLabel = `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}`;
  return (
    <View style={[chatStyles.messageBlock, mine && chatStyles.messageMine, message._status === 'sending' && { opacity: 0.6 }]}>
      <Pressable
        style={[chatStyles.bubble, chatStyles.voiceBubble, mine ? chatStyles.bubbleMine : chatStyles.bubbleOther]}
        onPress={!message._status ? onPlay : undefined}
        onLongPress={message._status !== 'sending' ? onLongPress : undefined}
      >
        {message.replyTo && <ReplyQuote preview={message.replyTo} />}
        <View style={chatStyles.voiceRow}>
          <Ionicons
            name={isPlaying ? 'pause-circle' : 'play-circle'}
            size={32}
            color={mine ? colors.primary : colors.text}
          />
          <View style={chatStyles.voiceInfo}>
            <View style={chatStyles.voiceWave}>
              {Array.from({ length: 16 }).map((_, i) => (
                <View
                  key={i}
                  style={[chatStyles.voiceBar, { height: 4 + (i % 4) * 4 }, isPlaying && chatStyles.voiceBarActive]}
                />
              ))}
            </View>
            <Text style={chatStyles.voiceDuration}>{durLabel}</Text>
          </View>
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
