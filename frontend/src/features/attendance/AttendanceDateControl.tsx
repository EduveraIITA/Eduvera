import { DateNavigation } from '../../components/date-navigation/DateNavigation';
import './attendance-simple.css';

export function AttendanceDateControl({date,onChange}:{date:string;onChange:(date:string)=>void | boolean}) {
  return <section className="attendance-date-control" aria-label="Attendance date">
    <DateNavigation date={date} view="day" onDateChange={onChange} compact />
  </section>;
}
