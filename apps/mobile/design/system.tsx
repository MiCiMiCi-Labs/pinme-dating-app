import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

export const colors = {
  bg: '#FFFFFF',
  text: '#101116',
  muted: '#73727C',
  soft: '#F7EAED',
  line: '#ECECF1',
  primary: '#E64C61',
  primaryDark: '#D94356',
  orange: '#E9782F',
  purple: '#8B2B90',
  grayIcon: '#A8ABB7',
};

export const photos = {
  blonde:
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=85',
  pink:
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=900&q=85',
  yellow:
    'https://images.unsplash.com/photo-1502823403499-6ccfcf4fb453?auto=format&fit=crop&w=900&q=85',
  black:
    'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=900&q=85',
  neon:
    'https://images.unsplash.com/photo-1509967419530-da38b4704bc6?auto=format&fit=crop&w=900&q=85',
  man:
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=900&q=85',
  beach:
    'https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=900&q=85',
  redhead:
    'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=900&q=85',
  street:
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=85',
  portrait:
    'https://images.unsplash.com/photo-1512316609839-ce289d3eba0a?auto=format&fit=crop&w=900&q=85',
};

export const people = [
  {
    id: '1',
    name: 'Jessica Parker',
    age: 23,
    role: 'Professional model',
    city: 'Chicago, IL United States',
    distance: '1 km',
    image: photos.black,
  },
  {
    id: '2',
    name: 'Camila Snow',
    age: 23,
    role: 'Marketer',
    city: 'Chicago, IL United States',
    distance: '3 km',
    image: photos.neon,
  },
  {
    id: '3',
    name: 'Bred Jackson',
    age: 25,
    role: 'Photograph',
    city: 'Chicago, IL United States',
    distance: '7 km',
    image: photos.man,
  },
  {
    id: '4',
    name: 'Grace',
    age: 24,
    role: 'Designer',
    city: 'Chicago, IL United States',
    distance: '5 km',
    image: photos.redhead,
  },
];

export function PrimaryButton({
  children,
  onPress,
  variant = 'filled',
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: 'filled' | 'soft' | 'outline';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.button,
        variant === 'filled' && styles.buttonFilled,
        variant === 'soft' && styles.buttonSoft,
        variant === 'outline' && styles.buttonOutline,
        style,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'filled' ? styles.buttonTextFilled : styles.buttonTextAccent,
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  color = colors.primary,
  onPress,
  size = 52,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  onPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.iconButton, { width: size, height: size }, style]}>
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  );
}

export function TextButton({
  children,
  onPress,
  color = colors.primary,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <Text style={[styles.textButton, { color }, style]}>{children}</Text>
    </Pressable>
  );
}

export function SocialIconButton({
  icon,
  onPress,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.socialIconButton, style]}>
      <Ionicons name={icon} size={24} color={colors.text} />
    </Pressable>
  );
}

export function RoundActionButton({
  icon,
  onPress,
  color = colors.primary,
  filled = false,
  active = false,
  size = 76,
  iconSize = 32,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  filled?: boolean;
  active?: boolean;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const isFilled = filled || active;

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.roundActionButton,
        { width: size, height: size, borderRadius: size / 2 },
        isFilled && { backgroundColor: color },
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={isFilled ? '#FFFFFF' : color} />
    </Pressable>
  );
}

export function PillActionButton({
  label,
  icon,
  onPress,
  color = colors.primary,
  style,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.pillActionButton, { backgroundColor: color }, style]}>
      {icon ? <Ionicons name={icon} size={22} color="#FFFFFF" /> : null}
      <Text style={styles.pillActionText}>{label}</Text>
    </Pressable>
  );
}

export function ScreenTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.headerRow}>
      <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : null)} />
      <View style={styles.headerCenter}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right ?? <IconButton icon="options-outline" />}
    </View>
  );
}

export function LogoMark({ size = 104 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <LinearGradient
        colors={['#F36D35', '#EF3D63', '#8F2DA8']}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={[styles.logoCircle, { width: size * 0.68, height: size * 0.68 }]}
      />
      <View
        style={[
          styles.logoCut,
          {
            width: size * 0.38,
            height: size * 0.58,
            borderRadius: size * 0.24,
            left: size * 0.24,
          },
        ]}
      />
      <View
        style={[
          styles.logoCut,
          {
            width: size * 0.22,
            height: size * 0.42,
            borderRadius: size * 0.16,
            left: size * 0.48,
            top: size * 0.3,
          },
        ]}
      />
    </View>
  );
}

export function InterestPill({
  label,
  icon,
  selected,
}: {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  selected?: boolean;
}) {
  return (
    <View style={[styles.pill, selected && styles.pillSelected]}>
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={selected ? '#FFFFFF' : colors.primary}
      />
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{label}</Text>
    </View>
  );
}

export function ProfileThumb({
  uri,
  size = 54,
  style,
}: {
  uri: string;
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  return (
    <Image
      source={{ uri }}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      contentFit="cover"
    />
  );
}

export function StatText({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.statText, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonFilled: {
    backgroundColor: colors.primary,
  },
  buttonSoft: {
    backgroundColor: colors.soft,
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '800',
  },
  buttonTextFilled: {
    color: '#FFFFFF',
  },
  buttonTextAccent: {
    color: colors.primary,
  },
  textButton: {
    fontSize: 14,
    fontWeight: '800',
  },
  socialIconButton: {
    flex: 1,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  roundActionButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    shadowColor: '#E5B9C0',
    shadowOpacity: 0.25,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  pillActionButton: {
    minHeight: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 24,
    shadowColor: '#E5B9C0',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  pillActionText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  headerRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
  },
  headerCenter: {
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  headerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  iconButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCircle: {
    borderRadius: 999,
    transform: [{ rotate: '-18deg' }],
  },
  logoCut: {
    position: 'absolute',
    top: 22,
    backgroundColor: '#FFFFFF',
    transform: [{ rotate: '22deg' }],
  },
  pill: {
    minHeight: 46,
    width: '47%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.bg,
  },
  pillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.text,
    fontWeight: '700',
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  statText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});
