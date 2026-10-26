/**
 * Consent, anonymous install id, and "Delete all my data".
 * Everything ScamSafe stores on the phone is listed in ALL_KEYS, so "Delete all my data" is complete.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setInstallId } from './api';
import { CLOUD_ENABLED } from './config';
import { clearAll, STORAGE_KEY } from './storage';

export const CONSENT_KEY = 'scamsafe_consent_v1';
export const AUTO_KEY = 'scamsafe_auto_v1';
export const INSTALL_ID_KEY = 'scamsafe_install_id_v1';

const ALL_KEYS = [STORAGE_KEY, AUTO_KEY, CONSENT_KEY, INSTALL_ID_KEY];

export async function hasConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CONSENT_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function grantConsent(): Promise<void> {
  await AsyncStorage.setItem(CONSENT_KEY, '1');
}

function randomId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 24; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/**
 * Random id, NOT derived from the phone, used only so the backend can rate-limit.
 * Created only when the cloud check is enabled in this build.
 */
export async function ensureInstallId(): Promise<string> {
  if (!CLOUD_ENABLED) {
    return '';
  }
  try {
    let id = await AsyncStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = randomId();
      await AsyncStorage.setItem(INSTALL_ID_KEY, id);
    }
    setInstallId(id);
    return id;
  } catch {
    return '';
  }
}

/** Removes scan history, settings, the consent flag and the install id. */
export async function deleteAllUserData(): Promise<void> {
  await clearAll();
  await AsyncStorage.multiRemove(ALL_KEYS);
  setInstallId('');
}
