/**
 * Level (floor) helpers shared by the build script, router and UI.
 *
 * OSM convention (Simple Indoor Tagging):
 *   level=0        ground floor            level=1  first floor
 *   level=0;1      spans both floors       -> a connector (stairs, ramp, lift)
 *   no level tag   outdoors, treated as 0
 */

export const GROUND = "0";

/** "0;1" -> ["0", "1"]; undefined -> ["0"]. Also accepts "0-2" ranges. */
export function parseLevels(value) {
  if (value == null || value === "") return [GROUND];
  const out = [];
  for (const part of String(value).split(";")) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(-?\d+)\s*-\s*(-?\d+)$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(String(i));
    } else {
      const n = Number(p);
      out.push(Number.isFinite(n) ? String(n) : p);
    }
  }
  return out.length ? [...new Set(out)] : [GROUND];
}

/** True when a way's tags say it spans more than one floor. */
export function isMultiLevel(tags) {
  return parseLevels(tags?.level).length > 1;
}

/** Human label: "Ground", "Level 1", "Level 0–1". */
export function levelLabel(level) {
  if (level == null) return "";
  const levels = parseLevels(level);
  if (levels.length > 1) return `Level ${levels[0]}–${levels[levels.length - 1]}`;
  const l = levels[0];
  if (l === "0") return "Ground";
  if (l === "-1") return "Basement";
  return `Level ${l}`;
}

/** Short label for the floor switcher: "G", "1", "2", "B". */
export function levelShort(level) {
  if (level === "0") return "G";
  if (level === "-1") return "B";
  return String(level);
}

/** Node key used in the routing graph: "<osmNodeId>@<level>". */
export function nodeKey(osmId, level) {
  return `${osmId}@${level}`;
}

export function splitKey(key) {
  const i = key.indexOf("@");
  return i === -1 ? { osmId: key, level: GROUND } : { osmId: key.slice(0, i), level: key.slice(i + 1) };
}

/** Sort levels numerically ("-1","0","1","2"). */
export function sortLevels(levels) {
  return [...levels].sort((a, b) => Number(a) - Number(b));
}
