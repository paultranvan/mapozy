import { useEffect } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { useDb } from '@/db/DbContext';
import { insertDiagnosticEvent } from '@/db/diagnostics';
import { colors, space, radii } from '@/theme/tokens';
import { useI18n } from '@/i18n';

/**
 * Fallback rendered by a route's `ErrorBoundary` export when that screen throws
 * during render. Instead of the whole app hard-crashing (there is no global
 * boundary, so an uncaught render error kills the process), the user gets a
 * recoverable screen — and the error + stack are written to `tracker_diagnostics`
 * so the next export pins down the root cause.
 */
export function ScreenErrorFallback({
  error,
  retry,
  screen,
}: {
  error: Error;
  retry: () => void;
  screen: string;
}) {
  const router = useRouter();
  const db = useDb();
  const { t } = useI18n();

  useEffect(() => {
    insertDiagnosticEvent(db, Date.now(), 'js_render_error', {
      screen,
      message: String(error?.message ?? error),
      stack: error?.stack ?? null,
    }).catch(() => {
      /* logging is best-effort — never let it mask the original error */
    });
  }, [db, error, screen]);

  return (
    <View style={styles.root}>
      <Text variant="display" align="center">
        {t('errorFallback.title')}
      </Text>
      <Text variant="body" soft align="center" style={styles.msg}>
        {t('errorFallback.message')}
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.btn, styles.primary]} onPress={() => void retry()}>
          <Text variant="title" style={{ color: colors.surface }}>
            {t('errorFallback.tryAgain')}
          </Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.secondary]} onPress={() => router.back()}>
          <Text variant="title">{t('errorFallback.goBack')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[5],
    gap: space[3],
  },
  msg: { marginTop: space[1] },
  actions: { flexDirection: 'row', gap: space[3], marginTop: space[4] },
  btn: {
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radii.pill,
    alignItems: 'center',
  },
  primary: { backgroundColor: colors.deep },
  secondary: { backgroundColor: colors.surfaceMuted },
});
