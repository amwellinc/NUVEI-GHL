const { REGION_SELECTOR_STYLES } = require('./checkoutStyles');

describe('REGION_SELECTOR_STYLES', () => {
  test('defines a visibly-filled, high-contrast option style distinct from a plain white card', () => {
    // Regression guard for the "barely visible, blends into the white card"
    // report — an unchecked option must have its own background fill, not
    // just a thin border on transparent/white.
    expect(REGION_SELECTOR_STYLES).toContain('--region-bg: #f3f4f6');
    expect(REGION_SELECTOR_STYLES).toContain('border:2px solid var(--region-border)');
  });

  test('enlarges the native radio input and the touch target beyond browser defaults', () => {
    expect(REGION_SELECTOR_STYLES).toContain('--region-radio-size: 24px');
    expect(REGION_SELECTOR_STYLES).toContain('min-height:64px');
  });

  test('gives a clearly distinct selected state', () => {
    expect(REGION_SELECTOR_STYLES).toContain('.region-option:has(input:checked)');
    expect(REGION_SELECTOR_STYLES).toContain('--region-bg-selected: #ede9fe');
  });

  test('stacks to a single column on narrow viewports instead of squeezing text', () => {
    expect(REGION_SELECTOR_STYLES).toMatch(/@media \(max-width:420px\)\{\.region-row\{grid-template-columns:1fr\}\}/);
  });
});
