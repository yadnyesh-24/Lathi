import { FEATURE_KINDS } from "../../data/config.js";
import { POPUP_TAG_ORDER, prettyValue } from "../lib/features.js";
import { levelLabel } from "../lib/levels.js";

function parseTags(props) {
  if (!props?.tags) return {};
  if (typeof props.tags === "string") {
    try {
      return JSON.parse(props.tags);
    } catch {
      return {};
    }
  }
  return props.tags;
}

/** Popup body for an accessibility feature or a building. */
export default function FeaturePopup({ feature, onFrom, onTo }) {
  const props = feature.properties ?? {};
  const isBuilding = Boolean(props.building);
  const tags = parseTags(props);
  const kind = props.kind ? FEATURE_KINDS[props.kind] : null;

  const isRoom = props.kind === "room";
  const title = props.name || props.ref || (isBuilding ? "Unnamed building" : isRoom ? "Room" : kind?.label || "Feature");
  const levelText = props.level != null && props.level !== "" ? levelLabel(props.level) : null;
  const subtitle = isBuilding
    ? `Building${props.levels ? ` · ${props.levels} floors` : ""}${props.entrances ? ` · ${props.entrances} mapped entrance${props.entrances > 1 ? "s" : ""}` : ""}`
    : isRoom
      ? `Room${levelText ? ` · ${levelText}` : ""}`
      : [kind?.label, levelText].filter(Boolean).join(" · ");

  const rows = POPUP_TAG_ORDER.filter((k) => tags[k] != null).map((k) => [k, tags[k]]);
  const wheelchair = props.wheelchair ?? tags.wheelchair ?? null;

  return (
    <div className="popup">
      <div className="popup-head">
        {kind && <span className="popup-dot" style={{ background: kind.color }} aria-hidden="true" />}
        <div>
          <div className="popup-title">{title}</div>
          {subtitle && <div className="popup-sub">{subtitle}</div>}
        </div>
      </div>

      {wheelchair && (
        <div className={`popup-wc wc-${wheelchair}`}>
          Wheelchair: <strong>{prettyValue(wheelchair)}</strong>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="popup-tags">
          {rows.map(([k, v]) => (
            <div key={k} className="popup-row">
              <dt>{k.replaceAll("_", " ").replace("ramp:wheelchair", "ramp for wheelchair")}</dt>
              <dd>{prettyValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      {!isBuilding && !isRoom && rows.length === 0 && (
        <div className="popup-note">No accessibility details in OpenStreetMap yet. Survey and tag it in JOSM.</div>
      )}
      {props.notes && <div className="popup-note">{props.notes}</div>}
      {props.photo && <img className="popup-photo" src={props.photo} alt="" />}

      <div className="popup-meta">
        {props.check_date ? `Last checked ${props.check_date}` : "Not yet verified on the ground"}
        {props.osmId && (
          <>
            {" · "}
            <a href={`https://www.openstreetmap.org/${props.osmId}`} target="_blank" rel="noreferrer">
              OSM
            </a>
          </>
        )}
      </div>

      {(onFrom || onTo) && (
        <div className="popup-actions">
          {onFrom && (
            <button type="button" className="btn btn-from" onClick={onFrom}>
              Directions from here
            </button>
          )}
          {onTo && (
            <button type="button" className="btn btn-to" onClick={onTo}>
              Directions to here
            </button>
          )}
        </div>
      )}
    </div>
  );
}
