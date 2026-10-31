import { ControlButton } from '../ui/DomainControls';
import { Notice } from '../ui/components';
import { NativeTimeField } from './ResourcesScreen';
/** Never let an empty source/Simulation time become NativeTimeField's host default. */
export function OperationsTimeField(props: { label: string; value: string; now: string; onChange(value: string): void; disabled?: boolean; minimumDate?: Date; maximumDate?: Date }) {
  if (!Number.isFinite(Date.parse(props.value))) return <><Notice message={`${props.label}: choose a time after the campus clock is confirmed.`} /><ControlButton title={`Use confirmed campus time for ${props.label.toLowerCase()}`} disabled={props.disabled || !Number.isFinite(Date.parse(props.now))} onPress={() => props.onChange(props.now)} /></>;
  return <NativeTimeField {...props} />;
}
