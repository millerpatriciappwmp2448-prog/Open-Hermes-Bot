import { t, useTranslation } from "../i18n";
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { MODELS } from '../data';
import { themedStyles } from '../theme';
import { CheckIcon, SearchIcon } from './Icons';

/**
 * The models a turn can run on, grouped by who serves them. The memory is
 * not here: a model is a choice for the conversation, nothing more.
 */
export function ModelList({
  selected,
  onPick,
}: {
  selected: string;
  onPick: (name: string) => void;
}) {
  const { styles, INK, scheme } = useStyles();
  const { language } = useTranslation();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MODELS.map((group) => ({
      ...group,
      models: group.models.filter((model) =>
        `${t(model.name)} ${model.meta ?? ''}`.toLowerCase().includes(needle),
      ),
    })).filter((group) => group.models.length > 0);
  }, [query, language]);

  return (
    <View style={styles.root}>
      <View style={styles.search}>
        <SearchIcon color={INK.meta} />
        <TextInput keyboardAppearance={scheme}
          value={query}
          onChangeText={setQuery}
          placeholder={t("搜索模型")}
          placeholderTextColor={INK.quiet}
          style={styles.input}
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {groups.map((group) => (
          <View key={group.group}>
            <Text style={styles.groupName}>{t(group.group)}</Text>
            {group.models.map((model) => {
              // The default is named by what it runs: one row marked, never two.
              const active =
                model.name === selected ||
                (model.name === "Hermes 默认模型" && model.meta === selected);
              return (
                <Pressable
                  key={model.name}
                  style={[styles.row, active && styles.rowActive]}
                  onPress={() => onPick(model.name === "Hermes 默认模型" ? (model.meta ?? model.name) : model.name)}
                >
                  <Text style={[styles.mark, active && styles.markActive]}>{model.mark}</Text>
                  <Text style={styles.name} numberOfLines={1}>
                    {t(model.name)}
                  </Text>
                  {model.tag && active ? <Text style={styles.tag}>{t(model.tag)}</Text> : null}
                  {model.meta && !active ? <Text style={styles.meta}>{model.meta}</Text> : null}
                  {active ? <CheckIcon /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        {groups.length === 0 ? <Text style={styles.empty}>{t("没有找到匹配的模型。")}</Text> : null}
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles(({ C, INK }) => ({
  root: { flex: 1, minHeight: 0 },
  search: {
    height: 33,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 11,
    marginHorizontal: 16,
    paddingHorizontal: 10,
    borderRadius: 9,
    backgroundColor: C.field,
  },
  input: { flex: 1, color: C.text, fontSize: 12, padding: 0 },
  body: { paddingTop: 6, paddingHorizontal: 10, paddingBottom: 18 },
  groupName: {
    paddingTop: 9,
    paddingHorizontal: 8,
    paddingBottom: 4,
    color: INK.label,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 1.04,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 9,
  },
  rowActive: { backgroundColor: C.bean },
  mark: {
    width: 25,
    height: 25,
    borderRadius: 7,
    backgroundColor: C.field2,
    color: INK.quiet,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 25,
  },
  markActive: { backgroundColor: C.field2, color: C.text },
  name: { color: C.text, fontSize: 13, fontWeight: '500', letterSpacing: -0.1 },
  tag: {
    marginLeft: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: C.line,
    color: INK.quiet,
    fontSize: 8,
    textTransform: 'uppercase',
  },
  meta: { marginLeft: 'auto', color: INK.quiet, fontSize: 9 },
  empty: { color: INK.quiet, fontSize: 12, padding: 12 },
}));
