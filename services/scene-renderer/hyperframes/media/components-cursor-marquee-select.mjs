// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/4eedee6a13038948.svg';
import m1 from '../shared/59c76f35aaecd92a.svg';
import m2 from '../shared/033e35689884463d.svg';
import m3 from '../shared/b85d9610b719b71c.svg';
import m4 from '../shared/a75ff50c896cbb13.svg';
import m5 from '../shared/4514425879223b58.svg';
import m6 from '../shared/9bea9e7dcfb9a196.svg';
import m7 from '../shared/c1d47db80786433c.svg';
import m8 from '../shared/936f79f1ff234f71.svg';
import m9 from '../shared/db4c03bed964d102.svg';
import m10 from '../shared/48a4480bad01c705.svg';
import m11 from '../shared/c0ef20825a844b48.svg';
import m12 from '../shared/3e2da3d5b610787c.svg';
const assets={"beach-sunset.jpg":m0,"mountain-lake.jpg":m1,"city-night.jpg":m2,"morning-coffee.jpg":m3,"forest-path.jpg":m4,"aurora.jpg":m5,"desert-dunes.jpg":m6,"window-portrait.jpg":m7,"harbor-boats.jpg":m8,"poppy-closeup.jpg":m9,"snow-peak.jpg":m10,"market-stall.jpg":m11};
export default function asset(path){
if(!path)return m12;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m12;
}
