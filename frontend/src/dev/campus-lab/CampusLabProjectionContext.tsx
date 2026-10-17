import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { getCampusLabStatus, type CampusLabStatus } from "./api";

interface CampusLabProjectionState {
  status: CampusLabStatus | undefined;
  isPending: boolean;
  isError: boolean;
}

const CampusLabProjectionContext = createContext<CampusLabProjectionState | null>(null);

export default function CampusLabProjectionProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const statusQuery = useQuery({
    queryKey: ["campus-lab", "projection"],
    queryFn: ({ signal }) => getCampusLabStatus(signal),
    enabled: Boolean(auth?.user),
    refetchInterval: 2_000,
    retry: 1,
  });
  return <CampusLabProjectionContext.Provider value={{ status: statusQuery.data, isPending: statusQuery.isPending, isError: statusQuery.isError }}>
    {children}
  </CampusLabProjectionContext.Provider>;
}

export function useCampusLabProjection() {
  const projection = useContext(CampusLabProjectionContext);
  if (!projection) throw new Error("Campus Lab projection must be read inside its development provider.");
  return projection;
}
