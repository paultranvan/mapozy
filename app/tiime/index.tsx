import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Switch,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { fr as dateFnsFr } from 'date-fns/locale';
import { useDb } from '@/db/DbContext';
import { TopBar } from '@/ui/TopBar';
import { Text } from '@/ui/Text';
import { Card } from '@/ui/Card';
import { colors, space, radii } from '@/theme/tokens';
import { useI18n, type TranslationKey, type TParams } from '@/i18n';
import {
  useTiimeConnection,
  useTiimeCandidates,
  useTiimeConfig,
  useSendToTiime,
} from '@/queries/useTiime';
import type { TiimeCandidate } from '@/connectors/tiime/travels';
import { ensurePlaceAddress } from '@/pipeline/geocoding';
import type { StructuredAddress } from '@/db/places';

type Translate = (key: TranslationKey, params?: TParams) => string;

const EMPTY_ADDRESS: StructuredAddress = {
  street: null,
  houseNumber: null,
  postalCode: null,
  city: null,
  country: null,
};

type CardStatus = 'idle' | 'sending' | 'sent' | 'error';

interface CardState {
  arrivalCompanyName: string;
  roundTrip: boolean;
  departure: StructuredAddress;
  arrival: StructuredAddress;
  status: CardStatus;
  error: string | null;
}

