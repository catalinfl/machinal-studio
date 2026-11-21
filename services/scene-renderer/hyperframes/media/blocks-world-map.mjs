// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/2516c915867c7baf.json';
import m1 from '../shared/466d494838e81b02.svg';
const assets={"https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json":m0,"countries-110m.json":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
