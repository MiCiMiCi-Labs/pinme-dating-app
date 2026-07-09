import { Pressable, Text, View } from 'react-native';
import { type Reaction } from '@/lib/api';
import { chatStyles } from './chatStyles';

type ReactionGroup = { emoji: string; count: number; userIds: string[] };

function groupReactions(reactions: Reaction[]): ReactionGroup[] {
  const map = new Map<string, { count: number; userIds: string[] }>();
  for (const r of reactions) {
    const entry = map.get(r.emoji) ?? { count: 0, userIds: [] };
    entry.count++;
    entry.userIds.push(r.userId);
    map.set(r.emoji, entry);
  }
  return Array.from(map.entries()).map(([emoji, { count, userIds }]) => ({ emoji, count, userIds }));
}

export function ReactionRow({
  reactions,
  currentUserId,
  onToggle,
}: {
  reactions: Reaction[] | undefined | null;
  currentUserId: string | null;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions || reactions.length === 0) return null;
  const groups = groupReactions(reactions);
  if (groups.length === 0) return null;
  return (
    <View style={chatStyles.reactionsRow}>
      {groups.map(({ emoji, count, userIds }) => (
        <Pressable
          key={emoji}
          style={[chatStyles.reactionChip, userIds.includes(currentUserId ?? '') && chatStyles.reactionChipMine]}
          onPress={() => onToggle(emoji)}
        >
          <Text style={chatStyles.reactionChipText}>{emoji} {count}</Text>
        </Pressable>
      ))}
    </View>
  );
}
