import { josmUrl, osmUrl } from "../lib/osmLinks.js";

const TYPE_LABEL = {
  island: "Disconnected paths",
  "entrance-unconnected": "Entrance not on a path",
  "entrance-island": "Entrance on an island",
  "ambiguous-connector": "Ambiguous level tag",
  "dead-end-connector": "Dead-end stairs / ramp",
  "level-wall": "Floors touch without stairs",
  "steep-ramp": "Steep ramp",
  "building-no-entrance": "No entrance mapped",
};

/** Popup body for a data-quality issue (for the mapping team). */
export default function QaPopup({ issue }) {
  return (
    <div className="popup popup-qa">
      <div className="popup-head">
        <span className={`popup-dot sev-${issue.severity}`} aria-hidden="true" />
        <div>
          <div className="popup-title">{TYPE_LABEL[issue.type] ?? issue.type}</div>
          <div className="popup-sub">{issue.severity} priority</div>
        </div>
      </div>
      <p className="popup-qa-text">{issue.message}</p>
      <div className="popup-actions">
        {issue.osm && (
          <a className="btn" href={osmUrl(issue.osm)} target="_blank" rel="noreferrer">
            View on OSM
          </a>
        )}
        <a className="btn" href={josmUrl(issue.lon, issue.lat, issue.osm)} target="_blank" rel="noreferrer" title="Requires JOSM running with Remote Control enabled">
          Open in JOSM
        </a>
      </div>
    </div>
  );
}
