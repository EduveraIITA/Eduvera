import { createContext } from 'react';
/** Ownership is stable while the one global body is retained, even hidden. */
export const AssistantOverlayOwnerContext = createContext(false);
/** Undefined preserves ordinary route-based motion outside the global overlay. */
export const AssistantOverlayActivityContext = createContext<boolean | undefined>(undefined);
