import { createContext } from 'react';
export const NativeDockMetricsContext = createContext<(bottom: number) => void>(() => {});

/** Occupied space inside a full-size UIKit tab host. Only screen content
 * consumes these offsets, so the native tab controller stays at the window edge. */
export const NativeDockInsetsContext = createContext({ bar: 0, assistant: 0 });
