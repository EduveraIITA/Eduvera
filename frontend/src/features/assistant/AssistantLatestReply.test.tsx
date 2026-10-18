import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AssistantLatestReply } from './AssistantLatestReply';

afterEach(cleanup);

describe('latest full-screen reply', () => {
  it('places the animated mark above the highlighted answer, not inside its border', () => {
    const {container} = render(<AssistantLatestReply><p>Latest answer</p></AssistantLatestReply>);
    const mark = container.querySelector('.assistant-latest-reply__mark')!;
    const icon = mark.querySelector('.assistant-brand-icon');
    const border = container.querySelector('.assistant-electric-border')!;

    expect(icon).toHaveAttribute('width', '26');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(mark.nextElementSibling).toBe(border);
    expect(border).toContainElement(screen.getByText('Latest answer'));
    expect(border.querySelector('.assistant-brand-icon')).toBeNull();
  });
});
