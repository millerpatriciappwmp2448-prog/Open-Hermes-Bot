const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const React = require('react');
const { act, create } = require('react-test-renderer');
const harness = require('./helpers/native-screen-harness.cjs');
const { Bloub } = require('../src/components/Bloub.tsx');
const { AvatarMotionProvider } = require('../src/components/AvatarMotion.tsx');
const { BLOUB_SHAPES } = require('../src/bloubFrames.ts');

const realNow = Date.now;
let now = 100000;
Date.now = () => now;
const trees = new Set();
const element = (props) => React.createElement(AvatarMotionProvider, null,
  React.createElement(Bloub, { color: '#8b5cf6', size: 64, animated: true, ...props }));
async function mount(props) {
  harness.native.AccessibilityInfo.isReduceMotionEnabled = async () => false;
  let tree;
  await act(async () => { tree = create(element(props)); });
  trees.add(tree);
  return tree;
}
async function step(ms = 100) {
  now += ms;
  await act(async () => harness.flushFrames());
}
function rings(tree) {
  return tree.root.findAllByType('Path').filter(node => node.props.stroke?.startsWith('url('));
}
function pose(tree) {
  const body = tree.root.findAllByType('G').find(node => node.props.opacity != null &&
    node.findAllByType('Rect').length > 0);
  return body?.props.transform ?? '';
}
afterEach(async () => {
  for (const tree of trees) await act(async () => tree.unmount());
  trees.clear();
  assert.equal(harness.pendingFrames(), 0, 'offscreen faces release their shared clock');
});
process.on('exit', () => { Date.now = realNow; });

test('every thinking shape keeps moving without squashing or shearing while its rings orbit', async () => {
  for (const shape of BLOUB_SHAPES) {
    const tree = await mount({ shape, active: true });
    await step(500);
    const poses = new Set();
    const eyes = new Set();
    const arcs = new Set();
    for (let i = 0; i < 60; i++) {
      await step();
      poses.add(pose(tree));
      eyes.add(tree.root.findByType('Mask').findAllByType('Path').slice(1).map(n => n.props.transform).join('|'));
      arcs.add(rings(tree).map(n => n.props.d).join('|'));
      assert.equal(rings(tree).length, 6, `${shape}: three rings split front/back`);
    }
    assert.ok(poses.size > 40, `${shape}: thinking must animate the body, not only eyes and rings (${poses.size} poses)`);
    assert.ok(eyes.size > 40, `${shape}: the gaze continues turning`);
    assert.ok(arcs.size > 40, `${shape}: rings continue independently`);
    // Thinking must not turn the selected shape into a stretched/skewed face.
    // Inspect the transform actually passed to SVG, independently of the driver.
    const turns = [];
    for (const transform of poses) {
      const scale = transform.match(/scale\(([-\d.]+)(?:[ ,]+([-\d.]+))?\)/);
      const sx = scale ? Number(scale[1]) : 1;
      const sy = scale ? Number(scale[2] ?? scale[1]) : 1;
      assert.ok(Math.abs(sx - sy) < 0.005, `${shape}: preserve aspect ratio (${sx}, ${sy})`);
      assert.ok(Math.abs(sx - 1) < 0.02, `${shape}: no large body stretching`);
      const shear = Number(transform.match(/skewX\(([-\d.]+)\)/)?.[1] ?? 0);
      assert.ok(Math.abs(shear) < 0.1, `${shape}: preserve silhouette without shear`);
      const turn = Number(transform.match(/rotate\(([-\d.]+)\)/)?.[1] ?? 0);
      assert.ok(Math.abs(turn) <= 4.1, `${shape}: head tilt stays gentle`);
      turns.push(turn);
    }
    assert.ok(Math.max(...turns) - Math.min(...turns) > 3, `${shape}: visible turning remains`);
    await act(async () => tree.unmount());
    trees.delete(tree);
  }
});

test('body keeps moving across repeated active/idle transitions and small faces have no rings', async () => {
  const tree = await mount({ size: 23 });
  for (const active of [true, false, true, false]) {
    await act(async () => tree.update(element({ size: 23, active })));
    const before = pose(tree);
    await step(500);
    assert.notEqual(pose(tree), before);
    assert.equal(rings(tree).length, 0, 'chat header stays free of orbit lines');
  }
});

test('working rings fade out after completion and reduced motion stops all face updates', async () => {
  const tree = await mount({ active: true });
  await step(500);
  assert.equal(rings(tree).length, 6);
  await act(async () => tree.update(element({ active: false })));
  await step(500);
  assert.equal(rings(tree).length, 0);
  await act(async () => tree.unmount());
  trees.delete(tree);
  harness.native.AccessibilityInfo.isReduceMotionEnabled = async () => true;
  let still;
  await act(async () => { still = create(element({ active: true })); });
  trees.add(still);
  assert.equal(still.root.findByType('Animated.View').props.testID, 'avatar-still');
  assert.equal(harness.pendingFrames(), 0);
});

test('unavailable face engine falls back to a slow sway without stretching the avatar', async () => {
  const Module = require('node:module');
  const file = require.resolve('../src/components/Bloub.tsx');
  const cached = require.cache[file];
  const load = Module._load;
  const interpolate = harness.native.Animated.Value.prototype.interpolate;
  const timing = harness.native.Animated.timing;
  const easing = harness.native.Easing;
  const durations = [];
  let tree;
  try {
    delete require.cache[file];
    Module._load = function (request, parent, isMain) {
      if (parent?.filename === file && request === '../vendor/bloub/engine') {
        throw new Error('face engine unavailable');
      }
      return load.call(this, request, parent, isMain);
    };
    // Render the end of the native animation, where the former squash peaked.
    harness.native.Animated.Value.prototype.interpolate = ({ outputRange }) => outputRange.at(-1);
    harness.native.Animated.timing = (value, options) => {
      durations.push(options.duration);
      return timing(value, options);
    };
    harness.native.Easing = { ...easing, sin: x => x, inOut: fn => fn };
    harness.native.AccessibilityInfo.isReduceMotionEnabled = async () => false;
    const { Bloub: FallbackFace } = require(file);
    const face = active => React.createElement(AvatarMotionProvider, null,
      React.createElement(FallbackFace, { size: 64, color: '#8b5cf6', animated: true, active }));
    await act(async () => { tree = create(face(true)); });
    for (const active of [true, false]) {
      await act(async () => tree.update(face(active)));
      const avatar = tree.root.findByType('Animated.View');
      assert.equal(avatar.props.testID, active ? 'avatar-thinking' : 'avatar-idle');
      const transform = Object.assign({}, ...avatar.props.style.transform);
      assert.equal(transform.scaleX ?? 1, transform.scaleY ?? 1, 'fallback must preserve aspect ratio');
      assert.ok(Math.abs(parseFloat(transform.rotate)) <= 4.1, 'fallback tilt stays gentle');
      assert.ok(Math.abs(transform.translateY) <= avatar.props.style.width * 0.03, 'no large bouncing');
    }
    assert.ok(durations.length >= 4);
    assert.ok(durations.every(duration => duration >= 2000), 'fallback must not shake rapidly');
    assert.equal(harness.pendingFrames(), 0, 'fallback uses native animation without the engine clock');
  } finally {
    if (tree) await act(async () => tree.unmount());
    Module._load = load;
    require.cache[file] = cached;
    harness.native.Animated.Value.prototype.interpolate = interpolate;
    harness.native.Animated.timing = timing;
    harness.native.Easing = easing;
  }
});
