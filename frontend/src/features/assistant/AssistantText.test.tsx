import { cleanup,render,screen } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import type { AgentChartData } from './agentApi';
import { AssistantText,prepareAssistantText } from './AssistantText';

const chart:AgentChartData={
  kind:'bar',title:'Recorded attendance by subject',scope:'Aarav Sharma',from:'2026-04-01',to:'2026-10-09',unit:'percent',
  points:[{label:'Physical Education',value:98.18,detail:'54 of 55 projected lessons'},{label:'Mathematics',value:89.47,detail:'51 of 57 projected lessons'}],
  note:'Subject attendance is projected from daily records.',total:2,shown:2,
};

afterEach(cleanup);

describe('assistant text presentation',()=>{
  it('renders safe semantic Markdown without exposing its syntax',()=>{
    render(<AssistantText text={'### Key points\n\n* **Attendance:** 95.3%\n* Follow up with Class 7A'}/>);
    expect(screen.getByRole('heading',{name:'Key points'})).toBeVisible();
    expect(screen.getByRole('list')).toBeVisible();
    expect(screen.getByText('Attendance:')).toBeVisible();
    expect(screen.queryByText(/^\*/)).not.toBeInTheDocument();
  });

  it('replaces duplicated chart narration with a verified two-point summary',()=>{
    const raw="Aarav Sharma's subject attendance is summarized below.\n\n* **Physical Education:** 98.18%\n* **Mathematics:** 89.47%\n\nThe chart has been generated. Please review the chart for a visual comparison.";
    const result=prepareAssistantText(raw,chart);
    expect(result).toBe('Physical Education is highest at **98.2%**. Mathematics is lowest at **89.5%**.');
    render(<AssistantText text={raw} chart={chart}/>);
    expect(screen.getByText(/Physical Education is highest/)).toBeVisible();
    expect(screen.queryByText(/chart has been generated/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('drops punctuation-only model debris',()=>{
    expect(prepareAssistantText('Useful answer.\n\n;')).toBe('Useful answer.');
  });
});
