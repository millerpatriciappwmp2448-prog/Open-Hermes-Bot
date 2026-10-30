import { t, useTranslation } from "../i18n";
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Page } from '../components/Page';
import { Card, Field, Hint, PrimaryButton, Row, SectionLabel } from '../components/UI';
import { BridgeError } from '../api';
import { useStore } from '../store';
import { themedStyles } from '../theme';

/**
 * The door, with its address and its code.
 *
 * The phone reaches the bridge the same way a browser would: over the tailnet,
 * at an HTTPS address. This page is where that address is typed, where the
 * one-time code is exchanged for this phone's token, and where the devices
 * that hold one can be forgotten.
 */
export function ConnectionScreen() {
  const { styles, C } = useStyles();
  useTranslation();
  const { connection, connect, disconnect, devices, revokeDevice, refresh, prefs } = useStore();
  const [url, setUrl] = useState(connection.url);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const online = connection.status === 'connected';
  const working = busy || connection.status === 'connecting';

  async function pair() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await connect(url, code);
      setCode('');
      setNotice(t("配对成功，已加载 Hermes 主机上的机器人。"));
    } catch (failure) {
      setError(
        failure instanceof BridgeError
          ? failure.message
          : t("无法连接桥接服务，请检查地址、Tailscale 和服务器状态。"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title={t("连接")}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.status}>
          <View
            style={[
              styles.dot,
              connection.status === 'error' && styles.dotBad,
              !online && connection.status !== 'error' && styles.dotOff,
            ]}
          />
          <Text style={styles.statusText}>
            {online
              ? t("已连接 · {0}{1}", {"0": connection.device || t("本机"), "1": connection.health ? t(" · 桥接服务 {0}", {"0": connection.health.version}) : ''})
              : connection.status === 'connecting'
                ? t("正在连接…")
                : connection.status === 'error'
                  ? t("未连接 · 桥接服务拒绝连接或未响应")
                  : t("未连接 · 等待配对")}
          </Text>
        </View>

        {online ? (
          <>
            <SectionLabel>{t("桥接服务")}</SectionLabel>
            <Card>
              <Row name={t("地址")} value={connection.url.replace(/^https?:\/\//i, '')} chevron={false} />
              <View style={styles.line} />
              <Row
                name="Hermes"
                value={connection.health?.hermes.ok ? t("正常响应") : t("无响应")}
                valueColor={connection.health?.hermes.ok ? C.green : C.warning}
                chevron={false}
              />
              <View style={styles.line} />
              <Row name={t("模型")} value={connection.model || t("主机默认模型")} chevron={false} />
              <View style={styles.line} />
              <Row name={t("所在主机")} value={prefs.host} chevron={false} />
            </Card>

            <View style={styles.buttons}>
              <PrimaryButton
                label={busy ? t("正在读取…") : t("刷新")}
                tone="quiet"
                onPress={async () => {
                  setError('');
                  setBusy(true);
                  try {
                    await refresh();
                    setNotice(t("已从 Hermes 刷新数据。"));
                  } catch {
                    setError(t("桥接服务未响应。"));
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <View style={styles.gap} />
              <PrimaryButton label={t("断开本机连接")} tone="quiet" onPress={() => void disconnect()} />
            </View>

            <SectionLabel>{t("已配对设备")}</SectionLabel>
            <Card>
              {devices.length === 0 ? (
                <Row name={t("暂无配对设备")} value="" chevron={false} />
              ) : (
                devices.map((device, index) => (
                  <Row
                    key={device.id}
                    name={device.name}
                    meta={device.id}
                    line={index > 0}
                    right={
                      <Pressable onPress={() => void revokeDevice(device.id)} accessibilityLabel={t("撤销 {0} 的授权", {"0": device.name})}>
                        <Text style={styles.revoke}>{t("撤销授权")}</Text>
                      </Pressable>
                    }
                    chevron={false}
                  />
                ))
              )}
            </Card>
            <Hint>
              {t("撤销授权后，该设备的令牌将永久失效。Hermes 密钥始终保存在服务器上，由桥接服务读取。")}
            </Hint>
          </>
        ) : (
          <>
            <SectionLabel>{t("桥接服务")}</SectionLabel>
            <Card>
              <View style={styles.card}>
                <Field
                  label={t("地址")}
                  value={url}
                  onChange={setUrl}
                  placeholder="https://host.tailnet.ts.net"
                />
                <Field
                  label={t("配对码")}
                  value={code}
                  onChange={setCode}
                  placeholder="ABCD-EFGH"
                />
              </View>
            </Card>

            <View style={styles.buttons}>
              <PrimaryButton
                label={working ? t("正在配对…") : t("配对本机")}
                onPress={() => void pair()}
              />
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {connection.error && !error ? <Text style={styles.error}>{connection.error}</Text> : null}
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <Hint>
              {t("填写服务器通过 Tailscale 提供的 HTTPS 根地址，例如 https://host.tailnet.ts.net。手机与服务器需登录同一 Tailscale 网络。在服务器的 ~/hermes-bridge 目录运行 python3 -m hermes_bridge pair 生成配对码；有效期为 20 分钟，仅能使用一次。")}
            </Hint>
            <Hint>
              {t("会话内容由服务器保存。本机仅保存桥接地址和设备令牌，该令牌只能访问桥接服务。")}
            </Hint>

            <SectionLabel>{t("状态")}</SectionLabel>
            <Card>
              <Row name={t("本机")} value={connection.device || t("尚未配对")} chevron={false} />
              <View style={styles.line} />
              <Row name={t("主机")} value={prefs.host || t('尚未连接服务器')} chevron={false} />
            </Card>
          </>
        )}
        <Hint>{t('无需 Mac。桥接服务安装在运行 Hermes 的 Linux 服务器上。这里填写桥接服务地址，不是模型的 Base URL；配对码也不是模型的 API Key。')}</Hint>
      </ScrollView>
    </Page>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  body: { paddingHorizontal: 12, paddingBottom: 24 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 13, paddingHorizontal: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  dotOff: { backgroundColor: INK.label },
  dotBad: { backgroundColor: C.warning },
  statusText: { flex: 1, color: INK.quiet, fontSize: 11 },
  card: { padding: 12, gap: 2 },
  buttons: { marginTop: 16 },
  gap: { height: 8 },
  line: { height: 1, backgroundColor: C.hairline },
  error: { marginTop: 10, color: C.warning, fontSize: 11, lineHeight: 16 },
  notice: { marginTop: 10, color: C.green, fontSize: 11, lineHeight: 16 },
  revoke: { color: C.warning, fontSize: 11 },
}));
