import { EventEmitter, requireNativeModule, type Subscription } from 'expo-modules-core';

type NativeSms = {
  id: string;
  address: string;
  body: string;
  date: number;
};

type SmsReaderNativeModule = {
  readRecentSms(days: number, limit: number): Promise<NativeSms[]>;
  startIncomingListener(): void;
  stopIncomingListener(): void;
  isSmsScannerAvailable(): boolean;
};

const SmsReader = requireNativeModule<SmsReaderNativeModule>('SmsReader');
const emitter = new EventEmitter(SmsReader);

export async function readRecentSms(days: number, limit: number): Promise<NativeSms[]> {
  const result = await SmsReader.readRecentSms(days, limit);
  return Array.isArray(result) ? result : [];
}

export function subscribeToIncomingSms(callback: (message: NativeSms) => void): () => void {
  let subscription: Subscription | null = null;

  try {
    SmsReader.startIncomingListener();
    subscription = emitter.addListener<NativeSms>('onIncomingSms', callback);
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
