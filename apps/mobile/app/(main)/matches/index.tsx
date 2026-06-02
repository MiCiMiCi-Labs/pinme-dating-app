import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, IconButton, people } from '@/design/system';

const newMatches = [...people, ...people].map((p, i) => ({ ...p, id: String(i) }));

export default function MatchesScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Matches</Text>
        <IconButton icon="options-outline" />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>New matches</Text>
        <View style={styles.grid}>
          {newMatches.map((person) => (
            <Pressable
              key={person.id}
              style={styles.card}
              onPress={() => router.push({ pathname: '/(main)/discover/[userId]', params: { userId: person.id } })}
            >
              <Image source={{ uri: person.image }} style={styles.cardImage} contentFit="cover" />
              <View style={styles.cardFooter}>
                <Text style={styles.cardName}>{person.name}</Text>
                <Text style={styles.cardMeta}>{person.age} · {person.distance}</Text>
              </View>
            </Pressable>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 30,
    paddingBottom: 8,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '900',
  },
  content: {
    paddingHorizontal: 28,
    paddingBottom: 34,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 20,
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  card: {
    width: '47%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.line,
  },
  cardImage: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  cardFooter: {
    padding: 12,
  },
  cardName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  cardMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
});
