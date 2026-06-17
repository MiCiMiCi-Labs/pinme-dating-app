const birthdayInputPattern = /^(\d{2})-(\d{2})-(\d{4})$/;
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})/;

export function formatBirthdayInput(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  const day = digits.slice(0, 2);
  const month = digits.slice(2, 4);
  const year = digits.slice(4, 8);

  if (digits.length <= 2) return day;
  if (digits.length <= 4) return `${day}-${month}`;

  return `${day}-${month}-${year}`;
}

export function isoToBirthdayInput(value?: string | null) {
  if (!value) return '';

  const match = value.match(isoDatePattern);

  if (!match) return formatBirthdayInput(value);

  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

export function birthdayInputToIso(value: string) {
  const match = value.match(birthdayInputPattern);

  if (!match) return null;

  const [, day, month, year] = match;
  const dayNumber = Number(day);
  const monthNumber = Number(month);
  const yearNumber = Number(year);

  if (monthNumber < 1 || monthNumber > 12) return null;

  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  const isValidDate =
    date.getUTCFullYear() === yearNumber &&
    date.getUTCMonth() === monthNumber - 1 &&
    date.getUTCDate() === dayNumber;

  if (!isValidDate) return null;

  return `${year}-${month}-${day}`;
}

export function getAgeFromBirthdayInput(value: string) {
  const isoBirthday = birthdayInputToIso(value);

  if (!isoBirthday) return null;

  const [year, month, day] = isoBirthday.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() + 1 - month;

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age -= 1;
  }

  return age;
}
