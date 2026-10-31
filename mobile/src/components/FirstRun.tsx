import { t, useTranslation } from "../i18n";
import { Pressable, Text, View } from 'react-native';
import { Bloub } from './Bloub';
import { PlusIcon } from './Icons';
import { themedStyles } from '../theme';

/**
 * The first run: the host is there, the bots are not. One face, one
 * sentence, and the one button that makes the app worth opening.
 */
export function FirstRunBody({
  onCreate,
  onSetup,
}: {
  onCreate: () => void;
  onSetup?: () => void;
}) {
  const { styles, INK } = useStyles();
  useTranslation();
  return (
    <View style={styles.body}>
      <Bloub shape="cercle" color="#8b5cf6" size={86} />
      <Text style={styles.title}>{t("暂无智能体")}</Text>
      <Text style={styles.copy}>
        {t("已连接服务器。创建第一个智能体后，Hermes 会保存它的记忆、外观和会话。")}
      </Text>
      <Pressable style={styles.primary} onPress={onCreate}>
        <PlusIcon size={15} color={INK.onPaper} />
        <Text style={styles.primaryText}>{t("创建智能体")}</Text>
      </Pressable>
      <Pressable onPress={onSetup} accessibilityRole="button" disabled={!onSetup}>
        <Text style={[styles.link, !onSetup && styles.linkOff]}>{t("重新运行初始设置")}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
    paddingBottom: 30,
  },
  title: { marginTop: 17, color: C.text, fontSize: 21, fontWeight: '600', letterSpacing: -0.59 },
  copy: {
    maxWidth: 245,
    marginTop: 7,
    marginBottom: 20,
    color: INK.quiet2,
    fontSize: 12,
    lineHeight: 18.5,
    textAlign: 'center',
  },
  primary: {
    width: 214,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 12,
    backgroundColor: C.paper,
  },
  primaryText: { color: INK.onPaper, fontSize: 14, fontWeight: '600' },
  link: { marginTop: 13, color: INK.quiet, fontSize: 11 },
  linkOff: { opacity: 0.5 },
}));
