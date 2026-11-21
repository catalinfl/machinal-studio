# Corecții Pixi / FFmpeg — raport final

**247 de cazuri pe profil (RGBA + YUV420p): 243 măsurate, 4 parțiale.** Zero erori de execuție, baseline MAE 0 în ambele profiluri. Preview-ul rămâne live GLSL (fără prerandare FFmpeg), conform deciziei de arhitectură.

## Scor final (MAE RGB 0–255, cel mai rău cadru eșantionat)

| Efect / variantă | RGBA | YUV420p |
|---|---:|---:|
| motion-trails normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| frame-echo normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| stop-motion normal | **0,00** | **0,00** |
| negate normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| negative-strobe normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| sepia normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| dust-scratches normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| scanlines normal + rampă | **0,01** / **0,01** | **0,00** / **0,00** |
| crt-phosphor normal + rampă | **0,00** / **0,02** | **0,00** / **0,02** |
| film-grain normal + rampă | **0,00** / **0,00** | **0,00** / **0,00** |
| prism normal + rampă | **0,00** / **0,00** | **0,00** / **0,01** |
| mirror / flip-v rampă | **0,07** / **0,06** | **0,06** / **0,04** |
| thermal normal + rampă | **0,01** / **0,02** | **0,01** / **0,02** |
| comic-book normal + rampă | **0,03** / **0,04** | **0,05** / **0,04** |
| pencil-sketch normal + rampă | **0,06** / **0,06** | **0,07** / **0,09** |
| chromatic-correction normal | **0,04** | **0,03** |
| rgb-punch normal | **0,03** | **0,03** |
| halation normal | **0,10** | **0,13** |
| lens-flare normal | **0,11** | **0,12** |
| analog-damage normal | **0,29** | **0,29** |
| old-projector normal | **0,41** | **0,40** |
| tilt-shift normal | **0,40** | **0,37** |
| emboss normal | **0,51** | **0,44** |
| datamosh normal + rampă | **0,36** / **0,38** | **0,26** / **0,32** |
| bad-tv normal + rampă | **2,28** / **1,50** | **2,15** / **1,43** |
| directional-blur normal + rampă | **2,31** / **1,98** | **2,16** / **1,69** |
| light-rays normal + rampă | **3,06** / **2,72** | **3,22** / **2,68** |
| rotate normal + rampă | **1,44** / **1,00** | **1,55** / **1,06** |

Tabele complete: [RGBA](effect-parity/changes.md), [YUV420p](effect-parity-yuv420p/changes.md). Imagini: `index.html` din fiecare director. `before.md` păstrează măsurătorile inițiale (valori de 30–150 la efectele grele).

## Ce s-a schimbat (toate loturile)

