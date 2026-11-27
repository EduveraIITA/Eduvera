import type { CampusSpace } from '../../../packages/contracts/src/institution';

export type CampusIndoorRoomKind = Extract<CampusSpace['kind'],
  'classroom' | 'laboratory' | 'library' | 'office' | 'auditorium' | 'workshop' | 'staff_room' | 'residential_room' | 'other'>;

export interface CampusIndoorResource { name: string; quantity: number | null }
export interface CampusIndoorRoom {
  name: string;
  kind: CampusIndoorRoomKind | null;
  /** One named room, or the explicitly stated quantity of an unnamed group. */
  quantity: number;
  resources: CampusIndoorResource[];
}
export interface CampusIndoorFloor { name: string; rooms: CampusIndoorRoom[] }
export interface CampusIndoorDescription {
  /** Present only when the description states a building-wide floor count. */
  floorCount: number | null;
  floors: CampusIndoorFloor[];
  warnings: string[];
}

const smallNumbers = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const tens = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const smallNumberPattern = smallNumbers.join('|');
const unitPattern = smallNumbers.slice(1, 10).join('|');
const shortNumber = `(?:(?:${tens.join('|')})(?:[ -](?:${unitPattern}))?|${smallNumberPattern})`;
const hundreds = `(?:(?:${unitPattern}) hundred(?: ${shortNumber})?|${shortNumber})`;
const quantityPattern = `(?:\\d{1,2}(?:,\\d{2})*,\\d{3}|\\d{1,3}(?:,\\d{3})+|\\d+|${hundreds} thousand(?: ${hundreds})?|${hundreds}|an?)`;
const leadingQuantity = new RegExp(`^(${quantityPattern})(?=\\s|$)\\s*`, 'iu');
const wordNumberAfterScale = new RegExp(`\\b(hundred|thousand)\\s+and\\s+(?=${shortNumber}\\b)`, 'giu');
const floorCountPattern = new RegExp(`\\b(${quantityPattern})\\s+(?:storeys|stories|floors|levels)\\b`, 'giu');
const ordinal = 'ground|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|upper|lower|top|mezzanine';
const level = `(?:${ordinal}|-?\\d{1,3}(?:st|nd|rd|th)?|[A-Z]\\d{1,2})`;
const floorPattern = new RegExp(`\\b(?:(?:lower ground|upper ground|${level})\\s+floor|(?:floor|level)\\s+(?:${level}|zero)|basement(?:\\s+\\d{1,2})?|mezzanine)\\b`, 'giu');

