
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxGeocoder from '@mapbox/mapbox-gl-geocoder';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-geocoder/dist/mapbox-gl-geocoder.css';
import {
  circle as turfCircle,
  distance as turfDistance,
  midpoint as turfMidpoint
} from '@turf/turf';
import '../App.css';

// This iss the Token from .env
mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN;

export default function MapboxGl() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(
    new mapboxgl.Popup({ className: 'quake-popup', closeButton: false, closeOnClick: false })
  );
  const lastQuakesRef = useRef(null);
  const spinRef = useRef(true);
  const [projection, setProjection] = useState('globe');

  useEffect(() => {
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-v9',
      projection: projection,
      center: [0, 20],
      zoom: 1.5,
      antialias: true,
    });
    mapRef.current = map;

    //  dont mess - Main Geocoder control
    map.addControl(
      new MapboxGeocoder({ accessToken: mapboxgl.accessToken, mapboxgl }),
      'top-left'
    );

    map.on('load', () => {
      map.setFog({});
      fetchAndUpdate(true);
      const interval = setInterval(() => fetchAndUpdate(false), 60_000);
      startSpin();
      map.on('mousemove', 'quake-points', onHover);
      map.on('mouseleave', 'quake-points', onLeave);
      return () => {
        clearInterval(interval);
        map.remove();
      };
    });

    // hard Cleanup function
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
      }
    };
    //  react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setProjection({ name: projection });
    }
  }, [projection]);

  async function fetchAndUpdate(initial) {
    const map = mapRef.current;
    const past30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0];
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${past30}&minmagnitude=5`;
    const res = await fetch(url);
    const data = await res.json();

    // New quake notifications - should wrk/
    if (!initial) {
      const prevIds = (lastQuakesRef.current?.features || []).map(f => f.id);
      data.features.forEach(f => {
        if (!prevIds.includes(f.id) && f.properties.mag >= 5) {
          Notification.permission === 'granted'
            ? new Notification(`M${f.properties.mag.toFixed(1)} quake`, { body: f.properties.place })
            : Notification.requestPermission();
        }
      });
    }

    // Update or add quake-points layer
    if (initial) {
      map.addSource('quake-points', { type: 'geojson', data });
      map.addLayer({
        id: 'quake-points',
        type: 'circle',
        source: 'quake-points',
        paint: {
          'circle-color': '#E55E5E',
          'circle-opacity': 0.8,
          'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 5, 6, 8, 12, 10, 20]
        }
      });
    } else {
      map.getSource('quake-points').setData(data);
    }

    // Actual task given -> "risk areas" where any two quakes are <=20km apart but i dont know why this is not working
    const coords = data.features.map(f => f.geometry.coordinates);
    const riskCircles = [];
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        const d = turfDistance(coords[i], coords[j], { units: 'kilometers' });
        if (d <= 20) {
          // midpoint between the two quake points
          const mid = turfMidpoint(coords[i], coords[j]).geometry.coordinates;
          // circle radius = half the distance to cover both
          riskCircles.push(
            turfCircle(mid, d / 2, { steps: 64, units: 'kilometers' })
          );
        }
      }
    }
    let zoneData;
    if (riskCircles.length === 0) {
      zoneData = { type: 'FeatureCollection', features: [] };
    } else if (riskCircles.length === 1) {
      zoneData = { type: 'FeatureCollection', features: [riskCircles[0]] };
    } else {
      // Using all the circles (no union) to display risk zones
      zoneData = { type: 'FeatureCollection', features: riskCircles };
    }

    // Update or adding the risk-area layer somewhere fked -> cant figure out this logic/
    if (initial) {
      map.addSource('risk-area', { type: 'geojson', data: zoneData });
      map.addLayer({
        id: 'risk-area-fill',
        type: 'fill',
        source: 'risk-area',
        paint: {
          'fill-color': 'rgba(255,255,0,0.3)',
          'fill-outline-color': 'rgba(255,255,0,0.6)'
        },
        before: 'quake-points'
      });
    } else {
      map.getSource('risk-area').setData(zoneData);
    }

    lastQuakesRef.current = data;
  }

  function onHover(e) {
    const { properties, geometry } = e.features[0];
    const coords = geometry.coordinates.slice();
    const date = new Date(properties.time).toLocaleString();
    popupRef.current
      .setLngLat(coords)
      .setHTML(`<strong>${properties.place}</strong><br/>Mag: ${properties.mag.toFixed(1)}<br/>${date}`)
      .addTo(mapRef.current);
  }
  function onLeave() {
    popupRef.current.remove();
  }

  function startSpin() {
    const map = mapRef.current;
    let frame;
    const animate = () => {
      if (!spinRef.current) return;
      const c = map.getCenter();
      map.jumpTo({ center: [c.lng - 0.05, c.lat] });
      frame = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(frame);
  }
  function toggleSpin() {
    spinRef.current = !spinRef.current;
    if (spinRef.current) startSpin();
  }

  return (
    <>
      <div ref={mapContainer} id="map" />
      <div className="controls">
        <label>
          Projection:
          <select value={projection} onChange={e => setProjection(e.target.value)}>
            <option value="globe">Globe</option>
            <option value="mercator">Mercator</option>
            <option value="winkelTripel">Winkel-Tripel</option>
            <option value="robinson">Robinson</option>
          </select>
        </label>
        <button onClick={toggleSpin}>Toggle Rotation</button>
      </div>
    </>
  );
}
