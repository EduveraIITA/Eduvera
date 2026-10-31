import * as SecureStore from 'expo-secure-store';

export type SavedAppearance = 'system' | 'light' | 'dark';
export const initialAppearance = (): SavedAppearance => 'system';
export async function readAppearance(): Promise<SavedAppearance> {
  const value = await SecureStore.getItemAsync('thatcampus.appearance');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export const saveAppearance = (value: SavedAppearance) => SecureStore.setItemAsync('thatcampus.appearance', value);
export const subscribeAppearance = (_listener: (value: SavedAppearance) => void) => () => {};
