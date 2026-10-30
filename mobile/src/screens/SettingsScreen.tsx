import { t, useTranslation } from "../i18n";
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bloub } from '../components/Bloub';
import { BackIcon, ChevronIcon } from '../components/Icons';
import { Toggle } from '../components/Toggle';
import { HOST } from '../data';
import { useStore } from '../store';
import { useAppNavigation } from '../nav';
import { themedStyles } from '../theme';
import { Segmented } from '../components/UI';

/**
 * Where the host, the conversation and the app are set. Every row opens the
 * page that holds it; the switches live in the store and take effect at once.
 */
export function SettingsScreen() {
  const { styles, C, preference: appearance } = useStyles();
  const { preference, setPreference, saveError } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useAppNavigation();
  const { toggles, toggle, prefs, connection } = useStore();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <Pressable style={styles.navIcon} onPress={() => navigation.goBack()} accessibilityLabel={t("返回")}>
          <BackIcon />
        </Pressable>
        <Text style={styles.title}>{t("设置")}</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        <Pressable style={styles.connection} onPress={() => navigation.navigate('Connection')}>
          <Bloub shape="cercle" color="#8b5cf6" size={30} />
          <View style={styles.connectionCopy}>
            <Text style={styles.connectionName}>{prefs.host || t('你的 Hermes 服务器')}</Text>
            <Text style={styles.connectionMeta}>
              {connection.status === 'connected'
                ? t("已连接 · {0}", {"0": connection.device || t("本机")})
                : connection.status === 'connecting'
                  ? t("正在连接…")
                  : connection.status === 'error'
                    ? t("未连接 · 桥接服务拒绝连接")
                    : t("未连接 · 当前为演示模式")}
            </Text>
          </View>
          <View style={styles.connectionState}>
            <View
              style={[
                styles.stateDot,
                connection.status !== 'connected' && styles.stateDotOff,
              ]}
            />
            <Text style={styles.stateText}>{t("桥接服务")}</Text>
          </View>
          <ChevronIcon />
        </Pressable>

        <Text style={styles.groupLabel}>Hermes</Text>
        <View style={styles.group}>
          <Row
            name={t("连接")}
            value={connection.status === 'connected' ? t("已连接") : t("未连接")}
            onPress={() => navigation.navigate('Connection')}
          />
          <Row
            name={t("模型")}
            value={connection.status === 'connected' ? t('按机器人选择') : t('请先连接')}
            line
            onPress={() => navigation.navigate('Models')}
          />
          <Row
            name={t("语音")}
            value={prefs.voice === 'host' ? t("主机转写") : t("在本机上")}
            line
            onPress={() => navigation.navigate('Voice')}
          />
          <Row
            name={t("更新")}
            value={prefs.autoUpdate ? t("自动") : t("手动")}
            valueColor={C.green}
            line
            onPress={() => navigation.navigate('Updates')}
          />
        </View>

        <Text style={styles.groupLabel}>{t("会话")}</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowName}>{t("表情回应")}</Text>
            <View style={styles.spacer} />
            <Toggle on={toggles.tapbacks} onChange={() => toggle('tapbacks')} label={t("表情回应")} />
          </View>
          <View style={[styles.row, styles.line]}>
            <Text style={styles.rowName}>{t("声音")}</Text>
            <View style={styles.spacer} />
            <Toggle on={toggles.sounds} onChange={() => toggle('sounds')} label={t("声音")} />
          </View>
        </View>

        <Text style={styles.groupLabel}>语言 / Language</Text>
        <View style={[styles.group, { padding: 10 }]}>
          <Segmented
            options={[
              { id: 'system', label: t('跟随系统') },
              { id: 'zh', label: '简体中文' },
              { id: 'en', label: 'English' },
            ]}
            value={preference}
            onChange={setPreference}
          />
          <Text style={styles.foot}>{t('切换界面语言不会翻译服务器返回的聊天内容。')}</Text>
          {saveError ? <Text style={styles.foot}>{t('无法保存语言设置，重启后可能恢复默认语言。')}</Text> : null}
        </View>

        <Text style={styles.groupLabel}>{t("应用")}</Text>
        <View style={styles.group}>
          <Row name={t("外观")} value={appearance === 'system' ? t('跟随系统') : appearance === 'ivory' ? t('象牙金') : appearance === 'light' ? t('白天') : t('夜间')} onPress={() => navigation.navigate('Appearance')} />
          <View style={[styles.row, styles.line]}>
            <Text style={styles.rowName}>{t("触感反馈")}</Text>
            <View style={styles.spacer} />
            <Toggle
              on={toggles.haptics}
              onChange={() => {
                // The switch answers in the hand when it is turned on.
                if (!toggles.haptics) void Haptics.selectionAsync();
                toggle('haptics');
              }}
              label={t("触感反馈")}
            />
          </View>
          <Row
            name={t("初始设置")}
            value={t("重新设置")}
            line
            onPress={() => navigation.navigate('Setup')}
          />
        </View>

        <Text style={styles.groupLabel}>{t("关于")}</Text>
        <View style={styles.group}>
          <Row name={t("版本")} value={HOST.version} chevron={false} />
          <Row name={t("服务器")} value={prefs.host || t('未连接')} line chevron={false} />
        </View>

        <Text style={styles.foot}>{t("Hermes Bot · 随时连接你的服务器")}</Text>
      </ScrollView>
    </View>
  );
}

function Row({
  name,
  value,
  line,
  valueColor,
  onPress,
  chevron = true,
}: {
  name: string;
  value: string;
  line?: boolean;
  valueColor?: string;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const { styles } = useStyles();
  return (
    <Pressable
      style={[styles.row, line && styles.line]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Text style={styles.rowName}>{name}</Text>
      <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      {onPress && chevron ? <ChevronIcon size={12} /> : null}
    </Pressable>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  root: { flex: 1, backgroundColor: C.bg },
  nav: {
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  navIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  title: { color: C.text, fontSize: 14, fontWeight: '600', letterSpacing: -0.17 },

  scroll: { flex: 1 },
  scrollBody: { paddingTop: 13, paddingHorizontal: 12, paddingBottom: 20 },

  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    backgroundColor: C.cardRaised,
  },
  connectionCopy: { flex: 1, gap: 2 },
  connectionName: { color: C.text, fontSize: 14, fontWeight: '600', letterSpacing: -0.14 },
  connectionMeta: { color: INK.quiet, fontSize: 10 },
  connectionState: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.green },
  stateDotOff: { backgroundColor: INK.label },
  stateText: { color: INK.quiet, fontSize: 9 },

  groupLabel: {
    paddingTop: 10,
    paddingHorizontal: 5,
    paddingBottom: 3,
    color: INK.label,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  group: { overflow: 'hidden', borderRadius: 13, backgroundColor: C.cardRaised },
  row: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 },
  line: { borderTopWidth: 1, borderTopColor: C.hairline },
  rowName: { color: C.text, fontSize: 12, fontWeight: '500' },
  rowValue: { marginLeft: 'auto', color: INK.quiet, fontSize: 11 },
  spacer: { flex: 1 },
  foot: { marginTop: 12, color: INK.quiet, fontSize: 9, textAlign: 'center' },
}));
