import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useDb } from '@/db/DbContext';
import { getSetting, SETTING_KEYS } from '@/db/settings';
import { TabBar } from '@/ui/TabBar';

export default function TabsLayout() {
  const router = useRouter();
  const db = useDb();

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
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Trips' }} />
      <Tabs.Screen name="stats" options={{ title: 'Stats' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
