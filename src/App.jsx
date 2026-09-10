import { useEffect, useMemo, useState } from "react";
import { FEATURE_KINDS, MAP_MODES, PATH_COLORS } from "../data/config.js";
import MapView from "./components/MapView.jsx";
import SearchBox from "./components/SearchBox.jsx";
import ProfilePicker from "./components/ProfilePicker.jsx";
import RouteSummary from "./components/RouteSummary.jsx";
import FloorSwitcher from "./components/FloorSwitcher.jsx";
import LayerPicker from "./components/LayerPicker.jsx";
import QaPanel from "./components/QaPanel.jsx";
import { loadAcademicArea, loadBuildings, loadFeatures, loadIndoor, loadMeta, loadPaths, loadPlaces, loadQa } from "./lib/data.js";
import { loadGraph } from "./lib/routing/graph.js";
import { computeRoutes, RouteError } from "./lib/routing/route.js";
import { GROUND } from "./lib/levels.js";

export default function App() {
  const [data, setData] = useState({ places: null, features: null, buildings: null, indoor: null, paths: null, academicArea: null, meta: null, qa: null, graph: null });
  const [loadError, setLoadError] = useState(null);

  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [profile, setProfile] = useState("normal");
  const [level, setLevel] = useState(GROUND);
  const [mode, setMode] = useState("paths");

  const [result, setResult] = useState(null);
  const [routeError, setRouteError] = useState(null);
  const [hoveredStep, setHoveredStep] = useState(null);
  const [focus, setFocus] = useState(null);

  const [showFeatures, setShowFeatures] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showIndoor, setShowIndoor] = useState(true);
  const [showQa, setShowQa] = useState(false);
  const [showSnap, setShowSnap] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);

  // ---- load static data + graph -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPlaces(), loadFeatures(), loadBuildings(), loadIndoor(), loadPaths(), loadAcademicArea(), loadMeta(), loadQa(), loadGraph()])
      .then(([places, features, buildings, indoor, paths, academicArea, meta, qa, graph]) => {
        if (cancelled) return;
        setData({ places, features, buildings, indoor, paths, academicArea, meta, qa, graph });
        const q = new URLSearchParams(window.location.search);
        const norm = (s) => s.toLowerCase().replace(/[\s-]/g, "");
        const find = (v) => (v ? places.find((p) => p.id === v || norm(p.name) === norm(v) || p.aliases?.some((a) => norm(a) === norm(v))) ?? null : null);
        if (q.get("from")) setFrom(find(q.get("from")));
        if (q.get("to")) setTo(find(q.get("to")));
        if (q.get("profile") === "wheelchair") setProfile("wheelchair");
        if (q.get("level") && graph.levels.includes(q.get("level"))) setLevel(q.get("level"));
        if (MAP_MODES.some((m) => m.id === q.get("mode"))) setMode(q.get("mode"));
        if (q.get("qa") === "1") setShowQa(true);
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- keep the URL shareable ---------------------------------------------------------
  useEffect(() => {
    if (!data.places) return;
    const q = new URLSearchParams();
    if (from && from.kind !== "point") q.set("from", from.id);
    if (to && to.kind !== "point") q.set("to", to.id);
    if (profile !== "normal") q.set("profile", profile);
    if (level !== GROUND) q.set("level", level);
    if (mode !== "paths") q.set("mode", mode);
    if (showQa) q.set("qa", "1");
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [data.places, from, to, profile, level, mode, showQa]);

  // ---- compute the route whenever inputs change ---------------------------------------
  useEffect(() => {
    if (!data.graph || !from || !to) {
      setResult(null);
      setRouteError(null);
      return;
    }
    try {
      const res = computeRoutes(data.graph, from, to, profile, { academicArea: data.academicArea?.features?.[0]?.geometry });
      setResult(res);
      setRouteError(null);
      // Show the floor the route starts on.
      const startLevel = res.main.directions[0]?.level;
      if (startLevel != null && data.graph.levels.includes(startLevel)) setLevel(startLevel);
    } catch (err) {
      setResult(null);
      setRouteError(err instanceof RouteError ? err.message : `Routing failed: ${err.message}`);
    }
  }, [data.graph, data.academicArea, from, to, profile]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const featureCounts = useMemo(() => {
    const counts = {};
    for (const f of data.features?.features ?? []) counts[f.properties.kind] = (counts[f.properties.kind] ?? 0) + 1;
    return counts;
  }, [data.features]);

  const ready = Boolean(data.graph && data.places);
  const pick = (setter) => (p) => {
    setter(p);
    setPanelOpen(true);
    if (p?.level != null && !String(p.level).includes(";") && data.graph?.levels.includes(String(p.level))) setLevel(String(p.level));
  };

  return (
    <div className="app">
      <MapView
        academicArea={data.academicArea}
        buildings={data.buildings}
        indoor={data.indoor}
        paths={data.paths}
        features={data.features}
        places={data.places}
        qa={data.qa}
        from={from}
        to={to}
        result={result}
        hoveredStep={hoveredStep}
        focus={focus}
        level={level}
        mode={mode}
        onSetFrom={pick(setFrom)}
        onSetTo={pick(setTo)}
        showFeatures={showFeatures}
        showBuildings={showBuildings}
        showIndoor={showIndoor}
        showQa={showQa}
        showSnap={showSnap}
      />

      <button type="button" className="panel-toggle" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
        {panelOpen ? "Hide panel" : "Directions"}
      </button>

      <aside className={`panel ${panelOpen ? "open" : "closed"}`}>
        <header className="panel-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              ♿
            </span>
            <div>
              <h1>IITK Accessible</h1>
              <p>Step-free &amp; accessibility-aware routes across IIT Kanpur</p>
            </div>
          </div>
        </header>

        <section className="inputs" aria-label="Route inputs">
          <div className="inputs-rows">
            <SearchBox places={data.places} value={from} onChange={pick(setFrom)} placeholder="Choose starting point" marker="from" />
            <SearchBox places={data.places} value={to} onChange={pick(setTo)} placeholder="Choose destination" marker="to" />
          </div>
          <button type="button" className="swap" onClick={swap} title="Swap start and destination" aria-label="Swap start and destination">
            ⇅
          </button>
        </section>

        <ProfilePicker value={profile} onChange={setProfile} />

        <section className="results">
          {loadError && <div className="route-error">Could not load map data: {loadError}</div>}
          {!loadError && !ready && <div className="hint">Loading campus data…</div>}

          {ready && !from && !to && (
            <div className="hint">
              <p>
                Search a building, room or entrance above, or click anywhere on the map and choose <em>Directions from here</em>.
              </p>
              <p className="hint-small">
                Detailed accessibility coverage is inside the dashed <span className="legend-swatch academic" /> Academic Area. Routes end at the building's door and change floor
                only via stairs, ramps or lifts. Switch between <em>Buildings</em> and <em>Paths</em> with the boxes at the bottom left.
              </p>
            </div>
          )}
          {ready && (from || to) && !(from && to) && <div className="hint">Now choose {from ? "a destination" : "a starting point"}.</div>}

          {routeError && <div className="route-error">{routeError}</div>}

          {result && (
            <RouteSummary
              result={result}
              onHoverStep={setHoveredStep}
              onSelectStep={(step) => {
                if (step.level != null && data.graph.levels.includes(step.level)) setLevel(step.level);
                setFocus({ coord: step.coord, t: Date.now() });
              }}
            />
          )}
        </section>

        <section className="legend" aria-label="Map layers">
          <div className="legend-toggles">
            <label>
              <input type="checkbox" checked={showBuildings} onChange={(e) => setShowBuildings(e.target.checked)} /> Buildings
            </label>
            <label>
              <input type="checkbox" checked={showIndoor} onChange={(e) => setShowIndoor(e.target.checked)} /> Indoor
            </label>
            <label>
              <input type="checkbox" checked={showFeatures} onChange={(e) => setShowFeatures(e.target.checked)} /> Features
            </label>
            <label title="Show where each endpoint joined the path network">
              <input type="checkbox" checked={showSnap} onChange={(e) => setShowSnap(e.target.checked)} /> Snap points
            </label>
          </div>
          {mode === "paths" && (
            <ul className="legend-list legend-paths">
              <li>
                <span className="legend-line" style={{ background: PATH_COLORS.ground }} /> Ground paths
              </li>
              <li>
                <span className="legend-line" style={{ background: PATH_COLORS.upper }} /> Level 1+ / skywalks
              </li>
              <li>
                <span className="legend-line" style={{ background: PATH_COLORS.ramp }} /> Ramps
              </li>
              <li>
                <span className="legend-line" style={{ background: PATH_COLORS.stairs }} /> Stairs
              </li>
              <li>
                <span className="legend-line" style={{ background: PATH_COLORS.route }} /> Your route
              </li>
            </ul>
          )}
          {mode === "paths" && showFeatures && (
            <ul className="legend-list">
              {Object.entries(FEATURE_KINDS)
                .filter(([k]) => featureCounts[k] && k !== "ramp" && k !== "stairs")
                .map(([k, v]) => (
                  <li key={k}>
                    <span className="legend-swatch" style={{ background: v.color }} /> {v.label}
                    <span className="legend-count">{featureCounts[k]}</span>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <QaPanel
          qa={data.qa}
          open={showQa}
          onToggle={() => setShowQa((o) => !o)}
          onFocus={(issue) => {
            setFocus({ coord: [issue.lon, issue.lat], zoom: 18.5, issue, t: Date.now() });
            setPanelOpen(window.matchMedia("(min-width: 900px)").matches);
          }}
        />

        <footer className="panel-foot">
          {data.meta && (
            <span>
              {data.meta.graph.nodes.toLocaleString()} path points on {data.meta.levels?.length ?? 1} floor{(data.meta.levels?.length ?? 1) > 1 ? "s" : ""} · {data.meta.namedBuildings} named
              buildings · {data.meta.rooms ?? 0} rooms · OSM snapshot {data.meta.osmFetchedAt ? new Date(data.meta.osmFetchedAt).toLocaleDateString() : "—"}
            </span>
          )}
          <span>
            Data ©{" "}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
              OpenStreetMap
            </a>{" "}
            contributors ·{" "}
            <a href="https://www.openstreetmap.org/edit#map=17/26.5125/80.2330" target="_blank" rel="noreferrer">
              Improve the map
            </a>
          </span>
        </footer>
      </aside>

      <FloorSwitcher levels={data.graph?.levels} value={level} onChange={setLevel} highlight={result?.main.levels ?? []} />
      <LayerPicker value={mode} onChange={setMode} />
    </div>
  );
}
