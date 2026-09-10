import { levelLabel, levelShort, sortLevels } from "../lib/levels.js";

/** Vertical G / 1 / 2 control shown over the map. */
export default function FloorSwitcher({ levels, value, onChange, highlight = [] }) {
  if (!levels || levels.length < 2) return null;
  const sorted = sortLevels(levels).reverse(); // top floor first, like a lift panel
  return (
    <div className="floors" role="radiogroup" aria-label="Floor">
      {sorted.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          className={`floor-btn ${value === l ? "active" : ""} ${highlight.includes(l) ? "on-route" : ""}`}
          title={levelLabel(l)}
          onClick={() => onChange(l)}
        >
          {levelShort(l)}
        </button>
      ))}
    </div>
  );
}
