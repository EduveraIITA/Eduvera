import { Navigate, useLocation, useParams } from "react-router-dom";

type RouteParameters = Readonly<Record<string, string | undefined>>;

export interface LegacyRouteRedirectProps {
  readonly to: string | ((parameters: RouteParameters, search: URLSearchParams) => string);
  readonly defaultSearch?: Readonly<Record<string, string>>;
  readonly dropSearch?: readonly string[];
}

/**
 * Keeps an old bookmark working while making the canonical route the only
 * place that renders a product screen. Existing query state and hash anchors
 * survive the move; defaults only fill values the old URL did not carry.
 */
export function LegacyRouteRedirect({ to, defaultSearch, dropSearch = [] }: LegacyRouteRedirectProps) {
  const location = useLocation();
  const parameters = useParams();
  const search = new URLSearchParams(location.search);
  const pathname = typeof to === "function" ? to(parameters, new URLSearchParams(search)) : to;

  for (const key of dropSearch) search.delete(key);

  for (const [key, value] of Object.entries(defaultSearch ?? {})) {
    if (!search.has(key)) search.set(key, value);
  }

  return <Navigate
    replace
    to={{
      pathname,
      search: search.toString(),
      hash: location.hash,
    }}
  />;
}
