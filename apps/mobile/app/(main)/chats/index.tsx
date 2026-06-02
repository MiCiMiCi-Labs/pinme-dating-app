import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatPreviewRow } from '@/components/cards';
import { colors, IconButton, people, ProfileThumb } from '@/design/system';
import { chatPreviews } from '@/data/mock';

export default function ChatListScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Messages</Text>
          <IconButton icon="options-outline" />
        </View>
        <View style={styles.search}>
          <Ionicons name="search-outline" size={20} color={colors.grayIcon} />
          <TextInput placeholder="Search" placeholderTextColor={colors.grayIcon} style={styles.searchInput} />
        </View>
        <Text style={styles.sectionTitle}>Activities</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityRow}>
          {['You', 'Emma', 'Ava', 'Sophia', 'Mia'].map((name, index) => (
            <View key={name} style={styles.activityItem}>
              <View style={[styles.activityRing, index < 2 && styles.activityRingHot]}>
                <ProfileThumb uri={people[index % people.length].image} size={58} />
              </View>
              <Text style={styles.activityName}>{name}</Text>
            </View>
          ))}
        </ScrollView>
        <Text style={styles.sectionTitle}>Messages</Text>
        <View style={styles.list}>
          {chatPreviews.map((chat, index) => (
            <ChatPreviewRow
              key={chat.name}
              {...chat}
              showDivider={index < chatPreviews.length - 1}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  search: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    gap: 10,
    marginTop: 30,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 14,
  },
  activityRow: {
    gap: 18,
    paddingRight: 22,
  },
  activityItem: {
    alignItems: 'center',
    gap: 8,
  },
  activityRing: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityRingHot: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  activityName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
  },
  list: {
    gap: 0,
  },
});
