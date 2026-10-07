import { useState } from 'react';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { DateNavigation } from './DateNavigation';
import { shiftDatePeriod, visibleDates } from './dateMath';

afterEach(cleanup);
function Demo({compact=false}:{compact?:boolean}) {
  const [date,setDate]=useState('2026-10-31');
  const [view,setView]=useState<'day'|'month'>('day');
  return <DateNavigation date={date} today="2026-10-08" view={view} onViewChange={setView} onDateChange={setDate} compact={compact}/>;
}
it('uses the same selected date circle in the week and month and stable action ordering',async()=>{
  const {container}=render(<Demo/>);
  const selected=screen.getByRole('button',{name:'Saturday, 31 October'});
  expect(selected).toHaveClass('date-navigation__day');
  expect(selected).toHaveAttribute('aria-pressed','true');
  expect(within(container.querySelector('.date-navigation__actions') as HTMLElement).getAllByRole('button').map(button=>button.getAttribute('aria-label'))).toEqual(['Go to today, Thursday, 8 October','Previous week','Next week']);
  await userEvent.click(screen.getByRole('button',{name:'Expand calendar',exact:true}));
  expect(screen.getByRole('button',{name:'Saturday, 31 October'})).toHaveClass('date-navigation__day');
  expect(screen.getByRole('button',{name:'Thursday, 8 October, today'})).toHaveAttribute('aria-current','date');
});
it('moves focus across month boundaries with the keyboard and returns focus on Escape',async()=>{
  render(<Demo/>);
  await userEvent.click(screen.getByRole('button',{name:'Expand calendar',exact:true}));
  screen.getByRole('button',{name:'Saturday, 31 October'}).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('button',{name:'Sunday, 1 November'})).toHaveFocus();
  expect(screen.getByRole('button',{name:'Sunday, 1 November'})).toHaveAttribute('aria-pressed','true');
  await userEvent.keyboard('{Escape}');
  expect(screen.getByRole('button',{name:'Expand calendar'})).toHaveAttribute('aria-expanded','false');
  expect(screen.getByLabelText('Choose date', {selector: 'input'})).toHaveFocus();
});
it('separates native date picking from inline expansion and hides Today after returning',async()=>{
  render(<Demo/>);
  fireEvent.change(screen.getByLabelText('Choose date', {selector: 'input'}),{target:{value:'2026-11-15'}});
  expect(screen.getByRole('button',{name:'Expand calendar'})).toHaveAttribute('aria-expanded','false');
  await userEvent.click(screen.getByRole('button',{name:'Expand calendar'}));
  fireEvent.change(screen.getByLabelText('Choose date', {selector: 'input'}),{target:{value:'2026-12-15'}});
  expect(screen.getByRole('button',{name:'Collapse calendar'})).toHaveAttribute('aria-expanded','true');
  await userEvent.click(screen.getByRole('button',{name:/Go to today/}));
  expect(screen.getByLabelText('Choose date', {selector: 'input'})).toHaveValue('2026-10-08');
  expect(screen.queryByRole('button',{name:/Go to today/})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Expand calendar'})).toHaveAttribute('aria-expanded','false');
});
it('clamps month/year transitions, handles leap years, and uses Monday-first weeks',()=>{
  expect(shiftDatePeriod('2026-01-31','month',1)).toBe('2026-02-28');
  expect(shiftDatePeriod('2024-02-29','year',1)).toBe('2025-02-28');
  expect(shiftDatePeriod('2026-12-31','day',1)).toBe('2027-01-01');
  expect(visibleDates('2026-10-08','day')).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
  expect(visibleDates('2024-02-15','month')).toHaveLength(29);
});
