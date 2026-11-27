import * as pdfjs from '../../../node_modules/pdfjs-dist/legacy/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).href;
globalThis.pdfjsLib = pdfjs;

const renderer = document.createElement('script');
renderer.src = new URL('renderer.js', import.meta.url).href;
renderer.async = false;
renderer.addEventListener('load', () => {
  const collections = document.createElement('script');
  collections.src = new URL('../../shared/collection-panel.js', import.meta.url).href;
  document.body.append(collections);
});
document.body.append(renderer);
