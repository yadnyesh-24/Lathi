import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { createRoot } from "react-dom/client";
import {
  ACADEMIC_AREA_CENTER,
  BASEMAP_STYLE_URL,
  CAMPUS_BBOX,
  FEATURE_KINDS,
  INITIAL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  PATH_COLORS,
} from "../../data/config.js";
import { bboxToBounds, coordsBbox, padBbox } from "../lib/geo/bbox.js";
import { buildingPlace, pointPlace } from "../lib/data.js";
import { GROUND, levelLabel } from "../lib/levels.js";
import FeaturePopup from "./FeaturePopup.jsx";
import QaPopup from "./QaPopup.jsx";

const EMPTY = { type: "FeatureCollection", features: [] };
const WORLD = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

/** MapLibre "match" expression colouring features by kind. */
function kindColorExpr() {
  const pairs = [];
  for (const [k, v] of Object.entries(FEATURE_KINDS)) pairs.push(k, v.color);
  return ["match", ["get", "kind"], ...pairs, "#64748b"];
}

/** Paths layer colour: stairs / ramp / lift by kind, otherwise by floor. */
const PATH_COLOR_EXPR = [
  "match",
  ["get", "kind"],
  "stairs",
  PATH_COLORS.stairs,
  "ramp",
  PATH_COLORS.ramp,
  "elevator",
  PATH_COLORS.elevator,
  ["case", [">=", ["to-number", ["get", "floor"]], 1], PATH_COLORS.upper, PATH_COLORS.ground],
];

/** Filter: feature has no level, spans levels, or is on the selected floor. */
function onFloorFilter(level) {
  return ["any", ["!", ["has", "level"]], ["==", ["get", "level"], null], ["==", ["to-string", ["get", "level"]], level], ["in", ";", ["to-string", ["get", "level"]]]];
}

function markerElement(kind) {
  const el = document.createElement("div");
  el.className = `pin pin-${kind}`;
  el.innerHTML = `<span>${kind === "from" ? "A" : "B"}</span>`;
  return el;
}

/**
 * The campus map: basemap locked to IITK, Academic Area overlay, buildings,
 * indoor floors, accessibility features, route rendering, pins and popups.
 */
