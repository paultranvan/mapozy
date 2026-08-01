import React, { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { TiimeLoginWebView } from '@/connectors/tiime/webview';
import { storeToken } from '@/connectors/tiime/auth';
import { colors } from '@/theme/tokens';

export default function TiimeLoginScreen() {
  const queryClient = useQueryClient();

  const onToken = useCallback(
    async (token: string) => {
      await storeToken(token);
      // Refresh connection state (and anything else under ['tiime']) so the
      // screens behind us show "connected" immediately — RN has no
      // window-focus refetch to pick it up otherwise.
      queryClient.invalidateQueries({ queryKey: ['tiime'] });
      router.back();
    },
    [queryClient]
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <TiimeLoginWebView onToken={onToken} />
    </View>
  );
}
