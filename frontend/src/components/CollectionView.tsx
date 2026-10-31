import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import "./collection-view.css";

export interface CollectionCategory<T> {
  value: string;
  label: string;
  matches: (item: T) => boolean;
}

/** A view over an already-authorized collection, never a substitute for server search. */
export function CollectionView<T extends { id: string }>({ items, namespace, label, searchLabel, searchPlaceholder, searchText, categories = [], categoryLabel = "Filter records", focusedId, disabled = false, renderAllForPrint = false, empty, children }: {
  items: readonly T[];
  namespace: string;
  label: string;
  searchLabel: string;
  searchPlaceholder?: string;
  searchText: (item: NoInfer<T>) => string;
  categories?: readonly CollectionCategory<NoInfer<T>>[];
  categoryLabel?: string;
  focusedId?: string | null;
  disabled?: boolean;
  renderAllForPrint?: boolean;
  empty?: ReactNode;
  children: (items: readonly T[]) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const searchKey = `${namespace}_search`, categoryKey = `${namespace}_filter`, pageKey = `${namespace}_page`;
  const search = params.get(searchKey) ?? "";
  const category = categories.find((item) => item.value === params.get(categoryKey));
  const rawPage = Number(params.get(pageKey));
  const requestedPage = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const matching = items.filter((item) => (!category || category.matches(item)) && searchText(item).toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(matching.length / 10));
  const page = Math.min(requestedPage, pages);
  const visible = renderAllForPrint ? items : matching.slice((page - 1) * 10, page * 10);
  const change = useCallback((values: { search?: string; category?: string; page?: number }) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of [[searchKey, values.search], [categoryKey, values.category], [pageKey, values.page !== undefined ? String(values.page) : "1"]] as const) {
        if (value === undefined) continue;
        if (!value || value === "all" || key === pageKey && value === "1") next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [categoryKey, pageKey, searchKey, setParams]);
  const openedFocus = useRef<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const movedPage = useRef(false);
  useEffect(() => {
    if (!movedPage.current) return;
    movedPage.current = false;
    container.current?.scrollIntoView?.({ behavior: "auto", block: "start" });
    container.current?.focus({ preventScroll: true });
  }, [page]);
  const focusIndex = focusedId ? items.findIndex((item) => item.id === focusedId) : -1;
  useEffect(() => {
    if (!focusedId) { openedFocus.current = null; return; }
    if (focusIndex < 0 || openedFocus.current === focusedId) return;
    openedFocus.current = focusedId;
    change({ search: "", category: "all", page: Math.floor(focusIndex / 10) + 1 });
  }, [change, focusIndex, focusedId]);
  const toolsVisible = items.length > 8 || Boolean(search) || Boolean(category);
  return <div className="collection-view" ref={container} tabIndex={-1} role="group" aria-label={`${label} collection`}>
    {toolsVisible ? <div className="collection-view__tools">
      <label><span>{searchLabel}</span><input type="search" placeholder={searchPlaceholder} value={search} disabled={disabled} onChange={(event) => change({ search: event.target.value })} /></label>
      {categories.length ? <label><span>{categoryLabel}</span><select value={category?.value ?? "all"} disabled={disabled} onChange={(event) => change({ category: event.target.value })}><option value="all">All {label} · {items.length}</option>{categories.map((item) => <option key={item.value} value={item.value}>{item.label} · {items.filter(item.matches).length}</option>)}</select></label> : null}
    </div> : null}
    {visible.length ? children(visible) : items.length ? <p className="collection-view__empty">No matching {label}. <button type="button" disabled={disabled} onClick={() => change({ search: "", category: "all" })}>Clear filters</button></p> : empty}
    {pages > 1 ? <nav className="collection-view__pages" aria-label={`${label} pages`}><button type="button" disabled={disabled || page === 1} onClick={() => { movedPage.current = true; change({ page: page - 1 }); }}><ChevronLeft size={16} aria-hidden="true" />Previous</button><span role="status">Page {page} of {pages} · {matching.length} {label}</span><button type="button" disabled={disabled || page === pages} onClick={() => { movedPage.current = true; change({ page: page + 1 }); }}>Next<ChevronRight size={16} aria-hidden="true" /></button></nav> : toolsVisible ? <p className="collection-view__count" role="status">{matching.length} matching {label}</p> : null}
  </div>;
}
