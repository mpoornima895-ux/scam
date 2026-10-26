import { NativeModule, requireNativeModule, type EventSubscription } from 'expo-modules-core';

type NativeSms = {
  id: string;
  address: string;
  body: string;
  date: number;
};

// Events emitted by the native Kotlin module (Events("onIncomingSms") in SmsReaderModule.kt)
type SmsReaderEvents = {
  onIncomingSms: (message: NativeSms) => void;
};

// Expo SDK 57: native modules are typed by extending NativeModule with an events map.
// NativeModule already provides addListener / removeListener / emit.
declare class SmsReaderNativeModule extends NativeModule<SmsReaderEvents> {
  readRecentSms(days: number, limit: number): Promise<NativeSms[]>;
  startIncomingListener(): void;
  stopIncomingListener(): void;
  isSmsScannerAvailable(): boolean;
}

const SmsReader = requireNativeModule<SmsReaderNativeModule>('SmsReader');

export async function readRecentSms(days: number, limit: number): Promise<NativeSms[]> {
  const result = await SmsReader.readRecentSms(days, limit);
  return Array.isArray(result) ? result : [];
}

export function subscribeToIncomingSms(callback: (message: NativeSms) => void): () => void {
  let subscription: EventSubscription | null = null;

  try {
    SmsReader.startIncomingListener();
    subscription = SmsReader.addListener('onIncomingSms', callback);
  } catch {
  }

  return () => {
    try {
      subscription?.remove();
    } catch {
    }
    try {
      SmsReader.stopIncomingListener();
    } catch {
    }
  };
}

export function isSmsScannerAvailable(): boolean {
  try {
    return SmsReader.isSmsScannerAvailable();
  } catch {
    return false;
  }
}
