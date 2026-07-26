import React, { useRef, useState, useCallback } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { isTokenExpired, storeToken } from '@/connectors/tiime/auth';

export const TIIME_APP_URL = 'https://apps.tiime.fr';
export const TIIME_SIGNIN_URL = 'https://apps.tiime.fr/signin';

// Read the SPA's Auth0 access token out of localStorage and hand it back to RN.
// Returns 'null' string when absent so the host can distinguish "not yet".
export const READ_TOKEN_JS = `
  (function () {
    try {
      var t = window.localStorage.getItem('access_token');
      window.ReactNativeWebView.postMessage(t || 'null');
    } catch (e) {
      window.ReactNativeWebView.postMessage('null');
    }
    true;
  })();
`;

/** Visible login WebView. Calls onToken once a token appears post-login. */
export function TiimeLoginWebView(props: { onToken: (token: string) => void }) {
  const ref = useRef<WebView>(null);
  // READ_TOKEN_JS fires on load and on every navigation, so the same token
  // can arrive several times; only the first accepted one may call onToken.
  const fired = useRef(false);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      if (fired.current) return;
      const data = e.nativeEvent.data;
      if (!data || data === 'null') return;
      // On reconnect the SPA's localStorage may still hold the old, expired
      // token — treat it as "not a token yet" and keep waiting for the fresh
      // one written after the user actually signs in.
      if (isTokenExpired(data, Date.now())) return;
      fired.current = true;
      props.onToken(data);
    },
    [props]
  );

  return (
    <WebView
      ref={ref}
      source={{ uri: TIIME_SIGNIN_URL }}
      onNavigationStateChange={() => ref.current?.injectJavaScript(READ_TOKEN_JS)}
      onMessage={onMessage}
      // Poll after load in case navigation state settles before storage is written.
      injectedJavaScript={READ_TOKEN_JS}
    />
  );
}

/** Offscreen WebView that reloads apps.tiime.fr to renew the token via the
 *  still-valid Auth0 SSO cookies. Resolves with the token or null after timeout. */
export function useHiddenTiimeRefresher(): {
  node: React.ReactNode;
  refresh: () => Promise<string | null>;
} {
  const [active, setActive] = useState(false);
  const resolver = useRef<((t: string | null) => void) | null>(null);
  const inFlight = useRef<Promise<string | null> | null>(null);
  const ref = useRef<WebView>(null);

  const refresh = useCallback(() => {
    // Single-flight: concurrent callers share the pending refresh instead of
    // overwriting resolver.current (which would orphan the first caller until
    // its 15s timeout resolves null → spurious TiimeAuthError).
    if (inFlight.current) return inFlight.current;
    const promise = new Promise<string | null>((resolve) => {
      // `settle` is defined before `timeoutId` is assigned, but it only ever
      // runs later (on message or on timeout), by which point `timeoutId`
      // has been set — so no TDZ issue at call time. This also sidesteps
      // strict-null-checks on a reassigned `resolver.current` (TS drops the
      // narrowing of a ref property across the intervening `setActive` call).
      let timeoutId: ReturnType<typeof setTimeout>;
      const settle = (t: string | null) => {
        clearTimeout(timeoutId);
        resolver.current = null;
        inFlight.current = null;
        setActive(false);
        resolve(t);
      };
      resolver.current = settle;
      setActive(true);
      timeoutId = setTimeout(() => settle(null), 15000);
    });
    inFlight.current = promise;
    return promise;
  }, []);

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    const data = e.nativeEvent.data;
    if (data && data !== 'null') {
      await storeToken(data);
      resolver.current?.(data);
    }
  }, []);

  const node = active ? (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }}>
      <WebView
        ref={ref}
        source={{ uri: TIIME_APP_URL }}
        onNavigationStateChange={() => ref.current?.injectJavaScript(READ_TOKEN_JS)}
        onMessage={onMessage}
      />
    </View>
  ) : null;

  return { node, refresh };
}
