import { t, useTranslation } from "../i18n";
import type { ReactNode } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';
import { ChevronIcon, CloseIcon } from './Icons';
import { themedStyles } from '../theme';

/** The head of a sheet: what it is, what it says, and the way out. */
export function SheetHeader({
  title,
  sub,
  onClose,
  back,
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  back?: () => void;
}) {
  const { styles, INK } = useStyles();
  useTranslation();
  return (
    <View style={styles.head}>
      <View style={styles.headCopy}>
        <Text style={styles.headTitle}>{title}</Text>
        {sub ? <Text style={styles.headSub}>{sub}</Text> : null}
      </View>
      <Pressable style={styles.close} onPress={back ?? onClose} accessibilityLabel={back ? t("返回") : t("关闭")}>
        {back ? (
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <ChevronIcon size={14} color={INK.quiet} />
          </View>
        ) : (
          <CloseIcon />
        )}
      </Pressable>
    </View>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const { styles } = useStyles();
  return <Text style={styles.section}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const { styles } = useStyles();
  return <View style={styles.card}>{children}</View>;
}

type RowProps = {
  name: string;
  meta?: string;
  value?: string;
  valueColor?: string;
  onPress?: () => void;
  right?: ReactNode;
  line?: boolean;
  chevron?: boolean;
};

/** One line of a card: a name, an optional value, the way forward. */
export function Row({
  name,
  meta,
  value,
  valueColor,
  onPress,
  right,
  line,
  chevron = true,
}: RowProps) {
  const { styles } = useStyles();
  return (
    <Pressable
      style={[styles.row, line && styles.line]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <View style={styles.rowCopy}>
        <Text style={styles.rowName}>{name}</Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, valueColor ? { color: valueColor } : null]}>{value}</Text> : null}
      {right}
      {onPress && chevron ? <ChevronIcon size={12} /> : null}
    </Pressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  tone = 'paper',
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'paper' | 'danger' | 'quiet';
  disabled?: boolean;
}) {
  const { styles, C } = useStyles();
  return (
    <Pressable
      style={[
        styles.button,
        tone === 'danger' && styles.buttonDanger,
        tone === 'quiet' && styles.buttonQuiet,
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityState={{ disabled }}
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.buttonText,
          tone === 'danger' && { color: C.red },
          tone === 'quiet' && { color: C.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  const { styles } = useStyles();
  return <Text style={styles.hint}>{children}</Text>;
}

/**
 * A confirmation, drawn in the sheet that asks it. The app never hands a
 * question to the system: the same card answers on the phone and in the
 * browser, and the answer is the press.
 */
export function ConfirmBlock({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
  error,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  error?: string;
}) {
  const { styles } = useStyles();
  useTranslation();
  return (
    <View style={styles.confirm}>
      <Text style={styles.confirmTitle}>{title}</Text>
      <Text style={styles.confirmMessage}>{message}</Text>
      {error ? <Text accessibilityRole="alert" style={styles.confirmError}>{error}</Text> : null}
      <View style={styles.confirmButtons}>
        <PrimaryButton label={busy ? t('正在处理…') : confirmLabel} tone="danger" disabled={busy} onPress={onConfirm} />
        <View style={{ height: 8 }} />
        <PrimaryButton label={t("取消")} tone="quiet" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const { styles } = useStyles();
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <Pressable
            key={option.id}
            style={[styles.segment, on && styles.segmentOn]}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard,
  secure,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  keyboard?: KeyboardTypeOptions;
  secure?: boolean;
}) {
  const { styles, INK, scheme } = useStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput keyboardAppearance={scheme}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={INK.quiet}
        keyboardType={keyboard}
        secureTextEntry={secure}
        style={styles.fieldValue}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  headCopy: { flex: 1 },
  headTitle: { color: C.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.48 },
  headSub: { marginTop: 3, color: INK.quiet, fontSize: 11, lineHeight: 15 },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: C.field2,
  },

  section: {
    paddingTop: 10,
    paddingHorizontal: 5,
    paddingBottom: 3,
    color: INK.label,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  card: { overflow: 'hidden', borderRadius: 13, backgroundColor: C.cardRaised },
  row: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  line: { borderTopWidth: 1, borderTopColor: C.hairline },
  rowCopy: { flex: 1 },
  rowName: { color: C.text, fontSize: 12, fontWeight: '500' },
  rowMeta: { marginTop: 1, color: INK.quiet, fontSize: 9 },
  rowValue: { color: INK.quiet, fontSize: 11 },

  button: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: C.paper,
  },
  buttonDanger: { backgroundColor: C.card },
  buttonQuiet: { backgroundColor: C.card },
  buttonText: { color: INK.onPaper, fontSize: 14, fontWeight: '600' },

  hint: { marginTop: 7, color: INK.quiet, fontSize: 10, lineHeight: 14 },

  confirm: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20 },
  confirmTitle: { color: C.text, fontSize: 16, fontWeight: '600', letterSpacing: -0.3 },
  confirmMessage: { marginTop: 6, color: INK.quiet, fontSize: 11, lineHeight: 16 },
  confirmError: { marginTop: 8, color: C.red, fontSize: 11, lineHeight: 16 },
  confirmButtons: { marginTop: 16 },

  segmented: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: 9, backgroundColor: C.field },
  segment: { flex: 1, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segmentOn: { backgroundColor: C.field2 },
  segmentText: { color: INK.quiet, fontSize: 12, fontWeight: '500' },
  segmentTextOn: { color: C.text },

  field: { marginTop: 10 },
  fieldLabel: { color: INK.quiet, fontSize: 9, fontWeight: '500', marginBottom: 3 },
  fieldValue: {
    height: 40,
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 9,
    backgroundColor: C.card,
    color: C.text,
    fontSize: 13,
  },
}));
