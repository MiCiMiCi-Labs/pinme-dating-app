import { useState } from 'react';
import { SafeAreaView, StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  DiscoverCard,
  FilterSheet,
  MatchOverlay,
  SwipeActions,
} from '@/components/discover';
import { colors, IconButton, people, ScreenTitle } from '@/design/system';

type SwipeMode = 'idle' | 'like' | 'nope';

export default function SwipeScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [mode, setMode] = useState<SwipeMode>('idle');
  const [filterOpen, setFilterOpen] = useState(false);
  const [matched, setMatched] = useState(false);
  const { height } = useWindowDimensions();
  const person = people[activeIndex % people.length];
  const cardHeight = Math.min(height * 0.54, 440);

  const moveCard = (nextMode: Exclude<SwipeMode, 'idle'>) => {
    setMode(nextMode);
    if (nextMode === 'like' && activeIndex === 0) setMatched(true);

    setTimeout(() => {
      setActiveIndex((value) => value + 1);
      setMode('idle');
    }, 420);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScreenTitle
        title="Discover"
        subtitle="Chicago, Il"
        right={<IconButton icon="options-outline" onPress={() => setFilterOpen(true)} />}
      />

      <View style={[styles.deck, { height: cardHeight + 38 }]}>
        <View style={[styles.backCard, { height: cardHeight + 10 }]} />
        <DiscoverCard person={person} height={cardHeight} mode={mode} />
      </View>

      <SwipeActions onNope={() => moveCard('nope')} onLike={() => moveCard('like')} />

      {filterOpen ? <FilterSheet onClose={() => setFilterOpen(false)} /> : null}
      {matched ? <MatchOverlay onKeepSwiping={() => setMatched(false)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  deck: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  backCard: {
    position: 'absolute',
    width: '58%',
    borderRadius: 14,
    backgroundColor: '#D7E5F2',
    top: 6,
  },
});
