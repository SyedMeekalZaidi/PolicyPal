export type PresetColor = {
  hex: string;
  label: string;
};

export const SET_COLORS: PresetColor[] = [
  { hex: "#4A9EFF", label: "Blue" },
  { hex: "#10B981", label: "Green" },
  { hex: "#FEC872", label: "Amber" },
  { hex: "#F472B6", label: "Pink" },
  { hex: "#A78BFA", label: "Purple" },
  { hex: "#F97316", label: "Orange" },
  { hex: "#14B8A6", label: "Teal" },
  { hex: "#EF4444", label: "Red" },
];

export const DEFAULT_SET_COLOR = SET_COLORS[0].hex;

/** Convert hex to rgba with given opacity — used for card background tints */
export function hexToRgba(hex: string, opacity: number): string {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.substring(0, 2), 16);
  const g = parseInt(cleaned.substring(2, 4), 16);
  const b = parseInt(cleaned.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}
