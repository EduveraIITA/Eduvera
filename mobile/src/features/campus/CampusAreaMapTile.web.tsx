import type { CampusAreaMapTileProps } from './CampusAreaMapTile';

export function CampusAreaMapTile({ tile, onStatus }: CampusAreaMapTileProps) {
  return <img
    referrerPolicy="strict-origin"
    alt=""
    draggable={false}
    width={256}
    height={256}
    style={{ position: 'absolute', left: tile.x, top: tile.y, pointerEvents: 'none' }}
    onLoad={() => onStatus(tile.key, 'loaded')}
    onError={() => onStatus(tile.key, 'error')}
    src={tile.url}
  />;
}
