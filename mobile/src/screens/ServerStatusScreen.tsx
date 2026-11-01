import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { BridgeError, type ServerMonitor } from '../api';
import { Page } from '../components/Page';
import { Hint, PrimaryButton } from '../components/UI';
import { localeTag, t, useTranslation } from '../i18n';
import { useAppNavigation } from '../nav';
import { useStore } from '../store';
import { themedStyles } from '../theme';

const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const numberText = (value: unknown) => validNumber(value) ? value.toLocaleString(localeTag(), { maximumFractionDigits: 1 }) : t('暂无数据');
const percentText = (value: unknown) => validNumber(value) && value <= 100 ? `${numberText(value)}%` : t('暂无数据');
function bytes(value: number) {
  const unit = value >= 1024 ** 3 ? 'GiB' : 'MiB';
  return `${numberText(value / (unit === 'GiB' ? 1024 ** 3 : 1024 ** 2))} ${unit}`;
}

export function ServerStatusScreen() {
  useTranslation();
  const { styles } = useStyles();
  const navigation = useAppNavigation();
  const { connection, loadMonitor } = useStore();
  const focused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [snapshot, setSnapshot] = useState<ServerMonitor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'old' | 'failed' | null>(null);
  const busy = useRef(false);
  const revision = useRef(0);
  const online = connection.status === 'connected';

  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => listener.remove();
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current || !online || !focused || !appActive) return;
    const ticket = revision.current;
    busy.current = true; setLoading(true);
    try {
      const result = await loadMonitor();
      if (ticket !== revision.current) return;
      setSnapshot(result); setError(null);
    } catch (e) {
      if (ticket === revision.current) setError(e instanceof BridgeError && e.status === 404 ? 'old' : 'failed');
    } finally {
      if (ticket === revision.current) { busy.current = false; setLoading(false); }
    }
  }, [online, focused, appActive, loadMonitor]);

  useEffect(() => { setSnapshot(null); setError(null); }, [connection.url, connection.status]);
  useEffect(() => {
    revision.current += 1; busy.current = false; setLoading(false);
    if (!online || !focused || !appActive) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { clearInterval(timer); revision.current += 1; busy.current = false; };
  }, [refresh, connection.url, online, focused, appActive]);

  const resources = snapshot?.resources;
  const gateway = snapshot?.gateway;
  const usage = gateway?.available ? gateway.usage : undefined;
  return <Page title={t('服务器状态')} right={online ? <Pressable accessibilityRole="button"
    accessibilityLabel={t('刷新')} disabled={loading} onPress={() => void refresh()} style={styles.refresh}>
    <Text style={styles.link}>{loading ? t('读取中') : t('刷新')}</Text>
  </Pressable> : null}>
    {!online ? <><Hint>{t('请先连接服务器。')}</Hint><PrimaryButton label={t('连接服务器')} onPress={() => navigation.navigate('Connection')} /></> : (
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error === 'old'
          ? t('请更新服务器桥接服务以查看状态。')
          : snapshot ? t('刷新失败，以下为上次读取的数据。') : t('无法读取服务器状态，请重试。')}</Text> : null}
        {resources ? <Text style={styles.caption}>{t('采样时间：{0}', { 0: new Date(resources.sampledAt * 1000).toLocaleTimeString(localeTag()) })}</Text> : null}
        <Text style={styles.heading}>{t('主机资源')}</Text>
        <View style={styles.card}>
          <Resource label="CPU" percent={resources?.cpuPercent} />
          <Resource label={t('内存')} percent={resources?.memory?.percent} capacity={resources?.memory} />
          <Resource label={t('磁盘')} percent={resources?.disk?.percent} capacity={resources?.disk} last />
        </View>
        <Text style={styles.caption}>{t('资源为桥接进程可见的主机数据；磁盘对应 Hermes 数据目录所在分区。')}</Text>
        <Text style={styles.heading}>{t('Hermes 网关')}</Text>
        <View style={styles.card}>
          <Stat label={t('状态')} value={!snapshot ? t('暂无数据') : gateway?.available ? t('可访问') : t('无法读取')} />
          <Stat label={t('版本')} value={gateway?.version || t('暂无数据')} />
          <Stat label={t('活跃智能体')} value={numberText(gateway?.activeAgents)} last />
        </View>
        {gateway && !gateway.available ? <Text style={styles.caption}>{gateway.error === 'unsupported'
          ? t('当前 Hermes 版本未提供网关统计。') : t('无法读取 Hermes 网关统计，请检查服务和访问密钥。')}</Text> : null}
        <Text style={styles.heading}>{t('API 用量')}{usage?.day ? ` · ${usage.day} UTC` : ''}</Text>
        <View style={styles.card}>
          <Stat label={t('请求数')} value={numberText(usage?.requests)} />
          <Stat label={t('消息数')} value={numberText(usage?.messages)} />
          <Stat label="Tokens" value={numberText(usage?.tokens)} />
          <Stat label={t('响应耗时 P95')} value={validNumber(usage?.latencyP95Ms) ? `${numberText(usage.latencyP95Ms)} ms` : t('暂无数据')} last />
        </View>
        <Text style={styles.caption}>{t('用量由网关按 UTC 当天统计，重启可能重置；不代表所有渠道的总消耗或账单。')}</Text>
      </ScrollView>
    )}
  </Page>;
}

function Stat({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { styles } = useStyles();
  return <View style={[styles.row, !last && styles.line]}>
    <Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text>
  </View>;
}

function Resource({ label, percent, capacity, last }: {
  label: string; percent: number | null | undefined;
  capacity?: { totalBytes: number; usedBytes: number } | null; last?: boolean;
}) {
  const { styles } = useStyles();
  return <View style={[styles.resource, !last && styles.line]}>
    <View style={styles.resourceHeader}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{percentText(percent)}</Text></View>
    {validNumber(percent) && percent <= 100 ? <View accessibilityRole="progressbar" accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }} style={styles.track}>
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View> : null}
    {capacity && validNumber(capacity.usedBytes) && validNumber(capacity.totalBytes)
      ? <Text style={styles.caption}>{bytes(capacity.usedBytes)} / {bytes(capacity.totalBytes)}</Text> : null}
  </View>;
}

const useStyles = themedStyles(({ C }) => ({
  body: { padding: 20, paddingBottom: 36, gap: 10 },
  heading: { fontSize: 14, fontWeight: '500', color: C.text2, marginTop: 8 },
  card: { backgroundColor: C.field, borderRadius: 14, overflow: 'hidden' },
  row: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 14, color: C.text, flexShrink: 0 },
  value: { fontSize: 14, fontWeight: '500', color: C.text, marginLeft: 'auto', flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  resource: { padding: 14, gap: 8 },
  resourceHeader: { flexDirection: 'row', gap: 12 },
  line: { borderBottomWidth: 1, borderBottomColor: C.hairline },
  track: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2, backgroundColor: C.green },
  caption: { color: C.text2, fontSize: 11, lineHeight: 17 },
  error: { color: C.red, fontSize: 12, lineHeight: 18 },
  refresh: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  link: { color: C.text, fontSize: 12 },
}), false);
