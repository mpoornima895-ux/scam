import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerRootComponent } from 'expo';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  type AppStateStatus,
  BackHandler,
  FlatList,
  Linking,
  Modal,
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
import { CLOUD_ENABLED, PRIVACY_URL } from './src/config';
import { AUTO_KEY, deleteAllUserData, ensureInstallId, grantConsent, hasConsent } from './src/consent';
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
  confidence: number | null;
  engine?: 'cloud_ai' | 'on_device_rules';
  if_already_sent?: string;
};

const SCAN_LIMIT = 10;
const DANGER_SCORE = 75;
const STORAGE_KEY = 'scamsafe_v1';

// ============================================================
// 🎨 DESIGN SYSTEM TOKENS (derived from The Outsiders reference)
// ============================================================
const COLORS = {
  bg: '#0E0E10',
  surface: '#1A1A1D',
  surfaceSubtle: '#141416',
  surfaceRaised: '#222227',
  surfaceBorder: 'rgba(255, 255, 255, 0.06)',
  borderLight: 'rgba(255, 255, 255, 0.12)',

  // Soft pastel semantic palette (no neon)
  fraud: '#F4A6B8',       // soft coral / pink
  fraudBg: 'rgba(244, 166, 184, 0.12)',
  fraudBorder: 'rgba(244, 166, 184, 0.30)',

  suspicious: '#F3E39A',  // soft butter-yellow
  suspiciousBg: 'rgba(243, 227, 154, 0.12)',
  suspiciousBorder: 'rgba(243, 227, 154, 0.30)',

  safe: '#B7E4C7',        // soft mint
  safeBg: 'rgba(183, 228, 199, 0.12)',
  safeBorder: 'rgba(183, 228, 199, 0.30)',

  // Hero Card pastel gradient mesh tokens
  heroBase: '#E4E6A8',     // pale yellow-green
  heroLavender: '#C9CBF2', // soft lavender
  heroMint: '#CFE8D5',     // soft mint
  heroDark: '#121316',

  // Typography colors
  text: '#F2F2F5',
  t2: 'rgba(242, 242, 245, 0.65)',
  t3: 'rgba(242, 242, 245, 0.40)',
  textDark: '#0E0E10',

  white: '#FFFFFF',
  gold: '#F6D268'
} as const;

const RISK_THEME = {
  High: {
    bg: COLORS.surface,
    tint: COLORS.fraudBg,
    border: COLORS.surfaceBorder,
    chip: COLORS.fraudBg,
    chipBorder: COLORS.fraudBorder,
    txt: COLORS.fraud
  },
  Medium: {
    bg: COLORS.surface,
    tint: COLORS.suspiciousBg,
    border: COLORS.surfaceBorder,
    chip: COLORS.suspiciousBg,
    chipBorder: COLORS.suspiciousBorder,
    txt: COLORS.suspicious
  },
  Low: {
    bg: COLORS.surface,
    tint: COLORS.safeBg,
    border: COLORS.surfaceBorder,
    chip: COLORS.safeBg,
    chipBorder: COLORS.safeBorder,
    txt: COLORS.safe
  }
} as const;

const FONT = Platform.select({ android: 'sans-serif', ios: 'System', default: 'System' });
const FONT_MEDIUM = Platform.select({ android: 'sans-serif-medium', ios: 'System', default: 'System' });

const TypedFlatList = FlatList as unknown as React.ComponentType<any>;

