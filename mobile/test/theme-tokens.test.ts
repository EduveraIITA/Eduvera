import assert from 'node:assert/strict';
import test from 'node:test';
import { productIconAppearance, productIconIdentityTones, type ProductIconIdentity, themePalettes } from '../src/ui/theme-tokens';

function luminance(color: string): number {
  assert.match(color, /^#[0-9a-f]{6}$/i);
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722;
}

test('body, links, filled actions and semantic labels remain readable in all four native theme modes', () => {
  for (const [world, appearances] of Object.entries(themePalettes)) {
    for (const [appearance, colors] of Object.entries(appearances)) {
      for (const [ink, surface] of [
        [colors.ink, colors.canvas], [colors.link, colors.canvas], [colors.onAction, colors.action],
        [colors.positive, colors.positiveSoft], [colors.warning, colors.warningSoft], [colors.danger, colors.dangerSoft],
      ]) {
        const [lighter, darker] = [luminance(ink!), luminance(surface!)].sort((a, b) => b - a);
        const ratio = (lighter! + .05) / (darker! + .05);
        assert.ok(ratio >= 4.5, `${world}/${appearance} ${ink} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
  }
});

test('feature accents, neutral controls and explicit status remain readable in all four theme modes', () => {
  for (const [world, appearances] of Object.entries(themePalettes)) {
    for (const [appearance, colors] of Object.entries(appearances)) {
      for (const role of [...Object.keys(productIconIdentityTones), 'neutral', 'status-positive'] as ProductIconIdentity[]) {
        const icon = productIconAppearance(role, colors, appearance === 'dark');
        for (const surface of [icon.fill, colors.canvas, colors.row, colors.surface]) {
          const [lighter, darker] = [luminance(icon.ink), luminance(surface)].sort((a, b) => b - a);
          const ratio = (lighter! + .05) / (darker! + .05);
          assert.ok(ratio >= 3, `${world}/${appearance}/${role} ${icon.ink} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      assert.deepEqual(productIconAppearance('neutral', colors, appearance === 'dark'), { ink: colors.muted, fill: colors.surfaceSoft });
      assert.deepEqual(productIconAppearance('status-positive', colors), { ink: colors.positive, fill: colors.positiveSoft });
    }
  }
});
