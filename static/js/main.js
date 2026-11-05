/**
 * main.js - Education Spatial Analytics Platform
 * Editorial Swiss Grid & High-Precision Data Visualization
 */

let mapInstance = null;
let currentGeoJsonLayer = null;
let geoJsonCache = null;
let currentClusterResults = [];
let activeClusterFilter = 'all';
let mapLegendControl = null;
let mapSearchControl = null;

// Bảng màu phân cụm Editorial (Trầm, sang trọng, độ tương phản học thuật cao)
const CLUSTER_COLORS = [
    '#1D3557', // Cụm 1: Deep Prussian Navy
    '#C85A32', // Cụm 2: Terracotta Clay
    '#2A9D8F', // Cụm 3: Verdigris Sage
    '#D4A373', // Cụm 4: Warm Ochre
    '#6D597A', // Cụm 5: Muted Plum
    '#457B9D', // Cụm 6: Steel Blue
    '#588157', // Cụm 7: Dry Moss
    '#8D99AE'  // Cụm 8: Warm Slate
];

const PLOT_FONT = {
    family: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, sans-serif',
    color: '#0B132B'
};

const PLOT_GRID_COLOR = '#EFEDE6';
const API_BASE_URL = (window.APP_CONFIG?.apiBaseUrl || '').replace(/\/+$/, '');

document.addEventListener("DOMContentLoaded", function () {
    initEventListeners();
});

// 1. KHỞI TẠO BẢN ĐỒ NỀN TỐI GIẢN
function initLeafletMap() {
    const mapElement = document.getElementById('map');
    if (!mapElement || mapInstance) return;

    mapInstance = L.map('map', {
        center: [16.047079, 108.206230],
        zoom: 6,
        zoomControl: true,
        scrollWheelZoom: true
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri',
        maxZoom: 16
    }).addTo(mapInstance);
}

