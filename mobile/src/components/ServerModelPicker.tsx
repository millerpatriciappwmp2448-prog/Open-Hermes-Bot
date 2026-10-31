import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { t, useTranslation } from '../i18n';
import { modelChoices, type ModelRef } from '../modelSelection';
import { useStore } from '../store';
import { themedStyles } from '../theme';
import { Bloub } from './Bloub';
import { CheckIcon, ChevronIcon, SearchIcon } from './Icons';

/** Credentials and provider URLs never leave Hermes. */
export function ServerModelPicker({ botId, onPicked, onChangeBot }: {
  botId: string; onPicked?: () => void; onChangeBot?: () => void;
}) {
  const { styles, C, scheme } = useStyles();
  useTranslation();
  const { botById, modelOptions, modelPicks, refreshModels, selectModel } = useStore();
  const bot = botById(botId), options = modelOptions[botId], picked = modelPicks[botId];
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [provider, setProvider] = useState(picked?.provider || options?.currentProvider || '');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const pending = useRef(false);
  const choices = modelChoices(options);
  const providers = [...new Set([options?.currentProvider, picked?.provider, ...choices.map(c => c.provider)].filter((p): p is string => Boolean(p)))];
  const selected = choices.find(c => c.model === picked?.model && c.provider === picked?.provider);
  const current = picked?.model || options?.current || t('暂未读取到');
  const needle = query.trim().toLowerCase();
  const visible = choices.filter(c => `${c.label} ${c.model} ${c.providerName}`.toLowerCase().includes(needle));
  const disabled = busy || loading;

  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setError(''); setLoading(true);
    try { await refreshModels(botId); }
    catch (e) { setError(e instanceof Error ? e.message : t('无法读取服务器模型。')); }
    finally { pending.current = false; setLoading(false); }
  }
  useEffect(() => { void reload(); }, [botId]);
  useEffect(() => {
    if (!provider && options?.currentProvider) setProvider(options.currentProvider);
  }, [options?.currentProvider, provider]);

  async function choose(ref: ModelRef | null) {
    if (pending.current) return;
    pending.current = true;
    setError(''); setSaved(false); setBusy(true);
    try {
      await selectModel(botId, ref);
      setSaved(true);
      onPicked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('模型未保存，请重试。'));
    } finally { pending.current = false; setBusy(false); }
  }
  function marker(checked: boolean) {
    return <View style={[styles.radio, checked && styles.radioSelected]}>
      {checked ? <CheckIcon size={11} color={C.bg} /> : null}
    </View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
      <View style={styles.identity}>
        <View style={styles.avatar}><Bloub shape={bot?.shape} color={bot?.color ?? C.green} size={36} /></View>
        <View style={styles.flex}><Text style={styles.botName}>{bot?.name}</Text><Text style={styles.caption}>{t('智能体的模型')}</Text></View>
        {onChangeBot ? <Pressable accessibilityRole="button" accessibilityLabel={t('选择其他智能体')}
          onPress={onChangeBot} style={({ pressed }) => [styles.change, pressed && styles.pressed]}>
          <Text style={styles.changeText}>{t('切换')}</Text><ChevronIcon size={10} color={C.text2} />
        </Pressable> : null}
      </View>
      <View style={styles.currentCard} accessibilityLabel={t('当前选择：{0}', { 0: picked?.model || t('跟随服务器') })}>
        <View style={styles.between}>
          <Text style={styles.caption}>{t('当前模型')}</Text>
          <View style={styles.status}><View style={styles.dot} /><Text style={styles.statusText}>{picked ? t('手动选择') : t('跟随服务器')}</Text></View>
        </View>
        <Text style={styles.current}>{selected?.label || current}</Text>
        {selected && selected.label !== current ? <Text style={styles.modelId}>{current}</Text> : null}
        <Text style={styles.caption}>{picked?.provider || options?.currentProvider || t('服务器提供商')}</Text>
      </View>
      <View style={styles.between}>
        <Text style={styles.section}>{t('服务器可用模型')} <Text style={styles.count}>{choices.length}</Text></Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('刷新模型列表')} disabled={disabled}
          onPress={() => void reload()} style={({ pressed }) => [styles.refresh, pressed && styles.pressed, disabled && styles.disabled]}>
          {loading ? <ActivityIndicator size="small" color={C.green} /> : <Text style={styles.refreshText}>{t('刷新')}</Text>}
        </Pressable>
      </View>
      <View style={styles.search}>
        <SearchIcon size={13} />
        <TextInput keyboardAppearance={scheme} accessibilityLabel={t('搜索模型')} value={query} onChangeText={setQuery}
          placeholder={t('搜索模型')} placeholderTextColor={C.text2} style={styles.searchInput}
          autoCapitalize="none" autoCorrect={false} clearButtonMode="while-editing" />
      </View>
      <View style={[styles.options, disabled && styles.disabled]}>
        {!needle ? <Pressable accessibilityRole="button" accessibilityLabel={t('跟随服务器')}
          accessibilityState={{ selected: !picked, disabled }} disabled={disabled}
          style={({ pressed }) => [styles.choice, !picked && styles.selectedRow, pressed && styles.pressed]}
          onPress={() => void choose(null)}>
          {marker(!picked)}
          <View style={styles.flex}><Text style={styles.name}>{t('跟随服务器')}</Text><Text style={styles.meta}>{options?.current || t('暂未读取到')}</Text></View>
        </Pressable> : null}
        {visible.map((choice, index) => {
          const checked = picked?.model === choice.model && picked.provider === choice.provider;
          return <Pressable key={JSON.stringify([choice.provider, choice.model])} accessibilityRole="button"
            accessibilityLabel={`${choice.label} · ${choice.providerName || t('服务器提供商')}`}
            accessibilityState={{ selected: checked, disabled }} disabled={disabled}
            style={({ pressed }) => [styles.choice, (!needle || index > 0) && styles.line, checked && styles.selectedRow, pressed && styles.pressed]}
            onPress={() => void choose({ model: choice.model, provider: choice.provider })}>
            {marker(checked)}
            <View style={styles.flex}>
              <Text style={styles.name}>{choice.label}</Text>
              <Text style={styles.meta}>{choice.providerName || t('服务器提供商')}{choice.label !== choice.model ? ` · ${choice.model}` : ''}</Text>
            </View>
          </Pressable>;
        })}
      </View>
      {!visible.length && !loading ? <Text style={styles.empty}>{needle ? t('没有匹配的模型') : t('未发现模型？可在下方输入模型 ID。')}</Text> : null}
      <View style={styles.customCard}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={t('自定义模型')}
          style={({ pressed }) => [styles.customHead, pressed && styles.pressed]} onPress={() => setExpanded(value => !value)}>
          <View style={styles.flex}><Text style={styles.name}>{t('自定义模型')}</Text><Text style={styles.meta}>{t('通过模型 ID 添加')}</Text></View>
          <View style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}><ChevronIcon size={12} /></View>
        </Pressable>
        {expanded ? <View style={styles.customBody}>
          <Text style={styles.caption}>{t('服务器提供商')}</Text>
          <View style={styles.providers}>
            {providers.map(p => <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: provider === p }}
              disabled={disabled} onPress={() => setProvider(p)} style={[styles.provider, provider === p && styles.providerSelected]}>
              <Text style={[styles.providerText, provider === p && styles.accent]}>{p}</Text>
              {provider === p ? <CheckIcon size={10} color={C.green} /> : null}
            </Pressable>)}
          </View>
          {!provider ? <Text style={styles.meta}>{t('提供商由服务器自动解析。')}</Text> : null}
          <TextInput keyboardAppearance={scheme} accessibilityLabel={t('模型 ID')} value={custom} onChangeText={setCustom} placeholder="model-id"
            placeholderTextColor={C.text2} style={styles.customInput} autoCapitalize="none" autoCorrect={false}
            editable={!disabled} onSubmitEditing={() => { if (custom.trim()) void choose({ model: custom.trim(), provider }); }} />
          <Pressable accessibilityRole="button" disabled={disabled || !custom.trim()}
            style={({ pressed }) => [styles.apply, (disabled || !custom.trim()) && styles.disabled, pressed && styles.pressed]}
            onPress={() => void choose({ model: custom.trim(), provider })}>
            <Text style={styles.applyText}>{t('使用此模型')}</Text>
          </Pressable>
          <Text style={styles.meta}>{t('请填写此提供商支持的模型 ID。')}</Text>
        </View> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy || saved ? <Text accessibilityLiveRegion="polite" style={styles.success}>{busy ? t('正在保存…') : t('已保存到服务器。')}</Text> : null}
      <Text style={styles.footnote}>{t('下一条消息生效 · 密钥由服务器管理')}</Text>
    </ScrollView>
  );
}

