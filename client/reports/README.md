# Raport Pixi / FFmpeg — 22 septembrie 2026 (final)

## Stare finală

**[Rezultatele și corecțiile implementate](FIXES.md): 247 de cazuri pe profil, 243 măsurate și 4 parțiale, zero erori.** Exemple RGBA: trails/echo/stop-motion/negate/strobe/sepia/dust **0,00**, datamosh 26,63 → **0,36**, halation (YUV) 21,19 → **0,13**, analog-damage 6,44 → **0,29**.

Tabele complete înainte/după: [RGBA](effect-parity/changes.md), [YUV420p](effect-parity-yuv420p/changes.md). **Aproape tot catalogul e 1:1 în limitele cuantizării;** cele 4 cazuri parțiale (deflicker/deinterlace, lookahead necesar) și reziduurile documentate (dblur margini, bad-tv reeșantionare, slide-up artefact nativ) sunt descrise în `FIXES.md`.

## Unde vezi rezultatele

- **Inventarul complet, per efect și variantă:** [effect-parity/report.md](effect-parity/report.md).
- **Imaginile deja randate, ordonate după diferență:** deschide `client/reports/effect-parity/index.html` în browser. Include Pixi, FFmpeg, diferență ×4 și suprapunere 50/50, pentru fiecare timestamp.
- **Diagnostic interactiv:** cu `pnpm dev` pornit din `client`, deschide `/diagnostics/effect-parity.html`. Alege întreg catalogul sau un efect, cu/fără rampe; rezultatele pot fi descărcate ca JSON cu imagini incluse.
- **Reproducere automată:** `pnpm report:effects`, din `client`. Generează raportul Markdown, JSON, HTML și PNG-urile în `client/reports/effect-parity/`. HTML/JSON/PNG sunt artefacte locale ignorate de Git; raportul Markdown rămâne versionabil.
- PowerShell, selecție scurtă: `$env:PARITY_IDS='emboss,comic-book'; pnpm report:effects`. Rezultatul selecției este în `test-results`, fără suprascrierea raportului complet. Elimină variabila cu `Remove-Item Env:PARITY_IDS` pentru întregul catalog. `PARITY_RAMPS=0` dezactivează rampele.

## Acoperire și interpretare — rularea inițială

Au fost executate **247 de cazuri**: 84 de efecte individuale, 83 de variante cu rampă, 76 de tranziții, 3 stive de efecte și un control fără efect. Controlul are MAE **0,00**, deci captura Pixi și intrarea FFmpeg sunt aliniate pe această sursă.

Rezultat final: **243 de cazuri măsurate și 4 parțiale (deflicker/deinterlace, cu lookahead)**. Cazurile măsurate includ diferențele mici rămase (vezi FIXES.md); zero erori de execuție. Verificările instrumentului (`pnpm check`, vitest 30/30, Go, `pnpm report:effects`) trec, inclusiv controlul fără efect.

Metodă: Chromium/WebGL, FFmpeg WASM 5.1.4 inclus în proiect, sursă RGBA sintetică de 160×90, 12 fps, o secundă. Efectele primesc aceeași secvență cu gradient, tablă de contrast și pătrat în mișcare. Tranzițiile primesc două imagini statice distincte. Cadrele sunt capturate la 0, 0,25, 0,5 și 0,75 secunde. Parametrii sunt valorile implicite din catalog; rampa este liniară, de la 0 la 1 pe o secundă.

MAE este eroarea medie pe canalele RGB, în intervalul 0–255. Tabelul arată cel mai rău cadru eșantionat. `measured` înseamnă **măsurat, nu validat ca identic**. `partial` semnalează comportament temporal/editor neacoperit; `error` indică eșec de execuție sau shader. Un MAE mic pe această sursă nu certifică întregul domeniu de parametri.

## Constatări inițiale — înainte de corecțiile din FIXES.md

