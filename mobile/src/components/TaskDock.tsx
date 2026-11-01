import { t, useTranslation } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { box, themedStyles } from '../theme';
import { countTodos, currentTodo, dockVisible, todoDepth, type TodoItem, type TodoStatus } from '../taskDock';
import { useAvatarMotion } from './AvatarMotion';
import { CheckIcon, ChevronIcon, CloseIcon } from './Icons';

type Props = {
  todos?: TodoItem[];
  /** The agent is working on this turn: only then does the running step pulse. */
  running: boolean;
};

const STATUS_LABEL: Record<TodoStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

/**
 * The agent's own task list (Hermes' `todo_list`), as a small tab resting on
 * the composer. Folded, it is one line: the count and the step being worked
 * on. It goes away once every step is settled.
 */
export function TaskDock({ todos, running }: Props) {
  const { styles } = useStyles();
  useTranslation();
  const [open, setOpen] = useState(false);

  if (!todos || !dockVisible(todos)) return null;

  const { done, total } = countTodos(todos);
  const current = currentTodo(todos);
  const label = t('任务 {0}/{1}', { '0': done, '1': total });

  return (
    <View style={styles.dock} testID="task-dock">
      <Pressable
        style={styles.header}
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={current ? `${label} · ${current.content}` : label}
        accessibilityHint={open ? t('收起任务列表') : t('展开任务列表')}
      >
        <View style={open ? styles.caretOpen : undefined}>
          <ChevronIcon size={10} />
        </View>
        <Text style={styles.label}>{label}</Text>
        {!open && current ? (
          <Text style={styles.current} numberOfLines={1}>
            {current.content}
          </Text>
        ) : null}
      </Pressable>

      {open ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listBody} nestedScrollEnabled>
          {todos.map((item, index) => (
            <View
              key={`${item.id}:${index}`}
              style={[
                styles.item,
                { paddingLeft: 8 + todoDepth(todos, item) * 12 },
                item.status === 'cancelled' && styles.cancelled,
              ]}
              accessible
              accessibilityLabel={`${t(STATUS_LABEL[item.status])}: ${item.content}`}
            >
              <Glyph status={item.status} running={running} />
              <Text
                style={[styles.text, (item.status === 'completed' || item.status === 'cancelled') && styles.settled]}
                numberOfLines={1}
              >
                {item.content}
              </Text>
            </View>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Glyph({ status, running }: { status: TodoStatus; running: boolean }) {
  const { styles, C, INK } = useStyles();
  if (status === 'completed') return <View style={styles.glyph}><CheckIcon size={10} color={C.green} /></View>;
  if (status === 'cancelled') return <View style={styles.glyph}><CloseIcon size={9} color={INK.quiet} /></View>;
  if (status === 'in_progress') return <View style={styles.glyph}><Pulse running={running} /></View>;
  const px = box(10);
  return (
    <View style={styles.glyph}>
      <Svg width={px} height={px} viewBox="0 0 12 12">
        <Circle cx="6" cy="6" r="5.2" stroke={INK.quiet} strokeWidth={1} strokeDasharray="1.8 1.6" fill="none" />
      </Svg>
    </View>
  );
}

function Pulse({ running }: { running: boolean }) {
  const { styles } = useStyles();
  const motion = useAvatarMotion();
  const opacity = useRef(new Animated.Value(0.85)).current;
  const live = motion && running;

  useEffect(() => {
    if (!live) {
      opacity.setValue(0.85);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, opacity]);

  return <Animated.View style={[styles.pulse, { opacity }]} testID={live ? 'task-pulse' : 'task-still'} />;
}

// Native points: the composer below is laid out with the scaled box factor, so
// its edge padding and corner are read back through `box()` to sit flush.
const useStyles = themedStyles(
  ({ C, INK }) => ({
    dock: {
      marginHorizontal: box(9) + 20,
      marginBottom: -box(6),
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: C.line,
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      backgroundColor: C.field,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 26,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    caretOpen: { transform: [{ rotate: '90deg' }] },
    label: { color: INK.quiet, fontSize: 11.5, fontWeight: '500' },
    current: { flex: 1, minWidth: 0, color: C.text2, fontSize: 11.5 },
    list: { maxHeight: 150 },
    listBody: { paddingBottom: 6 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 22, paddingRight: 10 },
    cancelled: { opacity: 0.7 },
    glyph: { width: box(10), height: box(10), alignItems: 'center', justifyContent: 'center' },
    pulse: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.text2 },
    text: { flex: 1, minWidth: 0, color: C.text, fontSize: 11.5, lineHeight: 15 },
    settled: { color: INK.quiet },
  }),
  false,
);
