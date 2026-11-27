import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCampusIndoorDescription, parseCampusIndoorRoomResources } from '../src/lib/campus-indoor-description';

test('extracts explicit floors, room names, and exact resource quantities from a description', () => {
  const result = parseCampusIndoorDescription(
    'The building has 2 floors. Ground floor: Library with 1,200 books, six lights and four ceiling fans; Room 101 with 2 fans. '
    + 'First floor has two classrooms with three lights and two fans each, and a computer lab with 10 computers.',
  );
  assert.deepEqual(result, {
    floorCount: 2,
    floors: [
      { name: 'Ground floor', rooms: [
        { name: 'Library', kind: 'library', quantity: 1, resources: [
          { name: 'books', quantity: 1200 }, { name: 'lights', quantity: 6 }, { name: 'ceiling fans', quantity: 4 },
        ] },
        { name: 'Room 101', kind: 'other', quantity: 1, resources: [{ name: 'fans', quantity: 2 }] },
      ] },
      { name: 'First floor', rooms: [
        { name: 'classrooms', kind: 'classroom', quantity: 2, resources: [
          { name: 'lights', quantity: 3 }, { name: 'fans', quantity: 2 },
        ] },
        { name: 'computer lab', kind: 'laboratory', quantity: 1, resources: [{ name: 'computers', quantity: 10 }] },
      ] },
    ],
    warnings: [],
  });
});

test('preserves custom room names and recognizes Indian grouping and written numbers', () => {
  const result = parseCampusIndoorDescription('Level 1: Room named “Blue Space” with 1,00,000 books, fifty-five chairs and one thousand two hundred and thirty desks.');
  assert.deepEqual(result.floors[0]?.rooms[0], {
    name: 'Blue Space', kind: null, quantity: 1,
    resources: [{ name: 'books', quantity: 100000 }, { name: 'chairs', quantity: 55 }, { name: 'desks', quantity: 1230 }],
  });
  assert.deepEqual(result.warnings, []);
});

test('keeps quantities unknown for ranges, approximate counts, and uncounted items', () => {
  const result = parseCampusIndoorDescription('Ground floor: Room 101 with at least 5 fans, between 2 and 4 lights, 3-5 chairs, and books.');
  assert.deepEqual(result.floors[0]?.rooms[0]?.resources, [
    { name: 'fans', quantity: null }, { name: 'lights', quantity: null }, { name: 'chairs', quantity: null }, { name: 'books', quantity: null },
  ]);
  assert.equal(result.warnings.length, 4);
});

test('a quantified room group needs explicit per-room allocation before attaching counts', () => {
  const result = parseCampusIndoorDescription('First floor: 2 classrooms with 6 fans. Second floor: 3 classrooms. Each room has 4 lights and 2 fans.');
  assert.equal(result.floors[0]?.rooms[0]?.quantity, 2);
  assert.deepEqual(result.floors[0]?.rooms[0]?.resources, [{ name: 'fans', quantity: null }]);
  assert.deepEqual(result.floors[1]?.rooms[0]?.resources, [{ name: 'lights', quantity: 4 }, { name: 'fans', quantity: 2 }]);
  assert.match(result.warnings[0] ?? '', /Confirm the number of fans/);
});

test('requires an explicit floor unless the person already selected the current floor', () => {
  assert.deepEqual(parseCampusIndoorDescription('Library has 8 books.').floors, []);
  const selected = parseCampusIndoorDescription('Library has 8 books.', { defaultFloorName: 'East teaching level' });
  assert.equal(selected.floors[0]?.name, 'East teaching level');
  assert.deepEqual(selected.floors[0]?.rooms[0]?.resources, [{ name: 'books', quantity: 8 }]);
  assert.equal(parseCampusIndoorDescription('There are 3 floors and 2 classrooms per floor.').floorCount, 3);
  assert.equal(parseCampusIndoorDescription('There are 3 floors and 2 classrooms per floor.').floors.length, 0);
});

test('omits negated and non-resource quantities and flags ambiguous rooms', () => {
  const result = parseCampusIndoorDescription(
    'Floor 2: Office with no lights and 2 fans; No workshops. Maybe a classroom. Room 104 with -3 fans and 30 square metres.',
  );
  assert.deepEqual(result.floors[0]?.rooms.map(room => room.name), ['Office', 'Room 104']);
  assert.deepEqual(result.floors[0]?.rooms[0]?.resources, [{ name: 'fans', quantity: 2 }]);
  assert.deepEqual(result.floors[0]?.rooms[1]?.resources, []);
  assert.ok(result.warnings.length >= 2);
});

test('conflicting counts and repeated room names require review', () => {
  const result = parseCampusIndoorDescription('This building has 2 floors. Ground floor: Library with 20 books and 30 books; Library with 5 fans. Ground floor: classroom A.');
  assert.equal(result.floors.length, 1);
  assert.deepEqual(result.floors[0]?.rooms.map(room => room.name), ['Library', 'classroom A']);
  assert.deepEqual(result.floors[0]?.rooms[0]?.resources, [{ name: 'books', quantity: null }]);
  assert.ok(result.warnings.some(warning => /separate rooms/.test(warning)));
  assert.ok(result.warnings.some(warning => /names 1 of the 2 stated floors/.test(warning)));
  assert.equal(parseCampusIndoorDescription('It has 2 or 3 floors.').floorCount, null);
});

test('a quoted room name preserves punctuation and never declares another floor', () => {
  const result = parseCampusIndoorDescription('Ground floor: Room named “First Floor: Library and Reading Centre” has three lamps.');
  assert.equal(result.floors.length, 1);
  assert.deepEqual(result.floors[0]?.rooms, [{
    name: 'First Floor: Library and Reading Centre', kind: 'library', quantity: 1,
    resources: [{ name: 'lamps', quantity: 3 }],
  }]);
  assert.deepEqual(result.warnings, []);
});

test('the guided example attaches fans to the library already mentioned on this floor', () => {
  const result = parseCampusIndoorDescription('The ground floor has a library and an office. The library has two fans.');
  assert.deepEqual(result, {
    floorCount: null,
    floors: [{ name: 'ground floor', rooms: [
      { name: 'library', kind: 'library', quantity: 1, resources: [{ name: 'fans', quantity: 2 }] },
      { name: 'office', kind: 'office', quantity: 1, resources: [] },
    ] }],
    warnings: [],
  });
});

test('reads only items for the selected room from fragments and natural sentences', () => {
  assert.deepEqual(parseCampusIndoorRoomResources('There are two fans and a bookshelf.'), {
    resources: [{ name: 'fans', quantity: 2 }, { name: 'bookshelf', quantity: 1 }],
    warnings: [],
  });
  const fragment = parseCampusIndoorRoomResources('a light, 1,200 books, and three desks');
  assert.deepEqual(fragment.resources, [
    { name: 'light', quantity: 1 }, { name: 'books', quantity: 1200 }, { name: 'desks', quantity: 3 },
  ]);
  assert.deepEqual(fragment.warnings, []);
});

test('selected-room item extraction flags other room declarations and ambiguous quantities', () => {
  const result = parseCampusIndoorRoomResources('Library has two fans. 3 classrooms, no lights, about 10 books and a desk.');
  assert.deepEqual(result.resources, [{ name: 'books', quantity: null }, { name: 'desk', quantity: 1 }]);
  assert.equal(result.warnings.length, 3);
});
