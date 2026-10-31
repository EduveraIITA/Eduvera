import type { CampusSceneDocument, CampusSceneElement, CampusSceneKind, CampusScenePoint, CampusSceneSpace } from "./types";

type Coordinates = readonly (readonly [number, number])[];
const normalize = (name: string) => name.trim().toLocaleLowerCase("en").replace(/\s+/gu, " ");

/** Explicit opt-in sample geometry. Never used as an inferred or generated real campus. */
export function createCampusDemoScene(spaces: readonly CampusSceneSpace[] = [], name = "Cambridge sample campus"): CampusSceneDocument {
  const elements: CampusSceneElement[] = [];
  const claimed = new Set<string>();
  const link = (label: string, kinds: readonly string[]) => {
    const matches = spaces.filter((space) => normalize(space.name) === normalize(label) && kinds.includes(space.kind));
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match || claimed.has(match.id)) return null;
    claimed.add(match.id);
    return match.id;
  };
  const add = (id: string, label: string, kind: CampusSceneKind, coords: Coordinates, extra: Partial<CampusSceneElement> = {}, compatibleKinds: readonly string[] = []) => {
    const points: CampusScenePoint[] = coords.map(([x, y]) => ({ x, y }));
    elements.push({ id: `sample_${id}`, label, kind, geometry: { type: kind === "tree" || kind === "fixture" ? "point" : kind === "road" || kind === "path" ? "polyline" : "polygon", points }, space_id: link(label, compatibleKinds), floor_id: null, review_state: "needs_review", ...extra });
  };

  // The pedestrian spine, entry court and service road form a connected, deliberate site.
  add("arrival_road", "Arrival avenue", "road", [[12, 195], [264, 195]], { width: 9, material: "asphalt" });
  add("entry_road", "Entrance approach", "road", [[135, 225], [135, 195]], { width: 10, material: "asphalt" });
  add("service_road", "Service lane", "road", [[264, 195], [264, 0]], { width: 6, material: "asphalt" });
  add("main_walk", "Central walkway", "path", [[135, 190], [135, 16]], { width: 6, material: "paving" });
  add("learning_walk", "Learning walk", "path", [[18, 91], [246, 91]], { width: 5, material: "paving" });
  add("community_walk", "Community walk", "path", [[18, 145], [188, 145]], { width: 5, material: "paving" });
  add("library_approach", "Library approach", "path", [[105, 91], [105, 129]], { width: 3.5, material: "paving" });
  add("garden_walk", "Garden walk", "path", [[135, 166], [113, 167], [93, 178], [76, 177], [60, 168], [23, 168]], { width: 3, material: "paving" });

  add("academic", "Academic Block", "building", [[24, 20], [112, 20], [112, 77], [94, 77], [94, 39], [42, 39], [42, 77], [24, 77]], { asset_key: "academic", material: "neutral", roof: "flat", levels: 3 }, ["building"]);
  add("administration", "Administration & Student Services", "building", [[20, 104], [69, 104], [69, 132], [20, 132]], { asset_key: "administration", material: "brick", roof: "hip", levels: 2 }, ["building"]);
  add("community", "Community & Activity Centre", "building", [[151, 22], [238, 22], [238, 41], [209, 41], [209, 75], [183, 75], [183, 41], [151, 41]], { asset_key: "library", material: "concrete", roof: "flat", levels: 2 }, ["building"]);
  add("library", "Library pavilion", "building", [[83, 104], [121, 104], [121, 131], [83, 131]], { asset_key: "library", material: "glass", roof: "flat", levels: 2 }, ["building"]);
  add("dining", "Garden dining pavilion", "building", [[23, 152], [58, 152], [58, 162], [23, 162]], { asset_key: "dining", material: "wood", roof: "gable", levels: 1 }, ["building"]);

  add("learning_court", "Learning courtyard", "surface", [[42, 40], [94, 40], [94, 80], [42, 80]], { asset_key: "paving", material: "paving" });
  add("assembly", "Assembly Court", "surface", [[146, 94], [185, 94], [185, 133], [146, 133]], { asset_key: "paving", material: "paving" }, ["outdoor_area"]);
  add("playfield", "Main Play Field", "surface", [[195, 95], [250, 95], [250, 181], [195, 181]], { asset_key: "sports", material: "grass" }, ["sports_area"]);
  add("parking", "Visitor Parking", "surface", [[20, 179], [76, 179], [76, 188], [20, 188]], { asset_key: "parking", material: "asphalt" }, ["outdoor_area"]);
  add("transport", "School Transport Bay", "surface", [[166, 203], [248, 203], [248, 215], [166, 215]], { asset_key: "parking", material: "asphalt" }, ["outdoor_area"]);
  add("garden", "Garden lawn", "surface", [[65, 151], [123, 151], [123, 189], [80, 189], [65, 177]], { asset_key: "grass", material: "grass" });
  add("water", "Garden water feature", "surface", [[85, 155], [103, 153], [114, 159], [110, 170], [100, 177], [87, 175], [79, 167]], { asset_key: "water", material: "water" });
  add("arrival_court", "Entrance court", "surface", [[122, 174], [147, 174], [147, 191], [122, 191]], { asset_key: "paving", material: "paving" });
  add("community_garden_west", "Community west flower bed", "surface", [[154, 52], [173, 52], [173, 55], [154, 55]], { asset_key: "flower_bed", material: "grass", height: .3 });
  add("community_garden_east", "Community east flower bed", "surface", [[218, 52], [237, 52], [237, 55], [218, 55]], { asset_key: "flower_bed", material: "grass", height: .3 });

  const trees: Coordinates = [
    [15, 19], [15, 41], [15, 66], [48, 12], [72, 12], [98, 12], [122, 24], [122, 50], [122, 75],
    [154, 12], [177, 12], [202, 12], [227, 12], [247, 27], [247, 50], [247, 75],
    [24, 84.5], [48, 84], [74, 84], [100, 86.5], [150, 84], [173, 84], [198, 84], [224, 84],
    [13, 108], [13, 130], [77, 102], [77, 127], [146, 112], [188, 111], [188, 131],
    [25, 141.5], [47, 140], [74, 140], [101, 140], [122, 142], [152, 141], [173, 141],
    [13.5, 154], [16, 172], [66, 153], [70, 172], [119, 161], [121, 183], [145, 158], [146, 177],
    [187, 153], [187, 175], [255, 108], [255, 133], [255, 156], [255, 178],
    [21, 207], [44, 207], [68, 207], [92, 207], [115, 210], [151, 210],
  ];
  // Deliberate sample planting: narrow trees fit the northern and service-lane
  // strips; low shrubs keep the garden open. No imported layout is adjusted.
  const planting: Readonly<Record<number, Pick<CampusSceneElement, "asset_key" | "width" | "height">>> = {
    1: { asset_key: "tree_conifer", width: 10, height: 16 },
    3: { asset_key: "tree_conifer", width: 10, height: 16 },
    4: { asset_key: "tree_columnar", width: 7, height: 15 },
    5: { asset_key: "tree_columnar", width: 7, height: 14 },
    6: { asset_key: "tree_columnar", width: 7, height: 16 },
    10: { asset_key: "tree_columnar", width: 7, height: 15 },
    11: { asset_key: "tree_columnar", width: 7, height: 14 },
    12: { asset_key: "tree_columnar", width: 7, height: 16 },
    13: { asset_key: "tree_columnar", width: 7, height: 14 },
    25: { asset_key: "tree_columnar", width: 7, height: 13 },
    26: { asset_key: "tree_columnar", width: 7, height: 14 },
    27: { asset_key: "tree_conifer", width: 8, height: 13 },
    28: { asset_key: "tree_columnar", width: 7, height: 14 },
    41: { asset_key: "shrub", width: 5, height: 2 },
    43: { asset_key: "shrub", width: 6, height: 2.5 },
    44: { asset_key: "shrub", width: 6, height: 2.5 },
    49: { asset_key: "tree_conifer", width: 8, height: 14 },
    50: { asset_key: "tree_columnar", width: 8, height: 15 },
    51: { asset_key: "tree_conifer", width: 8, height: 14 },
    52: { asset_key: "tree_columnar", width: 8, height: 15 },
  };
  trees.forEach((point, index) => add(`tree_${index + 1}`, `Landscape tree ${index + 1}`, "tree", [point], { asset_key: index >= 52 ? "tree_palm" : "tree_broadleaf", material: "grass", width: index >= 52 ? 11 : [11, 13.5, 12, 14][index % 4], height: index >= 52 ? 16 : [13, 15, 12, 16][index % 4], ...planting[index + 1] }));
  [[52, 67], [83, 67], [153, 125], [178, 125], [78, 154], [115, 176]].forEach((point, index) => add(`bench_${index + 1}`, `Garden bench ${index + 1}`, "fixture", [[point[0]!, point[1]!]], { asset_key: "bench", material: "wood", width: 4, height: 1.4 }));
  [30, 67, 104, 141, 178, 215, 250].forEach((x, index) => add(`lamp_${index + 1}`, `Avenue lamp ${index + 1}`, "fixture", [[x, 189]], { asset_key: "lamp", material: "metal", width: 1.8, height: 7 }));
  // Deliberate gaps meet the actual approach roads. Walls are editable geometry,
  // not a boundary inferred from the canvas rectangle or a real campus survey.
  const wall = { asset_key: "boundary_wall", material: "concrete", width: .65, height: 2.2 } as const;
  add("boundary_north", "North boundary wall", "path", [[5, 5], [258, 5]], wall);
  add("boundary_northeast", "Service entrance boundary", "path", [[270, 5], [275, 5]], wall);
  add("boundary_east", "East boundary wall", "path", [[275, 5], [275, 220]], wall);
  add("boundary_southeast", "Arrival boundary wall", "path", [[275, 220], [146, 220]], wall);
  add("boundary_southwest", "Garden boundary wall", "path", [[124, 220], [5, 220]], wall);
  add("boundary_west", "West boundary wall", "path", [[5, 220], [5, 5]], wall);
  add("main_gate", "Main Gate", "fixture", [[135, 220]], { asset_key: "gate", material: "metal", width: 22, height: 6 }, ["gate"]);
  add("service_gate", "Service Gate", "fixture", [[264, 5]], { asset_key: "gate", material: "metal", width: 12, height: 4.5 }, ["gate"]);

  return {
    schema_version: 1, name: `${name.trim() || "Campus"} · illustrative sample`.slice(0, 160),
    bounds: { width: 280, height: 225, unit: "metres" },
    source: { kind: "manual", label: "Synthetic Cambridge campus illustration", attribution: "ThatCampus sample asset library", notes: "Fictional sample geometry for trying the editor. It is not an aerial survey, a verified campus plan or evidence of physical resources. Only unique exact name-and-kind matches are linked to existing places. Review or replace every shape before publishing." },
    elements,
  };
}
