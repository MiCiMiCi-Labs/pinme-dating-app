import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, ProfileThumb } from '@/design/system';

export function ChatPreviewRow({
  name,
  text,
  time,
  unread,
  image,
  intimacyColor,
  showDivider,
  onPress,
}: {
  name: string;
  text: string;
  time: string;
  unread: number;
  image: string;
  intimacyColor?: string;
  showDivider?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable style={styles.chatRow} onPress={onPress ?? (() => router.push('/(main)/chats/demo-match'))}>
      <ProfileThumb uri={image} size={58} />
      <View style={styles.chatBody}>
        <Text style={styles.chatName}>{name}</Text>
        <Text style={styles.chatText}>{text}</Text>
      </View>
      <View style={styles.chatMeta}>
        <View style={styles.metaTop}>
          {intimacyColor ? <Text style={[styles.heart, { color: intimacyColor }]}>♥</Text> : null}
          <Text style={styles.time}>{time}</Text>
        </View>
        {unread ? (
          <View style={styles.unread}>
            <Text style={styles.unreadText}>{unread}</Text>
          </View>
        ) : null}
      </View>
      {showDivider ? <View style={styles.rowLine} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chatRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatBody: {
    flex: 1,
    marginLeft: 12,
  },
  chatName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
  },
  chatText: {
    color: colors.text,
    fontSize: 13,
    marginTop: 4,
  },
  chatMeta: {
    alignItems: 'flex-end',
    gap: 8,
  },
  metaTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  heart: {
    fontSize: 15,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.12)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  time: {
    color: colors.grayIcon,
    fontSize: 12,
  },
  unread: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  rowLine: {
    position: 'absolute',
    left: 70,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: colors.line,
  },
});
