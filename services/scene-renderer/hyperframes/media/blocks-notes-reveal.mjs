// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/dc156e7c21b47474.svg';
import m1 from '../shared/ed86faad6b1ee3a0.svg';
const assets={"assets/hyperframes-logo-black.svg":m0,"hyperframes-logo-black.svg":m0};
export default function asset(path){
if(!path)return m1;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m1;
}
