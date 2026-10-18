import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QRScanner from './QRScanner';

describe('QRScanner', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('keeps the native file control hidden behind the responsive gallery action', () => {
    render(<QRScanner hindi={false} onScan={vi.fn()} />);

    const input = screen.getByLabelText('Choose a QR photo from gallery');
    expect(input).toHaveAttribute('hidden');
    expect(input).toHaveStyle({ display: 'none' });
    expect(input).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: 'Gallery' })).toBeInTheDocument();
  });
});
