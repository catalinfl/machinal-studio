// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/7b436eba53fae786.bin';
import m1 from '../shared/011ffc76abd1fa36.svg';
import m2 from '../shared/6dbed2b2bc646683.svg';
const assets={"assets/ferndale_studio_01_1k.hdr":m0,"ferndale_studio_01_1k.hdr":m0,"assets/matcap-1.png":m1,"matcap-1.png":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
