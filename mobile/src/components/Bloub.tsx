import { memo, useEffect, useId, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { themedStyles } from '../theme';
import { Animated, Easing, Platform, Text, View } from 'react-native';
import { useAvatarMotion } from './AvatarMotion';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, Rect, Stop } from 'react-native-svg';
import {
  BLOUB_FRAMES,
  BLOUB_SHAPES,
  type BloubShape,
  type BloubVariant,
} from '../bloubFrames';
import { box } from '../theme';
import type { BotFrame, Look } from '../vendor/bloub/engine';
import type { ArcRender, ArcSeed } from '../vendor/bloub/decor';

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

type Expr = import('../vendor/bloub/expressions').BotExpression;

type Kit = {
  BotEngine: typeof import('../vendor/bloub/engine').BotEngine;
  arcRender: typeof import('../vendor/bloub/decor').arcRender;
  /** Three of the engine's orbit rings, slowed to a calm working pace. */
  runRings: ArcSeed[];
  scale: number;
  radii: (shape: BloubShape) => number[] | null;
  /** The resting face: short slanted capsules, close to Grok's eyes. */
  neutral: Expr;
  /** A soft happy squint, held for a moment now and then. */
  squint: Expr;
  /** One eye closed to a short line, the other open. */
  wink: [Expr, Expr];
};

let kit: Kit | null | undefined;

/**
 * The engine precomputes its eye tables when first evaluated. Loading it on the
 * first moving face keeps that work out of app start-up; a missing engine
 * leaves the still frames in place.
 */
function loadKit(): Kit | null {
  if (kit !== undefined) return kit;
  try {
    const engine = require('../vendor/bloub/engine') as typeof import('../vendor/bloub/engine');
    const decor = require('../vendor/bloub/decor') as typeof import('../vendor/bloub/decor');
    const repere = require('../vendor/bloub/repere') as typeof import('../vendor/bloub/repere');
    const skins = require('../vendor/bloub/skins') as typeof import('../vendor/bloub/skins');
    const expressions = require('../vendor/bloub/expressions') as typeof import('../vendor/bloub/expressions');
    const neutre = expressions.EXPRESSION_BY_ID.get('neutre');
    const heureux = expressions.EXPRESSION_BY_ID.get('heureux');
    if (!neutre || !heureux) throw new Error('bloub expressions missing');
    // The vendored 0.186 x 0.412 capsule reads as a long slash on a small
    // avatar. These eyes are about 1.5 : 1, slanted by the head roll. Every
    // custom face keeps the id 'neutre': the engine's eye-fit table is keyed
    // by expression id.
    const neutral: Expr = {
      ...neutre,
      id: 'neutre',
      gaze: { yaw: 24, pitch: 18, roll: -10 },
      eyes: [
        { ...neutre.eyes[0], w: 0.2, h: 0.31 },
        { ...neutre.eyes[1], w: 0.2, h: 0.31 },
      ],
    };
    const squint: Expr = {
      ...expressions.blendExpression(neutral, heureux, 0.5),
      id: 'neutre',
      gaze: neutral.gaze,
    };
    const winkOf = (side: 0 | 1): Expr => ({
      ...neutral,
      eyes: neutral.eyes.map((eye, index) => (
        index === side ? { ...eye, w: 0.34, h: 0.09 } : eye
      )) as Expr['eyes'],
    });
    kit = {
      BotEngine: engine.BotEngine,
      arcRender: decor.arcRender,
      // The vendored rings turn about 3.3 times a second, which reads as a
      // flash on a small avatar. At a sixth of that a ring takes about two
      // seconds per turn.
      runRings: decor.RINGS.slice(0, 3).map((ring) => ({ ...ring, speed: ring.speed * RUN_RING_PACE })),
      scale: repere.RAYON,
      radii: (shape) => skins.SHAPE_BY_ID.get(shape)?.radii ?? null,
      neutral,
      squint,
      wink: [winkOf(0), winkOf(1)],
    };
  } catch {
    kit = null;
  }
  return kit ?? null;
}

/**
 * One display-synced clock for every face on screen, capped near 30 fps and
 * running only while a face is mounted.
 */
