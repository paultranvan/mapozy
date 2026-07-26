import React, { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { TiimeLoginWebView } from '@/connectors/tiime/webview';
import { storeToken } from '@/connectors/tiime/auth';
import { colors } from '@/theme/tokens';

export default function TiimeLoginScreen() {
  const onToken = useCallback(async (token: string) => {
    await storeToken(token);
    router.back();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <TiimeLoginWebView onToken={onToken} />
    </View>
  );
}
