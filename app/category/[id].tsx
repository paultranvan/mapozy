import { useEffect, useState } from 'react';
import { View, TextInput, Pressable, ScrollView, StyleSheet, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, space } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { Text } from '@/ui/Text';
import {
  useCustomCategories, useCreateCustomCategory, useUpdateCustomCategory, useDeleteCustomCategory,
} from '@/queries/useCategories';
import type { CustomCategory } from '@/db/customCategories';

const ICON_OPTIONS: (keyof typeof MaterialCommunityIcons.glyphMap)[] = [
  'home', 'home-city', 'office-building', 'briefcase', 'bag-personal', 'dumbbell', 'run', 'weight-lifter', 'yoga', 'swim',
  'cart', 'store', 'shopping', 'silverware-fork-knife', 'food', 'pizza', 'coffee', 'cup', 'glass-cocktail', 'beer',
  'cake-variant', 'gift', 'account-group', 'baby-carriage', 'dog', 'cat', 'paw', 'fish', 'school', 'book-open-variant',
  'hospital-box', 'medical-bag', 'pill', 'tooth', 'spa', 'bank', 'cash', 'credit-card', 'gas-station', 'ev-station',
  'parking', 'car', 'bike', 'motorbike', 'bus', 'train', 'subway-variant', 'ferry', 'airplane', 'sail-boat',
  'beach', 'umbrella-beach', 'pine-tree', 'tree', 'leaf', 'flower', 'flower-tulip', 'image-filter-hdr', 'tent', 'campfire',
  'music', 'guitar-acoustic', 'movie-open', 'theater', 'ticket', 'party-popper', 'gamepad-variant', 'basketball', 'soccer', 'tennis',
  'golf', 'ski', 'hiking', 'palette', 'camera', 'heart', 'star', 'church', 'anchor', 'map-marker',
];
const COLOR_OPTIONS = ['#C9883F', '#8978FF', '#B3BF26', '#FF7B5E', '#1CAAE8', '#F85AA8', '#15CACD', '#21B930', '#BA5AE8', '#EA3F3F', '#0A84FF', '#A4A7AC'];

export default function CategoryEditor() {
  const router = useRouter();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id: string }>();
  const editId = params.id === 'new' ? null : Number(params.id);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<keyof typeof MaterialCommunityIcons.glyphMap>(ICON_OPTIONS[0]!);
  const [color, setColor] = useState(COLOR_OPTIONS[0]!);
  const [seeded, setSeeded] = useState(false);
  const existing = useCustomCategories();
  const create = useCreateCustomCategory();
  const update = useUpdateCustomCategory();
  const remove = useDeleteCustomCategory();

  const editing = editId != null ? existing.data?.find((c: CustomCategory) => c.id === editId) : undefined;

  // Prefill once when opening an existing category (query resolves async).
  useEffect(() => {
    if (editing && !seeded) {
      setName(editing.name);
      setIcon(editing.icon as keyof typeof MaterialCommunityIcons.glyphMap);
      setColor(editing.color);
      setSeeded(true);
    }
  }, [editing, seeded]);

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert(t('categoryNew.nameRequiredTitle'), t('categoryNew.nameRequiredBody')); return; }
    try {
      if (editId != null) await update.mutateAsync({ id: editId, input: { name: trimmed, icon, color } });
      else await create.mutateAsync({ name: trimmed, icon, color });
      router.back();
    } catch {
      Alert.alert(t('common.error'), editId != null ? t('categoryEdit.updateError') : t('categoryNew.createError'));
    }
  };

  const confirmDelete = (c: CustomCategory, afterDelete?: () => void) => {
    Alert.alert(t('categoryEdit.deleteTitle'), t('categoryEdit.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => { remove.mutate(c.id); afterDelete?.(); },
      },
    ]);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: space[6] }} keyboardShouldPersistTaps="handled">
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()}><Text variant="body" color={colors.inkSoft}>{t('common.cancel')}</Text></Pressable>
        <Text variant="body" color={colors.ink}>{editId != null ? t('categoryEdit.title') : t('categoryNew.title')}</Text>
        <Pressable onPress={onSave}><Text variant="body" color={name.trim() ? colors.accent : colors.inkSoft}>{t('common.save')}</Text></Pressable>
      </View>

      <View style={styles.preview}>
        <View style={[styles.previewBadge, { backgroundColor: color }]}>
          <MaterialCommunityIcons name={icon} size={26} color="#fff" />
        </View>
        <Text variant="body" color={colors.ink} numberOfLines={1}>{name.trim() || t('categoryNew.preview')}</Text>
      </View>

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>{t('categoryNew.sectionName')}</Text>
      <TextInput value={name} onChangeText={setName} placeholder={t('categoryNew.namePlaceholder')} placeholderTextColor={colors.inkSoft} style={styles.input} />

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>{t('categoryNew.sectionColor')}</Text>
      <View style={styles.colorRow}>
        {COLOR_OPTIONS.map((hex) => (
          <Pressable key={hex} onPress={() => setColor(hex)} style={[styles.swatch, { backgroundColor: hex }, color === hex && styles.swatchOn]} />
        ))}
      </View>

      <Text variant="label" color={colors.inkSoft} style={styles.sec}>{t('categoryNew.sectionIcon')}</Text>
      <View style={styles.iconGrid}>
        {ICON_OPTIONS.map((g) => (
          <Pressable key={g} onPress={() => setIcon(g)} style={[styles.iconCell, icon === g && { borderColor: color, backgroundColor: colors.accentSoft }]}>
            <MaterialCommunityIcons name={g} size={22} color={icon === g ? color : colors.ink} />
          </Pressable>
        ))}
      </View>

      {editId != null && editing && (
        <Pressable onPress={() => confirmDelete(editing, () => router.back())} style={styles.deleteBtn}>
          <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
          <Text variant="body" color={colors.danger}>{t('categoryEdit.delete')}</Text>
        </Pressable>
      )}

      {editId == null && (existing.data?.length ?? 0) > 0 && (
        <>
          <Text variant="label" color={colors.inkSoft} style={styles.sec}>{t('categoryNew.sectionYours')}</Text>
          {(existing.data ?? ([] as CustomCategory[])).map((c: CustomCategory) => (
            <View key={c.id} style={styles.row}>
              <Pressable onPress={() => router.push(`/category/${c.id}`)} style={styles.rowMain}>
                <View style={[styles.rowBadge, { backgroundColor: c.color }]}>
                  <MaterialCommunityIcons name={c.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={16} color="#fff" />
                </View>
                <Text variant="body" color={colors.ink} style={styles.rowName} numberOfLines={1}>{c.name}</Text>
                <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.inkSoft} />
              </Pressable>
              <Pressable onPress={() => confirmDelete(c)} hitSlop={8}>
                <MaterialCommunityIcons name="trash-can-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space[3] },
  preview: { alignItems: 'center', gap: space[2], paddingVertical: space[3] },
  previewBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  sec: { marginTop: space[3], marginHorizontal: space[3], marginBottom: space[1], letterSpacing: 0.5 },
  input: { marginHorizontal: space[3], backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: space[3], paddingVertical: space[2], color: colors.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[3] },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  swatchOn: { borderWidth: 3, borderColor: colors.ink },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingHorizontal: space[3] },
  iconCell: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1], marginTop: space[4], marginHorizontal: space[3], paddingVertical: space[2], borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[3], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowName: { flex: 1 },
});