const MIN_FRAME_MS = 30;
const listeners = new Set<(now: number) => void>();
const hasRaf = typeof requestAnimationFrame === 'function';
let pending: { cancel: () => void } | null = null;
let lastTick = 0;
const clock = () => Date.now() / 1000;

function tick() {
  pending = null;
  if (!listeners.size) return;
  const ms = Date.now();
  if (ms - lastTick >= MIN_FRAME_MS) {
    lastTick = ms;
    const now = ms / 1000;
    listeners.forEach((fn) => fn(now));
  }
  schedule();
}

function schedule() {
  if (pending || !listeners.size) return;
  if (hasRaf) {
    const id = requestAnimationFrame(tick);
    pending = { cancel: () => cancelAnimationFrame(id) };
  } else {
    const id = setTimeout(tick, 33);
    pending = { cancel: () => clearTimeout(id) };
  }
}

function onFrame(listener: (now: number) => void) {
  listeners.add(listener);
  schedule();
  return () => {
    listeners.delete(listener);
    if (!listeners.size && pending) {
      pending.cancel();
      pending = null;
    }
  };
}

function seedOf(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** A small seeded generator, so every face moves differently but repeatably. */
function randomFrom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** The engine's blink table ends at 900 s; faces rewind well before it. */
const REWIND_AT = 840;
/** Half the engine's own canvas: rings reach about 1.45 R from the centre. */
const HALF_VIEW = 158;
/** Seconds a glance takes; the engine eases it out, fast first, then settles. */
const LOOK_SECONDS = 1.1;
/** Fraction of the engine's ring speed used while the agent works. */
const RUN_RING_PACE = 0.16;
/** Seconds the working rings take to fade in or out. */
const RING_FADE = 0.4;
/**
 * Smallest avatar, in points, that draws the working rings: the conversation
 * list (42) shows them, the chat header (33) and the typing row stay plain.
 */
const RING_MIN_PX = 40;

const easeInOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

type Gaze = { yaw: number; pitch: number };
type ActKind = 'wink' | 'tour' | 'squint';
type Act = { kind: ActKind; at: number; until: number };
const ACT_SECONDS: Record<ActKind, number> = { wink: 0.6, tour: 1.5, squint: 1 };

/**
 * Drives one face. The engine is a pure function of time and already blinks,
 * drifts the gaze and breathes; this decides where the face looks and when it
 * does something. The body stays put while the eyes travel over it, which
 * reads as the head turning: rest in the upper right, then a glance left, down
 * or up, and back. Every 5-9 s it does one small thing: a wink, a squint, or a
 * spin that carries both eyes once round the ball (round faces only). Coloured
 * rings appear only while the agent works: the face looks up and to the right
 * and three slow rings fade in around it, then fade out when it is done.
 */
class FaceDriver {
  private engine: InstanceType<Kit['BotEngine']>;
  private readonly rand: () => number;
  private readonly offset: number;
  private readonly ringEpoch: number;
  private origin: number;
  private active = false;
  /** Ring opacity when `active` last changed, and when that was. */
  private ringFrom = 0;
  private ringAt = 0;
  private expr: Expr;
  private readonly rest: Gaze;
  private readonly busy: Gaze;
  private goal: Gaze;
  private away = false;
  private turn: number;
  private lookAt: number;
  private nextLookAt: number;
  private nextActAt: number;
  private act: Act | null = null;

  constructor(
    private readonly tools: Kit,
    private readonly shape: BloubShape,
    seed: number,
    now: number,
    private readonly rings: boolean,
  ) {
    this.expr = tools.neutral;
    this.engine = this.build();
    this.rand = randomFrom(seed);
    // Faces share the engine's blink table; a per-face offset keeps them
    // from blinking in unison.
    this.offset = 2 + (seed % 5800) / 100;
    this.origin = now;
    // Rings keep their own clock, so a rewind never makes them jump, and a
    // per-face start keeps two working faces from turning in step.
    this.ringEpoch = now - (seed % 997) / 100;
    this.turn = seed % 3;
    const t = this.offset;
    this.rest = { yaw: this.span(22, 28), pitch: this.span(16, 22) };
    this.busy = { yaw: this.span(14, 20), pitch: this.span(30, 34) };
    this.goal = this.rest;
    this.snapLook(t);
    this.lookAt = t - LOOK_SECONDS;
    this.nextLookAt = t + this.span(0.8, 2.4);
    this.nextActAt = t + this.span(3, 7);
  }

  private span(lo: number, hi: number) {
    return lo + (hi - lo) * this.rand();
  }

  private build() {
    const { BotEngine, scale, radii } = this.tools;
    return new BotEngine(scale, 'idle', radii(this.shape), this.expr);
  }

  private look(gaze: Gaze, spin = 0): Look {
    return { yaw: gaze.yaw, pitch: gaze.pitch, mix: 1, spin, wander: 0.7 };
  }

  /** Sets the look so it is already reached at `t`. */
  private snapLook(t: number, spin = 0) {
    this.engine.setLook(this.look(this.goal, spin), t - 1 / 60, 1 / 60);
  }

  private wear(expr: Expr, t: number) {
    this.expr = expr;
    this.engine.setExpression(expr, t);
  }

  private time(now: number) {
    let t = this.offset + Math.max(0, now - this.origin);
    if (t <= REWIND_AT) return t;
    this.endAct(t);
    const delta = t - this.offset;
    this.engine = this.build();
    this.origin = now;
    t = this.offset;
    this.lookAt -= delta;
    this.nextLookAt -= delta;
    this.nextActAt -= delta;
    this.snapLook(t);
    return t;
  }

  /**
   * Looks away from rest or back to it. The way out takes turns, left, down,
   * then up, so every face visibly turns its head within a few glances.
   */
  private glance(t: number) {
    let hold: number;
    if (this.away) {
      this.goal = this.rest;
      this.away = false;
      hold = this.span(1.4, 3.2);
    } else {
      const pick = this.turn;
      this.turn = (this.turn + 1) % 3;
      if (pick === 0) this.goal = { yaw: this.span(-18, -6), pitch: this.span(12, 20) };
      else if (pick === 1) this.goal = { yaw: this.rest.yaw, pitch: this.span(0, 8) };
      else this.goal = { yaw: this.span(8, 16), pitch: this.span(28, 32) };
      this.away = true;
      hold = this.span(1.2, 3);
    }
    this.engine.setLook(this.look(this.goal), t, this.span(LOOK_SECONDS, LOOK_SECONDS + 0.1));
    this.lookAt = t;
    this.nextLookAt = t + LOOK_SECONDS + hold;
  }

  private startAct(t: number) {
    const r = this.rand();
    let kind: ActKind = r < 0.5 ? 'wink' : r < 0.8 ? 'tour' : 'squint';
    // A spin starts from a settled look, so the eyes do not jump into it.
    if (kind === 'tour' && (this.shape !== 'cercle' || t - this.lookAt < 1.2)) {
      kind = r < 0.65 ? 'wink' : 'squint';
    }
    this.act = { kind, at: t, until: t + ACT_SECONDS[kind] };
    if (kind === 'wink') this.wear(this.tools.wink[this.rand() < 0.5 ? 0 : 1], t);
    else if (kind === 'squint') this.wear(this.tools.squint, t);
  }

  private endAct(t: number) {
    const act = this.act;
    if (!act) return;
    this.act = null;
    if (act.kind === 'tour') this.snapLook(t);
    else this.wear(this.tools.neutral, t);
    this.nextActAt = t + this.span(5, 9);
    this.nextLookAt = Math.max(this.nextLookAt, t + 0.6);
  }

  private update(t: number) {
    const act = this.act;
    if (act) {
      if (t >= act.until) this.endAct(t);
      else if (act.kind === 'tour') {
        // 360 deg is the same angle as 0, so the spin starts and ends in place.
        const p = (t - act.at) / (act.until - act.at);
        this.snapLook(t, 360 * (1 - easeInOutCubic(p)));
      }
      return;
    }
    if (t >= this.nextActAt) this.startAct(t);
    else if (t >= this.nextLookAt) this.glance(t);
  }

  setActive(active: boolean, now: number) {
    if (active === this.active) return false;
    const t = this.time(now);
    this.ringFrom = this.ringLevel(now);
    this.ringAt = now;
    this.active = active;
    if (active) {
      const act = this.act;
      this.act = null;
      if (this.expr !== this.tools.neutral) this.wear(this.tools.neutral, t);
      // Working: the face turns up and to the right, towards the rings, and
      // holds there. The body never changes into the engine's thinking dots.
      this.goal = this.busy;
      this.away = false;
      this.engine.setLook(this.look(this.busy), t, act?.kind === 'tour' ? 0.3 : 0.6);
    } else {
      this.goal = this.rest;
      this.away = false;
      this.engine.setLook(this.look(this.rest), t, 0.8);
      this.lookAt = t;
      this.nextLookAt = t + this.span(0.8, 2);
      this.nextActAt = t + this.span(3, 6);
    }
    return true;
  }

  /** Ring opacity, easing towards 1 while working and towards 0 at rest. */
  private ringLevel(now: number) {
    const k = Math.min(1, Math.max(0, (now - this.ringAt) / RING_FADE));
    return this.ringFrom + ((this.active ? 1 : 0) - this.ringFrom) * k;
  }

  frame(now: number): BotFrame {
    const t = this.time(now);
    if (!this.active) this.update(t);
    const base = this.engine.sample(t);
    const level = this.rings ? this.ringLevel(now) : 0;
    if (level <= 0.01) return base;
    const rt = now - this.ringEpoch;
    const { arcRender, runRings, scale } = this.tools;
    const arcs: ArcRender[] = runRings.map((seed, index) => arcRender(seed, rt, scale, `run${index}`, level));
    return { ...base, arcs: [...base.arcs, ...arcs] };
  }
}

function sameFrame(a: BotFrame, b: BotFrame) {
  if (a.bodyPath !== b.bodyPath || a.bodyAlpha !== b.bodyAlpha || a.dotsBehind !== b.dotsBehind) return false;
  if (a.eyes.length !== b.eyes.length || a.dots.length !== b.dots.length || a.arcs.length !== b.arcs.length) return false;
  for (let i = 0; i < a.eyes.length; i += 1) {
    const p = a.eyes[i];
    const q = b.eyes[i];
    if (p.d !== q.d || p.matrix !== q.matrix || p.alpha !== q.alpha) return false;
  }
  for (let i = 0; i < a.dots.length; i += 1) {
    const p = a.dots[i];
    const q = b.dots[i];
    if (p.x !== q.x || p.y !== q.y || p.r !== q.r || p.opacity !== q.opacity || p.d !== q.d || p.rot !== q.rot) return false;
  }
  for (let i = 0; i < a.arcs.length; i += 1) {
    const p = a.arcs[i];
    const q = b.arcs[i];
    if (p.id !== q.id || p.front !== q.front || p.back !== q.back || p.opacity !== q.opacity) return false;
  }
  const samePoint = (p: BotFrame['notif'], q: BotFrame['notif']) => (
    p === q || (!!p && !!q && p.x === q.x && p.y === q.y && p.r === q.r)
  );
  return samePoint(a.notif, b.notif) && samePoint(a.notch, b.notch);
}

type FaceProps = {
  shape: BloubShape;
  color: string;
  active: boolean;
  px: number;
  view: number;
  maskId: string;
  tools: Kit;
};

/**
 * A face the engine redraws on every frame. It draws on the engine's own
 * +-158 canvas, enlarged and centred so the body matches the still frame; the
 * extra margin, outside the avatar's box, is where the rings pass.
 */
function LiveFace({ shape, color, active, px, view, maskId, tools }: FaceProps) {
  const [driver] = useState(() => new FaceDriver(tools, shape, seedOf(`${shape}:${color}`), clock(), px >= RING_MIN_PX));
  const [frame, setFrame] = useState(() => {
    const now = clock();
    driver.setActive(active, now);
    return driver.frame(now);
  });

  useEffect(() => {
    const now = clock();
    if (driver.setActive(active, now)) setFrame(driver.frame(now));
  }, [active, driver]);

  useEffect(() => onFrame((now) => {
    const next = driver.frame(now);
    setFrame((current) => (sameFrame(current, next) ? current : next));
  }), [driver]);

  const size = (px * HALF_VIEW) / view;
  const inset = (px - size) / 2;
  const span = HALF_VIEW * 2;
  const dots = frame.dots.map((dot, index) => (
    dot.d ? (
      <Path
        key={index}
        d={dot.d}
        transform={`translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${tools.scale})`}
        fill={dot.color ?? color}
        opacity={dot.opacity}
      />
    ) : (
      <Circle key={index} cx={dot.x} cy={dot.y} r={dot.r} fill={dot.color ?? color} opacity={dot.opacity} />
    )
  ));
  const ring = (side: 'front' | 'back') => frame.arcs.map((arc) => (
    <Path
      key={`${side}-${arc.id}`}
      d={arc[side]}
      fill="none"
      stroke={`url(#${maskId}-${arc.id})`}
      strokeWidth={arc.width}
      strokeLinecap="round"
      opacity={arc.opacity}
    />
  ));

  return (
    <View style={{ width: px, height: px }} pointerEvents="none">
      <Svg
        width={size}
        height={size}
        viewBox={`${-HALF_VIEW} ${-HALF_VIEW} ${span} ${span}`}
        style={{ position: 'absolute', left: inset, top: inset }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Defs>
          <Mask id={maskId} maskUnits="userSpaceOnUse" x={-HALF_VIEW} y={-HALF_VIEW} width={span} height={span}>
            <Path d={frame.bodyPath} fill="#fff" />
            {frame.eyes.map((eye, index) => (
              <Path key={index} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
            ))}
            {frame.notch ? <Circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" /> : null}
          </Mask>
          {frame.arcs.map((arc) => (
            <LinearGradient
              key={arc.id}
              id={`${maskId}-${arc.id}`}
              gradientUnits="userSpaceOnUse"
              x1={arc.grad.x1}
              y1={arc.grad.y1}
              x2={arc.grad.x2}
              y2={arc.grad.y2}
            >
              {arc.grad.stops.map((stop, index, all) => (
                <Stop key={index} offset={all.length > 1 ? index / (all.length - 1) : 0} stopColor={stop} />
              ))}
            </LinearGradient>
          ))}
        </Defs>
        {ring('back')}
        {frame.dotsBehind ? dots : null}
        <G opacity={frame.bodyAlpha}>
          <Path d={frame.bodyPath} fill={EYE_PAPER} />
          <G mask={`url(#${maskId})`}>
            <Rect x={-HALF_VIEW} y={-HALF_VIEW} width={span} height={span} fill={color} />
          </G>
        </G>
        {frame.dotsBehind ? null : dots}
        {frame.notif ? <Circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill="#2496e8" /> : null}
        {ring('front')}
      </Svg>
    </View>
  );
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
  const tools = moving ? loadKit() : null;
  // Without the engine, a gentle whole-body sway keeps the still face alive.
  const swaying = moving && !tools;
  const motion = useRef(new Animated.Value(0)).current;
  const sway = { lift: active ? 0.10 : 0.065, turn: active ? '8deg' : '5deg', wide: active ? 1.07 : 1.045, flat: active ? 0.93 : 0.96 };

  useEffect(() => {
    motion.setValue(0);
    if (!swaying) return;
    // Transform only: iOS drives this on the UI thread, without rerendering the
    // SVG paths or blocking interactions. Offscreen navigation stops the loop.
    const duration = active ? 620 : 1400 + (shape.length % 4) * 170;
    const step = (toValue: number) => Animated.timing(motion, {
      toValue, duration, easing: Easing.inOut(Easing.sin),
      useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    });
    const loop = Animated.loop(Animated.sequence([step(1), step(0)]));
    loop.start();
    return () => { loop.stop(); motion.setValue(0); };
  }, [active, motion, swaying, shape]);

  return (
    <Animated.View
      testID={moving ? (active ? 'avatar-thinking' : 'avatar-idle') : 'avatar-still'}
      style={swaying ? { width: px, height: px, transform: [
        { translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [0, -px * sway.lift] }) },
        { rotate: motion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', sway.turn] }) },
        { scaleX: motion.interpolate({ inputRange: [0, 1], outputRange: [1, sway.wide] }) },
        { scaleY: motion.interpolate({ inputRange: [0, 1], outputRange: [1, sway.flat] }) },
      ] } : { width: px, height: px }}
    >
      {tools ? (
        <LiveFace
          key={`${shape}:${color}`}
          shape={shape}
          color={color}
          active={active}
          px={px}
          view={view}
          maskId={maskId}
          tools={tools}
        />
      ) : (
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
      )}
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
