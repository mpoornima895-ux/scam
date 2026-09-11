import * as SmsReaderModule from 'sms-reader';

export type SmsMessage = { id: string; address: string; body: string; date: number };

export async function readRecentSms(days: number, limit: number): Promise<SmsMessage[]> {
  try {
    const result = await SmsReaderModule.readRecentSms(days, limit);
    if (!Array.isArray(result)) {
      return [];
    }

    const normalized: SmsMessage[] = [];
    for (const item of result) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const id = item.id == null ? '' : String(item.id);
      const address = item.address == null ? 'Unknown' : String(item.address);
      const body = item.body == null ? '' : String(item.body);
      const date = typeof item.date === 'number' ? item.date : Number(item.date) || Date.now();
      if (!id || !body) {
        continue;
      }
      normalized.push({ id, address, body, date });
    }
    return normalized;
  } catch {
    return [];
  }
}

export function subscribeToIncomingSms(callback: (message: SmsMessage) => void): () => void {
  try {
    const unsubscribe = SmsReaderModule.subscribeToIncomingSms((item: unknown) => {
      try {
        if (!item || typeof item !== 'object') {
          return;
        }
        const raw = item as Record<string, unknown>;
        const id = raw.id == null ? `incoming-${Date.now()}` : String(raw.id);
        const address = raw.address == null ? 'Unknown' : String(raw.address);
        const body = raw.body == null ? '' : String(raw.body);
        const date = typeof raw.date === 'number' ? raw.date : Number(raw.date) || Date.now();
        if (!body) {
          return;
        }
        callback({ id, address, body, date });
      } catch {
      }
    });

    return typeof unsubscribe === 'function' ? unsubscribe : () => {};
  } catch {
    return () => {};
  }
}

export function isSmsScannerAvailable(): boolean {
  try {
    const result = SmsReaderModule.isSmsScannerAvailable();
    return !!result;
  } catch {
    return false;
  }
}
