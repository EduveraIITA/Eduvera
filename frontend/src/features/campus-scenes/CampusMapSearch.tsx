import type { CampusSceneElement } from "./types";

export function CampusMapSearch({ places, search, page, onSearch, onPage, onSelect }: {
  places: CampusSceneElement[]; search: string; page: number; onSearch: (query: string) => void; onPage: (page: number) => void; onSelect: (item: CampusSceneElement) => void;
}) {
  const matches = places.filter(item => item.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 8)), currentPage = Math.min(page, pages);
  return <section className="campus-map-search" aria-label="Find a campus place">
    <label>Place name<input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Building, room or entrance" maxLength={200} /></label>
    {matches.length ? <ul className="campus-map-search__results">{matches.slice((currentPage - 1) * 8, currentPage * 8).map(item => <li key={item.id}>
      <button type="button" onClick={() => onSelect(item)}><strong>{item.label}</strong><small>{item.kind}</small></button>
    </li>)}</ul> : <p role="status">No places match that name.</p>}
    {pages > 1 ? <div className="campus-scene-pagination"><button type="button" className="campus-scene-button" disabled={currentPage === 1} onClick={() => onPage(currentPage - 1)}>Previous</button><span>{currentPage} / {pages}</span><button type="button" className="campus-scene-button" disabled={currentPage === pages} onClick={() => onPage(currentPage + 1)}>Next</button></div> : null}
  </section>;
}
