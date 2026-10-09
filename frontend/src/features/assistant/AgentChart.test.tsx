import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,expect,it } from 'vitest';
import { AgentChart } from './AgentChart';
import type { AgentChartData } from './agentApi';

const chartFixture:AgentChartData={kind:'bar',title:'Recorded attendance by subject',scope:'Aarav Sharma',from:'2026-04-01',to:'2026-10-09',unit:'percent',points:[{label:'Mathematics',value:91.25,detail:'73 of 80 projected lessons'},{label:'Art',value:null,detail:'0 of 0 projected lessons'}],note:'Projected from daily records, not direct lesson observations.',total:2,shown:2};
afterEach(cleanup);
describe('verified agent charts',()=>{
  it('keeps null distinct from zero, with accessible labels and full-view source numbers',()=>{
    render(<AgentChart chart={chartFixture}/>);
    expect(screen.getByRole('heading',{name:chartFixture.title})).toBeVisible();
    expect(screen.getByText(/Aarav Sharma/)).toBeVisible();
    fireEvent.click(screen.getByText('Chart data'));
    expect(screen.getByRole('table')).toHaveTextContent('91.25%');
    expect(screen.getByRole('table')).toHaveTextContent('Not recorded');
    expect(screen.getByRole('table')).toHaveTextContent('73 of 80 projected lessons');
    expect(screen.getByText(chartFixture.note)).toBeVisible();
  });
  it('keeps the compact view non-interactive and labels truncated comparisons',()=>{
    render(<AgentChart compact chart={{...chartFixture,total:12}}/>);
    expect(screen.queryByText('Chart data')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 12/)).toBeVisible();
    expect(document.querySelector('button,a,input,summary')).toBeNull();
  });
  it('renders a complete record donut and a trend with a missing-period gap',()=>{
    const view=render(<AgentChart compact chart={{...chartFixture,kind:'donut',unit:'records',points:[{label:'Present',value:10,detail:'records'},{label:'Absent',value:2,detail:'records'}]}}/>);
    expect(screen.getByRole('figure')).toHaveAccessibleName(/12 records.*Present: 10.*Absent: 2/);
    view.rerender(<AgentChart compact chart={{...chartFixture,kind:'line',points:[{label:'Apr',date:'2026-04-01',end:'2026-04-30',value:90,detail:'9 of 10 days'},{label:'May',date:'2026-05-01',end:'2026-05-31',value:null,detail:'not recorded'},{label:'Jun',date:'2026-06-01',end:'2026-06-30',value:95,detail:'19 of 20 days'}]}}/>);
    expect(screen.getByRole('figure')).toHaveAccessibleName(/Missing periods are gaps, not zero/);
    expect(document.querySelectorAll('.analytics-trend__line')).toHaveLength(2);
  });
});
