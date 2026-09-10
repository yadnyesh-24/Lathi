import { useState } from "react";
import { osmUrl } from "../lib/osmLinks.js";

const TYPE_LABEL = {
  island: "Disconnected paths",
  "entrance-unconnected": "Entrance not on any path",
  "entrance-island": "Entrance only reaches an island",
  "ambiguous-connector": "level=a;b without ramp/stairs tags",
  "dead-end-connector": "Stairs / ramp ending in mid-air",
  "level-wall": "Floors share a node, no stairs",
  "steep-ramp": "Ramp steeper than 8 %",
  "building-no-entrance": "Building without entrance node",
};

/**
 * Collapsible "map data check" for the mapping team: lists what the build
 * script found wrong in the OSM data, grouped by type, with zoom-to.
 */
export default function QaPanel({ qa, open, onToggle, onFocus }) {
  const [expanded, setExpanded] = useState(() => new Set(["high"]));
  if (!qa?.issues) return null;

  const bySeverity = { high: [], medium: [], low: [] };
  for (const i of qa.issues) (bySeverity[i.severity] ?? bySeverity.low).push(i);

  const toggle = (k) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <section className="qa">
      <button type="button" className="qa-head" onClick={onToggle} aria-expanded={open}>
        <span>Map data check</span>
        <span className="qa-counts">
          <span className="sev sev-high">{bySeverity.high.length}</span>
          <span className="sev sev-medium">{bySeverity.medium.length}</span>
          <span className="sev sev-low">{bySeverity.low.length}</span>
        </span>
        <span className="qa-chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="qa-body">
          <p className="qa-hint">
            Found by <code>npm run data:build</code> in the OSM snapshot. Fix in JOSM, upload, then <code>npm run data:refresh</code>. Issues also show as dots on the map.
          </p>
          {["high", "medium", "low"].map((sev) => {
            const list = bySeverity[sev];
            if (!list.length) return null;
            const groups = {};
            for (const i of list) (groups[i.type] ??= []).push(i);
            return (
              <div key={sev} className="qa-group">
                <button type="button" className="qa-group-head" onClick={() => toggle(sev)}>
                  <span className={`sev sev-${sev}`}>{list.length}</span> {sev} priority
                  <span className="qa-chevron">{expanded.has(sev) ? "▾" : "▸"}</span>
                </button>
                {expanded.has(sev) &&
                  Object.entries(groups).map(([type, items]) => (
                    <div key={type} className="qa-type">
                      <div className="qa-type-head">
                        {TYPE_LABEL[type] ?? type} <span className="legend-count">{items.length}</span>
                      </div>
                      <ul className="qa-list">
                        {items.slice(0, 40).map((i, idx) => (
                          <li key={`${i.osm}-${idx}`} className="qa-item">
                            <button type="button" className="qa-zoom" onClick={() => onFocus(i)} title="Show on map">
                              {i.message}
                            </button>
                            {i.osm && (
                              <a className="qa-osm" href={osmUrl(i.osm)} target="_blank" rel="noreferrer">
                                {i.osm}
                              </a>
                            )}
                          </li>
                        ))}
                        {items.length > 40 && <li className="qa-more">…and {items.length - 40} more</li>}
                      </ul>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
