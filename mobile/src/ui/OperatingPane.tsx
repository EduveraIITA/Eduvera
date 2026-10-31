import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

export const OperatingPaneContext = createContext<{ width: number; height: number } | null>(null);
/** Responsive app content uses its actual allocation. Device scale/fontScale
 * and screen-coordinate keyboard measurements continue to use the real window. */
export function useOperatingPaneDimensions() {
  const window = useWindowDimensions(), pane = useContext(OperatingPaneContext);
  return pane && pane.width > 0 && pane.height > 0 ? { ...window,...pane } : window;
}
