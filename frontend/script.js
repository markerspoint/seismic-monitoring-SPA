async function loadEarthquakes() {
  const res = await fetch("http://localhost:3001/api/earthquakes");
  const quakes = await res.json();

  quakes.forEach(eq => {
    L.circleMarker([eq.lat, eq.lon], {
      radius: eq.magnitude * 2
    }).addTo(map)
      .bindPopup(`
        <b>${eq.magnitude}</b> ML<br/>
        ${eq.location}<br/>
        ${eq.datetime}<br/>
        Depth: ${eq.depth_km} km
      `);
  });
}

loadEarthquakes();