// 2. LẮNG NGHE SỰ KIỆN GIAO DIỆN
function initEventListeners() {
    const inputFile = document.getElementById('inputFile');
    const btnRun = document.getElementById('btnRun');
    if (!inputFile || !btnRun) return;

    inputFile.addEventListener('change', async function (e) {
        const file = e.target.files[0];
        const provinceField = document.getElementById('selectProvCol');
        const scoreField = document.getElementById('selectScoreCol');
        const mappingStatus = document.getElementById('columnMappingStatus');
        btnRun.disabled = true;
        resetColumnSelect(provinceField, 'Chọn cột mã tỉnh');
        resetColumnSelect(scoreField, 'Chọn cột điểm số');
        mappingStatus.textContent = '';
        mappingStatus.className = 'small mt-3';
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_BASE_URL}/api/preview-file`, { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Lỗi khi đọc file xem trước');

            if (data.columns && data.columns.length > 0) {
                autoMapColumns(data.columns);
                renderPreviewTable(data.columns, data.preview_data);
            } else {
                mappingStatus.textContent = 'Không tìm thấy cột nào trong tệp. Vui lòng kiểm tra lại file.';
                mappingStatus.classList.add('text-danger');
            }
        } catch (err) {
            alert(`Lỗi: ${err.message}`);
            inputFile.value = '';
            btnRun.disabled = true;
        }
    });

    [provinceField, scoreField].forEach(field => {
        field.addEventListener('change', function () {
            const hasValidMapping = provinceField.value
                && scoreField.value
                && provinceField.value !== scoreField.value;
            btnRun.disabled = !hasValidMapping;

            if (hasValidMapping) {
                mappingStatus.textContent = 'Đã chọn cột mã tỉnh và cột điểm số.';
                mappingStatus.className = 'small mt-3 text-success';
            } else {
                mappingStatus.textContent = 'Vui lòng chọn hai cột khác nhau để tiếp tục.';
                mappingStatus.className = 'small mt-3 text-warning';
            }
        });
    });

    btnRun.addEventListener('click', async function () {
        const fileInput = document.getElementById('inputFile');
        const colProv = document.getElementById('selectProvCol').value;
        const colScore = document.getElementById('selectScoreCol').value;
        const algo = document.getElementById('selectAlgo').value;
        const kVal = document.getElementById('inputK').value;
        const k = Number(kVal);
        const linkageElem = document.getElementById('selectLinkage');
        const linkageVal = linkageElem ? linkageElem.value : 'ward';

        if (!fileInput.files[0] || !colProv || !colScore) {
            alert('Không nhận diện được cột Mã tỉnh hoặc cột Điểm số trong tệp.');
            return;
        }
        if (!Number.isInteger(k) || k < 2 || k > 7) {
            alert('Số cụm k phải là số nguyên từ 2 đến 7.');
            document.getElementById('inputK').focus();
            return;
        }

        toggleLoadingState(true);

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('col_province', colProv);
        formData.append('col_score', colScore);
        formData.append('algorithm', algo);
        formData.append('k', kVal);
        formData.append('linkage', linkageVal);

        try {
            const res = await fetch(`${API_BASE_URL}/api/run-clustering`, { method: 'POST', body: formData });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || 'Lỗi tính toán mô hình');

            const resultBox = document.getElementById('resultContainer');
            resultBox.style.display = 'block';

            currentClusterResults = data.province_results || [];

            if (!mapInstance) {
                initLeafletMap();
            }

            renderMacroKPIs(currentClusterResults);
            await renderChoroplethMap(currentClusterResults);
            renderClusterSummaryAndFilters(currentClusterResults);
            renderTabCharts(currentClusterResults);
            renderDiagnostics(data.metrics, algo);
            renderFullProvincesTable(currentClusterResults);

            setTimeout(() => {
                if (mapInstance) mapInstance.invalidateSize(true);
            }, 200);

            resultBox.scrollIntoView({ behavior: 'smooth' });

        } catch (err) {
            alert(`Thao tác thất bại: ${err.message}`);
        } finally {
            toggleLoadingState(false);
        }
    });
}

// 3. TỰ NHẬN DIỆN CỘT & HIỂN THỊ BẢNG XEM TRƯỚC
function resetColumnSelect(select, placeholder) {
    select.replaceChildren(new Option(placeholder, ''));
    select.value = '';
    select.disabled = true;
}

function autoMapColumns(columns) {
    const provinceField = document.getElementById('selectProvCol');
    const scoreField = document.getElementById('selectScoreCol');
    const status = document.getElementById('columnMappingStatus');
    const btnRun = document.getElementById('btnRun');
    const populateOptions = (select, placeholder) => {
        select.replaceChildren(new Option(placeholder, ''));
        columns.forEach(column => select.add(new Option(column, column)));
        select.disabled = false;
    };

    populateOptions(provinceField, 'Chọn cột mã tỉnh');
    populateOptions(scoreField, 'Chọn cột điểm số');

    const normalize = value => String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const findColumn = (aliases, fieldType) => {
        const matches = columns.map(column => {
            const name = normalize(column);
            const tokens = name.split('_');
            const matchingAlias = aliases
                .filter(alias => name === alias || (alias.length >= 5 && name.includes(alias)))
                .sort((a, b) => b.length - a.length)[0];

            if (matchingAlias) {
                return { column, score: matchingAlias.length + (name === matchingAlias ? 100 : 0) };
            }

            if (fieldType === 'province') {
                const hasProvinceToken = tokens.includes('tinh') || tokens.includes('province');
                const hasCodeToken = tokens.some(token =>
                    ['ma', 'code', 'id', 'tp', 'thanh', 'thanhpho'].includes(token)
                );
                if (hasProvinceToken && hasCodeToken) return { column, score: 50 + tokens.length };
                if (name === 'tinh' || name === 'province') return { column, score: 10 };
            }

            return null;
        }).filter(Boolean);
        const bestScore = Math.max(0, ...matches.map(match => match.score));
        const bestMatches = matches.filter(match => match.score === bestScore);
        return bestMatches.length === 1 ? bestMatches[0].column : '';
    };

    const provinceColumn = findColumn([
        'ma_tinh_thanh_pho', 'ma_tinh_thanhpho', 'matinhthanhpho',
        'ma_tinh_thanh', 'matinhthanh', 'ma_tinh_tp', 'matinhtp',
        'ma_tinh', 'matinh', 'ma_tp', 'matp', 'ma_dia_phuong',
        'ma_don_vi', 'code_tinh', 'tinh_code', 'province_id',
        'province_code', 'id_tinh', 'province'
    ], 'province');
    const scoreColumn = findColumn([
        'diem_tieng_anh', 'diem_ngoai_ngu', 'english_score',
        'diem_thi_anh', 'diem_anh', 'tieng_anh', 'ngoai_ngu',
        'diem_thi', 'score', 'diem'
    ], 'score');

    provinceField.value = provinceColumn;
    scoreField.value = scoreColumn;
    btnRun.disabled = !provinceColumn || !scoreColumn || provinceColumn === scoreColumn;

    if (!provinceColumn || !scoreColumn || provinceColumn === scoreColumn) {
        status.textContent = 'Không tự nhận diện đủ cột. Vui lòng chọn cột mã tỉnh và cột điểm số ở danh sách.';
        status.className = 'small mt-3 text-warning';
        return false;
    }

    status.textContent = 'Đã tự nhận diện cột mã tỉnh và cột điểm số.';
    status.className = 'small mt-3 text-success';
    return true;
}

function renderPreviewTable(columns, rows) {
    const container = document.getElementById('previewContainer');
    const table = document.getElementById('tablePreview');
    if (!container || !table) return;

    container.style.display = 'block';
    let headerHtml = '<thead><tr>' + columns.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead>';
    let bodyHtml = '<tbody class="num-mono">' + rows.map(r => {
        return '<tr>' + columns.map(c => `<td>${escapeHtml(String(r[c] !== null && r[c] !== undefined ? r[c] : ''))}</td>`).join('') + '</tr>';
    }).join('') + '</tbody>';

    table.innerHTML = headerHtml + bodyHtml;
}

// 4. HIỂN THỊ KPI TỔNG QUAN VĨ MÔ
function renderMacroKPIs(data) {
    if (!data || data.length === 0) return;
    const totalCandidates = data.reduce((acc, curr) => acc + curr.total_candidates, 0);
    const nationalMean = data.reduce((acc, curr) => acc + (curr.mean * curr.total_candidates), 0) / totalCandidates;
    const nationalLiet = data.reduce((acc, curr) => acc + (curr.rate_liet * curr.total_candidates), 0) / totalCandidates;
    const nationalGte8 = data.reduce((acc, curr) => acc + (curr.rate_gte_8 * curr.total_candidates), 0) / totalCandidates;

    document.getElementById('kpiTotalCandidates').textContent = Number(totalCandidates).toLocaleString('vi-VN');
    document.getElementById('kpiNationalMean').textContent = nationalMean.toFixed(2);
    document.getElementById('kpiNationalLiet').textContent = `${nationalLiet.toFixed(2)}%`;
    document.getElementById('kpiNationalGte8').textContent = `${nationalGte8.toFixed(2)}%`;
}

// 5. BẢN ĐỒ CHOROPLETH
async function renderChoroplethMap(provinces) {
    if (!mapInstance) return;

    const provLookup = {};
    const layerMapping = {};
    provinces.forEach(p => {
        provLookup[String(p.province_id).padStart(2, '0')] = p;
    });

    if (!geoJsonCache) {
        try {
            const response = await fetch('/static/data/vietnam_provinces.geojson');
            if (!response.ok) throw new Error("Không thể tải file GeoJSON 34 tỉnh");
            geoJsonCache = await response.json();
        } catch (e) {
            console.error("Lỗi GeoJSON:", e);
            return;
        }
    }

    if (currentGeoJsonLayer) {
        mapInstance.removeLayer(currentGeoJsonLayer);
    }

    currentGeoJsonLayer = L.geoJSON(geoJsonCache, {
        style: feature => {
            const pid = getFeatureProvinceId(feature);
            const info = provLookup[pid];
            const isMatch = activeClusterFilter === 'all' || (info && String(info.cluster) === String(activeClusterFilter));
            const clusterColor = info ? CLUSTER_COLORS[info.cluster % CLUSTER_COLORS.length] : '#D5D2C8';

            return {
                fillColor: clusterColor,
                weight: isMatch ? 1.1 : 0.5,
                opacity: 1,
                color: isMatch ? '#F9F9F6' : '#E6E4DD',
                fillOpacity: isMatch ? 0.88 : 0.14
            };
        },
        onEachFeature: (feature, layer) => {
            const pid = getFeatureProvinceId(feature);
            const info = provLookup[pid];
            if (info) {
                layerMapping[pid] = layer;
                const color = CLUSTER_COLORS[info.cluster % CLUSTER_COLORS.length];
                const tooltipHtml = `
                    <div style="font-family: var(--font-sans); min-width: 230px; padding: 6px 4px; color: #0B132B;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <strong style="font-size: 14px; letter-spacing: -0.02em;">${info.province_name}</strong>
                            <span style="background-color: ${color}; color: #fff; font-size: 10px; padding: 2px 8px; border-radius: 999px; font-weight: 600;">
                                Cụm ${info.cluster + 1}
                            </span>
                        </div>
                        <div style="font-size: 12px; color: #4A5268; border-top: 1px solid #E6E4DD; padding-top: 8px; line-height: 1.6;">
                            <div style="display: flex; justify-content: space-between;"><span>Quy mô:</span> <b class="num-mono" style="color:#0B132B;">${Number(info.total_candidates).toLocaleString('vi-VN')}</b></div>
                            <div style="display: flex; justify-content: space-between;"><span>Điểm TB (Mean):</span> <b class="num-mono" style="color:#0B132B;">${info.mean}</b></div>
                            <div style="display: flex; justify-content: space-between;"><span>Trung vị (Median):</span> <b class="num-mono">${info.median}</b></div>
                            <div style="display: flex; justify-content: space-between;"><span>Độ lệch chuẩn:</span> <b class="num-mono">${info.std}</b></div>
                            <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #F1EFEA;">
                                <div style="display: flex; justify-content: space-between;"><span>Điểm Liệt (&le; 1.0):</span> <b class="num-mono" style="color: #C85A32;">${info.rate_liet}%</b></div>
                                <div style="display: flex; justify-content: space-between;"><span>Dưới TB (&lt; 5.0):</span> <b class="num-mono">${info.rate_under_5}%</b></div>
                                <div style="display: flex; justify-content: space-between;"><span>Điểm Giỏi (&ge; 8.0):</span> <b class="num-mono" style="color: #2A9D8F;">${info.rate_gte_8}%</b></div>
                            </div>
                        </div>
                    </div>
                `;
                layer.bindTooltip(tooltipHtml, { sticky: true, className: 'glass-box' });

                layer.on('mouseover', () => {
                    layer.setStyle({ weight: 2.2, color: '#0B132B', fillOpacity: 0.96 });
                    layer.bringToFront();
                });
                layer.on('mouseout', () => {
                    currentGeoJsonLayer.resetStyle(layer);
                });
                layer.on('click', () => {
                    const elem = layer.getElement();
                    if (elem && typeof elem.blur === 'function') {
                        elem.blur();
                    }
                    mapInstance.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 8 });
                });
            }
        }
    }).addTo(mapInstance);

    try {
        mapInstance.fitBounds(currentGeoJsonLayer.getBounds(), { padding: [24, 24] });
    } catch (e) {
        mapInstance.setView([16.047079, 108.206230], 6);
    }

    updateMapLegend(provinces);
    updateMapSearchControl(provinces, layerMapping);
}

function updateMapSearchControl(provinces, layerMapping) {
    if (mapSearchControl) {
        mapInstance.removeControl(mapSearchControl);
    }

    mapSearchControl = L.control({ position: 'topright' });
    mapSearchControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'glass-box');
        div.style.padding = '6px 12px';

        let options = '<option value="">Định vị nhanh Tỉnh/Thành...</option>';
        [...provinces].sort((a, b) => a.province_name.localeCompare(b.province_name)).forEach(p => {
            options += `<option value="${p.province_id}">${p.province_name} — Cụm ${p.cluster + 1}</option>`;
        });

        div.innerHTML = `<select id="mapProvSelector" class="form-select form-select-sm border-0 bg-transparent" style="min-width: 210px; font-weight: 600; font-size: 12px; color: #0B132B;">${options}</select>`;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    mapSearchControl.addTo(mapInstance);

    setTimeout(() => {
        const selector = document.getElementById('mapProvSelector');
        if (selector) {
            selector.addEventListener('change', function () {
                const targetLayer = layerMapping[this.value];
                if (targetLayer) {
                    mapInstance.fitBounds(targetLayer.getBounds(), { padding: [60, 60], maxZoom: 8 });
                    targetLayer.openTooltip();
                    targetLayer.setStyle({ weight: 2.5, color: '#0B132B', fillOpacity: 1 });
                    setTimeout(() => currentGeoJsonLayer.resetStyle(targetLayer), 2500);
                }
            });
        }
    }, 150);
}

function updateMapLegend(data) {
    if (mapLegendControl) {
        mapInstance.removeControl(mapLegendControl);
    }

    mapLegendControl = L.control({ position: 'bottomright' });
    mapLegendControl.onAdd = function () {
        const div = L.DomUtil.create('div', 'glass-box');
        div.style.padding = '12px 16px';
        div.style.fontSize = '12px';

        const clusters = [...new Set(data.map(d => d.cluster))].sort((a, b) => a - b);
        let content = '<span style="display:block; margin-bottom:8px; color:#848C9E; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.08em;">Chú giải Phân cụm</span>';
        clusters.forEach(c => {
            const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
            const count = data.filter(d => d.cluster === c).length;
            content += `
                <div style="display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:5px; color:#0B132B;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="width:10px; height:10px; background:${color}; border-radius:50%; display:inline-block;"></span>
                        <span style="font-weight:600;">Cụm ${c + 1}</span>
                    </div>
                    <span class="num-mono" style="color:#848C9E; font-size:11px;">${count} tỉnh</span>
                </div>
            `;
        });
        div.innerHTML = content;
        return div;
    };
    mapLegendControl.addTo(mapInstance);
}

function getFeatureProvinceId(feature) {
    const p = feature.properties || {};
    const raw = p.id ?? p.ma_tinh ?? p.ISO ?? p.GID_1 ?? '';
    return String(raw).padStart(2, '0');
}

// 6. BỘ LỌC CỤM & BẢNG TÓM TẮT ĐẶC TRƯNG
function renderClusterSummaryAndFilters(data) {
    const filterContainer = document.getElementById('clusterFilter');
    const tableBody = document.querySelector('#tableClusterSummary tbody');
    if (!filterContainer || !tableBody) return;

    const clusters = [...new Set(data.map(d => d.cluster))].sort((a, b) => a - b);

    const isAllActive = activeClusterFilter === 'all';
    let filterHtml = `
        <button class="btn btn-sm rounded-pill px-3 fw-semibold"
                style="border: 1px solid ${isAllActive ? '#0B132B' : '#E6E4DD'}; background-color: ${isAllActive ? '#0B132B' : '#FFFFFF'}; color: ${isAllActive ? '#FFFFFF' : '#4A5268'}; font-size: 0.78rem;"
                onclick="applyClusterFilter('all')">Tất cả (${data.length})</button>
    `;

    clusters.forEach(c => {
        const count = data.filter(d => d.cluster === c).length;
        const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];
        const isActive = String(activeClusterFilter) === String(c);

        filterHtml += `
            <button class="btn btn-sm rounded-pill px-3 fw-semibold"
                    style="border: 1px solid ${isActive ? color : '#E6E4DD'}; background-color: ${isActive ? color : '#FFFFFF'}; color: ${isActive ? '#FFFFFF' : '#0B132B'}; font-size: 0.78rem;"
                    onclick="applyClusterFilter(${c})">
                <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${isActive ? '#FFFFFF' : color}; margin-right:5px;"></span>
                Cụm ${c + 1} (${count})
            </button>
        `;
    });
    filterContainer.innerHTML = filterHtml;

    let rowsHtml = '';
    clusters.forEach(c => {
        const subset = data.filter(d => d.cluster === c);
        const count = subset.length;
        const avgMean = (subset.reduce((acc, curr) => acc + curr.mean, 0) / count).toFixed(2);
        const avgGte8 = (subset.reduce((acc, curr) => acc + curr.rate_gte_8, 0) / count).toFixed(2);
        const color = CLUSTER_COLORS[c % CLUSTER_COLORS.length];

        rowsHtml += `
            <tr>
                <td class="text-start">
                    <span class="d-inline-flex align-items-center gap-2 fw-semibold" style="color: #0B132B;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${color};"></span>
                        Cụm ${c + 1}
                    </span>
                </td>
                <td class="num-mono">${count}</td>
                <td class="num-mono fw-semibold" style="color: #0B132B;">${avgMean}</td>
                <td class="text-end" style="min-width: 110px;">
                    <div class="d-flex align-items-center justify-content-end gap-2">
                        <div class="progress flex-grow-1" style="height: 4px; max-width: 60px; background-color: #EFEDE6;">
                            <div class="progress-bar rounded-pill" style="width: ${Math.min(avgGte8 * 2.5, 100)}%; background-color: ${color};"></div>
                        </div>
                        <span class="num-mono small fw-medium" style="color: #0B132B;">${avgGte8}%</span>
                    </div>
                </td>
            </tr>
        `;
    });
    tableBody.innerHTML = rowsHtml;
}

window.applyClusterFilter = function (clusterId) {
    activeClusterFilter = clusterId;
    renderClusterSummaryAndFilters(currentClusterResults);
    if (currentGeoJsonLayer) {
        currentGeoJsonLayer.setStyle(currentGeoJsonLayer.options.style);
    }
};

// 7. BIỂU ĐỒ PHÂN TÍCH ĐA CHIỀU (TAB 02)
function renderTabCharts(data) {
    if (typeof Plotly === 'undefined') return;

    const clusters = [...new Set(data.map(d => d.cluster))].sort((a, b) => a - b);
    const plotConfig = { responsive: true, displayModeBar: false };

    // 1. Boxplot
    const boxTraces = clusters.map(c => ({
        y: data.filter(d => d.cluster === c).map(d => d.mean),
        type: 'box',
        name: `Cụm ${c + 1}`,
        marker: { color: CLUSTER_COLORS[c % CLUSTER_COLORS.length], size: 5 },
        boxpoints: 'all',
        jitter: 0.35,
        pointpos: -1.6,
        line: { width: 1.5 }
    }));
    Plotly.newPlot('chartBoxplot', boxTraces, {
        title: { text: 'Phân phối Điểm trung bình theo Cụm (Boxplot)', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        yaxis: { title: 'Điểm Trung Bình', gridcolor: PLOT_GRID_COLOR, zerolinecolor: PLOT_GRID_COLOR },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 50, b: 40, l: 50, r: 20 },
        font: PLOT_FONT
    }, plotConfig);

    // 2. Bubble Scatter
    const scatterTraces = clusters.map(c => {
        const subset = data.filter(d => d.cluster === c);
        return {
            x: subset.map(d => d.mean),
            y: subset.map(d => d.rate_gte_8),
            mode: 'markers+text',
            type: 'scatter',
            name: `Cụm ${c + 1}`,
            text: subset.map(d => d.province_name),
            textposition: 'top center',
            textfont: { size: 10, color: '#4A5268' },
            marker: {
                size: subset.map(d => Math.max(9, Math.min(28, Math.sqrt(d.total_candidates) / 4.5))),
                color: CLUSTER_COLORS[c % CLUSTER_COLORS.length],
                opacity: 0.85,
                line: { color: '#FFFFFF', width: 1.5 }
            },
            hovertemplate: '<b>%{text}</b> (Cụm ' + (c + 1) + ')<br>Điểm TB: %{x}<br>Tỷ lệ Giỏi: %{y}%<br>Quy mô: %{customdata:,} thí sinh<extra></extra>',
            customdata: subset.map(d => d.total_candidates)
        };
    });
    Plotly.newPlot('chartScatter', scatterTraces, {
        title: { text: 'Tương quan Điểm TB & Tỷ lệ Giỏi (Kích thước = Quy mô)', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        xaxis: { title: 'Điểm Trung Bình Tỉnh', gridcolor: PLOT_GRID_COLOR },
        yaxis: { title: 'Tỷ lệ Giỏi (%)', gridcolor: PLOT_GRID_COLOR },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 50, b: 45, l: 50, r: 20 },
        font: PLOT_FONT
    }, plotConfig);

    // 3. Radar Chart
    const radarCategories = ['Điểm TB', 'Trung Vị', '% Giỏi (≥8)', '% Dưới TB (<5)', 'Độ Lệch Chuẩn'];
    const radarTraces = clusters.map(c => {
        const subset = data.filter(d => d.cluster === c);
        const n = subset.length;
        const avgMean = subset.reduce((acc, curr) => acc + curr.mean, 0) / n;
        const avgMed = subset.reduce((acc, curr) => acc + curr.median, 0) / n;
        const avgGte8 = subset.reduce((acc, curr) => acc + curr.rate_gte_8, 0) / n;
        const avgUnder5 = subset.reduce((acc, curr) => acc + curr.rate_under_5, 0) / n;
        const avgStd = subset.reduce((acc, curr) => acc + curr.std, 0) / n;

        return {
            type: 'scatterpolar',
            r: [avgMean, avgMed, avgGte8, avgUnder5, avgStd],
            theta: radarCategories,
            fill: 'toself',
            name: `Cụm ${c + 1}`,
            line: { color: CLUSTER_COLORS[c % CLUSTER_COLORS.length], width: 2 },
            opacity: 0.65
        };
    });

    const radarContainer = document.getElementById('chartRadar');
    if (radarContainer) {
        Plotly.newPlot('chartRadar', radarTraces, {
            polar: {
                radialaxis: { visible: true, range: [0, 100], gridcolor: PLOT_GRID_COLOR },
                angularaxis: { gridcolor: PLOT_GRID_COLOR }
            },
            title: { text: 'Chân dung đa chiều Trọng tâm Cụm (Centroid Profile)', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
            plot_bgcolor: '#FFFFFF',
            paper_bgcolor: '#FFFFFF',
            margin: { t: 55, b: 40, l: 50, r: 50 },
            font: PLOT_FONT
        }, plotConfig);
    }

    // 4. Stacked Bar Chart
    const sortedData = [...data].sort((a, b) => (a.cluster - b.cluster) || (a.mean - b.mean));
    const traceUnder5 = {
        x: sortedData.map(d => d.province_name),
        y: sortedData.map(d => d.rate_under_5),
        name: 'Điểm dưới trung bình (< 5.0)',
        type: 'bar',
        marker: { color: '#C85A32' },
        hovertemplate: '%{x}<br>Dưới TB: %{y}%<extra></extra>'
    };
    const traceGte8 = {
        x: sortedData.map(d => d.province_name),
        y: sortedData.map(d => d.rate_gte_8),
        name: 'Điểm giỏi (≥ 8.0)',
        type: 'bar',
        marker: { color: '#2A9D8F' },
        hovertemplate: '%{x}<br>Điểm Giỏi: %{y}%<extra></extra>'
    };
    Plotly.newPlot('chartStackedBar', [traceUnder5, traceGte8], {
        barmode: 'stack',
        title: { text: 'Cấu trúc phân hóa học lực theo Tỉnh/Thành', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        yaxis: { title: 'Tỷ Lệ (%)', gridcolor: PLOT_GRID_COLOR },
        xaxis: { tickangle: -45, tickfont: { size: 9.5 } },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 65, b: 120, l: 50, r: 20 },
        font: PLOT_FONT,
        legend: {
            orientation: 'h',
            x: 0.98,
            y: 1,
            xanchor: 'right',
            yanchor: 'top',
            font: { ...PLOT_FONT, size: 11 },
            traceorder: 'normal'
        }
    }, plotConfig);
}

// 8. CHẨN ĐOÁN MÔ HÌNH (TAB 03)
function renderDiagnostics(metrics, algo) {
    if (!metrics) return;

    const silElem = document.getElementById('valSilhouette');
    const dbElem = document.getElementById('valDB');
    if (silElem) silElem.textContent = metrics.silhouette_score ?? '--';
    if (dbElem) dbElem.textContent = metrics.davies_bouldin_index ?? '--';

    if (metrics.diagnostics && metrics.diagnostics.silhouette.length > 0) {
        const silScores = metrics.diagnostics.silhouette;
        const kValues = metrics.diagnostics.elbow_k;
        const maxSilIdx = silScores.indexOf(Math.max(...silScores));
        const optimalK = kValues[maxSilIdx];
        const maxScore = silScores[maxSilIdx];

        const recoElem = document.getElementById('optimalKRecommendation');
        if (recoElem) {
            recoElem.innerHTML = `
                <div class="p-4 mb-4 rounded-4 border d-flex align-items-center justify-content-between flex-wrap gap-3" style="background-color: #FDF3EF; border-color: #F3D8CE !important;">
                    <div>
                        <span class="eyebrow-label mb-1" style="color: #C85A32;">Khuyến nghị tham số tự động</span>
                        <div style="color: #0B132B; font-size: 0.95rem;">
                            Cấu trúc phân cụm đạt cực đại về mặt toán học tại <strong class="num-mono">k = ${optimalK}</strong> với hệ số Silhouette đạt <strong class="num-mono">${maxScore}</strong>.
                        </div>
                    </div>
                </div>
            `;
        }
    }

    if (typeof Plotly === 'undefined' || !metrics.diagnostics) return;
    const plotConfig = { responsive: true, displayModeBar: false };

    // 1. Elbow
    const traceElbow = {
        x: metrics.diagnostics.elbow_k,
        y: metrics.diagnostics.wcss,
        type: 'scatter',
        mode: 'lines+markers',
        line: { color: '#0B132B', width: 2 },
        marker: { size: 7, color: '#C85A32' },
        hovertemplate: 'k = %{x}<br>WCSS = %{y:.2f}<extra></extra>'
    };
    Plotly.newPlot('chartElbow', [traceElbow], {
        title: { text: 'Đường cong Elbow (Phương sai nội cụm WCSS)', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        xaxis: { title: 'Số Cụm (k)', dtick: 1, gridcolor: PLOT_GRID_COLOR },
        yaxis: { title: 'Tổng WCSS', gridcolor: PLOT_GRID_COLOR },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 50, b: 45, l: 55, r: 20 },
        font: PLOT_FONT
    }, plotConfig);

    // 2. Silhouette
    const silColors = metrics.diagnostics.silhouette.map(val => val >= 0.4 ? '#2A9D8F' : val >= 0.25 ? '#1D3557' : '#D4A373');
    const traceSil = {
        x: metrics.diagnostics.elbow_k,
        y: metrics.diagnostics.silhouette,
        type: 'bar',
        marker: { color: silColors, opacity: 0.9 },
        hovertemplate: 'k = %{x}<br>Silhouette = %{y:.3f}<extra></extra>'
    };
    Plotly.newPlot('chartSilhouette', [traceSil], {
        title: { text: 'Biến thiên Hệ số Silhouette theo tham số k', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        xaxis: { title: 'Số Cụm (k)', dtick: 1, gridcolor: PLOT_GRID_COLOR },
        yaxis: { title: 'Silhouette Score', range: [0, 1], gridcolor: PLOT_GRID_COLOR },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 50, b: 45, l: 50, r: 20 },
        font: PLOT_FONT
    }, plotConfig);

    // 3. Dendrogram
    if (algo === 'hierarchical' && metrics.linkage_matrix) {
        renderDendrogram(metrics.linkage_matrix, currentClusterResults);
    }
}

// 9. CÂY PHÂN CẤP DENDROGRAM
function renderDendrogram(linkageMatrix, provinces) {
    if (!linkageMatrix || linkageMatrix.length === 0) return;

    const n = linkageMatrix.length + 1;
    const leafLabels = provinces.map(p => p.province_name);

    function getLeafOrder(nodeId) {
        if (nodeId < n) return [nodeId];
        const row = linkageMatrix[nodeId - n];
        return [...getLeafOrder(row[0]), ...getLeafOrder(row[1])];
    }

    const rootId = 2 * n - 2;
    const leafOrder = getLeafOrder(rootId);
    const leafX = {};
    leafOrder.forEach((leafIdx, pos) => { leafX[leafIdx] = pos; });

    const linesX = [];
    const linesY = [];

    function traverse(nodeId) {
        if (nodeId < n) return { x: leafX[nodeId], y: 0 };
        const row = linkageMatrix[nodeId - n];
        const left = traverse(row[0]);
        const right = traverse(row[1]);
        const currentH = row[2];
        const currentX = (left.x + right.x) / 2;

        linesX.push(left.x, left.x, right.x, right.x, null);
        linesY.push(left.y, currentH, currentH, right.y, null);
        return { x: currentX, y: currentH };
    }

    traverse(rootId);

    const dendroTrace = {
        x: linesX,
        y: linesY,
        mode: 'lines',
        type: 'scatter',
        line: { color: '#0B132B', width: 1.5 },
        hoverinfo: 'none'
    };

    Plotly.newPlot('chartDendrogram', [dendroTrace], {
        title: { text: 'Cấu trúc cây phân cấp (Agglomerative Hierarchical Dendrogram)', font: { ...PLOT_FONT, size: 14, weight: 600 }, x: 0.02 },
        xaxis: {
            tickmode: 'array',
            tickvals: leafOrder.map((_, idx) => idx),
            ticktext: leafOrder.map(idx => leafLabels[idx] || `Tỉnh ${idx}`),
            tickangle: -45,
            tickfont: { size: 10 }
        },
        yaxis: { title: 'Khoảng Cách Liên Kết', gridcolor: PLOT_GRID_COLOR },
        plot_bgcolor: '#FFFFFF',
        paper_bgcolor: '#FFFFFF',
        margin: { t: 50, b: 120, l: 55, r: 20 },
        font: PLOT_FONT
    }, { responsive: true, displayModeBar: false });
}

// 10. BẢNG DỮ LIỆU CHI TIẾT 34 TỈNH (TAB 04)
function renderFullProvincesTable(data) {
    const tbody = document.querySelector('#tableFullProvinces tbody');
    const clusterSelect = document.getElementById('tableClusterFilter');
    const searchInput = document.getElementById('tableFilterInput');
    if (!tbody || !clusterSelect || !searchInput) return;

    const clusters = [...new Set(data.map(d => d.cluster))].sort((a, b) => a - b);
    clusterSelect.innerHTML = '<option value="all">Tất cả các cụm</option>' +
        clusters.map(c => `<option value="${c}">Cụm ${c + 1}</option>`).join('');

    function updateTable() {
        const query = searchInput.value.toLowerCase().trim();
        const selectedCluster = clusterSelect.value;

        const filtered = data.filter(p => {
            const matchName = p.province_name.toLowerCase().includes(query) || p.province_id.includes(query);
            const matchCluster = selectedCluster === 'all' || String(p.cluster) === selectedCluster;
            return matchName && matchCluster;
        });

        tbody.innerHTML = filtered.map(p => {
            const color = CLUSTER_COLORS[p.cluster % CLUSTER_COLORS.length];
            return `
                <tr>
                    <td class="num-mono text-muted">${p.province_id}</td>
                    <td class="text-start fw-semibold" style="color: #0B132B;">${p.province_name}</td>
                    <td>
                        <span class="d-inline-flex align-items-center gap-1.5 px-2.5 py-1 rounded-pill small fw-semibold"
                              style="background-color: #F3F2EE; color: #0B132B; font-size: 0.75rem;">
                            <span style="width: 7px; height: 7px; border-radius: 50%; background-color: ${color}; display: inline-block; margin-right: 5px;"></span>
                            Cụm ${p.cluster + 1}
                        </span>
                    </td>
                    <td class="num-mono text-end">${Number(p.total_candidates).toLocaleString('vi-VN')}</td>
                    <td class="num-mono text-end fw-semibold" style="color: #0B132B;">${p.mean}</td>
                    <td class="num-mono text-end">${p.median}</td>
                    <td class="num-mono text-end">${p.std}</td>
                    <td class="num-mono text-end">${p.q1}</td>
                    <td class="num-mono text-end">${p.q3}</td>
                    <td class="num-mono text-end fw-medium" style="color: #C85A32;">${p.rate_liet}%</td>
                    <td class="num-mono text-end">${p.rate_under_5}%</td>
                    <td class="num-mono text-end fw-semibold" style="color: #2A9D8F;">${p.rate_gte_8}%</td>
                </tr>
            `;
        }).join('');
    }

    searchInput.oninput = updateTable;
    clusterSelect.onchange = updateTable;
    updateTable();
}

// 11. XUẤT CSV BÁO CÁO
function exportClusteringResultsToCSV() {
    if (!currentClusterResults || currentClusterResults.length === 0) {
        alert("Chưa có dữ liệu kết quả để xuất file!");
        return;
    }

    const headers = ["Mã Tỉnh", "Tên Tỉnh", "Cụm Gán", "Số Thí Sinh", "Điểm TB", "Trung Vị", "Độ Lệch Chuẩn", "Q1", "Q3", "Tỷ Lệ Liệt (%)", "Tỷ Lệ Dưới 5 (%)", "Tỷ Lệ Giỏi (>=8) (%)"];
    const rows = currentClusterResults.map(p => [
        `"${p.province_id}"`,
        `"${p.province_name}"`,
        `"Cụm ${p.cluster + 1}"`,
        p.total_candidates,
        p.mean,
        p.median,
        p.std,
        p.q1,
        p.q3,
        p.rate_liet,
        p.rate_under_5,
        p.rate_gte_8
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Bao_Cao_Phan_Cum_THPT_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 12. TIỆN ÍCH TRỢ GIÚP
function toggleLoadingState(isLoading) {
    const btn = document.getElementById('btnRun');
    const spinner = document.getElementById('btnSpinner');
    const text = document.getElementById('btnText');
    if (!btn) return;

    btn.disabled = isLoading;
    if (isLoading) {
        if (spinner) spinner.classList.remove('d-none');
        if (text) text.textContent = 'Đang xử lý mô hình...';
    } else {
        if (spinner) spinner.classList.add('d-none');
        if (text) text.textContent = 'Thực thi mô hình';
    }
}

function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}