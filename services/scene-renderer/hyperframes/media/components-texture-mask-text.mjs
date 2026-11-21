// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/34f029d2033ce1d5.svg';
import m1 from '../shared/3faae6eb3471fe40.svg';
const assets={"masks/${item.slug}.png":m0,"${item.slug}.png":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
