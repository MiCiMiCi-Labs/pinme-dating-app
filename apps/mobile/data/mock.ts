import { photos, people } from '@/design/system';

export const onboardingSlides = [
  {
    title: 'Algorithm',
    copy: 'Users going through a vetting process to ensure you never match with bots.',
    image: photos.blonde,
  },
  {
    title: 'Matches',
    copy: 'We match you with people that have a large array of similar interests.',
    image: photos.pink,
  },
  {
    title: 'Premium',
    copy: 'Sign up today and enjoy the first month of premium benefits on us.',
    image: photos.yellow,
  },
];

export const profileGallery = [
  photos.black,
  photos.street,
  photos.portrait,
  photos.yellow,
  photos.blonde,
];

export const profileInterests = ['Travelling', 'Books', 'Music', 'Dancing', 'Modeling'];

export const chatPreviews = [
  { name: 'Emelie', text: 'Sticker', time: '23 min', unread: 1, image: people[0].image },
  { name: 'Abigail', text: 'Typing..', time: '27 min', unread: 2, image: people[1].image },
  { name: 'Elizabeth', text: 'Ok, see you then.', time: '33 min', unread: 0, image: people[2].image },
  { name: 'Penelope', text: 'You: Hey! What’s up, long time..', time: '50 min', unread: 0, image: people[3].image },
  { name: 'Grace', text: 'You: Great I will write later', time: '1 hour', unread: 0, image: people[0].image },
];

export const demoThread = [
  {
    id: '1',
    mine: false,
    time: '2:55 PM',
    body: 'Hi Jake, how are you? I saw on the app that we’ve crossed paths several times this week.',
  },
  {
    id: '2',
    mine: true,
    time: '3:02 PM',
    body: 'Haha truly! Nice to meet you Grace! What about a cup of coffee today evening?',
  },
  { id: '3', mine: false, time: '3:10 PM', body: 'Sure, let’s do it!' },
  {
    id: '4',
    mine: true,
    time: '3:12 PM',
    body: 'Great I will write later the exact time and place. See you soon!',
  },
];

export const myProfileFields = [
  ['Name', 'Mia'],
  ['Gender', 'FEMALE'],
  ['Birthday', '2000-01-01'],
  ['City', 'Chicago'],
  ['Height', '168 cm'],
  ['Education', 'University'],
  ['Job title', 'Product designer'],
  ['Company', 'PinMe'],
  ['Relationship goal', 'Long-term relationship'],
  ['Drinking', 'Sometimes'],
  ['Smoking', 'No'],
  ['MBTI', 'ENFP'],
  ['Constellation', 'Capricorn'],
] as const;

export const myProfilePrompts = [
  ['Prompt 1', 'A perfect weekend is coffee, galleries, and a long walk.'],
  ['Prompt 2', 'I get along best with people who are kind and curious.'],
] as const;

export const myPhotoSlots = [photos.portrait, photos.blonde, photos.street, null, null, null];
