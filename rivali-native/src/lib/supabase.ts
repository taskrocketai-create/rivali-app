import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
// Chunk sessions so each Keychain value remains below the 2KB platform limit.
const storage = {
  async getItem(key: string) {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    const manifest = JSON.parse(raw) as { generation: string; count: number };
    const chunks = await Promise.all(Array.from({ length: manifest.count }, (_, i) => SecureStore.getItemAsync(`${key}.${manifest.generation}.${i}`)));
    return chunks.some(chunk => chunk === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string) {
    const previous = await SecureStore.getItemAsync(key);
    const generation = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const chunks = value.match(/[\s\S]{1,400}/g) ?? [''];
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(`${key}.${generation}.${i}`, chunks[i]);
    await SecureStore.setItemAsync(key, JSON.stringify({ generation, count: chunks.length }));
    if (previous) {
      const old = JSON.parse(previous) as { generation: string; count: number };
      await Promise.all(Array.from({ length: old.count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${old.generation}.${i}`)));
    }
  },
  async removeItem(key: string) {
    const previous = await SecureStore.getItemAsync(key);
    await SecureStore.deleteItemAsync(key);
    if (previous) {
      const old = JSON.parse(previous) as { generation: string; count: number };
      await Promise.all(Array.from({ length: old.count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${old.generation}.${i}`)));
    }
  },
};
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key, { auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }) : null;