const roomKinds: ReadonlyArray<[CampusIndoorRoomKind, RegExp]> = [
  ['staff_room', /\b(?:staff|teachers?'?|faculty)\s+(?:rooms?|lounges?)\b/iu],
  ['residential_room', /\b(?:dorm(?:itory)?|residential|hostel|bed)\s*rooms?\b|\bdormitories\b/iu],
  ['laboratory', /\b(?:labs?|laborator(?:y|ies))\b/iu],
  ['classroom', /\b(?:class\s?rooms?|teaching rooms?|lecture rooms?)\b/iu],
  ['library', /\b(?:librar(?:y|ies)|reading rooms?)\b/iu],
  ['office', /\boffices?\b/iu],
  ['auditorium', /\b(?:auditoriums?|lecture halls?)\b/iu],
  ['workshop', /\bworkshops?\b/iu],
  ['other', /\b(?:rooms?|halls?|reception|lobb(?:y|ies)|toilets?|restrooms?|washrooms?|canteens?|cafeterias?|pantr(?:y|ies)|storerooms?)\b/iu],
];
const pluralRoom = /\b(?:class\s?rooms|rooms|labs|laboratories|libraries|offices|auditoriums|halls|workshops|dormitories|lobbies|toilets|restrooms|washrooms|canteens|cafeterias|pantries|storerooms)\s*$/iu;
const resourcePattern = /^(?:(?:ceiling|wall|exhaust|floor|table|standing|pedestal|electric|desk|reading|led|tube|fluorescent|library|text|desktop|laptop)\s+)?(?:lights?|bulbs?|fans?|books?|desks?|chairs?|tables?|benches|bench|projectors?|computers?|laptops?|monitors?|boards?|whiteboards?|blackboards?|shelves|shelf|bookshelves|bookshelf|cabinets?|windows?|doors?|washbasins?|printers?|servers?|fire extinguishers?|air conditioners?|conditioners?|air conditioning units?|ac units?|ac|units?)(?:\s|$)/iu;
const ambiguousName = /\b(?:maybe|possibly|probably|might|could|should|either|or|if|not|never|believe|think|suppose|assuming|unknown)\b/iu;
const nonResource = /\b(?:square|cubic|capacity|occupants?|people|students?|metres?|meters?|feet|foot|hours?|floors?|levels?)\b/iu;
const noEntry = /^(?:no|without|not|none|neither|don['’]t|doesn['’]t|do not|does not)\b/iu;
const approximate = /^(?:about|around|approximately|roughly|some|several|a few|at least|at most|up to|between|maybe|almost|more than|less than|over|under|~)\s*/iu;
const introduction = /^(?:(?:on|in|inside|at)\s+(?:the\s+)?|there\s+(?:is|are)\s+|(?:it\s+)?(?:has|have|contains?|includes?|holds?|consists of)\s+|(?:with|then|plus|and|also|just)\s+)+/iu;
const roomContents = /(?:\s+(has|have|with|contains?|includes?|holds?|equipped with|without)\s+|:\s*)/iu;
const perRoom = /\b(?:each(?: room)?|per (?:room|classroom|lab|office))\b/iu;
const quotedText = /"[^"]*"|“[^”]*”/gu;
const namedRoom = /^(?:room\s+(?:(?:called|named)\s+)?)?["“]([^"”]+)["”]$/iu;
const MAX_TEXT = 6_000;
const MAX_ROOM_GROUP = 2_000;

function tidy(value: string) {
  return value.trim().replace(/^[\s:.,;–—]+|[\s:.,;–—]+$/gu, '').replace(/\s+/gu, ' ');
}

function numberFrom(token: string) {
  if (/^\d/u.test(token)) return Number(token.replaceAll(',', ''));
  if (/^an?$/iu.test(token)) return 1;
  let thousands = 0;
  let group = 0;
  for (const word of token.toLowerCase().split(/[ -]/u)) {
    if (word === 'thousand') { thousands += group * 1000; group = 0; }
    else if (word === 'hundred') group *= 100;
    else {
      const small = smallNumbers.indexOf(word);
      group += small >= 0 ? small : (tens.indexOf(word) + 2) * 10;
    }
  }
  return thousands + group;
}

function extractQuantity(value: string): { quantity: number | null; rest: string } {
  const start = leadingQuantity.exec(value);
  if (!start) return { quantity: null, rest: value };
  return { quantity: numberFrom(start[1]!), rest: value.slice(start[0].length) };
}

function roomFrom(value: string): CampusIndoorRoom | null {
  if (noEntry.test(value) || approximate.test(value)) return null;
  const { quantity, rest } = extractQuantity(value);
  const name = tidy(namedRoom.exec(rest)?.[1] ?? rest.replace(/^room\s+(?:called|named)\s+/iu, ''));
  const named = namedRoom.test(rest) || /^(?:room\s+(?:called|named)\s+)/iu.test(rest);
  const matched = roomKinds.filter(([, pattern]) => pattern.test(name)).map(([kind]) => kind);
  const specific = matched.filter(kind => kind !== 'other');
  const kind = specific.length > 1 ? null : specific[0] ?? matched[0] ?? null;
  if ((!matched.length && !named) || name.length < 2 || name.length > 160 || quantity === 0 || (quantity !== null && quantity > MAX_ROOM_GROUP)) return null;
  if (quantity === null && !named && pluralRoom.test(name)) return null;
  if (!named && (ambiguousName.test(name) || /^(?:and\b|or\b|to\b|-)/iu.test(name))) return null;
  return { name, kind, quantity: quantity ?? 1, resources: [] };
}

function resourceFrom(value: string): CampusIndoorResource | null {
  if (noEntry.test(value) || /^[-–—]\s*\d/u.test(value)) return null;
  const description = value.replace(/\s+(?:each(?: room)?|per (?:room|classroom|lab|office))$/iu, '');
  const uncertain = approximate.test(description);
  const unnamedCount = uncertain ? description.replace(approximate, '') : description;
  const normalizedQuantity = unnamedCount.replace(/^(\d+)\s*[-–—]\s*(\d+)(?=\s)/u, '$1 to $2');
  let { quantity, rest } = extractQuantity(normalizedQuantity);
  // A range or alternative is no exact quantity. Retain a known resource name only.
  const range = /^(?:[–—-]|to\b|or\b)\s*/iu;
  if (range.test(rest)) {
    rest = extractQuantity(rest.replace(range, '')).rest;
    quantity = null;
  }
  if (uncertain) quantity = null;
  const name = tidy(rest);
  if ((!resourcePattern.test(name) && (quantity === null || !/^[\p{L}][\p{L}\p{N} -]{1,56}$/u.test(name)))
    || nonResource.test(name) || quantity === 0 || (quantity !== null && !Number.isSafeInteger(quantity)) || name.length > 80) return null;
  return { name, quantity };
}

function maskQuoted(value: string) {
  return value.replace(quotedText, name => '\u0000'.repeat(name.length));
}

function normalizeText(value: string) {
  const range = new RegExp(`\\bbetween\\s+(${quantityPattern})\\s+and\\s+(${quantityPattern})(?=\\s)`, 'giu');
  return value.normalize('NFC').split(/("[^"]*"|“[^”]*”)/u).map((part, index) =>
    index % 2 ? part : part.replace(wordNumberAfterScale, '$1 ').replace(range, '$1 to $2')).join('');
}

function contentParts(value: string) {
  const parts: string[] = [];
  const delimiters = maskQuoted(value).matchAll(/\r?\n|;|[.!?](?=\s|$)|(?<!\d),|,(?!\d)|\s+and\s+/giu);
  let start = 0;
  for (const delimiter of delimiters) {
    parts.push(value.slice(start, delimiter.index));
    start = delimiter.index + delimiter[0].length;
  }
  parts.push(value.slice(start));
  return parts.map(part => tidy(part).replace(introduction, '')).filter(Boolean);
}

function readResources(
  parts: readonly string[],
  warn: (message: string) => void,
  room?: CampusIndoorRoom,
): CampusIndoorResource[] {
  const perNamedPlace = !room || room.quantity === 1 || perRoom.test(parts.join(' '));
  const byName = new Map(room?.resources.map(resource => [resource.name.toLocaleLowerCase(), resource] as const));
  for (const part of parts) {
    const resource = resourceFrom(part);
    if (!resource || (!room && roomKinds.some(([, kind]) => kind.test(resource.name)))) {
      if (!noEntry.test(part)) warn(room ? `Check the resource details for “${room.name}”.` : `Check the item detail “${part.slice(0, 95)}”.`);
      continue;
    }
    const key = resource.name.toLocaleLowerCase();
    const previous = byName.get(key);
    if (!perNamedPlace || (previous && previous.quantity !== resource.quantity)) resource.quantity = null;
    if (resource.quantity === null) warn(`Confirm the number of ${resource.name}${room ? ` for “${room.name}”` : ''}.`);
    byName.set(key, resource);
  }
  return [...byName.values()];
}

/** Read items for a room explicitly selected by the caller. */
export function parseCampusIndoorRoomResources(text: string): { resources: CampusIndoorResource[]; warnings: string[] } {
  if (text.length > MAX_TEXT) {
    return { resources: [], warnings: [`Use a description under ${MAX_TEXT.toLocaleString()} characters.`] };
  }
  const warnings = new Set<string>();
  const resources = readResources(contentParts(normalizeText(text)), message => { if (warnings.size < 25) warnings.add(message); });
  return { resources, warnings: [...warnings] };
}

function readRooms(value: string, floor: CampusIndoorFloor, warn: (message: string) => void) {
  let active: { room: CampusIndoorRoom; resourceText: string[] } | undefined;
  const finishRoom = () => {
    if (!active) return;
    const { room, resourceText } = active;
    room.resources = readResources(resourceText, warn, room);
    if (!floor.rooms.includes(room)) {
      if (floor.rooms.some(previous => previous.name.toLowerCase() === room.name.toLowerCase())) {
        warn(`Check whether “${room.name}” is one room or separate rooms on ${floor.name}.`);
      } else floor.rooms.push(room);
    }
    active = undefined;
  };
  for (const part of contentParts(value)) {
    const contents = roomContents.exec(maskQuoted(part));
    const title = tidy(contents ? part.slice(0, contents.index) : part);
    if (active && contents && /^(?:it|this room|each room)$/iu.test(title)) {
      const resources = tidy(part.slice(contents.index + contents[0].length));
      if (resources && contents[1]?.toLowerCase() !== 'without') active.resourceText.push(title.toLowerCase() === 'each room' ? resources + ' each' : resources);
      continue;
    }
    // A definite reference can extend a uniquely named room already introduced on this floor.
    const reference = /^(?:the same|the|same)\s+(.+)$/iu.exec(title)?.[1]?.toLowerCase();
    const known = active && !floor.rooms.includes(active.room) ? [...floor.rooms, active.room] : floor.rooms;
    const referenced = reference ? known.filter(room => room.name.toLowerCase() === reference) : [];
    if (referenced.length === 1) {
      const room = referenced[0]!;
      if (active?.room !== room) { finishRoom(); active = { room, resourceText: [] }; }
      const resources = contents ? tidy(part.slice(contents.index + contents[0].length)) : '';
      if (resources && contents?.[1]?.toLowerCase() !== 'without') active?.resourceText.push(resources);
      continue;
    }
    const room = roomFrom(title);
    if (room) {
      finishRoom();
      const resources = contents ? tidy(part.slice(contents.index + contents[0].length)) : '';
      active = { room, resourceText: [] };
      if (resources && contents?.[1]?.toLowerCase() !== 'without') active.resourceText.push(resources);
    } else if (active && !contents && resourceFrom(part)) {
      active.resourceText.push(part);
    } else if (!noEntry.test(part)) {
      finishRoom();
      warn(`Check the unassigned detail “${part.slice(0, 95)}”.`);
    }
  }
  finishRoom();
}

/** Extract explicit claims for an editable draft. This never writes places or inventory. */
export function parseCampusIndoorDescription(
  text: string,
  { defaultFloorName }: { defaultFloorName?: string } = {},
): CampusIndoorDescription {
  const warnings = new Set<string>();
  const warn = (message: string) => { if (warnings.size < 25) warnings.add(message); };
  if (text.length > MAX_TEXT) {
    return { floorCount: null, floors: [], warnings: [`Use a description under ${MAX_TEXT.toLocaleString()} characters.`] };
  }
  const counts: number[] = [];
  const normalized = normalizeText(text);
  const unquoted = maskQuoted(normalized);
  const source = normalized
    .replace(floorCountPattern, (whole, count: string, offset: number, input: string) => {
      if (unquoted[offset] === '\u0000') return whole;
      const context = input.slice(Math.max(0, offset - 30), offset);
      if (!/(?:about|around|approximately|roughly|at least|at most|up to|maybe|not|more than|less than|[–—-]|to|or)\s*$/iu.test(context))
        counts.push(numberFrom(count));
      else warn('Confirm the total number of floors.');
      return ' ';
    })
    .replace(/\b(?:the\s+)?building\s+(?:has|contains|includes)\s*(?=[.;\n]|$)/giu, '');
  const distinctCounts = [...new Set(counts)];
  const floorCount = distinctCounts.length === 1 && distinctCounts[0]! > 0 && distinctCounts[0]! <= MAX_ROOM_GROUP ? distinctCounts[0]! : null;
  if (distinctCounts.length > 0 && floorCount === null) warn('Confirm the total number of floors.');
  const floors = new Map<string, CampusIndoorFloor>();
  const readFloor = (name: string, description: string) => {
    const clean = tidy(name);
    if (!clean || clean.length > 160) { warn('Name the floor before adding its rooms.'); return; }
    const key = clean.toLowerCase();
    const floor = floors.get(key) ?? { name: clean, rooms: [] };
    floors.set(key, floor);
    readRooms(description, floor, warn);
  };
  const headings = [...maskQuoted(source).matchAll(floorPattern)];
  if (!headings.length) {
    const description = tidy(source);
    if (description && defaultFloorName?.trim()) readFloor(defaultFloorName, description);
    else if (description || floorCount) warn('Name each floor and say which rooms are on it.');
  }
  for (let index = 0; index < headings.length; index++) {
    const match = headings[index]!;
    const next = headings[index + 1];
    const tail = source.slice(match.index + match[0].length, next?.index).replace(/\b(?:on|in|at)\s+(?:the\s+)?$/iu, '');
    readFloor(match[0], tail);
  }
  if (headings.length) {
    const prefix = tidy(source.slice(0, headings[0]!.index).replace(/\b(?:on|in|at)\s+(?:the\s+)?$/iu, ''));
    if (prefix && !/^(?:this|the|our)$/iu.test(prefix) && !/^(?:for |inside )?(?:this |the |our )?building(?:\s+has)?$/iu.test(prefix))
      warn('Check the details before the first named floor.');
  }
  if (floorCount !== null && floorCount !== floors.size && floors.size)
    warn(`The description names ${floors.size} of the ${floorCount} stated floors. Check the floor list.`);
  return { floorCount, floors: [...floors.values()], warnings: [...warnings] };
}
