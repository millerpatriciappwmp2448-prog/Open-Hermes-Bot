import { memo, useEffect, useId, useRef } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { themedStyles } from '../theme';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import { useAvatarMotion } from './AvatarMotion';
import Svg, { Defs, G, Mask, Path, Rect } from 'react-native-svg';
import {
  BLOUB_FRAMES,
  BLOUB_SHAPES,
  type BloubShape,
  type BloubVariant,
} from '../bloubFrames';
import { box } from '../theme';

/**
 * The face a bot wears. The geometry is the app's own, vendored from
 * jeremy-prt/bloub (MIT) and shared with the desktop window and the mockup:
 * nothing here redraws a Bloub by hand.
 */
export const EYE_PAPER = '#f6f3e9';

export function botShape(shape?: string): BloubShape {
  const wanted = String(shape ?? '').trim() as BloubShape;
  return BLOUB_SHAPES.includes(wanted) ? wanted : 'cercle';
}

type BloubProps = {
  shape?: BloubShape;
  color: string;
  variant?: BloubVariant;
  size?: number;
  animated?: boolean;
  active?: boolean;
};

export const Bloub = memo(function Bloub({ shape = 'cercle', color, variant = 'neutral', size = 40, animated = size >= 30, active = false }: BloubProps) {
  const raw = useId();
  const maskId = `bloub-${raw.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const data = BLOUB_FRAMES[shape] ?? BLOUB_FRAMES.cercle;
  const frame = data.variants[active && variant === 'neutral' ? 'attentive' : variant] ?? data.variants.neutral;
  const view = data.viewBox;
  const px = box(size);
  const allowed = useAvatarMotion();
  const focused = useIsFocused();
  const moving = animated && allowed && focused;
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    motion.setValue(0);
    if (!moving) return;
    // Transform only: iOS drives this on the UI thread, without rerendering the
    // SVG paths or blocking interactions. Offscreen navigation stops the loop.
    const duration = active ? 620 : 2100 + (shape.length % 4) * 170;
    const step = (toValue: number) => Animated.timing(motion, {
      toValue, duration, easing: Easing.inOut(Easing.sin),
      useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => { loop.stop(); motion.setValue(0); };
  }, [active, motion, moving, shape]);

  return (
    <Animated.View
      testID={moving ? (active ? 'avatar-thinking' : 'avatar-idle') : 'avatar-still'}
      style={{ width: px, height: px, transform: [
        { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, -px * (active ? 0.07 : 0.035)] }) },
        { rotate: motion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', active ? '5deg' : '2deg'] }) },
        { scaleX: motion.interpolate({ inputRange: [0, 1], outputRange: [1, active ? 1.045 : 1.025] }) },
        { scaleY: motion.interpolate({ inputRange: [0, 1], outputRange: [1, active ? 0.96 : 0.98] }) },
      ] }}
    >
      <Svg
        width={px}
        height={px}
        viewBox={`${-view} ${-view} ${view * 2} ${view * 2}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <Mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x={-view}
            y={-view}
            width={view * 2}
            height={view * 2}
          >
            <Path d={frame.bodyPath} fill="#fff" />
            {frame.eyes.map((eye, index) => (
              <Path
                key={index}
                d={eye.d}
                transform={eye.matrix}
                opacity={eye.alpha}
                fill="#000"
              />
            ))}
          </Mask>
        </Defs>
        <Path d={frame.bodyPath} fill={EYE_PAPER} />
        <G mask={`url(#${maskId})`}>
          <Rect x={-view} y={-view} width={view * 2} height={view * 2} fill={color} />
        </G>
      </Svg>
    </Animated.View>
  );
});

/** The three faces of a group, laid over one another as the app does it. */
const GROUP_LAYOUT = [
  { top: 0, left: 9, scale: 0.64 },
  { bottom: 0, left: 0, scale: 0.57 },
  { bottom: 2, right: 0, scale: 0.53 },
] as const;

type GroupProps = {
  members: { shape: BloubShape; color: string }[];
  size?: number;
  active?: boolean;
};

export function BloubGroup({ members, size = 40, active = false }: GroupProps) {
  const { styles, INK } = useStyles();
  const visible = members.slice(0, 3);
  const extra = members.length - visible.length;
  const px = box(size);

  return (
    <View style={{ width: px, height: px }}>
      {visible.map((member, index) => {
        const place = GROUP_LAYOUT[index];
        const shade = place.scale * 100;
        return (
          <View
            key={index}
            style={[
              styles.groupItem,
              {
                width: `${shade}%`,
                height: `${shade}%`,
                top: 'top' in place ? `${place.top}%` : undefined,
                bottom: 'bottom' in place ? `${place.bottom}%` : undefined,
                left: 'left' in place ? `${place.left}%` : undefined,
                right: 'right' in place ? `${place.right}%` : undefined,
              },
            ]}
          >
            <Bloub shape={member.shape} color={member.color} size={Math.round(size * place.scale)} animated active={active} />
          </View>
        );
      })}
      {extra > 0 && size >= 32 ? (
        <View
          style={[
            styles.more,
            {
              minWidth: px * 0.3,
              height: px * 0.3,
              borderRadius: px,
            },
          ]}
        >
          <Text style={{ fontSize: Math.max(10, Math.round(px * 0.3 * 0.62)), color: INK.onPaper }}>
            +{extra}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles(({ C }) => ({
  groupItem: { position: 'absolute' },
  more: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: C.sidebar,
    backgroundColor: C.paper,
  },
}));
