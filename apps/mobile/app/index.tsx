import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors, PrimaryButton } from '@/design/system';
import { onboardingSlides } from '@/data/mock';

export default function OnboardingScreen() {
  const [index, setIndex] = useState(0);
  const { height, width } = useWindowDimensions();
  const slide = onboardingSlides[index];
  const heroHeight = Math.min(height * 0.44, 360);
  const heroWidth = Math.min(width * 0.62, 242);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.heroWrap, { height: heroHeight + 42 }]}>
        <Image
          source={{ uri: onboardingSlides[(index + 2) % onboardingSlides.length].image }}
          style={[
            styles.peek,
            styles.peekLeft,
            { width: heroWidth * 0.48, height: heroHeight * 0.82 },
          ]}
        />
        <Image
          source={{ uri: slide.image }}
          style={[styles.heroImage, { width: heroWidth, height: heroHeight }]}
          contentFit="cover"
        />
        <Image
          source={{ uri: onboardingSlides[(index + 1) % onboardingSlides.length].image }}
          style={[
            styles.peek,
            styles.peekRight,
            { width: heroWidth * 0.48, height: heroHeight * 0.82 },
          ]}
        />
      </View>

      <View style={styles.copyWrap}>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.copy}>{slide.copy}</Text>
        <View style={styles.dots}>
          {onboardingSlides.map((item, dotIndex) => (
            <Pressable
              key={item.title}
              onPress={() => setIndex(dotIndex)}
              style={[styles.dot, index === dotIndex && styles.dotActive]}
            />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton onPress={() => router.push('/(auth)/register')}>Create an account</PrimaryButton>
        <View style={styles.signInRow}>
          <Text style={styles.signInText}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.signInLink}>Sign In</Text>
          </Pressable>
        </View>
        {__DEV__ && (
          <Pressable onPress={() => router.replace('/(main)/discover')}>
            <Text style={styles.devSkip}>[ Dev: skip to app ]</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 18,
  },
  heroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroImage: {
    borderRadius: 12,
    zIndex: 2,
  },
  peek: {
    position: 'absolute',
    borderRadius: 12,
    opacity: 0.95,
  },
  peekLeft: {
    left: -38,
  },
  peekRight: {
    right: -38,
  },
  copyWrap: {
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: colors.primary,
    fontSize: 25,
    fontWeight: '900',
    marginBottom: 16,
  },
  copy: {
    color: '#424560',
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 300,
  },
  dots: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 30,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#E7E7E7',
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  footer: {
    marginTop: 'auto',
    paddingHorizontal: 28,
    paddingBottom: 34,
    gap: 24,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  signInText: {
    color: colors.muted,
    fontSize: 14,
  },
  signInLink: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  devSkip: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
