export type CitySuggestion = {
  placeId: string;
  label: string;
  mainText: string;
  secondaryText: string;
};

const citySuggestions: CitySuggestion[] = [
  { placeId: 'local-auckland-nz', label: 'Auckland, New Zealand', mainText: 'Auckland', secondaryText: 'New Zealand' },
  { placeId: 'local-wellington-nz', label: 'Wellington, New Zealand', mainText: 'Wellington', secondaryText: 'New Zealand' },
  { placeId: 'local-christchurch-nz', label: 'Christchurch, New Zealand', mainText: 'Christchurch', secondaryText: 'New Zealand' },
  { placeId: 'local-hamilton-nz', label: 'Hamilton, New Zealand', mainText: 'Hamilton', secondaryText: 'New Zealand' },
  { placeId: 'local-dunedin-nz', label: 'Dunedin, New Zealand', mainText: 'Dunedin', secondaryText: 'New Zealand' },
  { placeId: 'local-tauranga-nz', label: 'Tauranga, New Zealand', mainText: 'Tauranga', secondaryText: 'New Zealand' },
  { placeId: 'local-sydney-au', label: 'Sydney, Australia', mainText: 'Sydney', secondaryText: 'Australia' },
  { placeId: 'local-melbourne-au', label: 'Melbourne, Australia', mainText: 'Melbourne', secondaryText: 'Australia' },
  { placeId: 'local-brisbane-au', label: 'Brisbane, Australia', mainText: 'Brisbane', secondaryText: 'Australia' },
  { placeId: 'local-chicago-us', label: 'Chicago, IL, United States', mainText: 'Chicago', secondaryText: 'IL, United States' },
  { placeId: 'local-new-york-us', label: 'New York, NY, United States', mainText: 'New York', secondaryText: 'NY, United States' },
  { placeId: 'local-los-angeles-us', label: 'Los Angeles, CA, United States', mainText: 'Los Angeles', secondaryText: 'CA, United States' },
  { placeId: 'local-san-francisco-us', label: 'San Francisco, CA, United States', mainText: 'San Francisco', secondaryText: 'CA, United States' },
];

export async function searchCities(input: string): Promise<CitySuggestion[]> {
  const query = input.trim().toLowerCase();

  if (query.length < 2) {
    return [];
  }

  return citySuggestions
    .filter((city) => city.label.toLowerCase().includes(query))
    .slice(0, 6);
}

/*
 * TODO: Re-enable Google Places once a key is ready.
 *
 * Use:
 * POST https://places.googleapis.com/v1/places:autocomplete
 * body: { input, includedPrimaryTypes: ['(cities)'], languageCode: 'en' }
 * header: X-Goog-Api-Key: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY
 */
