import { useAppearance } from "../appearance";

export function useLoginTheme() {
  return useAppearance().resolved === "dark";
}
