import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

export function SkeletonBox({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.box, style]} />;
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#EBEBEB',
    borderRadius: 10,
  },
});
