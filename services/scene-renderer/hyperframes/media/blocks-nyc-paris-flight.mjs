// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/d9d845600da5fbe2.svg';
import m1 from '../shared/56d4af65701c26df.wav';
import m2 from '../shared/8dee578d30be3bcb.svg';
const assets={"assets/map-nyc-paris.png":m0,"map-nyc-paris.png":m0,"assets/sfx-mix.wav":m1,"sfx-mix.wav":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
