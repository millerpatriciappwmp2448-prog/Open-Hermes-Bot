import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { t, useTranslation } from '../i18n';
import { modelChoices, type ModelRef } from '../modelSelection';
import { useStore } from '../store';
import { C, createStyles } from '../theme';
import { Field, Hint, SectionLabel } from './UI';

/** A server-backed model picker. Credentials and provider URLs never leave Hermes. */
export function ServerModelPicker({ botId, onPicked }: { botId: string; onPicked?: () => void }) {
  useTranslation();
  const { modelOptions, modelPicks, refreshModels, selectModel } = useStore();
  const options = modelOptions[botId];
  const picked = modelPicks[botId];
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [provider, setProvider] = useState(picked?.provider || options?.currentProvider || '');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const choices = modelChoices(options);
  const providers = [...new Set([options?.currentProvider, picked?.provider, ...choices.map(c => c.provider)].filter((p): p is string => Boolean(p)))];

  async function reload() {
    setError('');
    setLoading(true);
    try { await refreshModels(botId); }
    catch (e) { setError(e instanceof Error ? e.message : t('无法读取服务器模型。')); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, [botId]);
  useEffect(() => {
    if (!provider && options?.currentProvider) setProvider(options.currentProvider);
  }, [options?.currentProvider]);

  async function choose(ref: ModelRef | null) {
    if (busy || loading) return;
    setError('');
    setSaved(false);
    setBusy(true);
    try {
      await selectModel(botId, ref);
      setSaved(true);
      onPicked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('模型未保存，请重试。'));
    } finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.current}>{t('当前选择：{0}', { 0: picked?.model || t('跟随服务器') })}</Text>
      <Hint>{t('服务器默认：{0}', { 0: options?.current || t('暂未读取到') })}</Hint>
      <Hint>{t('模型选择保存在服务器上，从下一条消息生效。Base URL 和 API Key 继续使用该机器人的服务器配置。')}</Hint>
      <Pressable accessibilityRole="button" disabled={busy || loading} style={styles.button} onPress={() => void choose(null)}>
        <Text style={styles.buttonText}>{t('跟随服务器')}{!picked ? ' ✓' : ''}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || loading} style={styles.button} onPress={() => void reload()}>
        <Text style={styles.buttonText}>{loading ? t('正在读取…') : t('刷新模型列表')}</Text>
      </Pressable>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.success}>{t('已保存到服务器。')}</Text> : null}
      {busy ? <Hint>{t('正在保存…')}</Hint> : null}
      <SectionLabel>{t('服务器可用模型')}</SectionLabel>
      <Field label={t('搜索模型')} value={query} onChange={setQuery} placeholder={t('模型名称或 ID')} />
      {choices.filter(c => `${c.label} ${c.model} ${c.providerName}`.toLowerCase().includes(query.toLowerCase())).map(choice => (
        <Pressable key={JSON.stringify([choice.provider, choice.model])} accessibilityRole="button"
          accessibilityLabel={`${choice.label} · ${choice.providerName || t('服务器提供商')}`}
          disabled={busy || loading} style={styles.choice} onPress={() => void choose({ model: choice.model, provider: choice.provider })}>
          <Text style={styles.name}>{choice.label}{picked?.model === choice.model && picked.provider === choice.provider ? ' ✓' : ''}</Text>
          <Text style={styles.meta}>{choice.model} · {choice.providerName || t('服务器提供商')}</Text>
        </Pressable>
      ))}
      {!choices.length && !loading ? <Hint>{t('服务器未返回模型列表。自定义接口可以在下方填写准确的模型 ID。')}</Hint> : null}
      <SectionLabel>{t('自定义模型')}</SectionLabel>
      <Hint>{t('只填写你的 API 支持的模型 ID。选择其他提供商时，该提供商也需要在服务器上配置。')}</Hint>
      <View style={styles.providers}>
        {providers.map(p => <Pressable key={p} accessibilityRole="button" disabled={busy} onPress={() => setProvider(p)} style={[styles.provider, provider === p && styles.selected]}>
          <Text style={styles.meta}>{p}{provider === p ? ' ✓' : ''}</Text>
        </Pressable>)}
      </View>
      {!provider ? <Hint>{t('提供商由服务器自动解析。')}</Hint> : null}
      <Field label={t('模型 ID')} value={custom} onChange={setCustom} placeholder="model-id" />
      <Pressable accessibilityRole="button" disabled={busy || loading || !custom.trim()} style={styles.button}
        onPress={() => void choose({ model: custom.trim(), provider })}>
        <Text style={styles.buttonText}>{t('使用此模型')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = createStyles({
  body: { padding: 14, paddingBottom: 30 },
  current: { color: C.text, fontSize: 14, fontWeight: '600' },
  button: { marginTop: 9, padding: 12, borderRadius: 10, backgroundColor: C.bean },
  buttonText: { color: C.text, fontSize: 12, textAlign: 'center' },
  choice: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.hairline, gap: 4 },
  name: { color: C.text, fontSize: 13 },
  meta: { color: '#a4a4ab', fontSize: 11 },
  providers: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
  provider: { padding: 8, borderRadius: 7, backgroundColor: C.cardRaised },
  selected: { backgroundColor: C.bean },
  error: { color: '#e09248', fontSize: 12, lineHeight: 18, marginTop: 10 },
  success: { color: '#7fcfaa', fontSize: 12, marginTop: 10 },
});
