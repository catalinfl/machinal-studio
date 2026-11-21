// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/d76b391ccfa8bff6.json';
import m1 from '../shared/c74a542d24225253.svg';
const assets={"https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json":m0,"states-10m.json":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
