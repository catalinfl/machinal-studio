// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/08789e6505800542.svg';
import m1 from '../shared/56d4af65701c26df.wav';
import m2 from '../shared/ee2d3290e7110b5b.svg';
const assets={"assets/joe-sai-avatar.png":m0,"joe-sai-avatar.png":m0,"assets/sfx/integrated-melodic-tech-mix.wav":m1,"integrated-melodic-tech-mix.wav":m1};
export default function asset(path){
if(!path)return m2;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m2;
}
