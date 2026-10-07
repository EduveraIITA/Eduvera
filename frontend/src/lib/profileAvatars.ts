const demoProfileAvatars: Record<string, string> = {
  "Aarav Sharma": "/assets/aarav-sharma.png",
  "Ananya Iyer": "/assets/ananya-iyer.png",
  "Rohan Verma": "/assets/rohan-verma.png",
  "Kavya Nair": "/assets/kavya-nair.png",
  "Pooja Sharma": "/assets/pooja-sharma.png",
  "Rashmi Joshi": "/assets/rashmi-joshi.png",
  "Nandita Deshmukh": "/assets/nandita-deshmukh.png",
  "Pooja Chauhan": "/assets/pooja-chauhan.png",
  "Meera Kapoor": "/assets/meera-kapoor.png",
  "Kavita Mehta": "/assets/kavita-mehta.png",
};

const studentPortraits = [
  "/assets/aarav-sharma.png",
  "/assets/ananya-iyer.png",
  "/assets/rohan-verma.png",
  "/assets/kavya-nair.png",
];

const guardianPortraits = [
  "/assets/pooja-sharma.png",
  "/assets/rashmi-joshi.png",
  "/assets/nandita-deshmukh.png",
  "/assets/pooja-chauhan.png",
];

function stablePortrait(key: string, portraits: string[]): string {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return portraits[hash % portraits.length]!;
}

export function profileAvatar(
  name: string,
  serverAvatar?: string | null,
  kind?: "student" | "guardian",
  stableKey = name,
): string | undefined {
  if (serverAvatar) return serverAvatar;
  const namedPortrait = demoProfileAvatars[name.trim()];
  if (namedPortrait) return namedPortrait;
  if (kind === "student") return stablePortrait(stableKey, studentPortraits);
  if (kind === "guardian") return stablePortrait(stableKey, guardianPortraits);
  return undefined;
}
