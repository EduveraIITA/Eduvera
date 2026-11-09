export interface TemporalFieldProps {
  label: string; mode: 'date' | 'datetime'; value: string; onChange(value: string): void;
  disabled?: boolean; minimumDate?: Date; maximumDate?: Date;
  /** Interpret and display a datetime in this campus IANA zone. Date-only fields are civil dates. */
  timeZone?: string;
  /** Optional concise label inside a grouped native form. */
  rowLabel?: string;
}
