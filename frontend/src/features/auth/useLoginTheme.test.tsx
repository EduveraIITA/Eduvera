import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoginTheme } from './useLoginTheme';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

function ThemeProbe() {
  return <span>{useLoginTheme() ? 'dark' : 'light'}</span>;
}

describe('login theme subscription', () => {
  it('supports the legacy MediaQueryList listener API', () => {
    const addListener = vi.fn();
    const removeListener = vi.fn();
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addListener,
      removeListener,
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    const {unmount} = render(<ThemeProbe/>);
    expect(screen.getByText('light')).toBeVisible();
    expect(addListener).toHaveBeenCalledOnce();

    unmount();
    expect(removeListener).toHaveBeenCalledOnce();
  });
});
