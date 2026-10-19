// Application-level regression checks using a minimal DOM/Leaflet adapter.
// Run from the repository root: node tests/map-behavior.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    const attrs = {}, classes = new Set();
    elements.set(id, { id, style: {}, dataset: {}, value: id === 'sortSchools' ? 'name' : '', hidden: id === 'listPanel',
      events: {}, classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle(x, on) { if(on===undefined)on=!classes.has(x); on ? classes.add(x) : classes.delete(x); return on; } },
      addEventListener(name, fn) { this.events[name] = fn; }, setAttribute(k,v) { attrs[k] = v; }, getAttribute(k) { return attrs[k]; },
      querySelectorAll() { return []; }, focus() {}, click() { this.events.click?.({ target: this }); },
    });
  }
  return elements.get(id);
}
class Bounds {
  constructor() { this.points = []; }
  extend(p) { this.points.push(...(p instanceof Bounds ? p.points : [p])); return this; }
  isValid() { return this.points.length > 0; }
  getCenter() { const a=this.points; return {lat:(Math.min(...a.map(p=>p.lat))+Math.max(...a.map(p=>p.lat)))/2,lon:(Math.min(...a.map(p=>p.lon))+Math.max(...a.map(p=>p.lon)))/2}; }
}
class Layer {
  constructor(pos, options) { this.pos=pos; this.options=options; this.layers=[]; this.events={}; }
  addTo(group) { group.addLayer(this); return this; }
  addLayer(layer) { this.layers.push(layer); return this; }
  addLayers(layers) { layers.forEach(l=>this.addLayer(l)); }
  clearLayers() { this.layers=[]; }
  getLayers() { return this.layers; }
  getBounds() { return this.bounds || this.layers.reduce((b,l)=>b.extend(l.pos || l.getBounds()),new Bounds()); }
  getLatLng() { return this.pos; }
  bindPopup(html) { this.popup=html; return this; }
  bindTooltip() { return this; }
  on(name, fn) { if(typeof name==='object')Object.assign(this.events,name); else this.events[name]=fn; return this; }
  setStyle(style) { this.style=style; }
  bringToFront() {}
  openPopup() { opened=this; return this; }
  zoomToShowLayer(marker, cb) { cb(); }
}
let opened, map, cluster; const groups=[];
const L={
  map() { return map={zoom:10, layers:new Set(), handlers:{}, fits:0,
    setView(_,z) { return this.setZoom(z); }, getZoom() { return this.zoom; },
    setZoom(z) { this.zoom=z; this.handlers.zoomend?.(); return this; },
    addLayer(l) { this.layers.add(l); return this; }, removeLayer(l) { this.layers.delete(l); }, hasLayer(l) { return this.layers.has(l); },
    on(n,fn) { this.handlers[n]=fn; }, invalidateSize() {},
    createPane() {}, getPane() { return { style: {} }; },
    fitBounds(b,opts) { assert(b.isValid()); this.fits++; this.setZoom(opts.maxZoom===18?18:(b.points.length>100?10:16)); },
  }; },
  tileLayer(url) { const l=new Layer(); l.url=url; return l; }, markerClusterGroup() { return cluster=new Layer(); },
  featureGroup() { const g=new Layer();groups.push(g);return g; }, layerGroup() { return new Layer(); },
  latLngBounds() { return new Bounds(); }, latLng(lat,lon) { return {lat,lon}; },
  divIcon(options) { return options; }, marker(pos, options) { return new Layer(pos, options); },
  geoJSON(feature, options) { const group=new Layer(), polygon=new Layer(); polygon.bounds=new Bounds();
    function walk(c) { if(typeof c[0]==='number')polygon.bounds.extend({lat:c[1],lon:c[0]}); else c.forEach(walk); }
    walk(feature.geometry.coordinates); options.onEachFeature(feature,polygon);group.addLayer(polygon);return group;
  },
  control() { return {addTo() { this.onAdd?.(); }}; }, DomUtil:{ create() { return {}; } },
};
L.control.zoom=()=>({addTo(){}});
const data=JSON.parse(fs.readFileSync('data/schools.geojson','utf8'));
const errors=[];
const context={ L, document:{documentElement:element('root'),getElementById:element,querySelector:()=>element('range'),querySelectorAll:()=>[],addEventListener(){}},
  localStorage:{getItem(){},setItem(){}},getComputedStyle:()=>({getPropertyValue:()=> '#43866f'}),
  window:{L,matchMedia:q=>({matches:q.includes('reduced-motion')}),addEventListener(){},print(){}}, console:{error:e=>errors.push(e)},
  requestAnimationFrame:fn=>{fn();return 0;},
  fetch:async()=>({ok:true,json:async()=>data}),setTimeout:()=>0,clearTimeout(){},cancelAnimationFrame(){},Intl,Map,Set,
};
vm.runInNewContext(fs.readFileSync('js/app.js','utf8'),context);
setImmediate(()=>{
  assert.equal(errors.length,0,'application initialization');
  function checkCharts(expected) {
    const overview=element('portfolioOverview').innerHTML;
    const overviewCounts=[...overview.matchAll(/<b>(\d+)<\/b>/g)].map(m=>Number(m[1]));
    assert.equal(overviewCounts.reduce((a,b)=>a+b,0),expected,'overview tracks the filtered dataset');
    assert(!overview.includes('NaN')); assert(!overview.includes('Infinity'));
    const html=element('analysisContent').innerHTML;
    if (!expected) { assert(!html.includes('class="list-insights"')); return; }
    const chart=html.split('</section>')[0];
    const statusCounts=[...chart.matchAll(/<strong>(\d+)<\/strong>/g)].map(m=>Number(m[1]));
    const bars=chart.split('class="insight-bars"')[1];
    const communityCounts=[...bars.matchAll(/<b>(\d+)<\/b>/g)].map(m=>Number(m[1]));
    assert.equal(statusCounts.reduce((a,b)=>a+b,0),expected,'status chart includes every filtered school');
    assert.equal(communityCounts.reduce((a,b)=>a+b,0),expected,'top communities plus remaining includes every school');
    assert(!chart.includes('NaN')); assert(!chart.includes('Infinity'));
  }
  checkCharts(68);
  assert(element('analysisContent').innerHTML.includes('province-comparison'));
  assert(element('analysisContent').innerHTML.includes('Դիտել 7 դպրոց'));
  const polygons=groups[0];
  assert.equal(cluster.getLayers().length,68);
  assert.equal(polygons.getLayers().length,68);
  assert(map.hasLayer(cluster));assert(!map.hasLayer(polygons));

  // --- list cards: parcel thumbnails, legal-form tags, zero values shown as a dash ---
  const cards=element('schoolList').innerHTML;
  assert(cards.includes('class="school-thumb"') && cards.includes('<svg viewBox="0 0 100 100"'),'cards show a parcel thumbnail');
  assert(!cards.includes('NaN'),'thumbnail paths are numeric');
  assert(cards.includes('school-tag">ՊՈԱԿ'),'legal-form suffix becomes a tag');
  assert(!cards.includes('ՊՈԱԿ</h3>'),'suffix is removed from the title text');
  assert(!/<b>0<\/b>/.test(cards),'zero values are not shown as a real-looking 0');
  assert(cards.includes('class="no-data"'),'missing values use the dash');

  // --- stat tiles: share bars follow the selection ---
  assert(Math.abs(parseFloat(element('statCompletedBar').style.width)-7/68*100)<0.01,'completed share bar');
  assert(Math.abs(parseFloat(element('statOngoingBar').style.width)-46/68*100)<0.01,'ongoing share bar');

  // --- header menu (phones) and dismissible welcome strip ---
  element('menuToggle').click();
  assert(element('topbar').classList.contains('menu-open'));assert.equal(element('menuToggle').getAttribute('aria-expanded'),'true');
  element('menuToggle').click();
  assert(!element('topbar').classList.contains('menu-open'));assert.equal(element('menuToggle').getAttribute('aria-expanded'),'false');
  element('heroClose').click();assert(element('root').classList.contains('hero-hidden'),'welcome strip can be dismissed');

  // --- basemap and Armenian labels by zoom ---
  const tileUrls=()=>[...map.layers].filter(l=>l.url).map(l=>l.url);
  const labelLayers=()=>[...map.layers].filter(l=>l.options&&l.options.pane==='labels');
  const communities=new Set(data.features.map(f=>f.properties.community).filter(c=>c&&c!=='Անհայտ')).size;
  map.setZoom(9);assert.equal(labelLayers().length,12,'10 regions + Yerevan + Lake Sevan at zoom 9');
  map.setZoom(11);assert.equal(labelLayers().length,communities+2,'community labels + Yerevan + lake at zoom 11');
  map.setZoom(12);assert.equal(labelLayers().length,communities+1,'community labels + Yerevan at zoom 12');
  map.setZoom(13);assert.equal(labelLayers().length,communities,'community labels only at zoom 13');
  map.setZoom(14);assert.equal(tileUrls().length,1);assert(tileUrls()[0].includes('arcgisonline'),'calm grey basemap below zoom 15');
  map.setZoom(15);assert.equal(tileUrls().length,1);assert(tileUrls()[0].includes('openstreetmap'),'OpenStreetMap close-up from zoom 15');
  assert.equal(labelLayers().length,0,'no custom labels once OpenStreetMap names streets');

  map.setZoom(15);assert(!map.hasLayer(cluster));assert(map.hasLayer(polygons));
  map.setZoom(14);assert(map.hasLayer(cluster));assert(!map.hasLayer(polygons));
  map.setZoom(17); const fits=map.fits;element('themeToggle').click();
  assert.equal(map.getZoom(),17);assert.equal(map.fits,fits);assert(map.hasLayer(polygons));
  assert.equal(tileUrls().length,1,'theme switch keeps exactly one basemap');
  element('provinceSelect').events.change({target:{value:'Արարատ'}});
  const expected=data.features.filter(f=>f.properties.province==='Արարատ').length;
  assert.equal(polygons.getLayers().length,expected);assert.equal(cluster.getLayers().length,expected);
  checkCharts(expected);
  element('provinceSelect').events.change({target:{value:'missing'}});
  assert.equal(polygons.getLayers().length,0);assert.equal(cluster.getLayers().length,0);assert.equal(element('mapEmpty').hidden,false);
  checkCharts(0);
  element('resetFilters').click();assert.equal(polygons.getLayers().length,68);
  element('listView').click();const before=map.fits;
  element('provinceSelect').events.change({target:{value:'Արարատ'}});assert.equal(map.fits,before);
  element('mapView').click();assert(map.fits>before);
  element('resetFilters').click();element('listView').click();
  element('schoolList').events.click({target:{closest:()=>({dataset:{school:'1'}})}});
  assert(map.hasLayer(polygons));assert.equal(map.getZoom(),18);assert(element('detailsContent').innerHTML.includes('Օհանավանի'));
  assert.equal(element('schoolDetails').hidden,false);
  element('detailsClose').click();assert.equal(element('schoolDetails').hidden,true);
  element('analysisView').click();assert.equal(element('analysisPanel').hidden,false);assert.equal(element('mapPanel').hidden,true);
  assert.equal(Number(element('statCompleted').dataset.count),7);
  assert.equal(Number(element('statOngoing').dataset.count),46);
  element('presentationToggle').click();assert(element('root').classList.contains('presentation-mode'));
  element('presentationToggle').click();assert(!element('root').classList.contains('presentation-mode'));
  element('printSummary').click();assert(element('printReport').innerHTML.includes('Օհանավանի'));
  element('analysisContent').events.click({target:{closest:()=>({dataset:{status:'Ավարտված'}})}});
  assert.equal(cluster.getLayers().length,7);checkCharts(7);
  assert.equal(element('listPanel').hidden,false);
  assert.equal(element('backToAnalysis').hidden,false);
  element('backToAnalysis').click();
  assert.equal(element('analysisPanel').hidden,false);checkCharts(68);
  assert.equal(element('backToAnalysis').hidden,true);
  element('provinceSelect').events.change({target:{value:'Արարատ'}});
  element('analysisContent').events.click({target:{closest:()=>({dataset:{status:'Ավարտված'}})}});
  element('analysisView').click();
  assert.equal(element('provinceSelect').value,'Արարատ');checkCharts(expected);
  element('homeMap').click();
  assert.equal(element('mapPanel').hidden,false);
  assert.equal(element('analysisPanel').hidden,true);
  assert.equal(cluster.getLayers().length,expected,'home preserves the current filters');
  assert(element('activeFilters').innerHTML.includes('Արարատ'));
  element('activeFilters').events.click({target:{closest:()=>({dataset:{filterKey:'province',filterValue:''}})}});
  assert.equal(cluster.getLayers().length,68,'removing province tag restores all schools');
  assert.equal(element('provinceSelect').value,'');
  assert.equal(element('activeFilters').hidden,true);
  assert(element('filterSummary').classList.contains('is-idle'),'summary line is idle with no filters');
  element('resetFilters').click();
  element('fitBounds').click();assert(map.hasLayer(cluster));
  let finishTransition;
  context.window.matchMedia=()=>({matches:false});
  context.setTimeout=fn=>{finishTransition=fn;return 1;};
  element('analysisView').click();
  assert.equal(element('viewTransition').hidden,false,'animated transition is visible');
  assert.equal(element('analysisPanel').hidden,false,'navigation does not wait for animation');
  finishTransition();
  assert.equal(element('viewTransition').hidden,true,'transition ends');
  context.window.matchMedia=()=>({matches:true});
  element('mapView').click();
  assert.equal(element('viewTransition').hidden,true,'reduced motion skips transition');
  console.log('PASS: 68 geometries, two-stage basemap, Armenian labels by zoom, theme switch, filtering, empty results, hidden-map fit, school details, analysis, presentation, print summary, list thumbnails/tags/dashes, stat bars, header menu and welcome strip.');
});
