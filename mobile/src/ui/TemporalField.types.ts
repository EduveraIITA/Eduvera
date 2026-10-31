export interface TemporalFieldProps {
  label: string; mode: 'date' | 'datetime'; value: string; onChange(value: string): void;
  disabled?: boolean; minimumDate?: Date; maximumDate?: Date;
  /** Optional concise label inside a grouped native form. */
  rowLabel?: string;
}
