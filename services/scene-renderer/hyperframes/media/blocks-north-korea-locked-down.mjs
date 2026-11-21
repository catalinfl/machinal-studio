// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/4558677491b50c34.svg';
import m1 from '../shared/69c98fcac1d35f86.svg';
const assets={"assets/korea-map.png":m0,"korea-map.png":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
