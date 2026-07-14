import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BirthdaySheet,
  ProfileOnboardingNav,
  ProfileOnboardingStepView,
  profileOnboardingSteps,
} from '@/components/profile-onboarding';
import { colors, PrimaryButton } from '@/design/system';

export default function CreateProfileScreen() {
  const [stepIndex, setStepIndex] = useState(0);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const step = profileOnboardingSteps[stepIndex];

  const goNext = () => {
    if (stepIndex === profileOnboardingSteps.length - 1) {
      router.replace('/(main)/discover');
      return;
    }

    setStepIndex((value) => value + 1);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ProfileOnboardingNav
        canGoBack={stepIndex > 0}
        onBack={() => setStepIndex((value) => value - 1)}
        onSkip={goNext}
      />

      <ProfileOnboardingStepView step={step} onBirthdayPress={() => setCalendarOpen(true)} />

      <View style={styles.footer}>
        <PrimaryButton onPress={goNext}>
          {step === 'details' ? 'Confirm' : step === 'notifications' ? 'I want to be notified' : 'Continue'}
        </PrimaryButton>
      </View>

      {calendarOpen ? <BirthdaySheet onClose={() => setCalendarOpen(false)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
});
