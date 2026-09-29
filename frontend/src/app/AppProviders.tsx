import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "../features/auth/AuthContext";
import { SchoolEventBridge } from "../features/school/SchoolEventBridge";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: (failureCount, error) => {
              if (import.meta.env.MODE === "test") return false;
              if (error instanceof Error && "status" in error) {
                const status = Number(error.status);
                if (status >= 400 && status < 500) return false;
              }
              return failureCount < 2;
            },
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SchoolEventBridge />
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
}