export default function MapView({
  academicArea,
  buildings,
  indoor,
  paths,
  features,
  places,
  qa,
  from,
  to,
  result,
  hoveredStep,
  focus,
  level = GROUND,
  mode = "paths",
  onSetFrom,
  onSetTo,
  showFeatures = true,
  showBuildings = true,
  showIndoor = true,
  showQa = false,
  showSnap = false,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const popupRootRef = useRef(null);
  const fromMarker = useRef(null);
  const toMarker = useRef(null);
  const callbacks = useRef({ onSetFrom, onSetTo, places, level });
  const [loaded, setLoaded] = useState(false);

  callbacks.current = { onSetFrom, onSetTo, places, level };

  // ---- create the map once ---------------------------------------------------
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE_URL,
      center: [ACADEMIC_AREA_CENTER.lon, ACADEMIC_AREA_CENTER.lat],
      zoom: INITIAL_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: bboxToBounds(padBbox(CAMPUS_BBOX, 0.15)),
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");

    map.on("load", () => {
      for (const id of ["mask", "academic-area", "buildings", "indoor", "paths", "features", "route-compare", "route", "connectors", "snap", "step", "qa"]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }

      // Dim everything outside the Academic Area.
      map.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": "#0f172a", "fill-opacity": 0.08 } });
      map.addLayer({ id: "academic-fill", type: "fill", source: "academic-area", paint: { "fill-color": "#2563eb", "fill-opacity": 0.04 } });
      map.addLayer({ id: "academic-outline", type: "line", source: "academic-area", paint: { "line-color": "#2563eb", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.8 } });

      // Buildings
      map.addLayer({
        id: "buildings-fill",
        type: "fill",
        source: "buildings",
        paint: {
          "fill-color": ["case", ["boolean", ["get", "inAcademicArea"], false], "#93c5fd", "#cbd5e1"],
          "fill-opacity": ["case", ["has", "name"], 0.35, 0.12],
        },
      });
      map.addLayer({ id: "buildings-outline", type: "line", source: "buildings", paint: { "line-color": "#475569", "line-width": ["case", ["has", "name"], 1, 0.4], "line-opacity": 0.6 } });

      // Indoor: rooms + corridors of the selected floor.
      map.addLayer({
        id: "indoor-room-fill",
        type: "fill",
        source: "indoor",
        minzoom: 16,
        filter: ["all", ["==", ["get", "kind"], "room"], onFloorFilter(GROUND)],
        paint: { "fill-color": "#fef3c7", "fill-opacity": 0.75 },
      });
      map.addLayer({
        id: "indoor-room-outline",
        type: "line",
        source: "indoor",
        minzoom: 16,
        filter: ["all", ["==", ["get", "kind"], "room"], onFloorFilter(GROUND)],
        paint: { "line-color": "#b45309", "line-width": 0.8, "line-opacity": 0.8 },
      });
      // All walkable paths, coloured by floor (ground light blue, upper dark
      // blue) with ramps yellow and stairs orange. Roads drawn thinner.
      map.addLayer({
        id: "paths-line",
        type: "line",
        source: "paths",
        paint: {
          "line-color": PATH_COLOR_EXPR,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            14,
            ["match", ["get", "kind"], "road", 1, "stairs", 2.5, "ramp", 2.5, 2],
            18,
            ["match", ["get", "kind"], "road", 3, "stairs", 7, "ramp", 7, 5],
          ],
          "line-opacity": ["match", ["get", "kind"], "road", 0.55, 0.9],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "indoor-room-label",
        type: "symbol",
        source: "indoor",
        minzoom: 17,
        filter: ["all", ["==", ["get", "kind"], "room"], onFloorFilter(GROUND)],
        layout: {
          "text-field": ["coalesce", ["get", "name"], ["get", "ref"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
          "text-max-width": 7,
          "text-optional": true,
        },
        paint: { "text-color": "#78350f", "text-halo-color": "#ffffff", "text-halo-width": 1.2 },
      });

      map.addLayer({
        id: "buildings-label",
        type: "symbol",
        source: "buildings",
        minzoom: 15.5,
        filter: ["has", "name"],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 10, 18, 13],
          "text-max-width": 8,
          "text-padding": 4,
          "text-optional": true,
        },
        paint: { "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
      });

      // Accessibility features drawn as lines (stairs, ramps, skywalks).
      map.addLayer({
        id: "features-line",
        type: "line",
        source: "features",
        filter: ["all", ["==", ["geometry-type"], "LineString"], onFloorFilter(GROUND)],
        paint: { "line-color": kindColorExpr(), "line-width": ["interpolate", ["linear"], ["zoom"], 15, 3, 18, 7], "line-opacity": 0.9 },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      // Comparison route (shortest) when the wheelchair route differs.
      map.addLayer({
        id: "route-compare-line",
        type: "line",
        source: "route-compare",
        paint: { "line-color": "#64748b", "line-width": 4, "line-dasharray": [2, 2], "line-opacity": 0.7 },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      // The chosen route: magenta on a white casing, on every floor. Stairs and
      // ramp sections get a thin coloured casing so the connector type is visible.
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        paint: {
          "line-color": ["case", ["get", "connector"], ["match", ["get", "kind"], "stairs", PATH_COLORS.stairs, "ramp", PATH_COLORS.ramp, "elevator", PATH_COLORS.elevator, "#ffffff"], "#ffffff"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 14, 7, 18, 14],
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": PATH_COLORS.route, "line-width": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 8] },
        layout: { "line-cap": "round", "line-join": "round" },
      });
      map.addLayer({
        id: "connectors-line",
        type: "line",
        source: "connectors",
        paint: { "line-color": PATH_COLORS.route, "line-width": 3, "line-dasharray": [0.6, 1.4], "line-opacity": 0.8 },
        layout: { "line-cap": "round" },
      });

      // Point features.
      map.addLayer({
        id: "features-point",
        type: "circle",
        source: "features",
        filter: ["all", ["==", ["geometry-type"], "Point"], onFloorFilter(GROUND)],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 3, 17, 6, 19, 9],
          "circle-color": kindColorExpr(),
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.95,
        },
      });

      // Where the endpoints joined the network (debug).
      map.addLayer({
        id: "snap-point",
        type: "circle",
        source: "snap",
        layout: { visibility: "none" },
        paint: { "circle-radius": 7, "circle-color": "#ffffff", "circle-opacity": 0.9, "circle-stroke-color": ["match", ["get", "end"], "from", "#188038", "#d93025"], "circle-stroke-width": 3 },
      });

      // Data-quality issues.
      map.addLayer({
        id: "qa-point",
        type: "circle",
        source: "qa",
        layout: { visibility: "none" },
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 4, 18, 9],
          "circle-color": ["match", ["get", "severity"], "high", "#d93025", "medium", "#f59e0b", "#94a3b8"],
          "circle-opacity": 0.85,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // Highlighted direction step.
      map.addLayer({ id: "step-point", type: "circle", source: "step", paint: { "circle-radius": 10, "circle-color": "#1a73e8", "circle-opacity": 0.25, "circle-stroke-color": "#1a73e8", "circle-stroke-width": 2 } });

      for (const id of ["features-point", "features-line", "buildings-fill", "indoor-room-fill", "qa-point"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("click", (e) => handleClick(map, e));
      setLoaded(true);
    });

    return () => {
      closePopup();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- popups -------------------------------------------------------------------
  function closePopup() {
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    if (popupRootRef.current) {
      const root = popupRootRef.current;
      popupRootRef.current = null;
      queueMicrotask(() => root.unmount());
    }
  }

  function openPopup(map, lngLat, node) {
    closePopup();
    const el = document.createElement("div");
    const root = createRoot(el);
    root.render(node);
    popupRootRef.current = root;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "340px", offset: 8 }).setLngLat(lngLat).setDOMContent(el).addTo(map);
    popupRef.current.on("close", () => {
      if (popupRootRef.current === root) {
        popupRootRef.current = null;
        queueMicrotask(() => root.unmount());
      }
      popupRef.current = null;
    });
  }

  function handleClick(map, e) {
    const { onSetFrom, onSetTo, places, level } = callbacks.current;
    const layers = ["qa-point", "features-point", "features-line", "indoor-room-fill", "buildings-fill"].filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
    const hits = map.queryRenderedFeatures(e.point, { layers });
    const feat = hits.find((h) => h.layer.id === "qa-point") ?? hits.find((h) => h.layer.id.startsWith("features")) ?? hits.find((h) => h.layer.id === "indoor-room-fill") ?? hits[0];

    if (feat?.layer.id === "qa-point") {
      openPopup(map, feat.geometry.coordinates, <QaPopup issue={feat.properties} />);
      return;
    }

    if (feat) {
      const geo = { type: "Feature", properties: feat.properties, geometry: feat.geometry };
      let place;
      if (feat.layer.id === "buildings-fill") {
        place = buildingPlace(geo, places);
      } else if (feat.layer.id === "indoor-room-fill") {
        place = places?.find((p) => p.id === feat.properties.osmId) ?? pointPlace(e.lngLat.lng, e.lngLat.lat, feat.properties.name || "Room", feat.properties.level);
      } else {
        const c = feat.geometry.type === "Point" ? feat.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
        place = pointPlace(c[0], c[1], feat.properties.name || FEATURE_KINDS[feat.properties.kind]?.label || "Feature", feat.properties.level);
      }
      const anchor = feat.geometry.type === "Point" ? feat.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
      openPopup(
        map,
        anchor,
        <FeaturePopup
          feature={geo}
          onFrom={() => {
            onSetFrom(place);
            closePopup();
          }}
          onTo={() => {
            onSetTo(place);
            closePopup();
          }}
        />,
      );
      return;
    }

    // Plain map click: a dropped pin on the floor being viewed.
    const place = pointPlace(e.lngLat.lng, e.lngLat.lat, undefined, level);
    openPopup(
      map,
      e.lngLat,
      <div className="popup">
        <div className="popup-title">Dropped pin</div>
        <div className="popup-sub">
          {e.lngLat.lat.toFixed(5)}, {e.lngLat.lng.toFixed(5)}
          {level !== GROUND ? ` · ${levelLabel(level)}` : ""}
        </div>
        <div className="popup-actions">
          <button type="button" className="btn btn-from" onClick={() => { onSetFrom(place); closePopup(); }}>
            Directions from here
          </button>
          <button type="button" className="btn btn-to" onClick={() => { onSetTo(place); closePopup(); }}>
            Directions to here
          </button>
        </div>
      </div>,
    );
  }

  // ---- static overlays --------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !academicArea) return;
    map.getSource("academic-area").setData(academicArea);
    const ring = academicArea.features?.[0]?.geometry?.coordinates?.[0];
    if (ring) map.getSource("mask").setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [WORLD, ring] } });
  }, [loaded, academicArea]);

  useEffect(() => {
    const map = mapRef.current;
    if (loaded && map && buildings) map.getSource("buildings").setData(buildings);
  }, [loaded, buildings]);

  useEffect(() => {
    const map = mapRef.current;
    if (loaded && map && indoor) map.getSource("indoor").setData(indoor);
  }, [loaded, indoor]);

  useEffect(() => {
    const map = mapRef.current;
    if (loaded && map && features) map.getSource("features").setData(features);
  }, [loaded, features]);

  useEffect(() => {
    const map = mapRef.current;
    if (loaded && map && paths) map.getSource("paths").setData(paths);
  }, [loaded, paths]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const fc = qa?.issues
      ? { type: "FeatureCollection", features: qa.issues.map((i, idx) => ({ type: "Feature", id: idx, properties: { ...i, idx }, geometry: { type: "Point", coordinates: [i.lon, i.lat] } })) }
      : EMPTY;
    map.getSource("qa").setData(fc);
  }, [loaded, qa]);

  // ---- layer visibility ---------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const vis = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    // "buildings" mode: base map + building names only. "paths" mode: everything walkable.
    const pathsMode = mode === "paths";
    vis("paths-line", pathsMode);
    vis("features-point", pathsMode && showFeatures);
    vis("features-line", pathsMode && showFeatures);
    vis("buildings-fill", showBuildings);
    vis("buildings-outline", showBuildings);
    vis("buildings-label", showBuildings);
    for (const id of ["indoor-room-fill", "indoor-room-outline", "indoor-room-label"]) vis(id, pathsMode && showIndoor);
    vis("qa-point", showQa);
    vis("snap-point", showSnap);
  }, [loaded, mode, showFeatures, showBuildings, showIndoor, showQa, showSnap]);

  // ---- floor switch: re-filter indoor, features and route segments ----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const floor = onFloorFilter(level);
    map.setFilter("indoor-room-fill", ["all", ["==", ["get", "kind"], "room"], floor]);
    map.setFilter("indoor-room-outline", ["all", ["==", ["get", "kind"], "room"], floor]);
    map.setFilter("indoor-room-label", ["all", ["==", ["get", "kind"], "room"], floor]);
    map.setFilter("features-line", ["all", ["==", ["geometry-type"], "LineString"], floor]);
    map.setFilter("features-point", ["all", ["==", ["geometry-type"], "Point"], floor]);
    // Paths of all floors stay visible (colour tells the floor); the selected
    // floor is drawn on top by dimming the others slightly.
    map.setPaintProperty("paths-line", "line-opacity", [
      "case",
      ["==", ["get", "kind"], "road"],
      0.55,
      ["any", ["==", ["to-string", ["get", "floor"]], level], ["in", ";", ["to-string", ["get", "level"]]]],
      0.95,
      0.5,
    ]);
  }, [loaded, level]);

  // ---- from / to pins -----------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const sync = (ref, place, kind) => {
      if (!place) {
        ref.current?.remove();
        ref.current = null;
        return;
      }
      if (!ref.current) ref.current = new maplibregl.Marker({ element: markerElement(kind), anchor: "bottom" }).setLngLat([place.lon, place.lat]).addTo(map);
      else ref.current.setLngLat([place.lon, place.lat]);
    };
    sync(fromMarker, from, "from");
    sync(toMarker, to, "to");
    if ((from && !to) || (!from && to)) {
      const p = from ?? to;
      map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), duration: 500 });
    }
  }, [loaded, from, to]);

  // ---- route --------------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    closePopup();
    if (!result) {
      for (const id of ["route", "route-compare", "connectors", "snap"]) map.getSource(id).setData(EMPTY);
      return;
    }
    const { main, comparison } = result;
    map.getSource("route").setData(main.segments ?? main.line);
    map.getSource("connectors").setData(main.connectors);
    map.getSource("snap").setData(main.snapPoints ?? EMPTY);
    map.getSource("route-compare").setData(comparison && !comparison.sameAsMain ? comparison.line : EMPTY);

    const coords = [...main.line.geometry.coordinates, [main.from.lon, main.from.lat], [main.to.lon, main.to.lat]];
    const b = coordsBbox(coords);
    const desktop = window.matchMedia("(min-width: 900px)").matches;
    map.fitBounds(bboxToBounds(b), {
      padding: desktop ? { top: 60, bottom: 60, left: 440, right: 60 } : { top: 80, bottom: 320, left: 40, right: 40 },
      maxZoom: 18.5,
      duration: 700,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, result]);

  // ---- hovered direction step ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    map.getSource("step").setData(hoveredStep?.coord ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: hoveredStep.coord } } : EMPTY);
  }, [loaded, hoveredStep]);

  // ---- focus request from the panel -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map || !focus?.coord) return;
    map.easeTo({ center: focus.coord, zoom: Math.max(map.getZoom(), focus.zoom ?? 18), duration: 600 });
    if (focus.issue) openPopup(map, focus.coord, <QaPopup issue={focus.issue} />);
  }, [loaded, focus]);

  return <div ref={containerRef} className="map" role="application" aria-label="Map of IIT Kanpur" />;
}
