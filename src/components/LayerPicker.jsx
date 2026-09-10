import { MAP_MODES, PATH_COLORS } from "../../data/config.js";

/** Tiny thumbnail drawings for the two map modes. */
function Thumb({ mode }) {
  if (mode === "buildings") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" fill="#eef2f7" />
        <rect x="6" y="8" width="14" height="12" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
        <rect x="26" y="6" width="16" height="10" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
        <rect x="8" y="27" width="12" height="14" rx="1.5" fill="#cbd5e1" stroke="#475569" strokeWidth="1" />
        <rect x="26" y="24" width="15" height="17" rx="1.5" fill="#93c5fd" stroke="#475569" strokeWidth="1" />
        <rect x="9" y="12" width="8" height="1.6" fill="#1e293b" />
        <rect x="29" y="30" width="9" height="1.6" fill="#1e293b" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" fill="#eef2f7" />
      <path d="M4 36 C14 30, 20 30, 30 24 S40 14, 46 12" fill="none" stroke={PATH_COLORS.ground} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M6 12 C14 14, 20 20, 24 20 S34 26, 42 40" fill="none" stroke={PATH_COLORS.upper} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M24 20 L30 24" fill="none" stroke={PATH_COLORS.ramp} strokeWidth="4" strokeLinecap="round" />
      <path d="M14 30 L20 26" fill="none" stroke={PATH_COLORS.stairs} strokeWidth="4" strokeLinecap="round" />
      <path d="M8 40 C16 36, 22 34, 30 28" fill="none" stroke={PATH_COLORS.route} strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Google-Maps-style layer chooser: two rounded squares, bottom-left. */
export default function LayerPicker({ value, onChange }) {
  return (
    <div className="layer-picker" role="radiogroup" aria-label="Map layers">
      {MAP_MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} className={`layer-btn ${value === m.id ? "active" : ""}`} onClick={() => onChange(m.id)} title={m.hint}>
          <span className="layer-thumb">
            <Thumb mode={m.id} />
          </span>
          <span className="layer-label">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
