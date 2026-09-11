import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  FlatList,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import { analyzeMessage } from './src/api';
import { addEntry, clearAll, getAll, isDontClick, pinToggle, remove, type Entry } from './src/storage';
import { isSmsScannerAvailable, readRecentSms, subscribeToIncomingSms, type SmsMessage } from './src/smsReader';

type TabKey = 'scan' | 'history' | 'pinned';
type SmsResult = {
  risk_level: 'High' | 'Medium' | 'Low';
  risk_score: number;
  scam_type: string;
  explanation: string;
  scam_signals: string[];
  recommended_action: string;
  confidence: number;
  if_already_sent?: string;
};

const SCAN_LIMIT = 10;
const DANGER_SCORE = 80;
const AUTO_KEY = 'scamsafe_auto_v1';
const STORAGE_KEY = 'scamsafe_v1';

const COLORS = {
  bg: '#050508',
  surface: '#0e1015',
  s2: '#14171f',
  s3: '#1c2030',
  border: '#1e2535',
  accent: '#00e5a0',
  text: '#f0f4ff',
  t2: '#8899bb',
  t3: '#445566',
  white: '#ffffff',
  red: '#ef4444'
} as const;

const RISK_THEME = {
  High: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.6)', chip: 'rgba(239,68,68,0.2)', txt: '#fca5a5' },
  Medium: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.6)', chip: 'rgba(245,158,11,0.2)', txt: '#fcd34d' },
  Low: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.5)', chip: 'rgba(16,185,129,0.15)', txt: '#6ee7b7' }
} as const;

const FONT = Platform.select({ android: 'monospace', ios: 'Menlo', default: 'monospace' });

