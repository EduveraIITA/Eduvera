import { createContext } from 'react';
export const NativeDockMetricsContext = createContext<(bottom: number) => void>(() => {});
