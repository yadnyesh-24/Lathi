import { useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { levelLabel } from "../lib/levels.js";

const KIND_ICON = { building: "🏛", entrance: "🚪", landmark: "📍", point: "📌", room: "🔲" };

/**
 * From / To search input with fuzzy results over places.json.
 * `value` is a place object or null; `onChange(place|null)`.
 */
export default function SearchBox({ places, value, onChange, placeholder, marker, autoFocus, onFocusInput }) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the text in sync when the parent sets a place (map click, swap…).
  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value]);

  const fuse = useMemo(
    () =>
      new Fuse(places ?? [], {
        keys: [
          { name: "name", weight: 0.7 },
          { name: "aliases", weight: 0.6 },
          { name: "building", weight: 0.15 },
          { name: "category", weight: 0.05 },
        ],
        threshold: 0.38,
        ignoreLocation: true,
        minMatchCharLength: 1,
      }),
    [places],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!places) return [];
    if (!q) {
      // Empty query: show Academic Area buildings first as suggestions.
      return places.filter((p) => p.kind === "building" && p.inAcademicArea).slice(0, 8);
    }
    const qn = q.toLowerCase().replace(/[\s-]/g, "");
    // Exact alias/name hits first ("lh7" → Lecture Hall 7), then fuzzy matches.
    const exact = places.filter((p) => p.name.toLowerCase().replace(/[\s-]/g, "") === qn || p.aliases?.some((a) => a.toLowerCase().replace(/[\s-]/g, "") === qn));
    const hits = fuse.search(q, { limit: 12 }).map((h) => h.item).filter((p) => !exact.includes(p));
    // Prefer buildings and Academic-Area places on ties.
    hits.sort((a, b) => Number(b.inAcademicArea) - Number(a.inAcademicArea) || (a.kind === "building" ? -1 : 0) - (b.kind === "building" ? -1 : 0));
    return [...exact, ...hits].slice(0, 12);
  }, [query, fuse, places]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (place) => {
    onChange(place);
    setQuery(place.name);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="search" ref={wrapRef}>
      <span className={`search-marker marker-${marker}`} aria-hidden="true">
        {marker === "from" ? "A" : "B"}
      </span>
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        value={query}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        aria-label={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (value && e.target.value !== value.name) onChange(null);
        }}
        onFocus={() => {
          setOpen(true);
          onFocusInput?.();
        }}
        onKeyDown={onKeyDown}
      />
      {(query || value) && (
        <button
          type="button"
          className="search-clear"
          aria-label="Clear"
          onClick={() => {
            setQuery("");
            onChange(null);
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      )}
      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={`search-result ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
            >
              <span className="result-icon" aria-hidden="true">
                {KIND_ICON[p.kind] ?? "📍"}
              </span>
              <span className="result-text">
                <span className="result-name">{p.name}</span>
                <span className="result-sub">
                  {p.kind === "entrance" ? "Entrance" : p.kind === "room" ? `Room · ${levelLabel(p.level)}` : p.kind === "landmark" ? prettify(p.category) : "Building"}
                  {p.kind === "entrance" && p.level != null && p.level !== "0" ? ` · ${levelLabel(p.level)}` : ""}
                  {p.inAcademicArea ? " · Academic Area" : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="search-results search-empty">No match. Try another name, or click a spot on the map.</div>
      )}
    </div>
  );
}

function prettify(s) {
  if (!s) return "Place";
  return String(s).replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}