// Native point sizes: the legacy mockup's extra scale makes this list unwieldy.
const useStyles = themedStyles(({ C }) => ({
  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 32, gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  avatar: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  botName: { color: C.text, fontSize: 17, fontWeight: '600', marginBottom: 5 },
  caption: { color: C.text2, fontSize: 12, lineHeight: 18 },
  change: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 8 },
  changeText: { color: C.text2, fontSize: 13 },
  currentCard: { padding: 16, backgroundColor: C.cardRaised, borderRadius: 18, borderWidth: 1, borderColor: C.line, gap: 6 },
  current: { color: C.text, fontSize: 17, lineHeight: 24, fontWeight: '600', flexShrink: 1 },
  modelId: { color: C.text2, fontSize: 12, lineHeight: 18 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.green },
  statusText: { color: C.green, fontSize: 11, flexShrink: 1 },
  section: { color: C.text2, fontSize: 12, fontWeight: '500', flexShrink: 1 },
  count: { color: C.text2, fontSize: 11 },
  refresh: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' },
  refreshText: { color: C.green, fontSize: 13, fontWeight: '500' },
  search: { minHeight: 44, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.field, borderRadius: 12, marginTop: -8 },
  searchInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 14, paddingVertical: 12 },
  options: { backgroundColor: C.cardRaised, borderRadius: 16, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  line: { borderTopWidth: 1, borderTopColor: C.line },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, borderColor: C.text3, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { backgroundColor: C.green, borderColor: C.green },
  selectedRow: { backgroundColor: C.selected },
  name: { color: C.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  meta: { color: C.text2, fontSize: 12, lineHeight: 18, marginTop: 3 },
  empty: { color: C.text2, fontSize: 13, lineHeight: 20, padding: 8 },
  customCard: { borderWidth: 1, borderColor: C.line, borderRadius: 16, overflow: 'hidden', marginTop: 4 },
  customHead: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15 },
  customBody: { borderTopWidth: 1, borderTopColor: C.line, padding: 15, gap: 12 },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  provider: { paddingHorizontal: 12, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 7, maxWidth: '100%' },
  providerSelected: { borderColor: C.selectedBorder, backgroundColor: C.selected },
  providerText: { color: C.text2, fontSize: 13, flexShrink: 1 },
  accent: { color: C.green },
  customInput: { minHeight: 46, backgroundColor: C.field, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, color: C.text },
  apply: { minHeight: 46, padding: 12, backgroundColor: C.paper, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: C.bg, fontSize: 14, fontWeight: '600' },
  error: { color: C.red, fontSize: 13, lineHeight: 20 },
  success: { color: C.green, fontSize: 12, lineHeight: 18 },
  footnote: { color: C.text2, fontSize: 12, lineHeight: 19, textAlign: 'center', marginTop: 4 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
}), false);
