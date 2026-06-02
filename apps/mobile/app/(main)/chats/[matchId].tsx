import { router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, IconButton, people, ProfileThumb } from '@/design/system';
import { demoThread } from '@/data/mock';

export default function ChatRoomScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.replace('/(main)/chats')} />
          <View style={styles.personRow}>
            <ProfileThumb uri={people[3].image} size={54} />
            <View>
              <Text style={styles.title}>Grace</Text>
              <View style={styles.onlineRow}>
                <View style={styles.onlineDot} />
                <Text style={styles.online}>Online</Text>
              </View>
            </View>
          </View>
          <IconButton icon="ellipsis-vertical" />
        </View>

        <View style={styles.dayRow}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>Today</Text>
          <View style={styles.dayLine} />
        </View>

        <View style={styles.thread}>
          {demoThread.map((message) => (
            <View key={message.id} style={[styles.messageBlock, message.mine && styles.messageMine]}>
              <View style={[styles.bubble, message.mine ? styles.bubbleMine : styles.bubbleOther]}>
                <Text style={styles.bubbleText}>{message.body}</Text>
              </View>
              <Text style={[styles.messageTime, message.mine && styles.timeMine]}>
                {message.time}
                {message.mine ? '  ✓✓' : ''}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.inputRow}>
          <View style={styles.messageInput}>
            <TextInput
              placeholder={`Your message${matchId ? '' : ''}`}
              placeholderTextColor={colors.grayIcon}
              style={styles.input}
            />
            <Ionicons name="pie-chart-outline" size={22} color={colors.grayIcon} />
          </View>
          <Pressable style={styles.mic}>
            <Ionicons name="mic" size={23} color={colors.primary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  keyboard: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginLeft: 12,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '900',
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  online: {
    color: colors.muted,
    fontSize: 12,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 28,
  },
  dayLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  dayText: {
    color: colors.muted,
    fontSize: 12,
  },
  thread: {
    flex: 1,
    paddingTop: 20,
    gap: 16,
  },
  messageBlock: {
    alignSelf: 'flex-start',
    maxWidth: '82%',
  },
  messageMine: {
    alignSelf: 'flex-end',
  },
  bubble: {
    borderRadius: 12,
    padding: 16,
  },
  bubbleOther: {
    backgroundColor: colors.soft,
  },
  bubbleMine: {
    backgroundColor: '#F3F3F5',
  },
  bubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  messageTime: {
    color: colors.grayIcon,
    fontSize: 12,
    marginTop: 6,
  },
  timeMine: {
    textAlign: 'right',
    color: colors.primary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 28,
  },
  messageInput: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  mic: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
