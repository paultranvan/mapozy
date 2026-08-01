import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, View, ActivityIndicator, StatusBar } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useEffect, useState } from 'react';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { adriaticTheme } from '@/theme/paperTheme';
import { colors } from '@/theme/tokens';
import { type Db } from '@/db/client';
import { getSharedDb } from '@/db/sharedDb';
import { DbProvider } from '@/db/DbContext';
import { getSetting, SETTING_KEYS } from '@/db/settings';
import {
  I18nProvider,
  normalizeLanguagePref,
  resolveLocale,
  setCurrentLocale,
  type LanguagePref,
} from '@/i18n';
import {
  runPipelineForForeground,
  isTracking,
  restartTracking,
  subscribeStationary,
} from '@/tracking/tracker';
import { shouldRunPipelineOnAppStateChange } from '@/tracking/foregroundTrigger';
import { useHiddenTiimeRefresher } from '@/connectors/tiime/webview';
import { TiimeRefresherProvider } from '@/queries/useTiime';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 0,
    },
  },
});

export default function RootLayout() {
  const [db, setDb] = useState<Db | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  // Resolved before first render of the app tree (we already gate on `db`),
  // so no flash of the wrong language.
  const [language, setLanguage] = useState<LanguagePref | null>(null);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  const { node: tiimeRefresherNode, refresh: tiimeRefresh } = useHiddenTiimeRefresher();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Shared singleton (not a fresh openDb): the headless pipeline task
        // must land on the SAME Db instance so its runs serialize with ours.
        const handle = await getSharedDb();
        const pref = normalizeLanguagePref(
          await getSetting(handle, SETTING_KEYS.LANGUAGE)
        );
        setCurrentLocale(resolveLocale(pref));
        if (mounted) {
          setLanguage(pref);
          setDb(handle);
        }
      } catch (e) {
        if (mounted) setDbError(String(e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Re-assert the native tracking service on cold start. An app update or OS
  // process kill tears down the foreground service, and nothing else restarts it
  // until a reboot or a manual Settings toggle — so simply reopening the app
  // would silently leave tracking dead (the Settings toggle still reads "on"
  // from the persisted flag, masking it). If tracking is enabled, restart it
  // (atomic re-subscribe; also reschedules the watchdog). Runs in the
  // foreground, so it's exempt from the background FGS-start restriction.
  useEffect(() => {
    (async () => {
      try {
        if (await isTracking()) {
          await restartTracking();
        }
      } catch {
        // Native module not ready / permission not yet granted — the Settings
        // toggle and the boot receiver remain as fallbacks.
      }
    })();
  }, []);

  // Drain unconsumed raw points on cold start and on every return to foreground.
  // Primary path is the native MOVING→STATIONARY event (see subscribeStationary
  // below); this foreground call is the backstop for when the event fired while
  // JS was dead and was lost in transit, or when the native side has been
  // stationary for the stale-bypass window. Internally guarded so it won't
  // fragment a trip the user opens mid-drive.
  useEffect(() => {
    if (!db) return;
    void runPipelineForForeground(db, queryClient);
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (shouldRunPipelineOnAppStateChange(next, prev)) {
        void runPipelineForForeground(db, queryClient);
      }
      prev = next;
    });
    return () => sub.remove();
  }, [db]);

  // Primary auto-trigger for the pipeline: native fires onStationary at trip
  // end (STOP_TIMEOUT_MS of confirmed stillness), JS drains immediately so the
  // trip appears without the user having to wait or hit "Force pipeline".
  useEffect(() => {
    if (!db) return;
    const sub = subscribeStationary(db, queryClient);
    return () => sub.remove();
  }, [db]);

  if (!db || !fontsLoaded || language === null) {
    return (
      <PaperProvider theme={adriaticTheme}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.ground} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ground,
          }}
        >
          <ActivityIndicator size="large" color={colors.inkOnGround} />
        </View>
      </PaperProvider>
    );
  }
  if (dbError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.ground }}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.ground} />
      <PaperProvider theme={adriaticTheme}>
        <QueryClientProvider client={queryClient}>
          <DbProvider db={db}>
            <I18nProvider db={db} initialLanguage={language}>
            <TiimeRefresherProvider value={tiimeRefresh}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.ground },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              <Stack.Screen
                name="trip/[id]"
                options={{
                  presentation: 'card',
                  animation: 'slide_from_right',
                }}
              />
              <Stack.Screen
                name="tiime/index"
                options={{
                  presentation: 'card',
                  animation: 'slide_from_right',
                }}
              />
              <Stack.Screen
                name="tiime/login"
                options={{
                  presentation: 'card',
                  animation: 'slide_from_right',
                }}
              />
            </Stack>
            {tiimeRefresherNode}
            </TiimeRefresherProvider>
            </I18nProvider>
          </DbProvider>
        </QueryClientProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
