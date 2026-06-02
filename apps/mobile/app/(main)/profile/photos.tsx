import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SafeAreaView, StyleSheet, View } from 'react-native';
import { colors, IconButton, photos } from '@/design/system';

const gallery = [photos.blonde, photos.street, photos.portrait, photos.yellow, photos.black];

export default function PhotosScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <IconButton icon="chevron-back" onPress={() => router.back()} style={styles.back} />
      <Image source={{ uri: photos.blonde }} style={styles.mainPhoto} contentFit="cover" />
      <View style={styles.thumbs}>
        {gallery.map((item, index) => (
          <Image
            key={item}
            source={{ uri: item }}
            style={[styles.thumb, index !== 0 && styles.thumbMuted]}
            contentFit="cover"
          />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 58,
  },
  back: {
    marginLeft: 40,
    marginBottom: 34,
  },
  mainPhoto: {
    width: '100%',
    height: '64%',
  },
  thumbs: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 20,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  thumbMuted: {
    opacity: 0.55,
  },
});
