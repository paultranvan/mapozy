import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  View,
  StyleSheet,
  Alert,
  Switch,
  Pressable,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useDb } from '@/db/DbContext';
import { getSetting, setSetting, SETTING_KEYS } from '@/db/settings';
import { setExternalApiAllowed } from '@/lib/net';
import { countTrips, deleteAllTrips } from '@/db/trips';
import { countUnconsumedPoints } from '@/db/rawPoints';
import {
  startTracking,
  stopTracking,
  isTracking,
  runPipelineAndInvalidate,
} from '@/tracking/tracker';
import { MapozyTracker } from 'mapozy-tracker';
import { injectDemoTrip } from '@/lib/demoTrip';
import { sendDbToPaul } from '@/lib/sendDbToPaul';
import { shareDb } from '@/lib/shareDb';
import { importDb, InvalidDatabaseError } from '@/lib/importDb';
import * as DocumentPicker from 'expo-document-picker';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { TrackingHealth } from '@/ui/TrackingHealth';
import { colors, space, radii } from '@/theme/tokens';
import { useTrackingHealth } from '@/tracking/useTrackingHealth';
import { getInterruptions, type Interruption } from '@/tracking/interruptions';
import { format } from 'date-fns';
import { fr as dateFnsFr } from 'date-fns/locale';
import { t, useI18n, type LanguagePref } from '@/i18n';
import {
  useTiimeConnection,
  useTiimeConfig,
  useTiimeRefresher,
  disconnectTiime,
} from '@/queries/useTiime';
import { createTiimeClient } from '@/connectors/tiime/client';
import {
  fetchDefaultCompany,
  fetchVehicles,
  type TiimeCompany,
  type TiimeVehicle,
} from '@/connectors/tiime/config-api';

const LANGUAGE_OPTIONS: Array<{ pref: LanguagePref; labelKey: Parameters<typeof t>[0] }> = [
  { pref: 'system', labelKey: 'settings.langSystem' },
  // Language names stay in their own language on purpose — a French speaker
  // stuck on an English UI must still recognize « Français ».
  { pref: 'en', labelKey: 'settings.langEnglish' },
  { pref: 'fr', labelKey: 'settings.langFrench' },
];