| Prioritate | Efecte | Constatare și acțiune recomandată |
|---|---|---|
| P0 | `dust-reduction` | Shaderul median nu compilează: indexarea cu `k` și inițializarea buclei `j=i+1` sunt respinse în configurația GLSL testată. Rescriere cu indici constanți/rețea de sortare, apoi verificare pe WebGL1/2. Ambele variante sunt marcate eroare, inclusiv după cache-ul programului invalid. |
| P0 | `camera-shake`, `bad-tv`, `gate-weave`, cu rampă | FFmpeg refuză `blend`: ramura originală are 160×90, cea decupată 140×70 sau 152×82. `wrapRamp` separă `crop` de `scale`, făcând blend înainte de restaurarea dimensiunilor. Gruparea crop+scale trebuie păstrată ca operație atomică. Același tipar stage-by-stage există în implementarea Go, dar nu a fost executat nativ aici. |
| P1 | `gaussian-blur`, cu rampă | MAE 112,17; cadrele FFmpeg după început devin negre în cazul RGBA testat. De investigat `sendcmd`/actualizarea sigma după inițializare la zero și negocierea formatului/alpha. Cauza exactă nu este încă izolată. |
| P1 | `negative-strobe` | MAE 146,57; cadrul de la limita ciclului diferă complet. Pixi folosește modulo JavaScript, FFmpeg expresia `mod(t,period)`; trebuie uniformizată faza pe indici de cadre și verificate limitele numerice. |
| P1 | `emboss` | MAE 102,34. Shaderul adaugă `0.5` în RGB normalizat, în timp ce `0bias=0.5` în FFmpeg este în unități de eșantion, nu jumătate din scala 0–255. Imaginile arată ridicarea masivă a luminozității. |
| P1 | `pencil-sketch`, `comic-book` | MAE 64,23 / 60,91. GLSL folosește Sobel/smoothstep, exportul folosește `edgedetect` și alte etape. În ramura comic a `conv.frag.glsl`, `ink` este suplimentar înmulțit cu pragul `uP0`, reducând drastic cerneala. Trebuie armonizate detecția, pragurile și compunerea. |
| P1 | `mirror`, `flip-v`, cu rampă | MAE 52,84 / 56,65. Transformarea Pixi comută complet imediat ce intensitatea este nenulă; FFmpeg amestecă imaginea originală cu cea inversată. Necesită două imagini amestecate, nu doar un semn schimbat pe scală. |
| P1 | `false-color`, `thermal` | MAE 49,33 / 43,68. Shaderul folosește aproximări Turbo/Inferno pe luminanță RGB; FFmpeg folosește `pseudocolor` cu LUT/plane și conversii de format. Trebuie unificate LUT-ul, intrarea și convențiile de culoare. |
| P1 | `rgb-punch`, `prism`, `radial-aberration`, `chromatic-correction` | Diferențe măsurate, inclusiv MAE 31,52 pentru RGB punch. Verificarea semnului deplasării, limitelor texturii Pixi și a diferenței dintre deplasare RGB și crominanță YUV este necesară. Shaderul clampează UV la 0,001–0,999, nu la regiunea validă din textura filtrului. |
| P1 | `camera-shake`, `gate-weave`, `shear`, `waviness`, `fisheye`, `rotate` cu rampă | Transformările și warpurile au diferențe de geometrie/interpolare și de rampă. Pixi interpolează transformări/coordonate; FFmpeg poate amesteca două imagini. Camera shake folosește și un zoom aproximativ bazat numai pe lățime. |
| P2 | `glow-bloom`, `watercolor`, `oil-painting`, `denoise`, `deband`, `global-beauty`, `cross-process` | Sunt algoritmi diferiți sau aproximări explicite: blur în loc de bilateral/hqdn3d/deband, matrice în loc de curbe, eșantionare limitată pentru glow. Corectarea câtorva constante nu garantează paritatea. |

Referințe principale: `src/lib/effects-pixi.ts`, `src/lib/effects.ts` (`wrapRamp`, `buildFilterChain`, `animatedGblur`), `src/lib/glsl/{median,conv,rgbshift,adjust,warp,glow,transition}.frag.glsl`; pentru traseul serverului: `api/internal/core/editor/render/effects.go`.

## Tranziții

Exemple de diferențe mari în profilul RGBA testat: `tv-static-transition` **91,02**, `shutter-snap` **90,67**, `flash-bulb-transition` **82,07**, `fade-grayscale` **35,33**, `light-leak-transition` **34,47**, `chroma-fade` **33,17**, `noise-dissolve` **32,93**.

Nu toate au aceeași cauză. `transition.frag.glsl` conține presupuneri despre YUV și operații RGB, iar expresiile FFmpeg sunt evaluate pe planele formatului negociat. De exemplu, `PLANE` nu este automat ordinea R/G/B într-un format planar GBR. Pentru efectele aleatoare, precizia/hash-ul GLSL și generatorul FFmpeg pot produce modele diferite chiar cu aspect statistic apropiat. Acestea cer comparații și în profilul video YUV folosit la export, nu doar modificarea formulei până trece sursa RGBA.

Multe tranziții de bază sunt aproape identice pe cadrele testate: cross-dissolve, wipe-urile, blinds, majoritatea irisurilor, slide-right/down, squeeze, zoom-in. Tabelul complet păstrează toate cele 76, inclusiv diferențele mici.

## Efecte temporale și combinații

`deflicker`, `deinterlace`, `motion-trails`, `frame-echo`, `datamosh`, `stop-motion` sunt marcate **partial**. Diagnosticul vede planurile Pixi omise, dar nu rulează overlay-urile ghost sau cuantizarea seek-ului din `usePreview.svelte.ts`. În special, valoarea 0 pentru stop-motion pe eșantioanele alese nu dovedește funcționarea preview-ului.

Cele trei combinații au MAE maxim **20,44**, **74,37**, respectiv **39,95**. Ordinea etapelor și rampele trebuie verificate și după repararea efectelor individuale.

## Limitele evaluării inițiale

Evaluarea inițială a folosit FFmpeg WASM; la acel moment FFmpeg nativ nu era instalat. Ulterior au fost executate și testele native Go cu FFmpeg 6.1.1, descrise în `FIXES.md`. Tabelele de paritate vizuală rămân comparații cu WASM 5.1.4, nu cu un MP4 final comprimat.

Mai sunt necesare: surse video/fotografice reale, intrare YUV și conversii de culoare controlate, SDR/HDR după cerințele produsului, transparență, rezoluții și scale de preview diferite, capetele exacte ale tranzițiilor, toate valorile min/max ale parametrilor, offset-uri de clip/timeline și istoricul temporal real. Pentru exportul nativ, aceleași fixture-uri trebuie trimise prin traseul Go și comparate după decodare fără a confunda erorile codec-ului cu cele de shader.

Ordinea recomandată: **erori de shader/render → emboss și rampe geometrice → strobe/timing → LUT-uri și spațiu de culoare → aproximări spațiale → istoric temporal**. După fiecare familie reparată se regenerează raportul și se verifică imaginile, nu doar testele care verifică parametrii shaderelor.
