// Local Hyperframes sample artwork; originals retain upstream notices. Substitutes are project-authored.
import m0 from '../shared/b94eef7d7ba13526.svg';
import m1 from '../shared/afa37721cd82eb22.svg';
import m2 from '../shared/823f0c10225cc4bb.svg';
import m3 from '../shared/32430ae977ec6566.svg';
import m4 from '../shared/69b328e8b12dfae2.svg';
import m5 from '../shared/787c62e5449f4072.svg';
import m6 from '../shared/145659dd3a9d4184.svg';
import m7 from '../shared/67f0dec9791cc7be.svg';
import m8 from '../shared/2f78ac48927b5655.svg';
import m9 from '../shared/acad52f52cb36d38.svg';
import m10 from '../shared/8f94da66458ad84c.svg';
import m11 from '../shared/b1cc0857dfe51aca.svg';
import m12 from '../shared/1753ac624343c5bb.svg';
import m13 from '../shared/9ae87ac03657d2e1.svg';
import m14 from '../shared/178836cf77efb0e3.svg';
import m15 from '../shared/95636d79722b9bf2.svg';
import m16 from '../shared/74595015c8ba47af.svg';
import m17 from '../shared/4e78fc2ce278845a.svg';
import m18 from '../shared/f2c296ce22589504.svg';
import m19 from '../shared/9583e8ca48737637.svg';
import m20 from '../shared/1bf326d5df195a09.svg';
import m21 from '../shared/0c9c779061e565bf.svg';
import m22 from '../shared/b9c1ecc4c99bdd85.svg';
import m23 from '../shared/c122eaea7e7fedb0.svg';
import m24 from '../shared/4134276e3b6ff46c.svg';
const assets={"assets/carousel-images/artist-bob-seger.jpg":m0,"artist-bob-seger.jpg":m1,"assets/carousel-images/artist-dire-straits.jpg":m2,"artist-dire-straits.jpg":m3,"assets/carousel-images/artist-faces.jpg":m4,"artist-faces.jpg":m5,"assets/carousel-images/artist-little-feat.jpg":m6,"artist-little-feat.jpg":m7,"assets/carousel-images/artist-north-mississippi-allstars.jpg":m8,"artist-north-mississippi-allstars.jpg":m9,"assets/carousel-images/artist-sea-level.jpg":m10,"artist-sea-level.jpg":m11,"assets/carousel-images/artist-taj-mahal.jpg":m12,"artist-taj-mahal.jpg":m13,"assets/carousel-images/artist-tool.jpg":m14,"artist-tool.jpg":m15,"assets/carousel-images/artist-van-morrison.jpg":m16,"artist-van-morrison.jpg":m17,"assets/carousel-images/pl-10-songs.jpg":m18,"pl-10-songs.jpg":m19,"assets/carousel-images/pl-bangers.jpg":m20,"pl-bangers.jpg":m21,"assets/carousel-images/pl-bhindi-bhagee.jpg":m22,"pl-bhindi-bhagee.jpg":m23};
export default function asset(path){
if(!path)return m24;
const value=String(path);if(/^(data:|blob:)/.test(value)||value.endsWith('/'))return value;
const clean=value.split(/[?#]/)[0];return assets[value]||assets[clean]||assets[clean.split('/').pop()]||m24;
}
