/* Licensed ACLED imports remain inside this worker; never send them to a server. */
let ready;
async function initialize() {
  const base = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
  self.postMessage({type:'progress', message:'Loading the statistical runtime. First use downloads Python and scientific packages; later runs reuse it.'});
  importScripts(base + 'pyodide.js');
  const py = await loadPyodide({indexURL:base});
  await py.loadPackage(['numpy','pandas','scipy','statsmodels','scikit-learn','networkx','shapely']);
  const names = ['research_data','research_models','research_causal','research_spatial','forecasting','research_engine'];
  for (const name of names) {
    const response = await fetch('./research/' + name + '.py?v=4.0.0');
    if (!response.ok) throw new Error('Statistical module is unavailable: ' + name);
    py.FS.writeFile('/home/pyodide/' + name + '.py', await response.text());
  }
  await py.runPythonAsync('import sys\nsys.path.insert(0, "/home/pyodide")\nfrom research_engine import analyze_json');
  return py;
}
self.onmessage = async ({data}) => {
  try {
    ready ||= initialize();
    const py = await ready;
    self.postMessage({type:'progress', message:'Building the validated panel and estimating ' + data.method + '…'});
    py.globals.set('research_payload', JSON.stringify(data));
    const output = await py.runPythonAsync('analyze_json(research_payload)');
    py.globals.delete('research_payload');
    const parsed = JSON.parse(output);
    self.postMessage({type:'result', id:data.id, ...parsed});
  } catch (error) {
    ready = undefined;
    self.postMessage({type:'error', id:data.id, message:String(error.message || error)});
  }
};