function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('scan');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [manualText, setManualText] = useState<string>('');
  const [manualResult, setManualResult] = useState<Entry | null>(null);
  const [manualLoading, setManualLoading] = useState<boolean>(false);
  const [scanLoading, setScanLoading] = useState<boolean>(false);
  const [scanTotal, setScanTotal] = useState<number>(0);
  const [scanDone, setScanDone] = useState<number>(0);
  const [autoNote, setAutoNote] = useState<string>('Idle');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fade = useRef(new Animated.Value(0)).current;
  const autoEnabledRef = useRef<boolean>(true);
  const entriesRef = useRef<Entry[]>([]);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastAutoScanAtRef = useRef<number>(0);
  const inboxScanLockRef = useRef<boolean>(false);

  useEffect(() => {
    autoEnabledRef.current = autoEnabled;
  }, [autoEnabled]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true
    }).start();
  }, [fade]);

  const loadInitialState = useCallback(async (): Promise<void> => {
    try {
      const storedEntries = await getAll();
      setEntries(storedEntries);
    } catch {
      setEntries([]);
    }

    try {
      const toggle = await AsyncStorage.getItem(AUTO_KEY);
      const value = toggle !== '0';
      setAutoEnabled(value);
      autoEnabledRef.current = value;
    } catch {
      setAutoEnabled(true);
      autoEnabledRef.current = true;
    }
  }, []);

  const hasReadSmsPermission = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return false;
    }
    try {
      return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
    } catch {
      return false;
    }
  }, []);

  const requestSmsPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      return false;
    }
    try {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_SMS,
        PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
      ]);
      return (
        result['android.permission.READ_SMS'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.RECEIVE_SMS'] === PermissionsAndroid.RESULTS.GRANTED
      );
    } catch {
      return false;
    }
  }, []);

  const mapAnalyzedToEntry = useCallback((source: SmsMessage | { id: string; address: string; body: string; date: number }, result: SmsResult): Entry => {
    return {
      id: source.id,
      text: source.body,
      sender: source.address,
      time: source.date,
      pinned: false,
      autoDeleted: false,
      ...result
    };
  }, []);

  const silentAnalyzeMessages = useCallback(async (messages: SmsMessage[]): Promise<{ added: number; danger: number }> => {
    let added = 0;
    let danger = 0;

    for (const message of messages) {
      try {
        const result = await analyzeMessage(message.body);
        if (!result) {
          continue;
        }
        const entry = mapAnalyzedToEntry(message, result);
        const next = await addEntry(entry);
        setEntries(next);
        added += 1;
        if (isDontClick(entry)) {
          danger += 1;
        }
      } catch {
      }
    }

    return { added, danger };
  }, [mapAnalyzedToEntry]);

  const runAutoScan = useCallback(async (): Promise<void> => {
    if (!autoEnabledRef.current) {
      setAutoNote('Auto-scan OFF');
      return;
    }
    if (!isSmsScannerAvailable()) {
      setAutoNote('SMS scanner unavailable');
      return;
    }
    if (inboxScanLockRef.current) {
      return;
    }

    inboxScanLockRef.current = true;
    lastAutoScanAtRef.current = Date.now();
    setAutoNote('Auto-scanning in background...');

    try {
      const allowed = await hasReadSmsPermission();
      if (!allowed) {
        setAutoNote('Permission missing');
        return;
      }

      const recentMessages = await readRecentSms(7, SCAN_LIMIT);
      const knownIds = new Set(entriesRef.current.map(item => item.id));
      const freshMessages = recentMessages.filter(item => !knownIds.has(item.id));

      if (freshMessages.length === 0) {
        setAutoNote('No new SMS to analyze');
        return;
      }

      const summary = await silentAnalyzeMessages(freshMessages);
      setAutoNote(`Auto-scan done · ${summary.added} checked · ${summary.danger} flagged`);
    } catch {
      setAutoNote('Auto-scan failed');
    } finally {
      inboxScanLockRef.current = false;
    }
  }, [hasReadSmsPermission, silentAnalyzeMessages]);

  useEffect(() => {
    void (async () => {
      await loadInitialState();
      await runAutoScan();
    })();
  }, [loadInitialState, runAutoScan]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (previousState.match(/inactive|background/) && nextState === 'active') {
        const elapsed = Date.now() - lastAutoScanAtRef.current;
        if (autoEnabledRef.current && elapsed > 30_000) {
          void runAutoScan();
        }
      }
    });

    return () => {
      subscription.remove();
    };
  }, [runAutoScan]);

  useEffect(() => {
    const unsubscribe = subscribeToIncomingSms(async (message: SmsMessage) => {
      if (!autoEnabledRef.current) {
        return;
      }
      try {
        const result = await analyzeMessage(message.body);
        if (!result) {
          return;
        }
        const entry = mapAnalyzedToEntry(message, result);
        const next = await addEntry(entry);
        setEntries(next);

        if (result.risk_score >= DANGER_SCORE) {
          Alert.alert(
            `🚫 DON'T CLICK · ${result.risk_score}/100`,
            `${message.address}\n${result.scam_type}\n${result.recommended_action}`
          );
        }
      } catch {
      }
    });

    return () => {
      try {
        unsubscribe();
      } catch {
      }
    };
  }, [mapAnalyzedToEntry]);

  const onToggleAuto = useCallback(async (value: boolean): Promise<void> => {
    try {
      setAutoEnabled(value);
      autoEnabledRef.current = value;
      await AsyncStorage.setItem(AUTO_KEY, value ? '1' : '0');
      setAutoNote(value ? 'Auto-scan ON' : 'Auto-scan OFF');
    } catch {
      setAutoNote(value ? 'Auto-scan ON' : 'Auto-scan OFF');
    }
  }, []);

  const onManualScan = useCallback(async (): Promise<void> => {
    if (scanLoading) {
      return;
    }

    try {
      const granted = await requestSmsPermissions();
      if (!granted) {
        Alert.alert(
          'SMS Permission Required',
          'ScamSafe needs READ_SMS and RECEIVE_SMS permissions to scan your messages.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => {
                void Linking.openSettings();
              }
            }
          ]
        );
        return;
      }

      const recentMessages = await readRecentSms(7, SCAN_LIMIT);
      if (recentMessages.length === 0) {
        Alert.alert('No messages found', 'No SMS found in the last 7 days.');
        return;
      }

      setScanLoading(true);
      setScanTotal(recentMessages.length);
      setScanDone(0);

      let dontClickCount = 0;

      for (let index = 0; index < recentMessages.length; index += 1) {
        const message = recentMessages[index];
        setScanDone(index);

        try {
          const result = await analyzeMessage(message.body);
          if (result) {
            const entry = mapAnalyzedToEntry(message, result);
            const next = await addEntry(entry);
            setEntries(next);
            if (isDontClick(entry)) {
              dontClickCount += 1;
            }
          }
        } catch {
        }

        setScanDone(index + 1);
      }

      lastAutoScanAtRef.current = Date.now();
      Alert.alert('✅ Scan Complete', `${recentMessages.length} messages\n🚫 ${dontClickCount} don't-click`);
    } catch {
      Alert.alert('Scan failed', 'Something went wrong during message analysis.');
    } finally {
      setScanLoading(false);
    }
  }, [mapAnalyzedToEntry, requestSmsPermissions, scanLoading]);

  const onManualTextCheck = useCallback(async (): Promise<void> => {
    if (manualLoading || manualText.trim().length < 10) {
      return;
    }

    setManualLoading(true);
    setManualResult(null);

    try {
      const result = await analyzeMessage(manualText.trim());
      if (!result) {
        Alert.alert('Analysis failed', 'Could not analyze this message right now.');
        return;
      }

      const entry: Entry = {
        id: `manual-${Date.now()}`,
        text: manualText.trim(),
        sender: 'Manual Check',
        time: Date.now(),
        pinned: false,
        autoDeleted: false,
        ...result
      };

      const next = await addEntry(entry);
      setEntries(next);
      setManualResult({ ...entry, pinned: entry.pinned || isDontClick(entry) });
      setTab('scan');
    } catch {
      Alert.alert('Error', 'Unable to analyze the pasted text.');
    } finally {
      setManualLoading(false);
    }
  }, [manualLoading, manualText]);

  const onTogglePin = useCallback(async (id: string): Promise<void> => {
    try {
      const next = await pinToggle(id);
      setEntries(next);
    } catch {
    }
  }, []);

  const onDeleteEntry = useCallback((id: string): void => {
    Alert.alert('Delete item', 'Remove this message from history?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const next = await remove(id);
              setEntries(next);
            } catch {
            }
          })();
        }
      }
    ]);
  }, []);

  const onClearHistory = useCallback((): void => {
    Alert.alert('Clear all history', 'This will remove every saved scan result.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const next = await clearAll();
              setEntries(next);
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([]));
            } catch {
            }
          })();
        }
      }
    ]);
  }, []);

  const progressPercent = useMemo(() => {
    if (scanTotal <= 0) {
      return 0;
    }
    return Math.round((scanDone / scanTotal) * 100);
  }, [scanDone, scanTotal]);

  const counts = useMemo(() => {
    let fraud = 0;
    let suspicious = 0;
    let safe = 0;

    for (const entry of entries) {
      if (entry.risk_level === 'High') {
        fraud += 1;
      } else if (entry.risk_level === 'Medium') {
        suspicious += 1;
      } else {
        safe += 1;
      }
    }

    return { fraud, suspicious, safe };
  }, [entries]);

  const pinnedEntries = useMemo(() => entries.filter(item => item.pinned), [entries]);

  const renderHistoryCard = useCallback(({ item }: { item: Entry }) => {
    return (
      <RiskCard
        entry={item}
        expanded={expandedId === item.id}
        onToggle={() => setExpandedId(current => current === item.id ? null : item.id)}
        onPin={() => {
          void onTogglePin(item.id);
        }}
        onDelete={() => onDeleteEntry(item.id)}
      />
    );
  }, [expandedId, onDeleteEntry, onTogglePin]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <Animated.View style={[styles.header, { opacity: fade }]}> 
        <View style={styles.headerRow}>
          <Text style={styles.brand}>ScamSafe</Text>
          <View style={styles.betaBadge}>
            <Text style={styles.betaText}>BETA</Text>
          </View>
        </View>
        <Text style={styles.headerSub}>AI-powered SMS fraud detector for Indian users</Text>
      </Animated.View>

      <View style={styles.statsBar}>
        <StatColumn icon="⚠" label="Fraud" value={counts.fraud} color="#fca5a5" />
        <View style={styles.statsDivider} />
        <StatColumn icon="◈" label="Suspicious" value={counts.suspicious} color="#fcd34d" />
        <View style={styles.statsDivider} />
        <StatColumn icon="✓" label="Safe" value={counts.safe} color="#6ee7b7" />
      </View>

      <View style={styles.tabs}>
        <TabButton label="Scan" active={tab === 'scan'} onPress={() => setTab('scan')} />
        <TabButton label="History" active={tab === 'history'} onPress={() => setTab('history')} />
        <TabButton label={`Pinned (${pinnedEntries.length})`} active={tab === 'pinned'} onPress={() => setTab('pinned')} />
      </View>

      {tab === 'scan' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <View style={styles.flexOne}>
                <Text style={styles.panelTitle}>Auto-scan toggle</Text>
                <Text style={styles.panelSub}>{autoNote}</Text>
              </View>
              <Switch
                value={autoEnabled}
                onValueChange={(value) => {
                  void onToggleAuto(value);
                }}
                trackColor={{ false: COLORS.s3, true: COLORS.accent }}
                thumbColor={autoEnabled ? '#0a2a21' : '#7b879f'}
              />
            </View>
          </View>

          <Pressable style={({ pressed }) => [styles.scanButton, pressed && styles.scalePressed, scanLoading && styles.dimmed]} onPress={() => { void onManualScan(); }}>
            <Text style={styles.scanButtonText}>{scanLoading ? 'Analyzing...' : 'Scan My Messages'}</Text>
            <Text style={styles.scanButtonSub}>Last 7 days · max {SCAN_LIMIT} SMS</Text>
          </Pressable>

          {scanLoading ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressText}>Analyzing {scanDone} of {scanTotal} messages...</Text>
            </View>
          ) : null}

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Manual text check</Text>
            <Text style={styles.panelSub}>Paste a suspicious SMS, UPI alert, bank text, or phishing attempt</Text>
            <TextInput
              value={manualText}
              onChangeText={setManualText}
              multiline
              style={styles.input}
              placeholder="Paste message here..."
              placeholderTextColor={COLORS.t3}
              textAlignVertical="top"
            />
            <View style={styles.rowBetween}>
              <Text style={styles.helperText}>Minimum 10 characters</Text>
              <Pressable
                style={({ pressed }) => [styles.checkButton, pressed && styles.scalePressed, manualText.trim().length < 10 && styles.dimmed, manualLoading && styles.dimmed]}
                disabled={manualText.trim().length < 10 || manualLoading}
                onPress={() => { void onManualTextCheck(); }}
              >
                <Text style={styles.checkButtonText}>{manualLoading ? 'Checking...' : 'Analyze Text'}</Text>
              </Pressable>
            </View>

            {manualResult ? (
              <View style={styles.manualResultWrap}>
                <RiskCard
                  entry={manualResult}
                  expanded={true}
                  onPin={() => {
                    void onTogglePin(manualResult.id);
                  }}
                  onDelete={() => onDeleteEntry(manualResult.id)}
                />
              </View>
            ) : null}
          </View>
        </ScrollView>
      ) : null}

      {tab === 'history' ? (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={entries.length > 0 ? (
            <View style={styles.historyHeader}>
              <Text style={styles.historyHeaderText}>{entries.length} saved results</Text>
              <Pressable onPress={onClearHistory}>
                <Text style={styles.clearText}>Clear all</Text>
              </Pressable>
            </View>
          ) : null}
          ListEmptyComponent={<EmptyState title="No scans yet" subtitle="Run a scan or paste suspicious text to build your history." />}
          renderItem={renderHistoryCard}
        />
      ) : null}

      {tab === 'pinned' ? (
        <FlatList
          data={pinnedEntries}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<EmptyState title="No pinned threats" subtitle="High-risk SMS are pinned automatically so you can review them quickly." />}
          renderItem={renderHistoryCard}
        />
      ) : null}
    </View>
  );
}