function App({ onDataDeleted }: { onDataDeleted: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('scan');
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [autoEnabled, setAutoEnabled] = useState<boolean>(true);
  const [manualText, setManualText] = useState<string>('');
  const [manualResult, setManualResult] = useState<Entry | null>(null);
  const [manualLoading, setManualLoading] = useState<boolean>(false);
  const [scanLoading, setScanLoading] = useState<boolean>(false);
  const [scanTotal, setScanTotal] = useState<number>(0);
  const [scanDone, setScanDone] = useState<number>(0);
  const [scanDetected, setScanDetected] = useState<number>(0);
  const [scanComplete, setScanComplete] = useState<boolean>(false);
  const [lastScanSummary, setLastScanSummary] = useState<{ total: number; threats: number; medium: number; safe: number } | null>(null);
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
      setScanComplete(false);
      setLastScanSummary(null);
      setScanTotal(recentMessages.length);
      setScanDone(0);
      setScanDetected(0);

      let dontClickCount = 0;
      let mediumCount = 0;
      let safeCount = 0;

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
              setScanDetected(prev => prev + 1);
            } else if (result.risk_level === 'Medium') {
              mediumCount += 1;
            } else {
              safeCount += 1;
            }
          }
        } catch {
        }

        setScanDone(index + 1);
      }

      lastAutoScanAtRef.current = Date.now();
      setScanComplete(true);
      setLastScanSummary({
        total: recentMessages.length,
        threats: dontClickCount,
        medium: mediumCount,
        safe: safeCount,
      });
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

  const onOpenPrivacyPolicy = useCallback((): void => {
    Linking.openURL(PRIVACY_URL).catch(() => {
      Alert.alert('Could not open link', PRIVACY_URL);
    });
  }, []);

  const onDeleteAllData = useCallback((): void => {
    Alert.alert(
      'Delete all my data',
      'This removes every saved scan, your settings and your consent from this phone. You will see "Before you start" again. To also remove the SMS permission, use Android Settings > Apps > ScamSafe > Permissions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteAllUserData();
              } catch {
              }
              setEntries([]);
              setManualResult(null);
              setSettingsOpen(false);
              onDataDeleted();
            })();
          }
        }
      ]
    );
  }, [onDataDeleted]);

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

  const totalScans = entries.length;
  const fraudPercent = totalScans > 0 ? Math.round((counts.fraud / totalScans) * 100) : 0;
  const suspPercent = totalScans > 0 ? Math.round((counts.suspicious / totalScans) * 100) : 0;
  const safePercent = totalScans > 0 ? Math.round((counts.safe / totalScans) * 100) : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} translucent />

      {/* SETTINGS (privacy policy + delete all my data) */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.settingsBackdrop} onPress={() => setSettingsOpen(false)} accessible={false}>
          <View style={styles.settingsSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.settingsTitle} accessibilityRole="header">Settings</Text>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Privacy policy"
              accessibilityHint="Opens the privacy policy in your browser"
              style={({ pressed }) => [styles.settingsRow, pressed && styles.scalePressed]}
              onPress={onOpenPrivacyPolicy}
            >
              <Text style={styles.settingsRowText}>Privacy policy</Text>
              <Text style={styles.chevronText}>›</Text>
            </Pressable>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Delete all my data"
              accessibilityHint="Removes all saved scans, settings and consent from this phone"
              style={({ pressed }) => [styles.settingsRow, styles.settingsRowDanger, pressed && styles.scalePressed]}
              onPress={onDeleteAllData}
            >
              <Text style={[styles.settingsRowText, { color: COLORS.fraud }]}>Delete all my data</Text>
            </Pressable>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
              style={({ pressed }) => [styles.settingsClose, pressed && styles.scalePressed]}
              onPress={() => setSettingsOpen(false)}
            >
              <Text style={styles.checkButtonText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* 1) UNIFORM MODERN HEADER */}
      <Animated.View style={[styles.header, { opacity: fade }]}>
        <View style={styles.headerTopBar}>
          <Pressable
            style={({ pressed }) => [styles.headerPillButton, pressed && styles.scalePressed]}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Application settings and menu"
            accessibilityHint="Opens settings: privacy policy and delete all my data"
            onPress={() => setSettingsOpen(true)}
          >
            <View style={styles.menuIconBar} />
            <View style={[styles.menuIconBar, { width: 12 }]} />
          </Pressable>
          <View style={styles.brandContainer} accessible={true} accessibilityRole="header" accessibilityLabel="ScamSafe Application">
            <Text style={styles.brandLight}>Scam<Text style={styles.brandBold}>Safe</Text></Text>
            <View style={styles.betaBadge}>
              <Text style={styles.betaText}>BETA</Text>
            </View>
          </View>
          <View
            style={styles.headerPillButton}
            accessible={true}
            accessibilityRole="image"
            accessibilityLabel="Security status: active protection"
          >
            <View style={styles.shieldIconShape} />
          </View>
        </View>
        <Text style={styles.headerSub}>AI SMS fraud & scam protection</Text>
      </Animated.View>

      {/* 2) TAB CONTENT */}
      {tab === 'scan' ? (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {/* PASTEL GRADIENT HERO CARD (The Outsiders reference) */}
          <View style={styles.heroCard}>
            {/* Layered pastel mesh glows (pure React Native, no external dependencies) */}
            <View style={styles.heroMeshLavender} />
            <View style={styles.heroMeshMint} />
            <View style={styles.heroMeshSoftGlow} />

            <View style={styles.heroContent}>
              <View style={styles.heroHeaderRow}>
                <View>
                  <Text style={styles.heroGreetingLight}>Welcome to</Text>
                  <Text style={styles.heroGreetingBold}>ScamSafe Protection</Text>
                </View>
                <View style={styles.heroBetaPill}>
                  <View style={styles.heroPillDot} />
                  <Text style={styles.heroBetaText}>ACTIVE</Text>
                </View>
              </View>

              {/* Dark Inner Card (like "Saldo disponible" in reference) */}
              <View style={styles.heroInnerCard}>
                <View style={styles.heroInnerCardHeader}>
                  <Text style={styles.heroInnerCardLabel}>PROTECTION SUMMARY</Text>
                  <Text style={styles.heroInnerCardCount}>{totalScans} Analyzed</Text>
                </View>
                <View style={styles.statsBar}>
                  <StatColumn icon="!" label="Fraud" value={counts.fraud} color={COLORS.fraud} />
                  <View style={styles.statsDivider} />
                  <StatColumn icon="~" label="Suspicious" value={counts.suspicious} color={COLORS.suspicious} />
                  <View style={styles.statsDivider} />
                  <StatColumn icon="–" label="Low risk" value={counts.safe} color={COLORS.safe} />
                </View>
              </View>
            </View>
          </View>

          {/* QUICK-ACTION TILES (like Agregar Gasto / Agregar Ingreso / Ver Transacción) */}
          <View style={styles.quickActionsRow}>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Manual text check"
              accessibilityHint="Scroll down to the manual text check card to paste an SMS"
              style={({ pressed }) => [styles.quickTile, pressed && styles.scalePressed]}
              onPress={() => {
                // Focus / quick feedback
              }}
            >
              <View style={[styles.quickTileIcon, { backgroundColor: 'rgba(201, 203, 242, 0.15)' }]}>
                <Text style={[styles.quickTileGlyph, { color: COLORS.heroLavender }]}>✎</Text>
              </View>
              <Text style={styles.quickTileLabel}>Manual</Text>
              <Text style={styles.quickTileSub}>Text check</Text>
            </Pressable>

            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Auto-Scan is ${autoEnabled ? 'Enabled' : 'Paused'}`}
              accessibilityHint="Toggles automated background scanning of incoming SMS"
              style={({ pressed }) => [styles.quickTile, pressed && styles.scalePressed]}
              onPress={() => {
                void onToggleAuto(!autoEnabled);
              }}
            >
              <View style={[styles.quickTileIcon, { backgroundColor: autoEnabled ? 'rgba(183, 228, 199, 0.18)' : 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={[styles.quickTileGlyph, { color: autoEnabled ? COLORS.safe : COLORS.t3 }]}>⚡</Text>
              </View>
              <Text style={styles.quickTileLabel}>Auto-Scan</Text>
              <Text style={styles.quickTileSub}>{autoEnabled ? 'Enabled' : 'Paused'}</Text>
            </Pressable>

            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`View scan history, ${entries.length} items`}
              accessibilityHint="Navigates to the History tab"
              style={({ pressed }) => [styles.quickTile, pressed && styles.scalePressed]}
              onPress={() => setTab('history')}
            >
              <View style={[styles.quickTileIcon, { backgroundColor: 'rgba(243, 227, 154, 0.15)' }]}>
                <Text style={[styles.quickTileGlyph, { color: COLORS.suspicious }]}>≡</Text>
              </View>
              <Text style={styles.quickTileLabel}>History</Text>
              <Text style={styles.quickTileSub}>{entries.length} items</Text>
            </Pressable>
          </View>

          {/* PRIMARY GRADIENT CTA CARD ("Agregar Nueva meta" style) */}
          <Pressable
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={scanLoading ? "Analyzing SMS messages in progress" : "Scan My Messages"}
            accessibilityHint={`Scans up to ${SCAN_LIMIT} recent SMS from the last 7 days`}
            style={({ pressed }) => [styles.primaryCtaCard, pressed && styles.scalePressed, scanLoading && styles.dimmed]}
            onPress={() => { void onManualScan(); }}
          >
            <View style={styles.primaryCtaMesh1} />
            <View style={styles.primaryCtaMesh2} />
            <View style={styles.primaryCtaRow}>
              <View style={styles.primaryCtaTextCol}>
                <Text style={styles.primaryCtaPretitle}>QUICK SCAN</Text>
                <Text style={styles.primaryCtaTitle}>{scanLoading ? 'Analyzing SMS...' : 'Scan My Messages'}</Text>
                <Text style={styles.primaryCtaSubtitle}>Last 7 days · max {SCAN_LIMIT} SMS</Text>
              </View>
              <View style={styles.primaryCtaCircleIcon}>
                <Text style={styles.primaryCtaPlusGlyph}>+</Text>
              </View>
            </View>
          </Pressable>

          {/* SCAN PROGRESS CARD ("Progreso" style from right reference phone) */}
          {scanLoading ? (
            <View style={styles.panel}>
              <View style={styles.rowBetween}>
                <Text style={styles.panelTitle}>Scanning Progress</Text>
                <Text style={styles.progressPercentText}>{progressPercent}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressText}>Analyzing message {scanDone} of {scanTotal}...</Text>

              <View style={styles.scanStatsRow}>
                <View style={styles.scanStatItem}>
                  <Text style={styles.scanStatNumber}>{scanDone}</Text>
                  <Text style={styles.scanStatLabel}>Scanned</Text>
                </View>
                <View style={styles.scanStatDivider} />
                <View style={styles.scanStatItem}>
                  <Text style={[styles.scanStatNumber, { color: COLORS.fraud }]}>{scanDetected}</Text>
                  <Text style={styles.scanStatLabel}>Threats</Text>
                </View>
                <View style={styles.scanStatDivider} />
                <View style={styles.scanStatItem}>
                  <Text style={[styles.scanStatNumber, { color: COLORS.safe }]}>{Math.max(0, scanDone - scanDetected)}</Text>
                  <Text style={styles.scanStatLabel}>Low risk</Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* SCAN COMPLETE SUMMARY */}
          {scanComplete && lastScanSummary ? (
            <View style={styles.summaryPanel}>
              <View style={styles.summaryTitleRow}>
                <View style={styles.summaryCheckCircle}>
                  <Text style={styles.summaryCheckGlyph}>✓</Text>
                </View>
                <View style={styles.flexOne}>
                  <Text style={styles.summaryTitle}>Scan Complete</Text>
                  <Text style={styles.summarySub}>{lastScanSummary.total} messages checked</Text>
                </View>
              </View>

              <View style={styles.summaryGrid}>
                <View style={[styles.summaryCard, { backgroundColor: COLORS.fraudBg, borderColor: COLORS.fraudBorder }]}>
                  <Text style={[styles.summaryCardNumber, { color: COLORS.fraud }]}>{lastScanSummary.threats}</Text>
                  <Text style={styles.summaryCardLabel}>Don't Click</Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: COLORS.suspiciousBg, borderColor: COLORS.suspiciousBorder }]}>
                  <Text style={[styles.summaryCardNumber, { color: COLORS.suspicious }]}>{lastScanSummary.medium}</Text>
                  <Text style={styles.summaryCardLabel}>Suspicious</Text>
                </View>
                <View style={[styles.summaryCard, { backgroundColor: COLORS.safeBg, borderColor: COLORS.safeBorder }]}>
                  <Text style={[styles.summaryCardNumber, { color: COLORS.safe }]}>{lastScanSummary.safe}</Text>
                  <Text style={styles.summaryCardLabel}>Low risk</Text>
                </View>
              </View>

              <Pressable
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="View Full History"
                accessibilityHint="Navigates to the History tab to review all scanned messages"
                style={({ pressed }) => [styles.viewHistoryBtn, pressed && styles.scalePressed]}
                onPress={() => setTab('history')}
              >
                <Text style={styles.viewHistoryText}>View Full History →</Text>
              </Pressable>
            </View>
          ) : null}

          {/* "INFORME FINANCIERO" STYLE PROPORTION OVERVIEW */}
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.panelTitle}>Risk Distribution</Text>
                <Text style={styles.panelSub}>Based on your scanned messages</Text>
              </View>
              <View style={styles.pillBadgeMuted}>
                <Text style={styles.pillBadgeMutedText}>{totalScans} TOTAL</Text>
              </View>
            </View>

            <View style={styles.chartBarsRow}>
              <View style={styles.chartCol}>
                <Text style={styles.chartPercentLabel}>{fraudPercent}%</Text>
                <View style={styles.chartBarTrack}>
                  <View style={[styles.chartBarFill, { height: `${Math.max(12, fraudPercent)}%`, backgroundColor: COLORS.fraud }]} />
                </View>
                <Text style={styles.chartBarName}>Fraud</Text>
              </View>

              <View style={styles.chartCol}>
                <Text style={styles.chartPercentLabel}>{suspPercent}%</Text>
                <View style={styles.chartBarTrack}>
                  <View style={[styles.chartBarFill, { height: `${Math.max(12, suspPercent)}%`, backgroundColor: COLORS.suspicious }]} />
                </View>
                <Text style={styles.chartBarName}>Suspicious</Text>
              </View>

              <View style={styles.chartCol}>
                <Text style={styles.chartPercentLabel}>{safePercent}%</Text>
                <View style={styles.chartBarTrack}>
                  <View style={[styles.chartBarFill, { height: `${Math.max(12, safePercent)}%`, backgroundColor: COLORS.safe }]} />
                </View>
                <Text style={styles.chartBarName}>Low risk</Text>
              </View>
            </View>
          </View>

          {/* AUTO-SCAN ROW */}
          <View style={styles.panel}>
            <View style={styles.rowBetween}>
              <View style={styles.flexOne}>
                <Text style={styles.panelTitle}>Background Auto-Scan</Text>
                <Text style={styles.panelSub}>{autoNote}</Text>
              </View>
              <Switch
                accessible={true}
                accessibilityRole="switch"
                accessibilityLabel="Background Auto-Scan"
                accessibilityHint="Toggles automatic background analysis for incoming SMS messages"
                accessibilityState={{ checked: autoEnabled }}
                value={autoEnabled}
                onValueChange={(value) => {
                  void onToggleAuto(value);
                }}
                trackColor={{ false: '#26262B', true: COLORS.safe }}
                thumbColor={autoEnabled ? '#0D1E15' : '#8E8E93'}
              />
            </View>
          </View>

          {/* MANUAL TEXT CHECK CARD */}
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Manual Text Check</Text>
            <Text style={styles.panelSub}>Paste a suspicious SMS, UPI alert, bank text, or phishing link</Text>
            <TextInput
              accessible={true}
              accessibilityLabel="Suspicious SMS message input field"
              accessibilityHint="Type or paste SMS content here to analyze"
              value={manualText}
              onChangeText={setManualText}
              multiline
              style={styles.input}
              placeholder="Paste message here..."
              placeholderTextColor={COLORS.t3}
              textAlignVertical="top"
            />
            <View style={styles.manualActionRow}>
              <Text style={styles.helperText}>Min. 10 characters</Text>
              <Pressable
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel={manualLoading ? "Analyzing pasted text..." : "Analyze Text"}
                accessibilityHint="Starts scam analysis on the pasted message content"
                style={({ pressed }) => [
                  styles.checkButton,
                  pressed && styles.scalePressed,
                  (manualText.trim().length < 10 || manualLoading) && styles.dimmed
                ]}
                disabled={manualText.trim().length < 10 || manualLoading}
                onPress={() => { void onManualTextCheck(); }}
              >
                <Text style={styles.checkButtonText}>{manualLoading ? 'Analyzing...' : 'Analyze Text'}</Text>
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

      {/* 3) HISTORY TAB (Workouts History reference) */}
      {tab === 'history' ? (
        <TypedFlatList
          data={entries}
          keyExtractor={(item: Entry) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={entries.length > 0 ? (
            <View style={styles.historySectionHeader}>
              <View style={styles.rowBetween}>
                <View>
                  <Text style={styles.historySectionTitle}>History</Text>
                  <Text style={styles.historySectionSub}>{entries.length} SAVED RESULTS</Text>
                </View>
                <View style={styles.historyHeaderChipsRow}>
                  <View style={[styles.historySmallChip, { backgroundColor: COLORS.fraudBg }]}>
                    <View style={[styles.chipDot, { backgroundColor: COLORS.fraud }]} />
                    <Text style={[styles.chipText, { color: COLORS.fraud }]}>{counts.fraud}</Text>
                  </View>
                  <View style={[styles.historySmallChip, { backgroundColor: COLORS.suspiciousBg }]}>
                    <View style={[styles.chipDot, { backgroundColor: COLORS.suspicious }]} />
                    <Text style={[styles.chipText, { color: COLORS.suspicious }]}>{counts.suspicious}</Text>
                  </View>
                  <View style={[styles.historySmallChip, { backgroundColor: COLORS.safeBg }]}>
                    <View style={[styles.chipDot, { backgroundColor: COLORS.safe }]} />
                    <Text style={[styles.chipText, { color: COLORS.safe }]}>{counts.safe}</Text>
                  </View>
                  <Pressable
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all scan history"
                    accessibilityHint="Deletes all stored message scans permanently"
                    style={({ pressed }) => [styles.clearPillButton, pressed && styles.scalePressed]}
                    onPress={onClearHistory}
                  >
                    <Text style={styles.clearPillText}>Clear</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}
          ListEmptyComponent={
            <EmptyState
              title="No scans yet"
              subtitle="Run a scan or paste a suspicious SMS above to verify threats and build your history."
            />
          }
          renderItem={renderHistoryCard}
        />
      ) : null}

      {/* 4) PINNED TAB */}
      {tab === 'pinned' ? (
        <TypedFlatList
          data={pinnedEntries}
          keyExtractor={(item: Entry) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={pinnedEntries.length > 0 ? (
            <View style={styles.historySectionHeader}>
              <View style={styles.rowBetween}>
                <View>
                  <Text style={styles.historySectionTitle}>Pinned</Text>
                  <Text style={styles.historySectionSub}>{pinnedEntries.length} SAVED THREATS</Text>
                </View>
                <View style={[styles.historySmallChip, { backgroundColor: COLORS.fraudBg }]}>
                  <Text style={[styles.chipText, { color: COLORS.fraud }]}>★ {pinnedEntries.length}</Text>
                </View>
              </View>
            </View>
          ) : null}
          ListEmptyComponent={
            <EmptyState
              title="No pinned threats"
              subtitle="High-risk and flagged SMS messages can be pinned here for immediate inspection."
            />
          }
          renderItem={renderHistoryCard}
        />
      ) : null}

      {/* 5) FLOATING BOTTOM NAVIGATION BAR (Capsule pill style from Workouts reference) */}
      <View style={styles.bottomNavContainer}>
        <View style={styles.floatingNavBar} accessible={false}>
          <Pressable
            accessible={true}
            accessibilityRole="tab"
            accessibilityLabel="Scan Tab"
            accessibilityState={{ selected: tab === 'scan' }}
            accessibilityHint="Navigates to the scanner dashboard"
            style={[styles.floatingTabItem, tab === 'scan' && styles.floatingTabItemActive]}
            onPress={() => setTab('scan')}
          >
            <View style={styles.tabIconShape}>
              <View style={[styles.tabIconRadarCircle, tab === 'scan' && { borderColor: COLORS.safe }]} />
            </View>
            <Text style={[styles.floatingTabLabel, tab === 'scan' && styles.floatingTabLabelActive]}>Scan</Text>
          </Pressable>

          <Pressable
            accessible={true}
            accessibilityRole="tab"
            accessibilityLabel="History Tab"
            accessibilityState={{ selected: tab === 'history' }}
            accessibilityHint={`Navigates to scan history containing ${entries.length} items`}
            style={[styles.floatingTabItem, tab === 'history' && styles.floatingTabItemActive]}
            onPress={() => setTab('history')}
          >
            <View style={styles.tabIconShape}>
              <View style={[styles.tabIconListLine, tab === 'history' && { backgroundColor: COLORS.heroLavender }]} />
              <View style={[styles.tabIconListLine, { width: 8 }, tab === 'history' && { backgroundColor: COLORS.heroLavender }]} />
            </View>
            <Text style={[styles.floatingTabLabel, tab === 'history' && styles.floatingTabLabelActive]}>History</Text>
          </Pressable>

          <Pressable
            accessible={true}
            accessibilityRole="tab"
            accessibilityLabel="Pinned Threats Tab"
            accessibilityState={{ selected: tab === 'pinned' }}
            accessibilityHint={`Navigates to pinned threats containing ${pinnedEntries.length} items`}
            style={[styles.floatingTabItem, tab === 'pinned' && styles.floatingTabItemActive]}
            onPress={() => setTab('pinned')}
          >
            <View style={styles.tabIconShape}>
              <Text style={[styles.tabStarGlyph, tab === 'pinned' && { color: COLORS.gold }]}>★</Text>
            </View>
            <Text style={[styles.floatingTabLabel, tab === 'pinned' && styles.floatingTabLabelActive]}>Pinned</Text>
            {pinnedEntries.length > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{pinnedEntries.length}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ============================================================
// 🧩 PRESENTATIONAL HELPER COMPONENTS
// ============================================================

function StatColumn({ icon, label, value, color }: { icon: string; label: string; value: number; color: string }): React.JSX.Element {
  return (
    <View style={styles.statColumn}>
      <View style={styles.statNumberRow}>
        <Text style={[styles.statIconDot, { color }]}>{icon}</Text>
        <Text style={[styles.statValue, { color }]}>{value}</Text>
      </View>
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
      <View style={styles.emptyIconCircle}>
        <View style={styles.emptyShieldGlyph} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

function DangerTag({ score, large }: { score: number; large?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.dangerTag, large && styles.dangerTagLarge]}>
      <View style={styles.dangerTagDot} />
      <Text style={[styles.dangerTagText, large && styles.dangerTagTextLarge]}>Don't Click · {score}/100</Text>
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
  const isHighRisk = entry.risk_score >= DANGER_SCORE || entry.risk_level === 'High';
  const scorePercent = Math.min(100, Math.max(0, entry.risk_score));

  return (
    <Pressable
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`Message from ${entry.sender}, risk level ${entry.risk_level}, risk score ${entry.risk_score} out of 100. Category: ${entry.scam_type}.`}
      accessibilityHint={expanded ? "Double tap to collapse details" : "Double tap to expand full analysis"}
      onPress={onToggle}
      style={({ pressed }) => [styles.card, pressed && styles.scalePressed]}
    >
      {/* Top row matching workout item in reference */}
      <View style={styles.cardHeaderRow}>
        {/* Left circular risk badge */}
        <View style={[styles.cardAvatarBadge, { backgroundColor: theme.tint }]}>
          <Text style={[styles.cardAvatarGlyph, { color: theme.txt }]}>
            {entry.risk_level === 'High' ? '!' : entry.risk_level === 'Medium' ? '▲' : '–'}
          </Text>
          {entry.pinned ? (
            <View style={styles.pinnedStarBadge}>
              <Text style={styles.pinnedStarText}>★</Text>
            </View>
          ) : null}
        </View>

        {/* Center sender + preview + metadata chips */}
        <View style={styles.cardCenterCol}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardSender} numberOfLines={1}>{entry.sender}</Text>
            <View style={[styles.riskPill, { backgroundColor: theme.chip, borderColor: theme.chipBorder }]}>
              <View style={[styles.riskPillDot, { backgroundColor: theme.txt }]} />
              <Text style={[styles.riskPillText, { color: theme.txt }]}>{entry.risk_level} · {entry.risk_score}</Text>
            </View>
          </View>

          <Text style={styles.cardDate}>{new Date(entry.time).toLocaleString()}</Text>

          <Text style={styles.cardBodyPreview} numberOfLines={expanded ? undefined : 1} ellipsizeMode="tail">
            {entry.text}
          </Text>

          <View style={styles.cardMetaChipsRow}>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText}>Score {entry.risk_score}/100</Text>
            </View>
            <View style={styles.metaChip}>
              <Text style={styles.metaChipText} numberOfLines={1}>{entry.scam_type}</Text>
            </View>
          </View>
        </View>

        {/* Right chevron indicator */}
        <View style={styles.chevronWrap}>
          <Text style={styles.chevronText}>{expanded ? 'ˬ' : '›'}</Text>
        </View>
      </View>

      {/* Danger soft pill tag */}
      {isHighRisk && !expanded ? (
        <View style={styles.cardDangerPillRow}>
          <DangerTag score={entry.risk_score} />
        </View>
      ) : null}

      {/* EXPANDED DETAILS (revealed when expanded === true) */}
      {expanded ? (
        <View style={styles.detailSection}>
          {isHighRisk ? (
            <View style={styles.dangerRowExpanded}>
              <DangerTag score={entry.risk_score} large />
            </View>
          ) : null}

          {/* Full SMS message in dark inset card */}
          <View style={styles.cardMessageSection}>
            <Text style={styles.cardMessageLabel}>SMS MESSAGE</Text>
            <Text style={styles.cardBodyFull}>{entry.text}</Text>
          </View>

          {/* AI Verdict & Risk Bar */}
          <View style={styles.cardResultSection}>
            <Text style={styles.cardResultLabel}>SECURITY VERDICT</Text>
            <View style={styles.verdictScoreBarTrack}>
              <View style={[styles.verdictScoreBarFill, { width: `${scorePercent}%`, backgroundColor: theme.txt }]} />
            </View>

            <View style={styles.inlineMetaRow}>
              <Text style={styles.inlineMetaLabel}>Scam Type:</Text>
              <Text style={[styles.inlineMetaValue, { color: theme.txt }]}>{entry.scam_type}</Text>
            </View>
          </View>

          <View style={styles.explanationSection}>
            <Text style={styles.detailHeading}>Explanation</Text>
            <Text style={styles.detailText}>{entry.explanation}</Text>

            <Text style={styles.detailHeading}>Scam signals</Text>
            {entry.scam_signals.length > 0 ? (
              entry.scam_signals.map((signal, index) => (
                <View key={`${entry.id}-signal-${index}`} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: theme.txt }]} />
                  <Text style={styles.detailBulletText}>{signal}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.detailText}>No additional signals detected.</Text>
            )}

            <Text style={styles.detailHeading}>Recommended action</Text>
            <Text style={styles.detailText}>{entry.recommended_action}</Text>

            {entry.if_already_sent ? (
              <>
                <Text style={styles.detailHeading}>If already sent</Text>
                <Text style={styles.detailText}>{entry.if_already_sent}</Text>
              </>
            ) : null}

            {typeof entry.confidence === 'number' && entry.confidence > 0 ? (
              <Text style={styles.confidenceText}>Confidence: {Math.round(entry.confidence * 100)}%</Text>
            ) : null}
          </View>

          {/* Action buttons (Pin + Delete in soft pill style) */}
          <View style={styles.actionRow}>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={entry.pinned ? "Unpin message" : "Pin message to threats"}
              accessibilityHint="Toggles pinned threat status"
              style={({ pressed }) => [styles.actionButton, pressed && styles.scalePressed]}
              onPress={onPin}
            >
              <Text style={styles.actionButtonText}>{entry.pinned ? '★ Unpin' : '☆ Pin'}</Text>
            </Pressable>
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Delete this scan result"
              accessibilityHint="Permanently removes this entry from your scan history"
              style={({ pressed }) => [styles.actionButtonDelete, pressed && styles.scalePressed]}
              onPress={onDelete}
            >
              <Text style={styles.actionButtonDeleteText}>Delete</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Honest labels: exactly ONE of the two engine labels, plus the limits line, on every result */}
      <View style={styles.cardFooter}>
        <Text style={styles.cardFooterEngine}>
          {entry.engine === 'cloud_ai' ? 'Checked with cloud AI (personal numbers hidden)' : 'Checked on your phone only'}
        </Text>
        <Text style={styles.cardFooterDisclaimer}>This tool can miss scams. If money or an OTP is involved, call your bank.</Text>
      </View>
    </Pressable>
  );
}

// ============================================================
// 🔐 FIRST-LAUNCH CONSENT ("Before you start") + ROOT GATE
// Nothing in <App/> (auto-scan, SMS listener, SMS permission prompt) runs until the user taps "I agree".
// ============================================================
function ConsentBlock({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View style={styles.consentBlock}>
      <Text style={styles.consentBlockTitle}>{title}</Text>
      <Text style={styles.consentBlockText}>{children}</Text>
    </View>
  );
}

function ConsentScreen({
  declined,
  onAgree,
  onDecline,
  onReview
}: {
  declined: boolean;
  onAgree: () => void;
  onDecline: () => void;
  onReview: () => void;
}): React.JSX.Element {
  if (declined) {
    return (
      <View style={styles.consentContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} translucent />
        <View style={styles.consentDeclinedBody}>
          <Text style={styles.consentTitle} accessibilityRole="header">No problem</Text>
          <Text style={styles.consentIntro}>
            ScamSafe cannot check your messages without your OK. Nothing was read and nothing was sent.
          </Text>
        </View>
        <View style={styles.consentButtons}>
          <Pressable
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Go back to Before you start"
            style={({ pressed }) => [styles.consentPrimary, pressed && styles.scalePressed]}
            onPress={onReview}
          >
            <Text style={styles.consentPrimaryText}>Go back</Text>
          </Pressable>
          {Platform.OS === 'android' ? (
            <Pressable
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Close the app"
              style={({ pressed }) => [styles.consentSecondary, pressed && styles.scalePressed]}
              onPress={() => BackHandler.exitApp()}
            >
              <Text style={styles.consentSecondaryText}>Close app</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.consentContainer}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} translucent />
      <ScrollView contentContainerStyle={styles.consentScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.consentTitle} accessibilityRole="header">Before you start</Text>
        <Text style={styles.consentIntro}>
          ScamSafe checks your text messages for scams. Here is, in plain words, what it does with them.
        </Text>

        <ConsentBlock title="What it reads">
          Your SMS messages. After you tap "I agree", Android will ask for permission to read and receive SMS. ScamSafe looks at your 10 most recent messages from the last 7 days when you scan, and at new messages as they arrive while Auto-Scan is on.
        </ConsentBlock>

        <ConsentBlock title="Where the checking happens">
          On your phone. The scam rules run on your device, and your scan results are saved on this phone only.
        </ConsentBlock>

        {CLOUD_ENABLED ? (
          <ConsentBlock title="Cloud check">
            To double-check, the text of the messages you scan is sent to our cloud AI service. Before it leaves your phone, card numbers, OTPs, Aadhaar numbers, phone numbers and bank account numbers are replaced with placeholders. Other text, such as names, amounts and links, is not hidden. If the cloud service cannot be reached, your phone does the check alone. Every result tells you which way it was checked.
          </ConsentBlock>
        ) : (
          <ConsentBlock title="Cloud check">
            This version of ScamSafe does not send any message text to the cloud. Every check happens on your phone only.
          </ConsentBlock>
        )}

        <ConsentBlock title="Nothing is sold or shared">
          We do not sell your data and we do not share it with advertisers or other companies.{CLOUD_ENABLED ? ' The masked text is processed by our AI provider only to produce your result.' : ''}
        </ConsentBlock>

        <ConsentBlock title="Delete everything, any time">
          Open the menu at the top left and tap "Delete all my data". To also remove the SMS permission, go to Android Settings, then Apps, then ScamSafe, then Permissions.
        </ConsentBlock>

        <Text style={styles.consentFootnote}>
          ScamSafe can miss scams. If money or an OTP is involved, call your bank.
        </Text>

        <Pressable
          accessible={true}
          accessibilityRole="link"
          accessibilityLabel="Read the full privacy policy"
          onPress={() => {
            Linking.openURL(PRIVACY_URL).catch(() => {
              Alert.alert('Could not open link', PRIVACY_URL);
            });
          }}
        >
          <Text style={styles.consentLink}>Read the full privacy policy</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.consentButtons}>
        <Pressable
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="I agree"
          accessibilityHint="Saves your choice and asks Android for SMS permission"
          style={({ pressed }) => [styles.consentPrimary, pressed && styles.scalePressed]}
          onPress={onAgree}
        >
          <Text style={styles.consentPrimaryText}>I agree</Text>
        </Pressable>
        <Pressable
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel="No thanks"
          accessibilityHint="Nothing will be read or sent"
          style={({ pressed }) => [styles.consentSecondary, pressed && styles.scalePressed]}
          onPress={onDecline}
        >
          <Text style={styles.consentSecondaryText}>No thanks</Text>
        </Pressable>
      </View>
    </View>
  );
}

type ConsentState = 'loading' | 'needed' | 'declined' | 'granted';

function Root(): React.JSX.Element {
  const [state, setState] = useState<ConsentState>('loading');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const agreed = await hasConsent();
      if (agreed) {
        await ensureInstallId();
      }
      if (alive) {
        setState(agreed ? 'granted' : 'needed');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onAgree = useCallback(async (): Promise<void> => {
    try {
      await grantConsent();
    } catch {
      Alert.alert('Could not save your choice', 'Please try again.');
      return;
    }
    await ensureInstallId();
    // The SMS permission is requested ONLY now, after "I agree".
    if (Platform.OS === 'android') {
      try {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_SMS,
          PermissionsAndroid.PERMISSIONS.RECEIVE_SMS
        ]);
      } catch {
      }
    }
    setState('granted');
  }, []);

  if (state === 'loading') {
    return (
      <View style={styles.consentContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} translucent />
      </View>
    );
  }

  if (state === 'granted') {
    return <App onDataDeleted={() => setState('needed')} />;
  }

  return (
    <ConsentScreen
      declined={state === 'declined'}
      onAgree={() => {
        void onAgree();
      }}
      onDecline={() => setState('declined')}
      onReview={() => setState('needed')}
    />
  );
}

// ============================================================
// 🎨 STYLESHEET (The Outsiders + Workouts visual design)
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === 'android' ? 44 : 56
  },

  // 1) HEADER
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14
  },
  headerTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  headerPillButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'
  },
  menuIconBar: {
    width: 16,
    height: 2,
    backgroundColor: COLORS.t2,
    borderRadius: 1,
    marginVertical: 1.5
  },
  shieldIconShape: {
    width: 14,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.8,
    borderColor: COLORS.t2
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  brandLight: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '300',
    letterSpacing: -0.5
  },
  brandBold: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontWeight: '700'
  },
  betaBadge: {
    marginLeft: 8,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)'
  },
  betaText: {
    color: COLORS.t2,
    fontFamily: FONT_MEDIUM,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8
  },
  headerSub: {
    marginTop: 6,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 12,
    textAlign: 'center'
  },

  // SCROLL CONTENT
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120
  },

  // HERO CARD (Soft Pastel Gradient Mesh)
  heroCard: {
    backgroundColor: COLORS.heroBase,
    borderRadius: 28,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 16,
    elevation: 3
  },
  heroMeshLavender: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: COLORS.heroLavender,
    opacity: 0.85
  },
  heroMeshMint: {
    position: 'absolute',
    bottom: -50,
    left: -20,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.heroMint,
    opacity: 0.85
  },
  heroMeshSoftGlow: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#FFEFA6',
    opacity: 0.5
  },
  heroContent: {
    padding: 20,
    zIndex: 1
  },
  heroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  },
  heroGreetingLight: {
    fontFamily: FONT,
    fontSize: 15,
    color: 'rgba(14, 14, 16, 0.7)',
    fontWeight: '400'
  },
  heroGreetingBold: {
    fontFamily: FONT_MEDIUM,
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.heroDark,
    letterSpacing: -0.4,
    marginTop: 2
  },
  heroBetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(18, 19, 22, 0.88)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  heroPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.safe,
    marginRight: 6
  },
  heroBetaText: {
    color: COLORS.white,
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6
  },
  heroInnerCard: {
    marginTop: 18,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)'
  },
  heroInnerCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  heroInnerCardLabel: {
    fontFamily: FONT_MEDIUM,
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.t3,
    letterSpacing: 0.8
  },
  heroInnerCardCount: {
    fontFamily: FONT,
    fontSize: 11,
    color: COLORS.t2
  },
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  statColumn: {
    flex: 1,
    alignItems: 'center'
  },
  statNumberRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  statIconDot: {
    fontSize: 12,
    fontWeight: '800',
    marginRight: 4
  },
  statValue: {
    fontFamily: FONT_MEDIUM,
    fontSize: 18,
    fontWeight: '800'
  },
  statLabel: {
    marginTop: 3,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11
  },
  statsDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.surfaceBorder
  },

  // QUICK ACTIONS ROW (3 tiles)
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16
  },
  quickTile: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder
  },
  quickTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  quickTileGlyph: {
    fontSize: 15,
    fontWeight: '700'
  },
  quickTileLabel: {
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.text
  },
  quickTileSub: {
    marginTop: 2,
    fontFamily: FONT,
    fontSize: 10,
    color: COLORS.t3
  },

  // PRIMARY CTA CARD ("Agregar Nueva meta" style)
  primaryCtaCard: {
    backgroundColor: COLORS.heroBase,
    borderRadius: 24,
    overflow: 'hidden',
    padding: 18,
    marginBottom: 16,
    position: 'relative'
  },
  primaryCtaMesh1: {
    position: 'absolute',
    right: -20,
    top: -20,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: COLORS.heroLavender,
    opacity: 0.9
  },
  primaryCtaMesh2: {
    position: 'absolute',
    left: 40,
    bottom: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.heroMint,
    opacity: 0.8
  },
  primaryCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 1
  },
  primaryCtaTextCol: {
    flex: 1
  },
  primaryCtaPretitle: {
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    fontWeight: '700',
    color: 'rgba(14, 14, 16, 0.65)',
    letterSpacing: 0.8
  },
  primaryCtaTitle: {
    fontFamily: FONT_MEDIUM,
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.heroDark,
    letterSpacing: -0.3,
    marginTop: 2
  },
  primaryCtaSubtitle: {
    marginTop: 4,
    fontFamily: FONT,
    fontSize: 12,
    color: 'rgba(14, 14, 16, 0.75)'
  },
  primaryCtaCircleIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(14, 14, 16, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12
  },
  primaryCtaPlusGlyph: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 24
  },

  // CARDS / PANELS
  panel: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: 18,
    marginBottom: 16
  },
  panelTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 15,
    fontWeight: '700'
  },
  panelSub: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12,
    marginTop: 4
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  flexOne: {
    flex: 1
  },

  // PROGRESS TRACK
  progressTrack: {
    height: 8,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 12
  },
  progressFill: {
    height: '100%',
    backgroundColor: COLORS.safe,
    borderRadius: 999
  },
  progressText: {
    marginTop: 8,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11
  },
  progressPercentText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.safe
  },
  scanStatsRow: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center'
  },
  scanStatItem: {
    flex: 1,
    alignItems: 'center'
  },
  scanStatNumber: {
    fontFamily: FONT_MEDIUM,
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.text
  },
  scanStatLabel: {
    fontFamily: FONT,
    fontSize: 10,
    color: COLORS.t2,
    marginTop: 2
  },
  scanStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: COLORS.surfaceBorder
  },

  // SCAN COMPLETE SUMMARY
  summaryPanel: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: 24,
    padding: 18,
    marginBottom: 16
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  summaryCheckCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.safeBg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  summaryCheckGlyph: {
    color: COLORS.safe,
    fontSize: 16,
    fontWeight: '800'
  },
  summaryTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 16,
    fontWeight: '800'
  },
  summarySub: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 11,
    marginTop: 2
  },
  summaryGrid: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 14,
    alignItems: 'center'
  },
  summaryCardNumber: {
    fontFamily: FONT_MEDIUM,
    fontSize: 18,
    fontWeight: '800'
  },
  summaryCardLabel: {
    fontFamily: FONT,
    fontSize: 10,
    color: COLORS.t2,
    marginTop: 4
  },
  viewHistoryBtn: {
    marginTop: 14,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center'
  },
  viewHistoryText: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
    fontWeight: '700'
  },

  // "INFORME FINANCIERO" BAR CHART
  pillBadgeMuted: {
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3
  },
  pillBadgeMutedText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.t3,
    letterSpacing: 0.6
  },
  chartBarsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 110,
    marginTop: 18
  },
  chartCol: {
    alignItems: 'center',
    width: 60
  },
  chartPercentLabel: {
    fontFamily: FONT_MEDIUM,
    fontSize: 11,
    color: COLORS.t2,
    marginBottom: 6
  },
  chartBarTrack: {
    width: 32,
    height: 64,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'flex-end'
  },
  chartBarFill: {
    width: '100%',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10
  },
  chartBarName: {
    marginTop: 6,
    fontFamily: FONT,
    fontSize: 10,
    color: COLORS.t3
  },

  // MANUAL TEXT INPUT
  input: {
    marginTop: 12,
    minHeight: 110,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    backgroundColor: COLORS.surfaceSubtle,
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  manualActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12
  },
  helperText: {
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 11
  },
  checkButton: {
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999
  },
  checkButtonText: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
    fontWeight: '700'
  },
  manualResultWrap: {
    marginTop: 16
  },

  // 3) HISTORY TAB
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120
  },
  historySectionHeader: {
    marginBottom: 16
  },
  historySectionTitle: {
    fontFamily: FONT_MEDIUM,
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.4
  },
  historySectionSub: {
    marginTop: 2,
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.t3,
    letterSpacing: 0.8
  },
  historyHeaderChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  historySmallChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4
  },
  chipText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    fontWeight: '700'
  },
  clearPillButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder
  },
  clearPillText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    color: COLORS.fraud,
    fontWeight: '700'
  },

  // RISK CARD (Workouts item style)
  card: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: 24,
    padding: 16,
    marginBottom: 12
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  cardAvatarBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  cardAvatarGlyph: {
    fontSize: 16,
    fontWeight: '800'
  },
  pinnedStarBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 8,
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.gold
  },
  pinnedStarText: {
    color: COLORS.gold,
    fontSize: 9,
    lineHeight: 11
  },
  cardCenterCol: {
    flex: 1,
    marginLeft: 12
  },
  cardSender: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    marginRight: 6
  },
  cardDate: {
    marginTop: 2,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 10
  },
  cardBodyPreview: {
    marginTop: 4,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 16
  },
  cardMetaChipsRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 6
  },
  metaChip: {
    backgroundColor: COLORS.surfaceSubtle,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder
  },
  metaChipText: {
    fontFamily: FONT,
    fontSize: 10,
    color: COLORS.t2
  },
  riskPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1
  },
  riskPillDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginRight: 4
  },
  riskPillText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 10,
    fontWeight: '700'
  },
  chevronWrap: {
    marginLeft: 8,
    paddingHorizontal: 4
  },
  chevronText: {
    color: COLORS.t3,
    fontSize: 16
  },
  cardDangerPillRow: {
    marginTop: 10
  },

  // DANGER TAG
  dangerTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.fraudBg,
    borderWidth: 1,
    borderColor: COLORS.fraudBorder,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start'
  },
  dangerTagLarge: {
    paddingHorizontal: 12,
    paddingVertical: 6
  },
  dangerTagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.fraud,
    marginRight: 6
  },
  dangerTagText: {
    color: COLORS.fraud,
    fontFamily: FONT_MEDIUM,
    fontSize: 11,
    fontWeight: '700'
  },
  dangerTagTextLarge: {
    fontSize: 12
  },

  // EXPANDED DETAILS
  detailSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder
  },
  dangerRowExpanded: {
    marginBottom: 10
  },
  cardMessageSection: {
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder
  },
  cardMessageLabel: {
    fontFamily: FONT_MEDIUM,
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.t3,
    letterSpacing: 0.8,
    marginBottom: 4
  },
  cardBodyFull: {
    color: COLORS.text,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 19
  },
  cardResultSection: {
    marginTop: 12
  },
  cardResultLabel: {
    fontFamily: FONT_MEDIUM,
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.t3,
    letterSpacing: 0.8,
    marginBottom: 6
  },
  verdictScoreBarTrack: {
    height: 4,
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8
  },
  verdictScoreBarFill: {
    height: '100%',
    borderRadius: 999
  },
  inlineMetaRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  inlineMetaLabel: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12,
    marginRight: 6
  },
  inlineMetaValue: {
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
    fontWeight: '700'
  },
  explanationSection: {
    marginTop: 8
  },
  detailHeading: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
    marginTop: 10
  },
  detailText: {
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 7,
    marginRight: 8
  },
  detailBulletText: {
    flex: 1,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18
  },
  confidenceText: {
    marginTop: 10,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 11
  },
  actionRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8
  },
  actionButton: {
    flex: 1,
    backgroundColor: COLORS.surfaceSubtle,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center'
  },
  actionButtonText: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
    fontWeight: '700'
  },
  actionButtonDelete: {
    flex: 1,
    backgroundColor: COLORS.fraudBg,
    borderWidth: 1,
    borderColor: COLORS.fraudBorder,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center'
  },
  actionButtonDeleteText: {
    color: COLORS.fraud,
    fontFamily: FONT_MEDIUM,
    fontSize: 12,
    fontWeight: '700'
  },

  // 5) FLOATING BOTTOM NAVIGATION BAR (The Outsiders / Workouts pill bar)
  bottomNavContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 24 : 34,
    left: 20,
    right: 20,
    alignItems: 'center'
  },
  floatingNavBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(26, 26, 29, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 32,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10
  },
  floatingTabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24
  },
  floatingTabItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)'
  },
  tabIconShape: {
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center'
  },
  tabIconRadarCircle: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.8,
    borderColor: COLORS.t3
  },
  tabIconListLine: {
    width: 12,
    height: 2,
    backgroundColor: COLORS.t3,
    borderRadius: 1,
    marginVertical: 1
  },
  tabStarGlyph: {
    fontSize: 13,
    color: COLORS.t3
  },
  floatingTabLabel: {
    color: COLORS.t3,
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
    fontWeight: '600'
  },
  floatingTabLabelActive: {
    color: COLORS.text,
    fontWeight: '700'
  },
  tabBadge: {
    marginLeft: 6,
    backgroundColor: COLORS.fraudBg,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 999
  },
  tabBadgeText: {
    fontFamily: FONT_MEDIUM,
    fontSize: 9,
    color: COLORS.fraud,
    fontWeight: '700'
  },

  // EMPTY STATE
  emptyState: {
    marginTop: 60,
    alignItems: 'center',
    paddingHorizontal: 30
  },
  emptyIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.surfaceSubtle,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14
  },
  emptyShieldGlyph: {
    width: 18,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.t3
  },
  emptyTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 16,
    fontWeight: '700'
  },
  emptySubtitle: {
    marginTop: 6,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18
  },

  // OLD TABS (Kept for backward compatibility if ever called)
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
    backgroundColor: COLORS.safe
  },

  // CONSENT SCREEN ("Before you start")
  consentContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: Platform.OS === 'android' ? 44 : 56
  },
  consentScroll: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 24
  },
  consentDeclinedBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 22
  },
  consentTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 28,
    fontWeight: '700'
  },
  consentIntro: {
    marginTop: 10,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 14,
    lineHeight: 21
  },
  consentBlock: {
    marginTop: 14,
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: 14
  },
  consentBlockTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 14,
    fontWeight: '700'
  },
  consentBlockText: {
    marginTop: 6,
    color: COLORS.t2,
    fontFamily: FONT,
    fontSize: 13,
    lineHeight: 20
  },
  consentFootnote: {
    marginTop: 16,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18
  },
  consentLink: {
    marginTop: 12,
    color: COLORS.heroLavender,
    fontFamily: FONT_MEDIUM,
    fontSize: 13,
    textDecorationLine: 'underline'
  },
  consentButtons: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 10
  },
  consentPrimary: {
    backgroundColor: COLORS.heroLavender,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center'
  },
  consentPrimaryText: {
    color: COLORS.bg,
    fontFamily: FONT_MEDIUM,
    fontSize: 15,
    fontWeight: '700'
  },
  consentSecondary: {
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center'
  },
  consentSecondaryText: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 15,
    fontWeight: '700'
  },

  // SETTINGS SHEET
  settingsBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    paddingHorizontal: 24
  },
  settingsSheet: {
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    padding: 18,
    gap: 10
  },
  settingsTitle: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4
  },
  settingsRow: {
    backgroundColor: COLORS.surfaceSubtle,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceBorder,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  settingsRowDanger: {
    backgroundColor: COLORS.fraudBg,
    borderColor: COLORS.fraudBorder
  },
  settingsRowText: {
    color: COLORS.text,
    fontFamily: FONT_MEDIUM,
    fontSize: 14,
    fontWeight: '700'
  },
  settingsClose: {
    marginTop: 4,
    backgroundColor: COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center'
  },

  // RESULT CARD FOOTER (honest labels)
  cardFooter: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceBorder
  },
  cardFooterEngine: {
    color: COLORS.t2,
    fontFamily: FONT_MEDIUM,
    fontSize: 11
  },
  cardFooterDisclaimer: {
    marginTop: 3,
    color: COLORS.t3,
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: 16
  },

  // UTILITY STATES
  scalePressed: {
    transform: [{ scale: 0.97 }]
  },
  dimmed: {
    opacity: 0.5
  }
});

registerRootComponent(Root);
export default Root;
