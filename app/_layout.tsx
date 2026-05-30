import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState, View, ActivityIndicator, StatusBar } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { useEffect, useState } from 'react';
import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_500Medium,
} from '@expo-google-fonts/fraunces';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { adriaticTheme } from '@/theme/paperTheme';
import { colors } from '@/theme/tokens';
import { openDb, type Db } from '@/db/client';
import { DbProvider } from '@/db/DbContext';
import {
  runPipelineForForeground,
  isTracking,
  restartTracking,
  subscribeStationary,
} from '@/tracking/tracker';
import { shouldRunPipelineOnAppStateChange } from '@/tracking/foregroundTrigger';

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

  const [fontsLoaded] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_500Medium,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const handle = await openDb();
        if (mounted) setDb(handle);
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

  if (!db || !fontsLoaded) {
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
            </Stack>
          </DbProvider>
        </QueryClientProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
