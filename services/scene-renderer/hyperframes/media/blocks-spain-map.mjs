// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/c99ec36ed214619a.json';
import m1 from '../shared/89caf15c3ec8a2a6.svg';
const assets={"https://cdn.jsdelivr.net/npm/es-atlas@0.6.0/es/autonomous_regions.json":m0,"autonomous_regions.json":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
