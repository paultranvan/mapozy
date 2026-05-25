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
import { runPipelineForForeground } from '@/tracking/tracker';
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

  // Drain unconsumed raw points on cold start and on every return to foreground,
  // BUT only if the most recent unconsumed point is at least 30 min old (or the
  // backlog is more than 12h stale). Recovers from "OS killed JS mid-trip, user
  // reopens app and sees nothing" without the risk of fragmenting an in-progress
  // trip when the user opens the app while still driving.
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

  if (!db || !fontsLoaded) {
    return (
      <PaperProvider theme={adriaticTheme}>
        <StatusBar barStyle="light-content" backgroundColor={colors.ground} />
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
      <StatusBar barStyle="light-content" backgroundColor={colors.ground} />
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
