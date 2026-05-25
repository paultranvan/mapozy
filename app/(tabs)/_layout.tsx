import { Tabs, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from 'react-native-paper';
import { useEffect } from 'react';
import { useDb } from '@/db/DbContext';
import { getSetting, SETTING_KEYS } from '@/db/settings';
import { useTrackerBridge } from '@/tracking/tracker';

export default function TabsLayout() {
  const theme = useTheme();
  const router = useRouter();
  const db = useDb();

  useTrackerBridge();

  useEffect(() => {
    (async () => {
      const done = await getSetting(db, SETTING_KEYS.ONBOARDING_DONE);
      if (done !== '1') {
        router.replace('/onboarding');
      }
    })();
  }, [db, router]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="walk" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="chart-bar" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
