import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { campusAreaMapTileSource } from './CampusAreaMapTileSource';

export type CampusAreaMapTileProps = {
  tile: { key: string; url: string; x: number; y: number };
  onStatus: (key: string, state: 'loaded' | 'error') => void;
};

export const CAMPUS_AREA_TILE_SIZE = 256;

export function CampusAreaMapTile({ tile, onStatus }: CampusAreaMapTileProps) {
  const [uri, setUri] = useState('');
  useEffect(() => {
    let active = true;
    void campusAreaMapTileSource(tile.url).then(value => {
      if (active) setUri(value);
    }, () => {
      if (active) onStatus(tile.key, 'error');
    });
    return () => { active = false; };
  }, [tile.key, tile.url, onStatus]);
  if (!uri) return null;
  return <Image source={{ uri }}
    onLoad={() => onStatus(tile.key, 'loaded')}
    onError={() => onStatus(tile.key, 'error')}
    accessible={false}
    style={{ position: 'absolute', width: CAMPUS_AREA_TILE_SIZE, height: CAMPUS_AREA_TILE_SIZE, left: tile.x, top: tile.y }}
    fadeDuration={0} />;
}
