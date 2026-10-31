// The canonical People API still uses legacy name-part keys. Do not guess
// cultural/family-name boundaries: retain the complete entered name in one key.
export const PERSON_NAME_MAX_LENGTH = 150;

export function personNameFields(name: string) {
  return { first_name: name.trim(), last_name: "" };
}

export function personDisplayName(person: { first_name: string; last_name: string }) {
  return `${person.first_name} ${person.last_name}`.trim();
}
