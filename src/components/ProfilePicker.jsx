import { PROFILES } from "../../data/config.js";

const ICONS = {
  normal: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="4" r="2" fill="currentColor" />
      <path d="M12 7l-3 5 2 1v7h2v-7l2-1-3-5z" fill="currentColor" />
      <path d="M9 12l-3 2M15 12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  wheelchair: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="4" r="2" fill="currentColor" />
      <path d="M11 7v6h5l3 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12a5 5 0 1 0 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
};

/** Normal / Wheelchair segmented control. */
export default function ProfilePicker({ value, onChange }) {
  return (
    <div className="profile-picker" role="radiogroup" aria-label="Accessibility profile">
      {PROFILES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="radio"
          aria-checked={value === p.id}
          className={`profile-btn ${value === p.id ? "active" : ""}`}
          onClick={() => onChange(p.id)}
          title={p.hint}
        >
          {ICONS[p.id]}
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}
