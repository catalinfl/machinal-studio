// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/a7745bb18ddccd79.svg';
import m1 from '../shared/f989b5c1b8dbcdfd.svg';
import m2 from '../shared/e8d34fc926099ac8.svg';
import m3 from '../shared/48a3d81ad0311d8c.svg';
import m4 from '../shared/dc156e7c21b47474.svg';
import m5 from '../shared/2eacae463374c6ba.svg';
const assets={"assets/slide-01.jpg":m0,"slide-01.jpg":m0,"assets/slide-02.jpg":m1,"slide-02.jpg":m1,"assets/slide-03.jpg":m2,"slide-03.jpg":m2,"assets/slide-04.jpg":m3,"slide-04.jpg":m3,"assets/hyperframes-logo-black.svg":m4,"hyperframes-logo-black.svg":m4};
export default function asset(path){
if(!path)return m5;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m5;
}