export default function SettingsScreen() {
  const db = useDb();
  const qc = useQueryClient();
  const router = useRouter();
  const { t, locale, language, setLanguage } = useI18n();

  const [trackingOn, setTrackingOn] = useState(false);
  const [tripCount, setTripCount] = useState(0);
  const [rawCount, setRawCount] = useState(0);
  const [batteryUnrestricted, setBatteryUnrestricted] = useState(false);
  const [interruptions, setInterruptions] = useState<Interruption[] | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [allowExternalApi, setAllowExternalApi] = useState(true);
  const [networkInfoVisible, setNetworkInfoVisible] = useState(false);
  const health = useTrackingHealth();

  const tiimeConnection = useTiimeConnection();
  const tiimeConfig = useTiimeConfig();
  const tiimeRefresh = useTiimeRefresher();
  // Created unconditionally, but only ever used from the two explicit paths
  // below (first-time setup, "Changer de véhicule") — never on a plain mount.
  const tiimeClient = useMemo(
    () => createTiimeClient({ refresh: tiimeRefresh }),
    [tiimeRefresh]
  );
  const tiimeSetupComplete = tiimeConfig.companyId != null && tiimeConfig.vehicleId != null;
  // First-time setup only (company/vehicle not yet stored locally).
  const [tiimeCompany, setTiimeCompany] = useState<TiimeCompany | null>(null);
  const [tiimeCompanyError, setTiimeCompanyError] = useState<string | null>(null);
  const [tiimeCompanyLoading, setTiimeCompanyLoading] = useState(false);
  const [tiimeVehicles, setTiimeVehicles] = useState<TiimeVehicle[] | null>(null);
  const [tiimeVehiclesError, setTiimeVehiclesError] = useState<string | null>(null);
  const [tiimeVehiclesLoading, setTiimeVehiclesLoading] = useState(false);
  const setupStartedRef = useRef(false);

  // "Changer de véhicule": on-demand vehicle refetch once setup is complete.
  const [showVehiclePicker, setShowVehiclePicker] = useState(false);
  const [changeVehicleList, setChangeVehicleList] = useState<TiimeVehicle[] | null>(null);
  const [changeVehicleError, setChangeVehicleError] = useState<string | null>(null);
  const [changeVehicleLoading, setChangeVehicleLoading] = useState(false);

  const refreshCounts = useCallback(async () => {
    setTripCount(await countTrips(db));
    setRawCount(await countUnconsumedPoints(db));
  }, [db]);

  useEffect(() => {
    (async () => {
      setTrackingOn(await isTracking());
      await refreshCounts();
      setAllowExternalApi(
        (await getSetting(db, SETTING_KEYS.ALLOW_EXTERNAL_API)) !== '0'
      );
      setBatteryUnrestricted(await MapozyTracker.isIgnoringBatteryOptimizations());
      const now = Date.now();
      const result = await getInterruptions(db, {
        intervalMs: 15 * 60_000,
        nowMs: now,
        sinceMs: now - 14 * 24 * 60 * 60_000,
      });
      setInterruptions(result);
    })();
  }, [db, refreshCounts]);

  // The native tracker keeps inserting points while this screen is open, so a
  // count fetched only on mount goes stale (and then appears to "jump up" after
  // Force pipeline). Re-read it whenever the tab regains focus so the number
  // the user sees is current.
  useFocusEffect(
    useCallback(() => {
      void refreshCounts();
    }, [refreshCounts])
  );

  // Ensure Tiime setup is complete (company + vehicle resolved and stored
  // locally). Runs the fetch flow ONCE, only when something is missing —
  // never on a mount where setup is already done. `setupStartedRef` guards
  // against re-entry: writing the resolved ids invalidates ['tiime','config'],
  // which refetches, but (see deps below) that refetch must NOT re-run this
  // effect.
  useEffect(() => {
    if (!tiimeConnection.connected) {
      setupStartedRef.current = false;
      setTiimeCompany(null);
      setTiimeCompanyError(null);
      setTiimeCompanyLoading(false);
      setTiimeVehicles(null);
      setTiimeVehiclesError(null);
      setTiimeVehiclesLoading(false);
      return;
    }
    // useTiimeConfig also returns null companyId/vehicleId while its 4 sqlite
    // reads are still in flight — indistinguishable from "not set up" unless
    // we wait for `loaded`. useTiimeConnection resolves first (1 SecureStore
    // read) so without this gate a fully-set-up user would still trigger a
    // fetchDefaultCompany/fetchVehicles round trip on every cold start.
    if (!tiimeConfig.loaded) return;
    if (tiimeSetupComplete || setupStartedRef.current) return;
    setupStartedRef.current = true;

    let cancelled = false;
    (async () => {
      setTiimeCompanyLoading(true);
      setTiimeCompanyError(null);
      let company: TiimeCompany;
      try {
        company = await fetchDefaultCompany(tiimeClient);
      } catch (e) {
        if (!cancelled) {
          setTiimeCompanyError(String(e));
          setTiimeCompanyLoading(false);
        }
        return;
      }
      if (cancelled) return;
      setTiimeCompany(company);
      setTiimeCompanyLoading(false);
      await tiimeConfig.setCompany(company.id, company.name);

      setTiimeVehiclesLoading(true);
      setTiimeVehiclesError(null);
      try {
        const list = await fetchVehicles(tiimeClient, company.id);
        if (cancelled) return;
        setTiimeVehicles(list);
        // A single vehicle needs no choice — select it by default.
        if (list.length === 1) {
          await tiimeConfig.setVehicle(list[0]!.id, list[0]!.name);
        }
      } catch (e) {
        if (!cancelled) setTiimeVehiclesError(String(e));
      } finally {
        if (!cancelled) setTiimeVehiclesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tiimeConfig's companyId/vehicleId (and tiimeSetupComplete, derived from
    // them) are intentionally excluded below. This effect is what WRITES
    // those ids via setCompany/setVehicle; each write invalidates
    // ['tiime','config'] and re-renders with a new value BEFORE the in-flight
    // fetchVehicles network call resolves. If those values were dependencies,
    // the resulting re-render would re-run this effect, whose cleanup sets
    // `cancelled = true` on the run still awaiting fetchVehicles — so the
    // resolved vehicle is silently dropped (never persisted) and the spinner
    // never clears, since setupStartedRef stays latched and blocks any retry.
    // Reading tiimeSetupComplete/tiimeConfig inside the effect body (guarded
    // above) is fine — only *re-running the effect* on their change is the
    // problem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiimeConnection.connected, tiimeConfig.loaded, tiimeClient]);

  // "Jun 5 14:02" / "5 juin 14:02" — interruption timestamps.
  const formatInterruptionDate = (ms: number) =>
    locale === 'fr'
      ? format(ms, 'd MMM HH:mm', { locale: dateFnsFr })
      : format(ms, 'MMM d HH:mm');

  async function requestBatteryExemption() {
    await MapozyTracker.requestIgnoreBatteryOptimizations();
    setTimeout(async () => {
      setBatteryUnrestricted(await MapozyTracker.isIgnoringBatteryOptimizations());
    }, 1500);
  }

  async function toggleTracking(value: boolean) {
    try {
      if (value) {
        await startTracking();
      } else {
        await stopTracking();
      }
      await setSetting(db, SETTING_KEYS.TRACKING_ENABLED, value ? '1' : '0');
      setTrackingOn(value);
    } catch (e) {
      Alert.alert(t('common.error'), String(e));
    }
  }

  async function toggleAllowExternalApi(value: boolean) {
    await setExternalApiAllowed(db, value);
    setAllowExternalApi(value);
  }

  async function runPipeline() {
    if (pipelineBusy) return;
    setPipelineBusy(true);
    try {
      await runPipelineAndInvalidate(db, qc);
      await refreshCounts();
      Alert.alert(t('settings.pipelineDone'), t('settings.pipelineDoneMsg'));
    } catch (e) {
      Alert.alert(t('settings.pipelineFailed'), String(e));
    } finally {
      setPipelineBusy(false);
    }
  }

  async function onSendDataToPaul() {
    try {
      await sendDbToPaul(db);
    } catch (e) {
      Alert.alert(t('settings.sendDataFailed'), String(e));
    }
  }

  async function onShareDb() {
    try {
      await shareDb(db);
    } catch (e) {
      Alert.alert(t('settings.shareDbFailed'), String(e));
    }
  }

  async function onImportDb() {
    let picked: DocumentPicker.DocumentPickerAsset;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      picked = result.assets[0]!;
    } catch (e) {
      Alert.alert(t('settings.pickFileFailed'), String(e));
      return;
    }
    Alert.alert(
      t('settings.replaceDbTitle'),
      t('settings.replaceDbMsg', { name: picked.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.replace'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Quiet the native side so it stops writing to the file we're
              // about to swap. Tracking re-enables on the next app start if
              // the user had it on (per the persisted setting).
              try {
                await stopTracking();
              } catch {
                // best effort
              }
              const r = await importDb(picked.uri);
              Alert.alert(
                t('settings.importedTitle'),
                t('settings.importedMsg', { kb: Math.round(r.sourceSize / 1024) })
              );
            } catch (e) {
              const msg =
                e instanceof InvalidDatabaseError
                  ? e.message
                  : t('settings.importFailedMsg', { error: String(e) });
              Alert.alert(t('settings.importFailed'), msg);
            }
          },
        },
      ]
    );
  }

  function confirmClearAll() {
    Alert.alert(
      t('settings.clearAllTitle'),
      t('settings.clearAllMsg'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteAllTrips(db);
            await db.runAsync(`DELETE FROM raw_points`);
            await db.runAsync(`DELETE FROM raw_activities`);
            await db.runAsync(`DELETE FROM places`);
            // Settings that reference deleted rows would otherwise dangle
            // (e.g. last_known_place_id -> non-existent place id, causing
            // FK violations on the next pipeline run). Reset AUTOINCREMENT
            // counters too so next inserts start at id=1, matching the
            // intent of "wipe everything".
            await db.runAsync(
              `DELETE FROM settings WHERE key = ?`,
              SETTING_KEYS.LAST_KNOWN_PLACE_ID
            );
            await db.runAsync(
              `DELETE FROM sqlite_sequence WHERE name IN ('trips','sections','places','raw_points','raw_activities')`
            );
            setTripCount(0);
            setRawCount(0);
            await qc.invalidateQueries();
          },
        },
      ]
    );
  }

  async function resetOnboarding() {
    await setSetting(db, SETTING_KEYS.ONBOARDING_DONE, '0');
    router.replace('/onboarding');
  }

  async function onSelectTiimeVehicle(vehicle: TiimeVehicle) {
    await tiimeConfig.setVehicle(vehicle.id, vehicle.name);
  }

  // "Changer de véhicule": only path (besides first-time setup and sending
  // trips) that is allowed to hit the Tiime API once setup is complete.
  function onOpenChangeVehicle() {
    if (tiimeConfig.companyId == null) return;
    if (changeVehicleLoading) return;
    setShowVehiclePicker(true);
    setChangeVehicleList(null);
    setChangeVehicleError(null);
    setChangeVehicleLoading(true);
    (async () => {
      try {
        const list = await fetchVehicles(tiimeClient, tiimeConfig.companyId!);
        setChangeVehicleList(list);
      } catch (e) {
        setChangeVehicleError(String(e));
      } finally {
        setChangeVehicleLoading(false);
      }
    })();
  }

  async function onPickChangedVehicle(vehicle: TiimeVehicle) {
    await tiimeConfig.setVehicle(vehicle.id, vehicle.name);
    setShowVehiclePicker(false);
    setChangeVehicleList(null);
    setChangeVehicleError(null);
  }

  async function onDisconnectTiime() {
    await disconnectTiime();
    // Wipe the persisted company/vehicle too, not just the auth token —
    // otherwise a reconnect (possibly to a DIFFERENT Tiime account) sees the
    // stale ids, tiimeSetupComplete is immediately true, and the app sends
    // trips against the old account's company/vehicle.
    await tiimeConfig.clearConfig();
    setTiimeCompany(null);
    setTiimeCompanyError(null);
    setTiimeCompanyLoading(false);
    setTiimeVehicles(null);
    setTiimeVehiclesError(null);
    setTiimeVehiclesLoading(false);
    setShowVehiclePicker(false);
    setChangeVehicleList(null);
    setChangeVehicleError(null);
    setChangeVehicleLoading(false);
    await tiimeConnection.refetch();
  }

  return (
    <View style={styles.root}>
      <TopBar title={t('settings.title')} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionTracking')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="title">
                {trackingOn ? t('settings.trackingActive') : t('settings.trackingPaused')}
              </Text>
            </View>
            <Switch
              value={trackingOn}
              onValueChange={toggleTracking}
              trackColor={{ true: colors.accentSoft, false: colors.divider }}
              thumbColor={trackingOn ? colors.accent : colors.surface}
            />
          </View>
          <View style={styles.divider} />
          <TrackingHealth
            snapshot={health.snapshot}
            pointsToday={health.pointsToday}
            onRefresh={health.refresh}
          />
          <View style={styles.divider} />
          <Pressable
            style={styles.actionRow}
            onPress={requestBatteryExemption}
            disabled={batteryUnrestricted}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title">
                {batteryUnrestricted
                  ? t('settings.batteryDisabled')
                  : t('settings.batteryDisable')}
              </Text>
              <Text variant="meta" soft>
                {batteryUnrestricted
                  ? t('settings.batteryOkHint')
                  : t('settings.batteryRequiredHint')}
              </Text>
            </View>
            {!batteryUnrestricted && (
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={colors.inkSoft}
              />
            )}
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionTiime')}
        </Text>
        <Card style={styles.card}>
          {!tiimeConnection.connected ? (
            <Pressable
              style={styles.actionRow}
              onPress={() => router.push('/tiime/login')}
            >
              <View style={{ flex: 1 }}>
                <Text variant="title">{t('settings.tiimeConnect')}</Text>
                <Text variant="meta" soft>
                  {t('settings.tiimeConnectHint')}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
            </Pressable>
          ) : tiimeSetupComplete ? (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" color={colors.inkSoft}>{t('settings.tiimeCompany')}</Text>
                  <Text variant="title">{tiimeConfig.companyName ?? '—'}</Text>
                </View>
              </View>

              <View style={styles.divider} />
              <Text variant="label" color={colors.inkSoft} style={styles.tiimeVehicleLabel}>
                {t('settings.tiimeVehicle')}
              </Text>
              <Text variant="title">{tiimeConfig.vehicleName ?? '—'}</Text>

              {showVehiclePicker ? (
                changeVehicleLoading ? (
                  <ActivityIndicator size="small" color={colors.ink} />
                ) : changeVehicleError ? (
                  <Text variant="meta" soft>
                    {t('settings.tiimeLoadError', { error: changeVehicleError })}
                  </Text>
                ) : changeVehicleList && changeVehicleList.length === 0 ? (
                  <Text variant="meta" soft>
                    {t('settings.tiimeNoVehicles')}
                  </Text>
                ) : (
                  (changeVehicleList ?? []).map((vehicle, idx) => (
                    <View key={vehicle.id}>
                      {idx > 0 && <View style={styles.divider} />}
                      <Pressable
                        style={styles.actionRow}
                        onPress={() => onPickChangedVehicle(vehicle)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: tiimeConfig.vehicleId === vehicle.id }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text variant="title">{vehicle.name}</Text>
                        </View>
                        {tiimeConfig.vehicleId === vehicle.id && (
                          <MaterialCommunityIcons name="check" size={22} color={colors.accent} />
                        )}
                      </Pressable>
                    </View>
                  ))
                )
              ) : (
                <Pressable style={styles.actionRow} onPress={onOpenChangeVehicle}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title">{t('settings.tiimeChangeVehicle')}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
                </Pressable>
              )}

              <View style={styles.divider} />
              <Pressable style={styles.actionRow} onPress={() => router.push('/tiime')}>
                <View style={{ flex: 1 }}>
                  <Text variant="title">{t('settings.tiimeViewQueue')}</Text>
                  <Text variant="meta" soft>
                    {t('settings.tiimeViewQueueHint')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
              </Pressable>

              <View style={styles.divider} />
              <Pressable style={styles.actionRow} onPress={onDisconnectTiime}>
                <Text variant="title" color={colors.danger}>
                  {t('settings.tiimeDisconnect')}
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text variant="label" color={colors.inkSoft}>{t('settings.tiimeCompany')}</Text>
                  {tiimeCompanyLoading ? (
                    <ActivityIndicator size="small" color={colors.ink} />
                  ) : tiimeCompanyError ? (
                    <Text variant="meta" soft>
                      {t('settings.tiimeLoadError', { error: tiimeCompanyError })}
                    </Text>
                  ) : (
                    <Text variant="title">
                      {tiimeCompany?.name ?? '—'}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.divider} />
              <Text variant="label" color={colors.inkSoft} style={styles.tiimeVehicleLabel}>
                {t('settings.tiimeVehicle')}
              </Text>
              {tiimeVehiclesLoading ||
              (!tiimeCompany && !tiimeCompanyError) ||
              (!!tiimeCompany && tiimeVehicles === null && !tiimeVehiclesError) ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : tiimeCompanyError ? (
                <Text variant="meta" soft>
                  {t('settings.tiimeLoadError', { error: tiimeCompanyError })}
                </Text>
              ) : tiimeVehiclesError ? (
                <Text variant="meta" soft>
                  {t('settings.tiimeLoadError', { error: tiimeVehiclesError })}
                </Text>
              ) : tiimeVehicles && tiimeVehicles.length === 0 ? (
                <Text variant="meta" soft>
                  {t('settings.tiimeNoVehicles')}
                </Text>
              ) : (
                (tiimeVehicles ?? []).map((vehicle, idx) => (
                  <View key={vehicle.id}>
                    {idx > 0 && <View style={styles.divider} />}
                    <Pressable
                      style={styles.actionRow}
                      onPress={() => onSelectTiimeVehicle(vehicle)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: tiimeConfig.vehicleId === vehicle.id }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text variant="title">{vehicle.name}</Text>
                      </View>
                      {tiimeConfig.vehicleId === vehicle.id && (
                        <MaterialCommunityIcons name="check" size={22} color={colors.accent} />
                      )}
                    </Pressable>
                  </View>
                ))
              )}

              <View style={styles.divider} />
              <Pressable style={styles.actionRow} onPress={() => router.push('/tiime')}>
                <View style={{ flex: 1 }}>
                  <Text variant="title">{t('settings.tiimeViewQueue')}</Text>
                  <Text variant="meta" soft>
                    {t('settings.tiimeViewQueueHint')}
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
              </Pressable>

              <View style={styles.divider} />
              <Pressable style={styles.actionRow} onPress={onDisconnectTiime}>
                <Text variant="title" color={colors.danger}>
                  {t('settings.tiimeDisconnect')}
                </Text>
              </Pressable>
            </>
          )}
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionLanguage')}
        </Text>
        <Card style={styles.card}>
          {LANGUAGE_OPTIONS.map((opt, idx) => (
            <View key={opt.pref}>
              {idx > 0 && <View style={styles.divider} />}
              <Pressable
                style={styles.actionRow}
                onPress={() => setLanguage(opt.pref)}
                accessibilityRole="radio"
                accessibilityState={{ selected: language === opt.pref }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="title">{t(opt.labelKey)}</Text>
                  {opt.pref === 'system' ? (
                    <Text variant="meta" soft>
                      {t('settings.langSystemHint')}
                    </Text>
                  ) : null}
                </View>
                {language === opt.pref && (
                  <MaterialCommunityIcons
                    name="check"
                    size={22}
                    color={colors.accent}
                  />
                )}
              </Pressable>
            </View>
          ))}
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionInterruptions')}
        </Text>
        <Card style={styles.card}>
          {interruptions === null ? (
            <Text variant="meta" soft>
              {t('common.loading')}
            </Text>
          ) : interruptions.length === 0 ? (
            <Text variant="meta" soft>
              {t('settings.noInterruptions')}
            </Text>
          ) : (
            interruptions.slice(0, 5).map((item, idx) => (
              <View key={idx}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text variant="title">
                      {formatInterruptionDate(item.startMs)}
                      {' – '}
                      {format(item.endMs, 'HH:mm')}
                      {' · '}
                      {formatDuration(item.durationMs)}
                    </Text>
                    <Text variant="meta" soft>
                      {causeLabel(item.cause)}
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionNetwork')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1, marginRight: space[2] }}>
              <Text variant="title">{t('settings.allowExternalApi')}</Text>
              <Text variant="meta" soft>
                {allowExternalApi
                  ? t('settings.externalApiOnHint')
                  : t('settings.externalApiOffHint')}
              </Text>
            </View>
            <Pressable
              onPress={() => setNetworkInfoVisible(true)}
              hitSlop={10}
              style={styles.infoBtn}
              accessibilityLabel={t('settings.externalApiInfoA11y')}
            >
              <MaterialCommunityIcons
                name="information-outline"
                size={22}
                color={colors.inkSoft}
              />
            </Pressable>
            <Switch
              value={allowExternalApi}
              onValueChange={toggleAllowExternalApi}
              trackColor={{ true: colors.accentSoft, false: colors.divider }}
              thumbColor={allowExternalApi ? colors.accent : colors.surface}
            />
          </View>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionData')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <MaterialCommunityIcons name="database-outline" size={22} color={colors.inkSoft} />
            <View style={{ flex: 1, marginLeft: space[3] }}>
              <Text variant="title">
                {t(tripCount === 1 ? 'settings.tripStored' : 'settings.tripsStored', {
                  count: tripCount,
                })}
              </Text>
              <Text variant="meta" soft>
                {t(rawCount === 1 ? 'settings.pointUnprocessed' : 'settings.pointsUnprocessed', {
                  count: rawCount,
                })}
              </Text>
              {rawCount > 0 ? (
                <Text variant="meta" soft style={styles.unprocessedHint}>
                  {t('settings.unprocessedHint')}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.buttonRow}>
            <SecondaryButton
              onPress={runPipeline}
              label={t('settings.forcePipeline')}
              busy={pipelineBusy}
            />
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onShareDb}>
            <View style={{ flex: 1 }}>
              <Text variant="title">{t('settings.shareDb')}</Text>
              <Text variant="meta" soft>
                {t('settings.shareDbHint')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onSendDataToPaul}>
            <View style={{ flex: 1 }}>
              <Text variant="title">{t('settings.sendToPaul')}</Text>
              <Text variant="meta" soft>
                {t('settings.sendToPaulHint')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={onImportDb}>
            <View style={{ flex: 1 }}>
              <Text variant="title">{t('settings.importDb')}</Text>
              <Text variant="meta" soft>
                {t('settings.importDbHint')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionDebug')}
        </Text>
        <Card style={styles.card}>
          <Pressable
            style={styles.actionRow}
            onPress={async () => {
              await injectDemoTrip(db);
              setTripCount(await countTrips(db));
              setRawCount(await countUnconsumedPoints(db));
              await qc.invalidateQueries();
              Alert.alert(t('settings.demoInserted'), t('settings.demoInsertedMsg'));
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="title">{t('settings.injectDemo')}</Text>
              <Text variant="meta" soft>
                {t('settings.injectDemoHint')}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.actionRow} onPress={resetOnboarding}>
            <Text variant="title">{t('settings.resetOnboarding')}</Text>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.inkSoft} />
          </Pressable>
        </Card>

        <Text variant="display" onGround style={styles.section}>
          {t('settings.sectionAbout')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text variant="title">Mapozy</Text>
              <Text variant="meta" soft>
                {t('settings.versionLine', {
                  version: Constants.expoConfig?.version ?? t('settings.versionUnknown'),
                })}
              </Text>
            </View>
          </View>
        </Card>

        <Text variant="display" onGround style={[styles.section, styles.dangerTitle]}>
          {t('settings.sectionDanger')}
        </Text>
        <Card style={[styles.card, styles.dangerCard]}>
          <DangerButton onPress={confirmClearAll} label={t('settings.clearAll')} />
        </Card>
      </ScrollView>
      <NetworkInfoModal
        visible={networkInfoVisible}
        onClose={() => setNetworkInfoVisible(false)}
      />
    </View>
  );
}

const NETWORK_SERVICES: Array<{
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  titleKey: Parameters<typeof t>[0];
  whatKey: Parameters<typeof t>[0];
  offKey: Parameters<typeof t>[0];
}> = [
  {
    icon: 'bus',
    titleKey: 'settings.netTransitTitle',
    whatKey: 'settings.netTransitWhat',
    offKey: 'settings.netTransitOff',
  },
  {
    icon: 'vector-polyline',
    titleKey: 'settings.netMatchTitle',
    whatKey: 'settings.netMatchWhat',
    offKey: 'settings.netMatchOff',
  },
  {
    icon: 'map-marker-outline',
    titleKey: 'settings.netPlacesTitle',
    whatKey: 'settings.netPlacesWhat',
    offKey: 'settings.netPlacesOff',
  },
];

function NetworkInfoModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text variant="display">{t('settings.allowExternalApi')}</Text>
            <Text variant="meta" soft style={styles.modalIntro}>
              {t('settings.netModalIntro')}
            </Text>
            {NETWORK_SERVICES.map((s) => (
              <View key={s.titleKey} style={styles.modalServiceRow}>
                <MaterialCommunityIcons
                  name={s.icon}
                  size={22}
                  color={colors.accent}
                  style={styles.modalServiceIcon}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="title">{t(s.titleKey)}</Text>
                  <Text variant="meta" soft style={styles.modalServiceText}>
                    {t(s.whatKey)}
                  </Text>
                  <Text variant="meta" soft style={styles.modalConsequence}>
                    {t('settings.netOffPrefix', { consequence: t(s.offKey) })}
                  </Text>
                </View>
              </View>
            ))}
            <Text variant="meta" soft style={styles.modalIntro}>
              {t('settings.netModalOutro')}
            </Text>
          </ScrollView>
          <Pressable style={styles.modalCloseBtn} onPress={onClose}>
            <Text variant="label">{t('settings.gotIt')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SecondaryButton({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.secondaryBtn,
        styles.secondaryBtnRow,
        busy && { opacity: 0.6 },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.ink} /> : null}
      <Text variant="label">{busy ? t('common.working') : label}</Text>
    </Pressable>
  );
}

function DangerButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dangerBtn,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text variant="label" color={colors.surface}>
        {label}
      </Text>
    </Pressable>
  );
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${Math.max(1, minutes)}m`;
}

function causeLabel(cause: Interruption['cause']): string {
  switch (cause) {
    case 'device_off':
      return t('settings.causeDeviceOff');
    case 'killed_recovered':
      return t('settings.causeKilledRecovered');
    case 'killed_until_reopen':
      return t('settings.causeKilledUntilReopen');
    case 'ongoing':
      return t('settings.causeOngoing');
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  scroll: { paddingBottom: space[6] },
  section: {
    marginTop: space[4],
    marginHorizontal: space[4],
    marginBottom: space[1],
  },
  dangerTitle: {
    marginTop: space[6],
    color: undefined,
  },
  card: {
    marginHorizontal: space[4],
    gap: space[3],
  },
  dangerCard: {
    backgroundColor: colors.dangerSurface,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unprocessedHint: {
    marginTop: space[1],
    opacity: 0.8,
  },
  tiimeVehicleLabel: {
    marginTop: space[1],
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[2],
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  secondaryBtn: {
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  secondaryBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  dangerBtn: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
  infoBtn: {
    paddingHorizontal: space[2],
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[5],
    maxHeight: '85%',
  },
  modalScroll: {
    gap: space[3],
    paddingBottom: space[3],
  },
  modalIntro: {
    lineHeight: 18,
  },
  modalServiceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  modalServiceIcon: {
    marginRight: space[3],
    marginTop: space[1],
  },
  modalServiceText: {
    marginTop: space[1],
    lineHeight: 18,
  },
  modalConsequence: {
    marginTop: space[1],
    color: colors.inkSoft,
    fontStyle: 'italic',
  },
  modalCloseBtn: {
    marginTop: space[3],
    paddingVertical: space[3],
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.divider,
    alignItems: 'center',
  },
});
