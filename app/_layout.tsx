import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useColorScheme, View, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { lightTheme, darkTheme } from '@/theme/paperTheme';
import { openDb, type Db } from '@/db/client';
import { DbProvider } from '@/db/DbContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 0,
    },
  },
});

export default function RootLayout() {
  const scheme = useColorScheme();
  const [db, setDb] = useState<Db | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

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

  const theme = scheme === 'dark' ? darkTheme : lightTheme;

  if (!db) {
    return (
      <PaperProvider theme={theme}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.background,
          }}
        >
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </PaperProvider>
    );
  }
  if (dbError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <DbProvider db={db}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
              <Stack.Screen
                name="trip/[id]"
                options={{
                  headerShown: true,
                  title: 'Trip',
                  presentation: 'card',
                }}
              />
            </Stack>
          </DbProvider>
        </QueryClientProvider>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
