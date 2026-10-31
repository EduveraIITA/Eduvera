import { createContext } from 'react';
/** The owning workspace shell has already allocated the measured bottom bar
 * and its system inset. Public/headerless/expanded content owns its own bottom. */
export const NativeTabInsetsContext = createContext(false);
