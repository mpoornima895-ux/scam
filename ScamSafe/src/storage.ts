import AsyncStorage from '@react-native-async-storage/async-storage';

export type Entry = {
  id: string;
  text: string;
  sender: string;
  time: number;
  pinned: boolean;
  autoDeleted: boolean;
  risk_level: 'High' | 'Medium' | 'Low';
  risk_score: number;
  scam_type: string;
  explanation: string;
  scam_signals: string[];
  recommended_action: string;
  /** From the real signal score; null when no signal was found (UI shows no number). */
  confidence: number | null;
  engine?: 'cloud_ai' | 'on_device_rules';
  if_already_sent?: string;
};

// Aligned with api.ts RISK_THRESHOLDS.HIGH = 75
export const DANGER_SCORE = 75;
export const STORAGE_KEY = 'scamsafe_v1';

export function isDontClick(entry: { risk_score: number; risk_level: 'High' | 'Medium' | 'Low' }): boolean {
  return entry.risk_score >= DANGER_SCORE || entry.risk_level === 'High';
}

export async function getAll(): Promise<Entry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Entry[]) : [];
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to load scan history:', error);
    return [];
  }
}

async function saveAll(items: Entry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to save entries:', error);
    throw error;
  }
}

export async function addEntry(entry: Entry): Promise<Entry[]> {
  try {
    const current = await getAll();
    const normalized: Entry = {
      ...entry,
      pinned: entry.pinned || isDontClick(entry)
    };
    const next = [normalized, ...current.filter(item => item.id !== normalized.id)];
    await saveAll(next);
    return next;
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to add entry:', error);
    return [];
  }
}

export async function pinToggle(id: string): Promise<Entry[]> {
  try {
    const current = await getAll();
    const next = current.map(item => item.id === id ? { ...item, pinned: !item.pinned } : item);
    await saveAll(next);
    return next;
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to toggle pin:', error);
    return [];
  }
}

export async function remove(id: string): Promise<Entry[]> {
  try {
    const current = await getAll();
    const next = current.filter(item => item.id !== id);
    await saveAll(next);
    return next;
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to remove entry:', error);
    return [];
  }
}

export async function clearAll(): Promise<Entry[]> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    return [];
  } catch (error) {
    console.error('[ScamSafe Storage] Failed to clear all entries:', error);
    return [];
  }
}