function StatColumn({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }): React.JSX.Element {
  return (
    <View style={styles.statColumn}>
      <Text style={[styles.statValue, { color }]}>{icon} {value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable style={styles.tabButton} onPress={onPress}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
    </Pressable>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

function DangerTag({ score, large }: { score: number; large?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.dangerTag, large && styles.dangerTagLarge]}>
      <Text style={[styles.dangerTagText, large && styles.dangerTagTextLarge]}>🚫 DON'T CLICK · {score}/100</Text>
    </View>
  );
}

function RiskCard({
  entry,
  expanded,
  onToggle,
  onPin,
  onDelete
}: {
  entry: Entry;
  expanded?: boolean;
  onToggle?: () => void;
  onPin?: () => void;
  onDelete?: () => void;
}): React.JSX.Element {
  const theme = RISK_THEME[entry.risk_level];
  const showDanger = entry.risk_score >= DANGER_SCORE || entry.risk_level === 'High';

  return (
    <Pressable onPress={onToggle} style={[styles.card, { backgroundColor: theme.bg, borderColor: theme.border }]}> 
      <View style={styles.rowBetweenTop}>
        <View style={styles.flexOne}>
          <Text style={styles.cardSender} numberOfLines={1}>{entry.sender}</Text>
          <Text style={styles.cardDate}>{new Date(entry.time).toLocaleString()}</Text>
        </View>
        <View style={[styles.riskChip, { backgroundColor: theme.chip, borderColor: theme.border }]}> 
          <Text style={[styles.riskChipText, { color: theme.txt }]}>{entry.risk_level} · {entry.risk_score}</Text>
        </View>
      </View>

      {showDanger ? (
        <View style={styles.dangerRow}>
          <DangerTag score={entry.risk_score} large={expanded} />
        </View>
      ) : null}

      <Text style={styles.cardBody} numberOfLines={expanded ? undefined : 3}>{entry.text}</Text>

      <View style={styles.inlineMetaRow}>
        <Text style={styles.inlineMetaLabel}>Scam type:</Text>
        <Text style={[styles.inlineMetaValue, { color: theme.txt }]}>{entry.scam_type}</Text>
      </View>

      {expanded ? (
        <View style={styles.detailSection}>
          <Text style={styles.detailHeading}>Explanation</Text>
          <Text style={styles.detailText}>{entry.explanation}</Text>

          <Text style={styles.detailHeading}>Scam signals</Text>
          {entry.scam_signals.length > 0 ? entry.scam_signals.map((signal, index) => (
            <Text key={`${entry.id}-signal-${index}`} style={styles.detailBullet}>• {signal}</Text>
          )) : <Text style={styles.detailText}>No additional signals provided.</Text>}

          <Text style={styles.detailHeading}>Recommended action</Text>
          <Text style={styles.detailText}>{entry.recommended_action}</Text>

          {entry.if_already_sent ? (
            <>
              <Text style={styles.detailHeading}>If already sent</Text>
              <Text style={styles.detailText}>{entry.if_already_sent}</Text>
            </>
          ) : null}

          <Text style={styles.confidenceText}>Confidence: {Math.round(entry.confidence * 100)}%</Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton} onPress={onPin}>
          <Text style={styles.actionButtonText}>{entry.pinned ? '★ Unpin' : '☆ Pin'}</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={onDelete}>
          <Text style={[styles.actionButtonText, { color: '#fca5a5' }]}>Delete</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === 'android' ? 34 : 54
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  brand: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 1
  },
  betaBadge: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,229,160,0.12)',
    borderWidth: 1,
    borderColor: COLORS.accent
  },
  betaText: {
    color: COLORS.accent,
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '800'
  },
  headerSub: {
    marginTop: 5,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12
  },
  statsBar: {
    marginHorizontal: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    flexDirection: 'row',
    paddingVertical: 12,
    alignItems: 'stretch'
  },
  statColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  statsDivider: {
    width: 1,
    backgroundColor: COLORS.border
  },
  statValue: {
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800'
  },
  statLabel: {
    marginTop: 4,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 10
  },
  tabs: {
    marginTop: 14,
    flexDirection: 'row',
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10
  },
  tabText: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '700'
  },
  tabTextActive: {
    color: COLORS.text
  },
  tabUnderline: {
    marginTop: 8,
    width: '68%',
    height: 3,
    borderRadius: 99,
    backgroundColor: 'transparent'
  },
  tabUnderlineActive: {
    backgroundColor: COLORS.accent
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 70
  },
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14
  },
  panelTitle: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '800'
  },
  panelSub: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11,
    marginTop: 4
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  rowBetweenTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between'
  },
  flexOne: {
    flex: 1
  },
  scanButton: {
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.accent,
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    marginBottom: 14
  },
  scanButtonText: {
    color: '#02261a',
    fontFamily: FONT,
    fontSize: 17,
    fontWeight: '900'
  },
  scanButtonSub: {
    marginTop: 5,
    color: '#033528',
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700'
  },
  progressWrap: {
    marginBottom: 14
  },
  progressTrack: {
    height: 10,
    backgroundColor: COLORS.s3,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.accent
  },
  progressText: {
    marginTop: 7,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11
  },
  input: {
    marginTop: 12,
    minHeight: 118,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.s2,
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 13,
    paddingHorizontal: 12,
    paddingVertical: 12
  },
  helperText: {
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 11,
    marginTop: 10
  },
  checkButton: {
    marginTop: 10,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  },
  checkButtonText: {
    color: '#02261a',
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '900'
  },
  manualResultWrap: {
    marginTop: 14
  },
  listContent: {
    padding: 20,
    paddingBottom: 70
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12
  },
  historyHeaderText: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12
  },
  clearText: {
    color: '#fca5a5',
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '800'
  },
  emptyState: {
    marginTop: 80,
    alignItems: 'center',
    paddingHorizontal: 20
  },
  emptyTitle: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 15,
    fontWeight: '800'
  },
  emptySubtitle: {
    marginTop: 8,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11,
    textAlign: 'center',
    lineHeight: 17
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12
  },
  cardSender: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '800'
  },
  cardDate: {
    marginTop: 4,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 10
  },
  riskChip: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginLeft: 10
  },
  riskChipText: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '800'
  },
  dangerRow: {
    marginTop: 10,
    alignItems: 'flex-start'
  },
  dangerTag: {
    backgroundColor: COLORS.red,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  dangerTagLarge: {
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  dangerTagText: {
    color: COLORS.white,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '900'
  },
  dangerTagTextLarge: {
    fontSize: 13
  },
  cardBody: {
    marginTop: 10,
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18
  },
  inlineMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap'
  },
  inlineMetaLabel: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11,
    marginRight: 6
  },
  inlineMetaValue: {
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '800'
  },
  detailSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border
  },
  detailHeading: {
    color: COLORS.accent,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 6,
    marginTop: 6
  },
  detailText: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18
  },
  detailBullet: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 2
  },
  confidenceText: {
    marginTop: 10,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11
  },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10
  },
  actionButton: {
    backgroundColor: COLORS.s2,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  actionButtonText: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '800'
  },
  scalePressed: {
    transform: [{ scale: 0.985 }]
  },
  dimmed: {
    opacity: 0.6
  }
});

registerRootComponent(App);
export default App;
