import {
  StyleSheet,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useAppearance } from './appearance';
import type { ThemeName } from './appearance';


/**
 * The app's palette and geometry, taken from the mockup (mockups/mobile.css)
 * and the desktop app's own tokens (src/styles.css). One place, so a screen
 * never invents a colour.
 */

const darkColors = {
  bg: '#1d1d1f',
  sidebar: '#19191b',
  divider: 'rgba(255,255,255,0.07)',
  hover: 'rgba(255,255,255,0.04)',
  active: '#27272a',
  field: '#262628',
  field2: '#353539',
  bubble: '#29292c',
  bean: '#303036',
  paper: '#f2efe5',
  text: '#f3f3f5',
  text2: '#9a9aa1',
  text3: '#96969e',
  green: '#3ecf8e',
  blue: '#2496e8',
  red: '#ff5f57',
  sheet: '#232326',
  sheet2: '#2b2b2f',
  card: '#2a2a2e',
  cardRaised: '#242427',
  line: 'rgba(255,255,255,0.075)',
  hairline: 'rgba(255,255,255,0.055)',
  border: 'rgba(255,255,255,0.14)',
  strongBorder: 'rgba(255,255,255,0.3)',
  selected: 'rgba(62,207,142,0.08)',
  selectedBorder: '#395c4b',
  warning: '#e4aa68',
  recording: '#2a2426',
  recordingButton: '#3a3234',
  recordingInk: '#f0b9b4',
  mention: 'rgba(28,27,25,0.09)',
  scrim: 'rgba(8,8,10,0.62)',
  handle: '#66666e',
};

/** The grey a body of text is allowed to be, from title to hint. */
const darkInk = {
  title: '#f0f0f2',
  body: '#f1f1f3',
  quiet: '#a1a1a9',
  quiet2: '#a1a1a9',
  label: '#a1a1a9',
  faint: '#a1a1a9',
  meta: '#a1a1a9',
  onPaper: '#1c1b19',
  onPaperQuiet: '#59584f',
};

export type Palette = { C: typeof darkColors; INK: typeof darkInk };
export const palettes: Record<ThemeName, Palette> = {
  dark: { C: darkColors, INK: darkInk },
  light: {
    C: {
      bg: '#f6f5f1', sidebar: '#f6f5f1', divider: 'rgba(32,34,31,0.09)',
      hover: 'rgba(32,34,31,0.04)', active: '#e9e8e3', field: '#eae9e4',
      field2: '#ddded7', bubble: '#e8e9e3', bean: '#e1e3dc', paper: '#263d32',
      text: '#202620', text2: '#60685f', text3: '#6d756c',
      green: '#22734e', blue: '#1769a0', red: '#b63832',
      sheet: '#f6f5f1', sheet2: '#eeeee8', card: '#eeeee8', cardRaised: '#ffffff',
      line: 'rgba(32,34,31,0.10)', hairline: 'rgba(32,34,31,0.08)',
      border: 'rgba(32,34,31,0.18)', strongBorder: 'rgba(32,34,31,0.35)',
      selected: '#e8f2eb', selectedBorder: '#91bba0', warning: '#925719',
      recording: '#f7e9e7', recordingButton: '#eddbd7', recordingInk: '#9e3e35',
      mention: 'rgba(255,255,255,0.13)', scrim: 'rgba(20,26,22,0.30)', handle: '#a3aaa1',
    },
    INK: {
      title: '#202620', body: '#202620', quiet: '#60685f', quiet2: '#60685f',
      label: '#60685f', faint: '#60685f', meta: '#60685f',
      onPaper: '#faf9f4', onPaperQuiet: '#d1dbcf',
    },
  },
  ivory: {
    C: {
      bg: '#faf7f0', sidebar: '#faf7f0', divider: 'rgba(71,52,25,0.10)',
      hover: 'rgba(137,101,46,0.05)', active: '#efe6d6', field: '#f0eade',
      field2: '#e8ddc9', bubble: '#eee7d9', bean: '#e9dfcd', paper: '#86612e',
      text: '#352e24', text2: '#736653', text3: '#827158',
      green: '#80602e', blue: '#956c33', red: '#a23d31',
      sheet: '#faf7f0', sheet2: '#f3ecdf', card: '#f3ecdf', cardRaised: '#fffdf8',
      line: 'rgba(111,82,39,0.13)', hairline: 'rgba(111,82,39,0.09)',
      border: 'rgba(111,82,39,0.22)', strongBorder: 'rgba(111,82,39,0.40)',
      selected: '#f3e8d2', selectedBorder: '#c6ab78', warning: '#86521d',
      recording: '#f4e6dc', recordingButton: '#ead7c9', recordingInk: '#8c4932',
      mention: 'rgba(255,255,255,0.13)', scrim: 'rgba(47,36,21,0.30)', handle: '#b5a589',
    },
    INK: {
      title: '#352e24', body: '#352e24', quiet: '#736653', quiet2: '#736653',
      label: '#736653', faint: '#736653', meta: '#736653',
      onPaper: '#fffbf3', onPaperQuiet: '#f1e1c7',
    },
  },
};

