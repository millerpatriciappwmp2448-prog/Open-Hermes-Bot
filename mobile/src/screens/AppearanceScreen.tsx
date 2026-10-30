import { t, useTranslation } from '../i18n';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Page } from '../components/Page';
import { CheckIcon } from '../components/Icons';
import { palettes, themedStyles } from '../theme';
import type { ThemeName } from '../appearance';

export function AppearanceScreen() {
  useTranslation();
  const { styles, C, preference, scheme, saveError, setAppearance } = useStyles();
  return (
    <Page title={t('外观')}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{t('选择你喜欢的外观')}</Text>
        <Text style={styles.description}>{t('让每一次对话都看得舒服。')}</Text>
        <ThemePreview mode="ivory" selected={preference === 'ivory'} onPress={() => { void setAppearance('ivory'); }} />
        <View style={styles.previews}>
          {(['light', 'dark'] as const).map(mode => (
            <ThemePreview key={mode} mode={mode} selected={preference === mode} onPress={() => { void setAppearance(mode); }} />
          ))}
        </View>
        <Pressable accessibilityRole="radio" aria-checked={preference === 'system'}
          accessibilityLabel={t('跟随系统')} onPress={() => { void setAppearance('system'); }}
          style={({ pressed }) => [styles.system, preference === 'system' && styles.selected, pressed && styles.pressed]}>
          <View style={styles.systemSymbol}><View style={styles.halfMoon} /></View>
          <View style={styles.flex}>
            <Text style={styles.name}>{t('跟随系统')}</Text>
            <Text style={styles.meta}>{t('随 iPhone 外观自动切换')}</Text>
          </View>
          <View style={[styles.radio, preference === 'system' && styles.checked]}>
            {preference === 'system' ? <CheckIcon size={10} color={C.bg} /> : null}
          </View>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {t('当前为{0}模式', { 0: preference === 'ivory' ? t('象牙金') : scheme === 'light' ? t('白天') : t('夜间') })}
        </Text>
        <Text style={styles.note}>{t('设置会保存在这台设备上，重新打开仍然生效。')}</Text>
        {saveError ? <Text accessibilityRole="alert" style={styles.error}>{t('无法保存外观设置，请重新选择一次。')}</Text> : null}
      </ScrollView>
    </Page>
  );
}

function ThemePreview({ mode, selected, onPress }: { mode: ThemeName; selected: boolean; onPress: () => void }) {
  const { styles, C } = useStyles();
  const preview = palettes[mode];
  const featured = mode === 'ivory';
  const label = featured ? t('象牙金') : mode === 'light' ? t('白天') : t('夜间');
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} aria-checked={selected} onPress={onPress}
    style={({ pressed }) => [styles.option, featured ? styles.featured : styles.regular, selected && styles.selected, pressed && styles.pressed]}>
    <View style={[styles.miniature, featured && styles.featuredPreview, { backgroundColor: preview.C.bg }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.miniHeader, { borderBottomColor: preview.C.line }]}>
        <View style={[styles.miniAvatar, { backgroundColor: featured ? '#b68d4c' : '#8b5cf6' }]} />
        <View style={[styles.miniLine, { backgroundColor: preview.C.text2 }]} />
      </View>
      <View style={[styles.miniBubble, { backgroundColor: preview.C.bubble }]}><View style={[styles.bubbleLine, { backgroundColor: preview.C.text2 }]} /></View>
      <View style={[styles.miniReply, { backgroundColor: preview.C.paper }]}><View style={[styles.bubbleLine, { backgroundColor: preview.INK.onPaper }]} /></View>
      <View style={[styles.miniInput, { backgroundColor: preview.C.field }]}><View style={[styles.miniSend, { backgroundColor: preview.C.paper }]} /></View>
    </View>
    <View style={[styles.optionLabel, featured && styles.featuredCopy]}>
      <Text style={styles.name}>{label}</Text>
      {featured ? <Text style={styles.meta}>{t('暖象牙白 · 香槟金')}</Text> : null}
      <View style={[styles.radio, selected && styles.checked]}>{selected ? <CheckIcon size={10} color={C.bg} /> : null}</View>
    </View>
  </Pressable>;
}

const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 32, gap: 12 },
  title: { color: C.text, fontSize: 23, fontWeight: '600', lineHeight: 31 },
  description: { color: C.text2, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  previews: { flexDirection: 'row', gap: 14, marginBottom: 4 },
  option: { padding: 9, borderRadius: 18, borderWidth: 2, borderColor: C.line, backgroundColor: C.cardRaised },
  regular: { flex: 1 },
  selected: { borderColor: C.green },
  featured: { minHeight: 114, flexDirection: 'row', alignItems: 'center', gap: 16 },
  featuredPreview: { width: '45%', height: 92 },
  featuredCopy: { flex: 1, flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 8, paddingRight: 5 },
  miniature: { height: 92, borderRadius: 10, padding: 8, overflow: 'hidden', gap: 4 },
  miniHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 4, borderBottomWidth: 1 },
  miniAvatar: { width: 12, height: 12, borderRadius: 5 },
  miniLine: { width: '45%', height: 4, borderRadius: 2, opacity: 0.6 },
  miniBubble: { width: '83%', height: 15, borderRadius: 5, justifyContent: 'center', paddingHorizontal: 7 },
  miniReply: { width: '70%', height: 15, borderRadius: 5, alignSelf: 'flex-end', justifyContent: 'center', paddingHorizontal: 7 },
  bubbleLine: { width: '75%', height: 2, borderRadius: 2, opacity: 0.65 },
  miniInput: { height: 15, marginTop: 'auto', borderRadius: 8, alignItems: 'flex-end', padding: 3 },
  miniSend: { height: 9, width: 9, borderRadius: 5 },
  optionLabel: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4, minHeight: 42, paddingHorizontal: 3 },
  name: { fontSize: 15, lineHeight: 22, fontWeight: '500', color: C.text },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, borderColor: C.text3, justifyContent: 'center', alignItems: 'center' },
  checked: { backgroundColor: C.green, borderColor: C.green },
  system: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderRadius: 16, borderWidth: 2, borderColor: C.line, backgroundColor: C.cardRaised },
  flex: { flex: 1, minWidth: 0 },
  meta: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 3 },
  systemSymbol: { width: 25, height: 25, borderRadius: 13, borderWidth: 1.5, borderColor: C.text2, overflow: 'hidden' },
  halfMoon: { width: '50%', height: '100%', backgroundColor: C.text2 },
  note: { color: C.text2, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  error: { color: C.red, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.7 },
}), false);
