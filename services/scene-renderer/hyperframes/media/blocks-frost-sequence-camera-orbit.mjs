// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/8922b373a19e4039.png';
import m1 from '../shared/c307c686e8032b7a.png';
import m2 from '../shared/e590d58631c76a9c.svg';
import m3 from '../shared/2dec7226ac14a834.svg';
import m4 from '../shared/73894e0448cae90a.ttf';
import m5 from '../shared/01f2ff28f9df2ed7.svg';
const assets={"assets/textures/bluenoise64.png":m0,"bluenoise64.png":m0,"assets/textures/ice-inclusions-generated.png":m1,"ice-inclusions-generated.png":m1,"assets/shards-atlas.png":m1,"shards-atlas.png":m1,"assets/logo.svg":m2,"logo.svg":m3,"fonts/Geist-Bold.ttf":m4,"Geist-Bold.ttf":m4};
export default function asset(path){
if(!path)return m5;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m5;
}
