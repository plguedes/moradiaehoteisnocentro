(function () {
  if (typeof MAPBOX_ACCESS_TOKEN === "undefined") return;
  mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

  let chartInstance = null;
  let allData = [];

  const TYPE_COLOR = {
    "Coliving": "#FF00FF", "Flat": "#007AFF", "HIS": "#34C759", "Hotel": "#FF9500", 
    "Hostel": "#5856D6", "Ocupação": "#FF3B30", "Pousada": "#AF52DE", 
    "Res. Misto": "#5AC8FA", "Res. Multifamiliar": "#1C1C1E" 
  };

  const map = new mapboxgl.Map({
    container: "map", 
    style: "mapbox://styles/mapbox/light-v11",
    center: [-34.8781, -8.0641], 
    zoom: 15
  });

  function parseNumber(v) {
    if (!v) return null;
    const s = v.toString().replace(/\s/g, "").replace("R$", "").replace("m²", "").replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s.replace(/[^\d.-]/g, ""));
    return isNaN(n) ? null : n;
  }

  function splitLabel(str) {
    if (!str || str.length <= 15) return str;
    const words = str.split(' ');
    let line1 = "";
    let line2 = "";
    for (let i = 0; i < words.length; i++) {
      if ((line1 + words[i]).length < 18) {
        line1 += (line1 === "" ? "" : " ") + words[i];
      } else {
        line2 = words.slice(i).join(' ');
        break;
      }
    }
    return line2 === "" ? line1 : [line1, line2];
  }

  function downloadCSV() {
    if (!allData.length) return;
    const headers = Object.keys(allData[0]).filter(k => !k.startsWith('_'));
    const csvRows = [headers.join(',')];
    for (const row of allData) {
      const values = headers.map(header => {
        const val = row[header] ?? "";
        return `"${val.toString().replace(/"/g, '""')}"`;
      });
      csvRows.push(values.join(','));
    }
    const blob = new Blob(["\ufeff" + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", "dados_territoriais_recife.csv");
    link.click();
  }

  function updateHistogram(filtered, mode) {
    const canvas = document.getElementById('chartCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const titleEl = document.getElementById('chartTitle');
    if (chartInstance) chartInstance.destroy();

    const currentMode = mode || "padrao";
    const isStandard = currentMode === "padrao";
    const prop = isStandard ? 'count' : (currentMode === "populacao" ? "_pop" : "_area");

    if (titleEl) {
      if (isStandard) titleEl.textContent = "Frequência por tipo";
      else if (currentMode === "populacao") titleEl.textContent = "Top 10 população";
      else if (currentMode === "area") titleEl.textContent = "Top 10 área construída";
    }

    let labels, dataValues, colors;
    if (isStandard) {
      const counts = {};
      filtered.forEach(d => counts[d.TIPO] = (counts[d.TIPO] || 0) + 1);
      const sortedKeys = Object.keys(counts).sort((a,b) => counts[b] - counts[a]);
      labels = sortedKeys.map(splitLabel);
      dataValues = sortedKeys.map(k => counts[k]);
      colors = sortedKeys.map(l => (TYPE_COLOR[l] || "#000") + "CC");
    } else {
      const valid = filtered.filter(d => d[prop] !== null);
      const sorted = [...valid].sort((a, b) => b[prop] - a[prop]).slice(0, 10);
      labels = sorted.map(d => splitLabel(d.NOME));
      dataValues = sorted.map(d => d[prop]);
      colors = sorted.map(d => (TYPE_COLOR[d.TIPO] || "#CCCCCC") + "CC");
    }

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: { 
        labels: labels, 
        datasets: [{ data: dataValues, backgroundColor: colors, barPercentage: 0.9, categoryPercentage: 0.6 }] 
      },
      options: { 
        indexAxis: 'y',
        responsive: true, 
        maintainAspectRatio: false, 
        plugins: { 
          legend: { display: false },
          tooltip: {
            enabled: true,
            callbacks: {
              title: (context) => {
                const label = context[0].label;
                return Array.isArray(label) ? label.join(' ') : label;
              }
            }
          }
        },
        scales: { 
          x: { beginAtZero: true, grid: { display: false } }, 
          y: { 
            ticks: { font: { size: 9, lineHeight: 1.0 }, autoSkip: false, padding: 5, crossAlign: 'far' },
            grid: { display: true, drawBorder: false, color: 'rgba(0,0,0,0.05)' }
          } 
        },
        layout: { padding: { left: 5, right: 15 } }
      }
    });
  }

  function applyFilters() {
    const currentMode = document.getElementById("sizeFilter")?.value || "padrao";
    const typeVal = document.getElementById("typeFilter")?.value || "all";
    const bairroVal = document.getElementById("bairroFilter")?.value || "all";
    const statusVal = document.getElementById("statusFilter")?.value || "all";

    const filtered = allData.filter(d => 
      (typeVal === "all" || d.TIPO === typeVal) &&
      (bairroVal === "all" || d.BAIRRO === bairroVal) &&
      (statusVal === "all" || d.SITUAÇÃO === statusVal)
    );

    const prop = currentMode === "populacao" ? "_pop" : "_area";
    const geojson = {
      type: "FeatureCollection",
      features: filtered.map(p => ({
        type: "Feature", 
        geometry: { type: "Point", coordinates: [p._lng, p._lat] },
        properties: { ...p, color: (currentMode !== "padrao" && p[prop] === null) ? "#CCCCCC" : (TYPE_COLOR[p.TIPO] || "#000000") }
      }))
    };

    if (!map.getSource("pts")) {
      map.addSource("pts", { type: "geojson", data: geojson });
      map.addLayer({
        id: "pts-circle", type: "circle", source: "pts",
        paint: { "circle-color": ["get", "color"], "circle-opacity": 0.8, "circle-stroke-width": 3, "circle-stroke-color": "#fff" }
      });
    } else { 
      map.getSource("pts").setData(geojson); 
    }

    const maxVal = Math.max(...filtered.map(d => d[prop] || 0), 1);
    const rad = currentMode === "padrao" ? 7 : ["interpolate", ["linear"], ["get", prop], 0, 4, maxVal, 22];
    map.setPaintProperty("pts-circle", "circle-radius", rad);

    const tbody = document.getElementById("summaryTableBody");
    const tfoot = document.getElementById("summaryFooter");
    if (tbody && tfoot) {
      let tI = 0, tP = 0; tbody.innerHTML = "";
      Object.keys(TYPE_COLOR).sort().forEach(t => {
        const list = filtered.filter(d => d.TIPO === t);
        if(list.length > 0) {
          const sP = list.reduce((s,i)=>s+(i._pop || 0), 0);
          tI += list.length; tP += sP;
          tbody.innerHTML += `<tr><td>${t}</td><td>${list.length}</td><td>${sP}</td></tr>`;
        }
      });
      tfoot.innerHTML = `<tr><td>TOTAL</td><td>${tI}</td><td>${tP}</td></tr>`;
    }
    updateHistogram(filtered, currentMode);
  }

  map.on("load", async () => {
    document.getElementById("downloadCsv")?.addEventListener("click", downloadCSV);
    const peris = [['recentro','#FF3B30'],['ircentro','#34C759'],['porto_digital','#007AFF']];
    peris.forEach(p => {
      map.addSource(p[0], { type: 'geojson', data: `./${p[0]}.geojson` });
      map.addLayer({ id: p[0], type: 'line', source: p[0], layout: { visibility: 'none' }, paint: { 'line-color': p[1], 'line-width': 2.5, 'line-dasharray': [10, 8] } });
    });

    ['recentro', 'ircentro', 'porto'].forEach(id => {
      const el = document.getElementById(`check-${id}`);
      if (el) el.addEventListener('change', e => map.setLayoutProperty(id === 'porto' ? 'porto_digital' : id, 'visibility', e.target.checked ? 'visible' : 'none'));
    });

    try {
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${SHEET_TAB}?key=${GOOGLE_SHEETS_API_KEY}`);
      const data = await res.json();
      const headers = data.values[0];
      
      allData = data.values.slice(1).map(r => {
        let obj = {}; headers.forEach((h, i) => obj[h] = r[i] ?? "");
        const lat = parseFloat(obj.latitude?.toString().replace(",", "."));
        const lng = parseFloat(obj.longitude?.toString().replace(",", "."));
        return { 
          ...obj, _lat: lat, _lng: lng, 
          _pop: parseNumber(obj["POPULAÇÃO"]), 
          _area: parseNumber(obj["ÁREA CONSTRUÍDA"]) 
        };
      }).filter(p => !isNaN(p._lat));

      const legendGrid = document.getElementById("legendGrid");
      if (legendGrid) {
        legendGrid.innerHTML = "";
        Object.keys(TYPE_COLOR).sort().forEach(t => {
          legendGrid.innerHTML += `<div class="type-pill"><span class="dot" style="background:${TYPE_COLOR[t]}"></span>${t}</div>`;
        });
      }

      ["typeFilter", "bairroFilter", "statusFilter"].forEach(id => {
        const el = document.getElementById(id);
        const prop = id === "typeFilter" ? "TIPO" : id === "bairroFilter" ? "BAIRRO" : "SITUAÇÃO";
        const vals = [...new Set(allData.map(d => d[prop]).filter(Boolean))].sort();
        el.innerHTML = `<option value="all">Todos</option>` + vals.map(v => `<option value="${v}">${v}</option>`).join("");
      });

      ["typeFilter", "bairroFilter", "statusFilter", "sizeFilter"].forEach(id => document.getElementById(id).addEventListener("change", applyFilters));
      applyFilters();

      map.on('click', 'pts-circle', (e) => {
        const p = e.features[0].properties;
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=400x240&location=${p._lat},${p._lng}&fov=120&pitch=15&source=outdoor&key=${GOOGLE_STREETVIEW_API_KEY}`;
        new mapboxgl.Popup().setLngLat([p._lng, p._lat]).setHTML(`
          <div class="popup-header"><h4>${p.NOME}</h4></div>
          <img src="${svUrl}" class="sv-img" />
          <div class="popup-body">
            <p><strong>Bairro:</strong> ${p.BAIRRO}</p>
            <p><strong>Tipo:</strong> ${p.TIPO}</p>
            <p><strong>Situação:</strong> ${p.SITUAÇÃO}</p>
            <p><strong>Unidades:</strong> ${p.UNIDADES} (${p['Unidade-tipo'] || 'não informado'})</p>
            <p><strong>População:</strong> ${p.POPULAÇÃO || 'pendente'}</p>
            <p><strong>Área:</strong> ${p['ÁREA CONSTRUÍDA'] || 'pendente'}</p>
            <p><strong>Investimento:</strong> ${p.INVESTIMENTO || 'não informado'}</p>
            <p><strong>Cronograma:</strong> ${p.INÍCIO || 'não definido'} até ${p.ENTREGA || 'não definido'}</p>
            <p style="font-size:9px; color:#999; margin-top:8px;">DSQFL: ${p.DSQFL}</p>
          </div>
        `).addTo(map);
      });
    } catch (e) { console.error(e); }
  });
})();