// Shared age calculation, used anywhere a user's age is derived from their
// stored birthday (@db.Date, always a UTC-midnight value). Every caller must
// use UTC calendar-date getters — mixing local-timezone getters in one place
// and UTC in another lets a user pass an age filter under one rule but be
// reported with a different age under the other, particularly around local
// midnight in timezones ahead of UTC (e.g. Pacific/Auckland).
export function calculateAge(birthday: Date): number {
  const today = new Date();
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birthday.getUTCMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthday.getUTCDate())
  ) {
    age -= 1;
  }

  return age;
}