- **Mix temporal exact (`tmix`):** `TmixFilter` cu ring buffer de cadre cuantizate, greutăți/scală native și rotunjire banker's (`lrintf`). Trails/echo 4,03 → **0,00**, datamosh 26,63 → **0,36**. La fel și stop-motion (frame-hold cauzal): parțial → **0,00**.
- **Izolare RGB pe etape (client + Go):** fiecare etapă vede `format=rgb24` (inclusiv ramurile `split` și conversiile `gray`), ca texturile decodate ale preview-ului. A reparat tot YUV-ul: halation 21,19 → **0,13**, lens-flare 6,59 → **0,12**, emboss 2,33 → **0,44**, tilt-shift 4,0 → **0,37**, thermal → **0,01**.
- **Trunchiere `blend` (toate shaderele + Go neschimbat):** `vf_blend.c` atribuie `double` la `uint8` (trunchiere C), framebufferul rotunjește. Toate mixurile cu intensitate trunchiază acum explicit (cu gărzi la capete). Rampe reparate: negate/strobe 1,00 → **0,00**, pencil 1,00 → **0,06**, tmix 0,04 → **0,00**, bad-tv rampă 2,25 → **1,50**, analog-damage rampă 1,61 → **0,54**.
- **Matrice fuzată + LUT `colorchannelmixer`:** matrix multiply și trunchierea într-un singur shader (fără rotunjire intermediară), iar gradele sepia folosesc LUT-uri cu `lrint` exact ca nativul. Sepia 0,77 → **0,00** (normal + rampă).
- **Zgomot nativ:** generator `av_lfg`/`MD5` portat bit-exact, tabele + shifturi pe cadre ca `vf_noise.c`; film-grain **0,00**.
- **Geometrie comună:** mirror/flip/rotate/shear/shake/weave într-un singur shader cu amestecul imaginii (nu interpolare de parametri la rampe); crop/scale atomic; media marginilor.
- **Grilă/drawgrid:** shader dedicat cu axe independente, celule la dimensiunea cadrului (inclusiv bordurile FFmpeg) și alpha trunchiat; scanlines **0,01**, phosphor **0,00**.
- **Chroma shift pe YUV limited-range** cu octeți cuantizați; palete turbo/inferno prin polinoamele exacte; curbe prin spline-uri naturale exacte.
- **dblur cu kernel simulat exact:** recurența `vf_dblur.c` rulată în `float32` pe impuls, kernel per-pixel extras fără duplicări, convoluție direcțională. Box generic 4,45 → **2,31**.
- **Istoric dublu-aplicare:** Pixi aplică filtrele de două ori pe cadru (render + extract); starea temporală distinge repeat de advance (altfel tmix se corupea).
- **Diagnosticul:** ieșirea FFmpeg e normalizată la dimensiunea cadrului (biliniar) ca în exportul cu scală de proiect; baseline rămâne 0,00.

## Verificări executate

- `pnpm check`: 0 erori, 0 avertismente.
- Vitest `effects` + `effects-pixi`: **30/30** (inclusiv teste noi tmix/dblur).
- Go `internal/core/editor/render`: **ok** (inclusiv teste native FFmpeg 6.1 pentru rampe crop/scale și Gaussian animat vs static).
- Blu-ray? Nu. Rapoarte complete regenerate pe ambele profiluri după toate corecțiile; PNG-urile și JSON-ul sunt artefacte locale (ignorate de Git), `report.md`/`changes.md`/`before.md` rămân versionabile.

## Limite oneste (ce NU e 1:1 și de ce)

1. **deflicker, deinterlace (4 cazuri, MAE ~0,5–1,1, parțiale):** necesită lookahead (deflicker folosește ferestre de 5 cadre cu viitor; yadif folosește câmpuri vecine). Preview-ul live e cauzal (latență zero); exportul întârzie. A le potrivi ar cere delay de 4 cadre în preview (desincron AV) sau decodare anticipată. Rămân passthrough documentat.
2. **dblur/light-rays (2–3):** kernelul e exact în interior (verificat contra binarului nativ la 16 biți), dar marginile rasterului FFmpeg sunt asimetrice și dependente de conținut (acumulare la colțul de final, trunchiere la început). Replicarea exactă ar cere raster secvențial (250+ pasefullscreen), infezabil live. Rămâne convoluția simetrică (documentat, măsurat).
3. **bad-tv (2,28):** grilă de înaltă frecvență × reeșantionare în doi pași (crop→scale în efect, apoi scala de proiect) cu rotunjiri fixed-point libswscale vs float GPU. Arhitectural, nu de parametri.
4. **slide-up t=0 (1,29):** primul rând al cadrului 0 de ieșire FFmpeg conține gunoi (verde, nu conținut A/B) — artefact nativ, nu diferență de algoritm. Preview-ul arată corect A.
5. **Coada 0,4–0,9** (shear, tiny-planet, hue, glow, duotone etc.): convenții sub-pixel la reeșantionare geometrică și rotunjiri fixed-point pe conținut de înaltă frecvență; invizibil în practică (<1 LSB mediu).

## Reproducere

Din `client`: `pnpm report:effects` (RGBA), apoi cu `$env:PARITY_PROFILE='yuv420p'` pentru video. Din `api` cu ffmpeg+ffprobe în PATH: `go test ./internal/core/editor/render`.