export default function TiimeQueueScreen() {
  const router = useRouter();
  const db = useDb();
  const { t, locale } = useI18n();
  const connection = useTiimeConnection();
  const config = useTiimeConfig();
  const candidatesQ = useTiimeCandidates();
  const sendMutation = useSendToTiime();

  const candidates: TiimeCandidate[] = candidatesQ.data ?? [];

  // Per-card editable state, keyed by tripId. Addresses are hydrated lazily
  // (below) since ensurePlaceAddress can hit the network for reverse geocoding.
  const [cardState, setCardState] = useState<Record<number, CardState>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sendingBatch, setSendingBatch] = useState(false);
  // Tracks which tripIds already had their default state (incl. addresses)
  // initialized, so a later re-render / refetch doesn't clobber user edits.
  const initializedRef = useRef<Set<number>>(new Set());
  // Synchronous re-entrancy guard for the batch send: `sendingBatch` only
  // disables the button after a re-render, so a fast double tap could run the
  // loop twice with a stale cardState (per-card guards still see 'idle').
  const sendingRef = useRef(false);

  useEffect(() => {
    const toInit = candidates.filter((c) => !initializedRef.current.has(c.tripId));
    if (toInit.length === 0) return;
    toInit.forEach((c) => initializedRef.current.add(c.tripId));
    let isMounted = true;
    (async () => {
      for (const c of toInit) {
        const [departure, arrival] = await Promise.all([
          c.departurePlaceId != null
            ? ensurePlaceAddress(db, c.departurePlaceId)
            : Promise.resolve(null),
          c.arrivalPlaceId != null
            ? ensurePlaceAddress(db, c.arrivalPlaceId)
            : Promise.resolve(null),
        ]);
        if (!isMounted) return;
        setCardState((prev) => ({
          ...prev,
          [c.tripId]: {
            arrivalCompanyName: c.arrivalPlaceName ?? '',
            roundTrip: false,
            departure: departure ?? EMPTY_ADDRESS,
            arrival: arrival ?? EMPTY_ADDRESS,
            status: 'idle',
            error: null,
          },
        }));
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [candidates, db]);

  const patchCard = useCallback((tripId: number, patch: Partial<CardState>) => {
    setCardState((prev) => {
      const cur = prev[tripId];
      if (!cur) return prev;
      return { ...prev, [tripId]: { ...cur, ...patch } };
    });
  }, []);

  const toggleSelected = useCallback((tripId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(tripId)) next.delete(tripId);
      else next.add(tripId);
      return next;
    });
  }, []);

  const formatCandidateDate = (ms: number) =>
    locale === 'fr'
      ? format(ms, 'd MMM yyyy, HH:mm', { locale: dateFnsFr })
      : format(ms, 'MMM d, yyyy, HH:mm');

  const onSendSelected = useCallback(async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      const companyId = config.companyId;
      const vehicleId = config.vehicleId;
      if (companyId == null || vehicleId == null) return;
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      setSendingBatch(true);
      // Sequential on purpose: keeps per-card status updates easy to reason
      // about and avoids hammering the Tiime API with a burst of requests.
      for (const tripId of ids) {
        const candidate = candidates.find((c) => c.tripId === tripId);
        const state = cardState[tripId];
        if (!candidate || !state) continue;
        // Guard against a stale selection re-sending an already-sent (or
        // in-flight) candidate, which would duplicate the trip in Tiime.
        if (state.status === 'sent' || state.status === 'sending') continue;
        patchCard(tripId, { status: 'sending', error: null });
        try {
          await sendMutation.mutateAsync({
            candidate,
            companyId,
            vehicleId,
            roundTrip: state.roundTrip,
            overrides: {
              arrivalCompanyName: state.arrivalCompanyName || candidate.arrivalPlaceName,
              departure: state.departure,
              arrival: state.arrival,
            },
          });
          patchCard(tripId, { status: 'sent', error: null });
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(tripId);
            return next;
          });
        } catch (e) {
          // Keep the card (and its selection) so the user can just hit
          // "Envoyer" again once the issue is fixed.
          patchCard(tripId, { status: 'error', error: String(e) });
        }
      }
    } finally {
      sendingRef.current = false;
      setSendingBatch(false);
    }
  }, [selected, candidates, cardState, config.companyId, config.vehicleId, sendMutation, patchCard]);

  if (!connection.connected) {
    return (
      <View style={styles.root}>
        <TopBar title={t('tiimeQueue.title')} />
        <View style={styles.centerWrap}>
          <Card style={styles.guardCard}>
            <MaterialCommunityIcons name="link-variant-off" size={32} color={colors.inkSoft} />
            <Text variant="title" style={styles.guardTitle}>
              {t('tiimeQueue.notConnectedTitle')}
            </Text>
            <Text variant="body" soft style={styles.guardBody}>
              {t('tiimeQueue.notConnectedBody')}
            </Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/tiime/login')}>
              <Text variant="label" color={colors.surface}>
                {t('tiimeQueue.connectCta')}
              </Text>
            </Pressable>
          </Card>
        </View>
      </View>
    );
  }

  if (config.companyId == null || config.vehicleId == null) {
    return (
      <View style={styles.root}>
        <TopBar title={t('tiimeQueue.title')} />
        <View style={styles.centerWrap}>
          <Card style={styles.guardCard}>
            <MaterialCommunityIcons name="car-cog" size={32} color={colors.inkSoft} />
            <Text variant="title" style={styles.guardTitle}>
              {t('tiimeQueue.noVehicleTitle')}
            </Text>
            <Text variant="body" soft style={styles.guardBody}>
              {t('tiimeQueue.noVehicleBody')}
            </Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.push('/settings')}>
              <Text variant="label" color={colors.surface}>
                {t('tiimeQueue.goToSettings')}
              </Text>
            </Pressable>
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopBar title={t('tiimeQueue.title')} />
      <FlatList
        style={styles.list}
        data={candidates}
        keyExtractor={(c) => String(c.tripId)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          candidatesQ.isLoading ? (
            <ActivityIndicator size="small" color={colors.ink} style={styles.emptyIndicator} />
          ) : (
            <Text variant="body" soft style={styles.emptyText}>
              {t('tiimeQueue.empty')}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <CandidateCard
            candidate={item}
            state={cardState[item.tripId]}
            selected={selected.has(item.tripId)}
            onToggleSelected={() => toggleSelected(item.tripId)}
            onPatch={(patch) => patchCard(item.tripId, patch)}
            dateLabel={formatCandidateDate(item.startMs)}
            t={t}
          />
        )}
      />
      <View style={styles.footer}>
        <Pressable
          style={[
            styles.sendBtn,
            (selected.size === 0 || sendingBatch) && styles.sendBtnDisabled,
          ]}
          disabled={selected.size === 0 || sendingBatch}
          onPress={onSendSelected}
        >
          {sendingBatch ? (
            <ActivityIndicator size="small" color={colors.surface} />
          ) : (
            <Text variant="label" color={colors.surface}>
              {t('tiimeQueue.sendSelected', { count: selected.size })}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function StatusBadge({ status, t }: { status: CardStatus; t: Translate }) {
  if (status === 'idle') return null;
  if (status === 'sending') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text variant="meta" soft style={styles.statusText}>
          {t('tiimeQueue.sending')}
        </Text>
      </View>
    );
  }
  if (status === 'sent') {
    return (
      <View style={styles.statusRow}>
        <MaterialCommunityIcons name="check-circle" size={18} color={colors.start} />
        <Text variant="meta" color={colors.start} style={styles.statusText}>
          {t('tiimeQueue.sent')}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.statusRow}>
      <MaterialCommunityIcons name="alert-circle" size={18} color={colors.danger} />
      <Text variant="meta" color={colors.danger} style={styles.statusText}>
        {t('common.error')}
      </Text>
    </View>
  );
}

function CandidateCard({
  candidate,
  state,
  selected,
  onToggleSelected,
  onPatch,
  dateLabel,
  t,
}: {
  candidate: TiimeCandidate;
  state: CardState | undefined;
  selected: boolean;
  onToggleSelected: () => void;
  onPatch: (patch: Partial<CardState>) => void;
  dateLabel: string;
  t: Translate;
}) {
  const distanceKm = Math.round(candidate.distanceM / 1000);
  const ready = !!state;
  const busy = state?.status === 'sending';
  // 'sent' is a terminal state: once a candidate has been sent, it must not
  // be re-selectable or re-editable, otherwise a stale selection could
  // re-invoke the send mutation and duplicate the trip in Tiime.
  const locked = state?.status === 'sending' || state?.status === 'sent';

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <Pressable
          onPress={onToggleSelected}
          hitSlop={10}
          style={styles.checkbox}
          disabled={!ready || locked}
        >
          <MaterialCommunityIcons
            name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
            size={22}
            color={selected ? colors.accent : colors.inkSoft}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="title">{dateLabel}</Text>
          <Text variant="meta" soft>
            {distanceKm} km
          </Text>
        </View>
        <StatusBadge status={state?.status ?? 'idle'} t={t} />
      </View>

      {!ready ? (
        <ActivityIndicator size="small" color={colors.ink} style={styles.cardLoading} />
      ) : (
        <>
          <View style={styles.divider} />

          <Text variant="label" color={colors.inkSoft}>
            {t('tiimeQueue.arrivalCompanyLabel')}
          </Text>
          <TextInput
            value={state.arrivalCompanyName}
            onChangeText={(v) => onPatch({ arrivalCompanyName: v })}
            placeholder={t('tiimeQueue.arrivalCompanyPlaceholder')}
            placeholderTextColor={colors.inkSoft}
            style={styles.input}
            editable={!locked}
          />

          <View style={styles.rowBetween}>
            <Text variant="body">{t('tiimeQueue.roundTrip')}</Text>
            <Switch
              value={state.roundTrip}
              onValueChange={(v) => onPatch({ roundTrip: v })}
              trackColor={{ true: colors.accentSoft, false: colors.divider }}
              thumbColor={state.roundTrip ? colors.accent : colors.surface}
              disabled={locked}
            />
          </View>

          <AddressFields
            label={t('tiimeQueue.departureAddress')}
            address={state.departure}
            onChange={(addr) => onPatch({ departure: addr })}
            disabled={locked}
            t={t}
          />
          <AddressFields
            label={t('tiimeQueue.arrivalAddress')}
            address={state.arrival}
            onChange={(addr) => onPatch({ arrival: addr })}
            disabled={locked}
            t={t}
          />

          {state.status === 'error' && state.error ? (
            <Text variant="meta" color={colors.danger} style={styles.errorText}>
              {t('tiimeQueue.errorPrefix', { error: state.error })}
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}

function AddressFields({
  label,
  address,
  onChange,
  disabled,
  t,
}: {
  label: string;
  address: StructuredAddress;
  onChange: (addr: StructuredAddress) => void;
  disabled: boolean;
  t: Translate;
}) {
  const set = (field: keyof StructuredAddress) => (v: string) =>
    onChange({ ...address, [field]: v.length > 0 ? v : null });

  return (
    <View style={styles.addressBlock}>
      <Text variant="label" color={colors.inkSoft}>
        {label}
      </Text>
      <View style={styles.addressRow}>
        <TextInput
          value={address.houseNumber ?? ''}
          onChangeText={set('houseNumber')}
          placeholder={t('tiimeQueue.houseNumberPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputSmall]}
          editable={!disabled}
        />
        <TextInput
          value={address.street ?? ''}
          onChangeText={set('street')}
          placeholder={t('tiimeQueue.streetPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputFlex]}
          editable={!disabled}
        />
      </View>
      <View style={styles.addressRow}>
        <TextInput
          value={address.postalCode ?? ''}
          onChangeText={set('postalCode')}
          placeholder={t('tiimeQueue.postalCodePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputSmall]}
          editable={!disabled}
        />
        <TextInput
          value={address.city ?? ''}
          onChangeText={set('city')}
          placeholder={t('tiimeQueue.cityPlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, styles.inputFlex]}
          editable={!disabled}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[4],
  },
  guardCard: {
    alignItems: 'center',
    gap: space[2],
  },
  guardTitle: {
    marginTop: space[2],
    textAlign: 'center',
  },
  guardBody: {
    textAlign: 'center',
    marginBottom: space[2],
  },
  primaryBtn: {
    marginTop: space[1],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[6],
    gap: space[3],
  },
  emptyIndicator: {
    marginTop: space[6],
  },
  emptyText: {
    marginTop: space[6],
    textAlign: 'center',
  },
  card: {
    gap: space[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    marginRight: space[3],
  },
  cardLoading: {
    marginVertical: space[3],
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginVertical: space[1],
  },
  input: {
    marginTop: space[1],
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  inputSmall: {
    width: 88,
  },
  inputFlex: {
    flex: 1,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[1],
  },
  addressBlock: {
    marginTop: space[2],
    gap: space[1],
  },
  addressRow: {
    flexDirection: 'row',
    gap: space[2],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  statusText: {
    marginLeft: 2,
  },
  errorText: {
    marginTop: space[1],
  },
  footer: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.ground,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  sendBtn: {
    paddingVertical: space[3],
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
});