export function useTheme() {
  const appearance = useAppearance();
  const themeName: ThemeName = appearance.preference === 'ivory' ? 'ivory' : appearance.scheme;
  return { ...appearance, themeName, ...palettes[themeName] };
}

/** Precompute every palette once. Each consumer reacts without remounting. */
export function themedStyles<T extends Record<string, ViewStyle | TextStyle | ImageStyle>>(
  factory: (palette: Palette) => T,
  scale = true,
) {
  const build = scale ? createStyles<T> : StyleSheet.create<T>;
  const sheets = { light: build(factory(palettes.light)), dark: build(factory(palettes.dark)), ivory: build(factory(palettes.ivory)) };
  return function useStyles() {
    const theme = useTheme();
    return { ...theme, styles: sheets[theme.themeName] };
  };
}

/** The ios system font: the mockup asks for -apple-system, and this is it. */
export const FONT = {
  regular: undefined,
} as const;

/** Legacy mockup sizes are normalized to compact, readable native points.
 * Tiny labels keep an 11pt floor; regular body copy stops at 16pt. Titles
 * already use native point sizes and must not get enlarged a second time.
 * The OS remains free to apply Dynamic Type on top of these defaults.
 */
const TEXT_SCALE = 1.18;
const BOX_SCALE = 1.1;

function textFactor(size: number): number {
  if (size <= 0) return 1;
  if (size > 16) return 1;
  return Math.min(16, Math.max(11, size * TEXT_SCALE)) / size;
}

const TEXT_SIZE = /^(fontSize|lineHeight|letterSpacing)$/;
const BOX_SIZE =
  /^(width|height|minWidth|minHeight|maxWidth|maxHeight|padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap|borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|top|bottom|left|right)$/;

function scaled(key: string, value: unknown): unknown {
  if (typeof value !== 'number') return value;
  if (TEXT_SIZE.test(key)) return Math.round(value * textFactor(value) * 10) / 10;
  if (BOX_SIZE.test(key)) return Math.round(value * BOX_SCALE);
  return value;
}

/**
 * StyleSheet.create, with the scale applied. Percentages are left alone — a
 * width of "78%" is already a share of the screen, not a number of points.
 */
export function createStyles<
  T extends Record<string, ViewStyle | TextStyle | ImageStyle>,
>(styles: T): T {
  const out: Record<string, ViewStyle | TextStyle | ImageStyle> = {};
  for (const [name, style] of Object.entries(styles)) {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(style)) next[key] = scaled(key, value);
    if ('fontSize' in style && typeof style.fontSize === 'number') {
      const factor = textFactor(style.fontSize);
      if ('lineHeight' in style && typeof style.lineHeight === 'number') next.lineHeight = Math.round(style.lineHeight * factor * 10) / 10;
      if ('letterSpacing' in style) next.letterSpacing = style.letterSpacing;
    }
    out[name] = next as ViewStyle;
  }
  return StyleSheet.create(out) as T;
}

/** A face or an icon, scaled by the same box factor the layout uses. */
export function box(pts: number): number {
  return Math.round(pts * BOX_SCALE);
}
