import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { StudentAttendancePage, demoStudentAttendanceData, type StudentAttendanceData } from "./StudentAttendancePage";
import { TestQueryProvider } from "../../test/TestQueryProvider";

afterEach(cleanup);
function Location(){return <output data-testid="attendance-location">{useLocation().search}</output>;}
function mount(data:StudentAttendanceData=demoStudentAttendanceData,search='',onApplyMedicalExcuse?:()=>void){return render(<TestQueryProvider><MemoryRouter initialEntries={['/student/attendance'+search]}><Location/><StudentAttendancePage data={data} onApplyMedicalExcuse={onApplyMedicalExcuse}/></MemoryRouter></TestQueryProvider>);}

describe("StudentAttendancePage", () => {
  it('shows compact subject rows and reveals scheduling details only when opened',async()=>{
    const {container}=mount();
    expect(container.querySelector('.subject-progress')).toBeNull();
    expect(container.querySelector('.subject-icon')).toBeNull();
    expect(screen.queryByRole('tablist',{name:'Filter subjects'})).not.toBeInTheDocument();
    const subject=screen.getByText('Computer Science & AI Lab').closest('details')!;
    expect(within(subject).getByText('49 of 50 classes attended')).toBeVisible();
    expect(within(subject).getByText('98%')).toBeVisible();
    expect(within(subject).getByText('Prof. Alan Zhao')).not.toBeVisible();
    expect(within(subject).getByText('Safe buffer')).not.toBeVisible();
    await userEvent.setup().click(within(subject).getByText('Computer Science & AI Lab'));
    expect(within(subject).getByText('Prof. Alan Zhao')).toBeVisible();
    expect(within(subject).getByText('Today at 03:00 PM')).toBeVisible();
    expect(within(subject).getByText('Safe buffer')).toBeVisible();
    expect(within(subject).getByText('7',{selector:'.student-attendance-subject__metrics strong'})).toBeVisible();
    expect(within(subject).getByText('85%',{selector:'.student-attendance-subject__metrics strong'})).toBeVisible();
    expect(within(subject).queryByText('+7 classes safe buffer')).not.toBeInTheDocument();
    expect(within(subject).getByText(/Planning estimate only/)).toBeVisible();
    expect(screen.queryByText(/Eligible across/)).not.toBeInTheDocument();
  });

  it('shows subject warnings even when overall attendance is high and persists the filter',async()=>{
    const subject=demoStudentAttendanceData.subjects[0]!;
    mount({...demoStudentAttendanceData,subjects:[{...subject,id:'low',name:'Low subject',percent:80,attended:8,held:10},{...subject,id:'near',name:'Near subject',percent:88,attended:22,held:25},{...subject,id:'healthy',name:'Healthy subject',percent:96},{...subject,id:'unknown',name:'Unknown subject',percent:0,held:0,attended:0}]});
    expect(screen.getByText('94.4%')).toBeVisible();
    expect(screen.getByText('Below 85% minimum')).toBeVisible();
    expect(screen.getByText('Near minimum')).toBeVisible();
    await userEvent.setup().selectOptions(screen.getByRole('combobox',{name:'Filter subjects'}),'near');
    expect(screen.getByTestId('attendance-location')).toHaveTextContent('subjects=near');
    expect(screen.queryByText('Healthy subject')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown subject')).not.toBeInTheDocument();
    expect(screen.getByRole('option',{name:'Needs attention · 2'})).toBeInTheDocument();
  });

  it.each([
    {aggregate:94.4,label:'Above minimum',tone:'is-above'},
    {aggregate:86,label:'Near minimum',tone:'is-near'},
    {aggregate:80,label:'Below minimum',tone:'is-below'},
  ])('shows the overall percentage and meaningful minimum status: $label',({aggregate,label,tone})=>{
    mount({...demoStudentAttendanceData,aggregate});
    const overview=screen.getByRole('region',{name:/Overall attendance/});
    expect(within(overview).getByText(`${aggregate.toFixed(1)}%`)).toBeVisible();
    expect(within(overview).getByText(label).parentElement).toHaveClass(tone);
    expect(within(overview).getByText('85% required')).toBeVisible();
    expect(within(overview).getByText('119',{selector:'strong'})).toBeVisible();
    expect(within(overview).queryByText(/Eligible/)).not.toBeInTheDocument();
  });

  it('does not present missing attendance as zero or below the minimum',async()=>{
    const subject=demoStudentAttendanceData.subjects[0]!;
    mount({...demoStudentAttendanceData,aggregate:0,held:0,attended:0,subjects:[{...subject,held:0,attended:0,percent:0}]});
    expect(screen.getAllByText(/No attendance recorded/)).toHaveLength(2);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('Below 85% minimum')).not.toBeInTheDocument();
    expect(screen.queryByText('Overall attendance is below the minimum.')).not.toBeInTheDocument();
    expect(screen.queryByText('Safe buffer')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Plan an absence'));
    expect(screen.getByText('An estimate needs recorded attendance first.')).toBeVisible();
    expect(screen.queryByRole('group',{name:'Projected absences'})).not.toBeInTheDocument();
  });

  it('restores an empty group filter without claiming attendance is healthy',()=>{
    mount({...demoStudentAttendanceData,subjects:demoStudentAttendanceData.subjects.filter(item=>item.group==='core')},'?subjects=language');
    expect(screen.getByRole('combobox',{name:'Filter subjects'})).toHaveValue('language');
    expect(screen.getByText('No subjects in this group.')).toHaveAttribute('role','status');
  });

  it('distinguishes zero buffer from a positive class buffer without hiding the warning',async()=>{
    const subject=demoStudentAttendanceData.subjects[0]!;
    mount({...demoStudentAttendanceData,subjects:[
      {...subject,id:'zero',name:'At minimum',safeBuffer:0,percent:85,attended:17,held:20},
      {...subject,id:'low',name:'Below minimum',safeBuffer:0,percent:80,attended:16,held:20},
      {...subject,id:'one',name:'One class buffer',safeBuffer:1},
    ]});
    const user=userEvent.setup();
    for(const [name,tone,value,unit] of [['At minimum','is-near','0','classes'],['Below minimum','is-below','0','classes'],['One class buffer','is-safe','1','class']]){
      const row=screen.getByText(name!).closest('details')!;
      await user.click(within(row).getByText(name!));
      const metric=within(row).getByText('Safe buffer').parentElement!;
      expect(metric).toHaveClass(tone!);
      expect(within(metric).getByText(value!,{selector:'strong'})).toBeVisible();
      expect(within(metric).getByText(unit!)).toBeVisible();
    }
    expect(screen.getByText('Below 85% minimum')).toBeVisible();
  });

  it('retains leave and class standings through named options',async()=>{
    const apply=vi.fn();mount(demoStudentAttendanceData,'',apply);
    const user=userEvent.setup();
    await user.click(screen.getByRole('button',{name:'Apply for leave'}));expect(apply).toHaveBeenCalledOnce();
    // Safari pointer clicks do not automatically focus buttons.
    const trigger=screen.getByRole('button',{name:'Class attendance'});fireEvent.click(trigger);
    expect(screen.getByRole('dialog',{name:'Class 7A standings'})).toBeVisible();
    await user.keyboard('{Escape}');expect(trigger).toHaveFocus();
  });
  it("updates the projected aggregate through the accessible what-if stepper", async () => {
    const user = userEvent.setup();

    render(
      <TestQueryProvider><MemoryRouter>
        <StudentAttendancePage />
      </MemoryRouter></TestQueryProvider>,
    );

    await user.click(screen.getByText('Plan an absence'));
    const stepper = screen.getByRole("group", { name: "Projected absences" });
    const increase = within(stepper).getByRole("button", { name: "Increase projected absences" });

    expect(within(stepper).getByText("1")).toBeVisible();
    expect(screen.getByText(/93\.7%/)).toBeVisible();

    await user.click(increase);

    expect(within(stepper).getByText("2")).toBeVisible();
    expect(screen.getByText(/93\.0%/)).toBeVisible();
  });
});
