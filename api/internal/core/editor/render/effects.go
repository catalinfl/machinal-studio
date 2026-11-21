package render

import (
	"fmt"
	"math"
	"strings"
)

type effect struct {
	ID     string             `json:"id"`
	Params map[string]float64 `json:"params"`
	Ramp   *ramp              `json:"ramp"`
}

// effectFilters mirrors the browser registry using stable preset IDs.
// Keeping filter construction on the server prevents clients from injecting an
// arbitrary filtergraph into the native FFmpeg process.
var effectFilters = map[string]string{
	"blur":                 "boxblur=luma_radius=8:luma_power=1:chroma_radius=4:chroma_power=1",
	"gaussian-blur":        "gblur=sigma=6:steps=2",
	"directional-blur":     "dblur=angle=45:radius=8",
	"mosaic-blur":          "pixelize=width=16:height=16:mode=avg",
	"soft-focus":           "gblur=sigma=1.2,eq=brightness=0.03:saturation=1.05",
	"grayscale":            "hue=s=0",
	"brightness":           "eq=brightness=0.12:saturation=1.25",
	"contrast-pop":         "eq=contrast=1.18:brightness=-0.02:saturation=1.08:gamma=1.03",
	"color-boost":          "eq=saturation=1.45:contrast=1.05",
	"hue-shift":            "hue=h=30",
	"warm-grade":           "colorbalance=rs=0.10:gs=0.02:bs=-0.08:rm=0.08:gm=0.02:bm=-0.06",
	"cool-grade":           "colorbalance=rs=-0.07:gs=0.01:bs=0.10:rm=-0.05:gm=0.01:bm=0.08",
	"day-for-night":        "colorbalance=bs=0.15:bm=0.12:bh=0.08:rs=-0.10,eq=brightness=-0.12:saturation=0.75",
	"vintage":              "curves=preset=vintage,eq=saturation=0.85",
	"bleach-bypass":        "eq=contrast=1.3:brightness=-0.03:saturation=0.35",
	"sepia":                "format=rgb24,colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131",
	"negate":               "negate",
	"sepia-dream":          "gblur=sigma=0.65:steps=2,colorbalance=rs=0.08:gs=0.01:bs=-0.08:rm=0.06:gm=0.01:bm=-0.05,eq=contrast=0.96:brightness=-0.015:saturation=0.82,format=rgb24,colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131,vignette=angle=PI/4:x0=w/2:y0=h/2:mode=forward:eval=init:dither=1",
	"negative-strobe":      "negate=enable='lt(mod(t*10+0.0000001,1),0.4)'",
	"flash-hit":            "eq=brightness=0.38:contrast=1.08:saturation=0.45",
	"rgb-punch":            "format=rgb24,rgbashift=rh=7:bh=-7:edge=smear,eq=contrast=1.16:saturation=1.2",
	"analog-flicker":       `eq=brightness='0.035*sin(2*PI*8*t)':contrast=1.03:eval=frame,noise=alls=3:allf=t+u:all_seed=29`,
	"film-grain":           "noise=alls=12:allf=t+u:all_seed=12345",
	"analog-damage":        "eq=contrast=1.12:brightness=-0.03:saturation=0.72,noise=alls=10:allf=t+u:all_seed=7,format=rgb24,chromashift=cbh=2:cbv=1:crh=-2:crv=-1:edge=smear,vignette=angle=PI/4",
	"scanlines":            "drawgrid=width=iw:height=4:thickness=1:color=black@0.35",
	"block-damage":         "pixelize=width=8:height=8:mode=avg,noise=alls=4:allf=u:all_seed=11",
	"vignette":             "vignette=angle=PI/4:x0=w/2:y0=h/2:mode=forward:eval=init:dither=1",
	"global-beauty":        "hqdn3d=luma_spatial=2:chroma_spatial=1.5:luma_tmp=3:chroma_tmp=2.25,gblur=sigma=0.35,unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.25",
	"deband":               "deband=1thr=0.02:2thr=0.02:3thr=0.02:4thr=0.02:range=16:blur=1:coupling=1",
	"deflicker":            "deflicker=size=5:mode=am",
	"denoise":              "hqdn3d=luma_spatial=4:chroma_spatial=3:luma_tmp=6:chroma_tmp=4.5",
	"dust-reduction":       "median=radius=1",
	"chromatic-correction": "chromashift=cbh=-2:crh=2:edge=smear",
	"deinterlace":          "yadif=mode=send_frame:parity=auto:deint=all",
	"sharpen":              "unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.8:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=0.2",
	"sharpen-edges":        "cas=strength=0.5",
	"soften":               "unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=-0.6:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=-0.3",
	"edge-detect":          "edgedetect=low=0.08:high=0.25:mode=colormix",
	"emboss":               "format=gray,convolution=0m=-2 -1 0 -1 1 1 0 1 2:0rdiv=1:0bias=0.5",
	"pencil-sketch":        "format=gray,edgedetect=low=0.06:high=0.2:mode=wires,negate",
	"posterize":            "format=rgb24,lutrgb=r=floor(val/51)*51:g=floor(val/51)*51:b=floor(val/51)*51",
	"prism":                "format=rgb24,rgbashift=rh=4:bh=-4:edge=smear",
	"watercolor":           "bilateral=sigmaS=5:sigmaR=0.12",
	"mirror":               "hflip",
	"flip-v":               "vflip",
	"motion-trails":        "tmix=frames=5:weights=1 1 1 1 1:scale=0.2",
	"frame-echo":           "tmix=frames=4:weights=1 0 0 0.55:scale=0.645161",
	"stop-motion":          "fps=12",
	"rotate":               "rotate=angle=5*PI/180:fillcolor=black",
	"lens-distortion":      "lenscorrection=cx=0.5:cy=0.5:k1=-0.2:k2=0.05:i=bilinear:fc=black",
	"fisheye":              "lenscorrection=cx=0.5:cy=0.5:k1=0.35:k2=0.08:i=bilinear:fc=black",
	"shear":                "shear=shx=0.15:shy=0:fillcolor=black",
	"waviness":             `geq=lum='lum(X+8*sin(Y/18),Y)':cb='cb(X+4*sin(Y/18),Y)':cr='cr(X+4*sin(Y/18),Y)'`,
	"camera-shake":         "crop=w=iw-20:h=ih-20:x=10+8*sin(13*t):y=10+8*sin(17*t),scale=w=iw+20:h=ih+20",
	"glow-bloom":           "format=gbrp,split[r0ia][r0ib];[r0ib]gblur=sigma=8,eq=brightness=0.08:saturation=1.15,format=gbrp[r0ig];[r0ia][r0ig]blend=all_mode=screen:all_opacity=0.35",
	"halation":             "split[r0ia][r0ib];[r0ib]gblur=sigma=5,colorbalance=rs=0.18:gs=-0.045:bs=-0.099[r0ih];[r0ia][r0ih]blend=all_mode=screen:all_opacity=0.24",
	"lens-flare":           `format=gbrp,geq=r='r(X,Y)+70*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))':g='g(X,Y)+52*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))':b='b(X,Y)+30*exp(-((X-W*0.72)*(X-W*0.72)+(Y-H*0.28)*(Y-H*0.28))/(W*H*0.006))'`,
	"light-rays":           "edgedetect=low=0.08:high=0.24:mode=colormix,dblur=angle=45:radius=14,eq=brightness=0.04:contrast=1.08",
	"radial-aberration":    "format=rgb24,rgbashift=rh=5:rv=2:bh=-5:bv=-2:edge=smear,vignette=angle=PI/5",
	"vhs-tracking":         `geq=lum='lum(X+10*sin(Y/18+T*7),Y)':cb='cb(X+5*sin(Y/18+T*7),Y)':cr='cr(X-5*sin(Y/18+T*7),Y)',noise=alls=6:allf=t+u:all_seed=41`,
	"vhs-head-noise":       `geq=lum='lum(X+if(gt(Y,H*0.82),14*sin(Y/2+T*25),0),Y)':cb='cb(X+if(gt(Y,H*0.82),7,0),Y)':cr='cr(X-if(gt(Y,H*0.82),7,0),Y)',noise=alls=8:allf=t:all_seed=53`,
	"datamosh":             "tmix=frames=4:weights=1 1 1 1:scale=0.25,pixelize=width=6:height=6:mode=avg,eq=saturation=1.25:contrast=1.08",
	"glitch-bands":         `geq=lum='lum(X+18*if(lt(mod(Y+T*90,72),10),sin(T*31),0),Y)':cb='cb(X+9*if(lt(mod(Y+T*90,72),10),1,0),Y)':cr='cr(X-9*if(lt(mod(Y+T*90,72),10),1,0),Y)',format=rgb24,rgbashift=rh=2:bh=-2:edge=smear`,
	"bad-tv":               "eq=contrast=1.16:brightness=-0.025:saturation=0.68,noise=alls=13:allf=t+u:all_seed=67,format=rgb24,chromashift=cbh=4:cbv=1:crh=-4:crv=-1:edge=smear,drawgrid=width=iw:height=5:thickness=1:color=black@0.22,crop=w=iw-8:h=ih-8:x=4+3*sin(19*t):y=4+2*sin(23*t),scale=w=iw+8:h=ih+8",
	"crt-curvature":        "lenscorrection=cx=0.5:cy=0.5:k1=0.22:k2=0.0528:i=bilinear:fc=black,vignette=angle=PI/4",
	"crt-phosphor":         "format=rgb24,rgbashift=rh=1:bh=-1:edge=smear,drawgrid=width=3:height=ih:thickness=1:color=black@0.3,drawgrid=width=iw:height=4:thickness=1:color=black@0.24",
	"color-isolation":      "colorhold=color=0xdc2d28:similarity=0.18:blend=0.08",
	"duotone":              `format=gray,format=rgb24,lutrgb=r='11+236*val/255':g='16+162*val/255':b='38+65*val/255'`,
	"tritone":              `format=gray,format=rgb24,lutrgb=r='if(lt(val,128),18+0.55*val,88+1.25*(val-128))':g='if(lt(val,128),24+0.75*val,120+0.72*(val-128))':b='if(lt(val,128),54+1.05*val,188+0.45*(val-128))'`,
	"false-color":          "pseudocolor=preset=turbo",
	"solarize":             `format=rgb24,lutrgb=r='if(lt(val,128),val,255-val)':g='if(lt(val,128),val,255-val)':b='if(lt(val,128),val,255-val)'`,
	"infrared":             "format=rgb24,colorchannelmixer=rr=0.1:rg=0.9:rb=0.2:gr=0.45:gg=0.2:gb=0.1:br=0.1:bg=0.25:bb=0.85,curves=all=0/0 0.35/0.2 0.72/0.88 1/1,eq=contrast=1.12:saturation=0.9",
	"thermal":              "format=gray,pseudocolor=preset=inferno",
	"cross-process":        `curves=r='0/0.04 0.35/0.24 0.68/0.82 1/0.97':g='0/0.01 0.42/0.52 1/0.94':b='0/0.12 0.38/0.46 0.72/0.78 1/0.9',eq=saturation=1.18:contrast=1.08`,
	"gate-weave":           "crop=w=iw-8:h=ih-8:x=4+2*sin(7*t):y=4+1.4*sin(11*t),scale=w=iw+8:h=ih+8",
	"dust-scratches":       "noise=alls=10:allf=t+u:all_seed=79,format=rgb24,drawgrid=width=173:height=ih:thickness=1:color=white@0.12",
	"film-flicker":         `eq=brightness='0.07*(0.58*sin(2*PI*5*t)+0.29*sin(2*PI*11.85*t)+0.13*sin(2*PI*25.55*t))':contrast=1.06:eval=frame`,
	"old-projector":        `curves=preset=vintage,eq=contrast=1.08:brightness='0.055*(0.65*sin(2*PI*5*t)+0.35*sin(2*PI*11.7*t))':saturation=0.72:eval=frame,noise=alls=14:allf=t+u:all_seed=83,format=rgb24,drawgrid=width=181:height=ih:thickness=1:color=white@0.1,vignette=angle=PI/4`,
	"comic-book":           "split[r0ia][r0ib];[r0ia]format=rgb24,lutrgb=r=floor(val*7/256)*255/6:g=floor(val*7/256)*255/6:b=floor(val*7/256)*255/6[r0ip];[r0ib]format=gray,edgedetect=low=0.06:high=0.22:mode=wires,negate[r0ie];[r0ip][r0ie]blend=all_mode=multiply:all_opacity=0.82",
	"oil-painting":         "bilateral=sigmaS=7:sigmaR=0.16,median=radius=1,format=rgb24,lutrgb=r=floor(val*12/256)*255/11:g=floor(val*12/256)*255/11:b=floor(val*12/256)*255/11",
	"neon-edges":           "edgedetect=low=0.04:high=0.18:mode=colormix,eq=contrast=1.7:brightness=-0.08:saturation=2,gblur=sigma=0.7",
	"kaleidoscope":         `geq=lum='lum(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)':cb='cb(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)':cr='cr(abs(mod(X,W/2)-W/4)*2,abs(mod(Y,H/2)-H/4)*2)'`,
	"tiny-planet":          `geq=lum='lum((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))':cb='cb((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))':cr='cr((atan2(Y-H/2,X-W/2)/(2*PI)+0.5)*W,max(0,min(H-1,H-2*hypot(X-W/2,Y-H/2))))'`,
	"tilt-shift":           "split[r0ia][r0ib];[r0ib]gblur=sigma=9[r0ig];[r0ia][r0ig]blend=all_expr='if(between(Y/H,0.38,0.62),A,B)'",
}

// EffectCatalog returns the effect IDs accepted by the render pipeline.
func EffectCatalog() []string {
	ids := make([]string, 0, len(effectFilters))
	for id := range effectFilters {
		ids = append(ids, id)
	}
	return ids
}

// ValidateEffect checks an effect ID and all of its parameters using the same
// rules that are applied while building the FFmpeg filter graph.
func ValidateEffect(id string, params map[string]float64) error {
	_, err := buildEffectFilter(effect{ID: id, Params: params})
	return err
}

// ramp mirrors the browser intensity-ramp model: the effect fades from
// 0 to full strength (in), back to 0 (out), or up then down with a peak in
// the middle (in-out), following the chosen easing curve. The envelope is
// relative to the whole effect block; Offset anchors segments that start
// mid-block so the curve stays continuous across region boundaries.
type ramp struct {
	Mode          string  `json:"mode"`
	Curve         string  `json:"curve"`
	Amount        float64 `json:"amount"`
	BlockDuration float64 `json:"blockDuration"`
	Offset        float64 `json:"offset"`
}

// Effects that change the frame cadence cannot be intensity-ramped: the blend
// against the original stream would desync.
var noRampEffects = map[string]bool{
	"stop-motion": true,
}

func (r ramp) mode() string {
	switch r.Mode {
	case "in", "out", "in-out":
		return r.Mode
	}
	return "in"
}

func (r ramp) curve() string {
	switch r.Curve {
	case "linear", "ease-in", "ease-out", "ease-in-out":
		return r.Curve
	}
	return "linear"
}

func (r ramp) amount() float64 {
	cap := 1.0
	if r.mode() == "in-out" {
		// In-out reserves half the block per fade so the peak plateau survives.
		cap = 0.5
	}
	amount := r.Amount
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		amount = 0.25 // matches the browser default ramp length
	}
	// Floor keeps microscopically short ramps from degenerating to full strength.
	return math.Min(cap, math.Max(0.05, amount))
}

// rampCurveExpr renders the easing curve C(u) as an ffmpeg expression
// fragment; u evaluates to 0..1 inside the ramp window.
//
// The output must stay pure arithmetic: no commas, semicolons, or quoted
// strings (no clip()/min()/max()/if()). The same fragment is embedded into
// `sendcmd=c='...'` arguments by commandRamp, and sendcmd's parser splits
// commands on bare commas with no parenthesis awareness (f_sendcmd.c
// COMMAND_DELIMS) — a single comma aborts the whole segment render with
// "No command specified in interval #0, command #1". Comma-bearing
// constructs (if/lt/gt/min) belong only in blend=all_expr='...', which is
// single-quoted at the filtergraph level.
func rampCurveExpr(curve, u string) string {
	switch curve {
	case "ease-in":
		return "(" + u + ")*(" + u + ")"
	case "ease-out":
		return "(1-(1-(" + u + "))*(1-(" + u + ")))"
	case "ease-in-out":
		return "(" + u + ")*(" + u + ")*(3-2*(" + u + "))"
	}
	return "(" + u + ")"
}

// rampIntensityExpr renders the intensity I(T) in 0..1 over the segment-local
// timestamp T, or "" when the ramp degenerates to full strength.
func rampIntensityExpr(ramp ramp) string {
	d := ramp.BlockDuration
	r := ramp.amount() * d
	if !(d > 0) || !(r > 0) {
		return ""
	}
	offset := ramp.Offset
	if math.IsNaN(offset) || math.IsInf(offset, 0) {
		offset = 0
	}
	block := "(T+" + ff(offset) + ")"
	if offset < 0 {
		block = "(T-" + ff(-offset) + ")"
	}
	R := ff(r)
	D := ff(d)
	inExpr := "if(lt(" + block + "," + R + ")," + rampCurveExpr(ramp.curve(), block+"/"+R) + ",1)"
	outExpr := "if(gt(" + block + "," + D + "-" + R + ")," + rampCurveExpr(ramp.curve(), "("+D+"-"+block+")/"+R) + ",1)"
	switch ramp.mode() {
	case "in":
		return inExpr
	case "out":
		return outExpr
	}
	return "min(" + inExpr + "," + outExpr + ")"
}

type rampPhase struct {
	start     float64
	end       float64
	intensity string
}

// rampPhaseEps drops zero-length phases from float rounding at region edges.
const rampPhaseEps = 1e-6

func rampPhases(ramp ramp, segmentDuration float64) []rampPhase {
	duration := ramp.BlockDuration
	length := ramp.amount() * duration
	if !(duration > 0) || !(length > 0) || !(segmentDuration > 0) {
		return nil
	}
	offset := ramp.Offset
	if math.IsNaN(offset) || math.IsInf(offset, 0) {
		offset = 0
	}
	blockTime := "(T+" + ff(offset) + ")"
	if offset < 0 {
		blockTime = "(T-" + ff(-offset) + ")"
	}
	up := rampCurveExpr(ramp.curve(), blockTime+"/"+ff(length))
	down := rampCurveExpr(ramp.curve(), "("+ff(duration)+"-"+blockTime+")/"+ff(length))
	source := make([]rampPhase, 0, 3)
	if ramp.mode() != "out" {
		source = append(source, rampPhase{start: 0, end: length, intensity: up})
	}
	if ramp.mode() == "out" {
		source = append(source, rampPhase{start: 0, end: duration - length, intensity: "1"})
	}
	if ramp.mode() == "in-out" {
		source = append(source, rampPhase{start: length, end: duration - length, intensity: "1"})
	}
	if ramp.mode() == "in" {
		source = append(source, rampPhase{start: length, end: duration, intensity: "1"})
	}
	if ramp.mode() != "in" {
		source = append(source, rampPhase{start: duration - length, end: duration, intensity: down})
	}

	segmentEnd := offset + segmentDuration
	if offset == 0 && duration > segmentEnd {
		// Preserve trailing ramp phases for streams whose PTS starts mid-block
		// while ramp.Offset stays 0.
		segmentEnd = duration
	}
	phases := make([]rampPhase, 0, len(source))
	for _, phase := range source {
		start := math.Max(offset, phase.start)
		end := math.Min(segmentEnd, phase.end)
		if end-start > rampPhaseEps {
			phases = append(phases, rampPhase{
				start: start - offset, end: end - offset, intensity: phase.intensity,
			})
		}
	}
	return phases
}

func rampCurveValue(curve string, value float64) float64 {
	u := math.Max(0, math.Min(1, value))
	switch curve {
	case "ease-in":
		return u * u
	case "ease-out":
		return 1 - (1-u)*(1-u)
	case "ease-in-out":
		return u * u * (3 - 2*u)
	}
	return u
}

func rampIntensityAt(ramp ramp, progress float64) float64 {
	p := math.Max(0, math.Min(1, progress))
	length := ramp.amount()
	fadeIn := 1.0
	if p < length {
		fadeIn = rampCurveValue(ramp.curve(), p/length)
	}
	fadeOut := 1.0
	if p > 1-length {
		fadeOut = rampCurveValue(ramp.curve(), (1-p)/length)
	}
	switch ramp.mode() {
	case "in":
		return fadeIn
	case "out":
		return fadeOut
	}
	return math.Min(fadeIn, fadeOut)
}

func parameterValueExpr(neutral, target float64, intensity string) string {
	if intensity == "1" {
		return ff(target)
	}
	delta := target - neutral
	if neutral == 0 {
		return ff(delta) + "*(" + intensity + ")"
	}
	return ff(neutral) + "+" + ff(delta) + "*(" + intensity + ")"
}

func commandRamp(target, option string, neutral, value float64, ramp ramp, segmentDuration float64) string {
	phases := rampPhases(ramp, segmentDuration)
	if len(phases) == 0 {
		return ""
	}
	commands := make([]string, 0, len(phases)+1)
	for _, phase := range phases {
		interval := ff(phase.start) + "-" + ff(phase.end)
		argument := parameterValueExpr(neutral, value, phase.intensity)
		if phase.intensity == "1" {
			commands = append(commands, interval+" "+target+" "+option+" "+argument)
		} else {
			commands = append(commands, interval+" [expr] "+target+" "+option+" "+argument)
		}
	}
	// Clamp any frame whose PTS lands at or just past the block end to the
	// exact terminal intensity (0 for out/in-out, target value for in).
	lastEnd := phases[len(phases)-1].end
	if ramp.BlockDuration > 0 && ramp.Offset+lastEnd >= ramp.BlockDuration-rampPhaseEps {
		terminal := neutral
		if ramp.mode() == "in" {
			terminal = value
		}
		commands = append(commands, ff(lastEnd)+"-86400 "+target+" "+option+" "+ff(terminal))
	}
	return "sendcmd=c='" + strings.Join(commands, ";") + "'"
}

func rampInitialIntensity(ramp ramp) float64 {
	progress := 0.0
	if ramp.BlockDuration > 0 {
		progress = ramp.Offset / ramp.BlockDuration
	}
	return rampIntensityAt(ramp, progress)
}

func animatedGblur(tag string, sigma, steps, planes float64, ramp ramp, segmentDuration float64) string {
	initialSigma := sigma * rampInitialIntensity(ramp)
	target := "gblur@" + tag
	parts := []string{
		commandRamp(target, "sigma", 0, sigma, ramp, segmentDuration),
		// FFmpeg resolves sigmaV=-1 only at initialization.
		commandRamp(target, "sigmaV", 0, sigma, ramp, segmentDuration),
		target + "=sigma=" + ff(initialSigma) + ":steps=" + ff(steps) + ":planes=" + ff(planes) + ":sigmaV=" + ff(initialSigma),
	}
	if parts[0] == "" {
		return parts[2]
	}
	return strings.Join(parts, ",")
}

func animatedGlowBloom(tag string, radius, opacity, brightness, saturation float64, ramp ramp, segmentDuration float64) (string, bool) {
	target := "blend@" + tag
	cmd := commandRamp(target, "all_opacity", 0, opacity, ramp, segmentDuration)
	if cmd == "" {
		return "", false
	}
	initial := opacity * rampInitialIntensity(ramp)
	graph := fmt.Sprintf(
		"settb=AVTB,split[%sa][%sb];[%sb]format=yuv444p,gblur=sigma=%s,eq=brightness=%s:saturation=%s,format=gbrp[%sg];[%sa]format=gbrp,%s[%so];[%so][%sg]%s=all_mode=screen:all_opacity=%s",
		tag, tag, tag, ff(radius), ff(brightness), ff(saturation), tag, tag, cmd, tag, tag, tag, target, ff(initial),
	)
	return graph, true
}

func animatedHalation(tag string, radius, opacity, red float64, ramp ramp, segmentDuration float64) (string, bool) {
	target := "blend@" + tag
	cmd := commandRamp(target, "all_opacity", 0, opacity, ramp, segmentDuration)
	if cmd == "" {
		return "", false
	}
	initial := opacity * rampInitialIntensity(ramp)
	graph := fmt.Sprintf(
		"settb=AVTB,split[%sa][%sb];[%sb]format=rgb24,gblur=sigma=%s,colorbalance=rs=%s:gs=%s:bs=%s,format=gbrp[%sh];[%sa]format=gbrp,%s[%so];[%so][%sh]%s=all_mode=screen:all_opacity=%s",
		tag, tag, tag, ff(radius), ff(red), ff(-red*0.25), ff(-red*0.55), tag, tag, cmd, tag, tag, tag, target, ff(initial),
	)
	return graph, true
}

func uniformWeights(frames int) string {
	return strings.TrimSpace(strings.Repeat("1 ", frames))
}

func posterizeExpr(levels float64) string {
	return fmt.Sprintf("floor(val*%s/256)*255/%s", ff(levels), ff(levels-1))
}

func shakeMargin(amount float64) int {
	// Crop margin must cover the worst-case pixel displacement plus a
	// 2px guard so sub-pixel rounding never exposes the frame edge.
	return int(math.Ceil(amount)) + 2
}

func buildParameterRamp(effect effect, ramp ramp, segmentDuration float64, tag string) (string, bool, bool) {
	value := func(key string, fallback float64) float64 {
		if candidate, ok := effect.Params[key]; ok {
			return candidate
		}
		return fallback
	}
	switch effect.ID {
	case "gaussian-blur":
		return animatedGblur(tag, value("sigma", 6), value("steps", 2), 15, ramp, segmentDuration), false, true
	case "glow-bloom":
		graph, ok := animatedGlowBloom(tag, value("radius", 8), value("opacity", 0.35), value("brightness", 0.08), value("saturation", 1.15), ramp, segmentDuration)
		return graph, true, ok
	case "halation":
		graph, ok := animatedHalation(tag, value("radius", 5), value("opacity", 0.24), value("red", 0.18), ramp, segmentDuration)
		return graph, true, ok
	}
	return "", false, false
}

// splitTopLevelFilters splits a filter chain on top-level commas: commas
// inside () or '...' stay. It returns nil when the graph is not a plain
// comma chain (labeled pads, semicolons, unbalanced input) — those keep a
// single whole-chain crossfade.
func splitTopLevelFilters(inner string) []string {
	stages := make([]string, 0, 4)
	depth := 0
	inQuote := false
	var current strings.Builder
	for _, ch := range inner {
		if ch == '\'' {
			inQuote = !inQuote
			current.WriteRune(ch)
			continue
		}
		if !inQuote {
			switch ch {
			case '(':
				depth++
			case ')':
				if depth > 0 {
					depth--
				}
			case ',':
				if depth == 0 {
					stages = append(stages, current.String())
					current.Reset()
					continue
				}
			case ';', '[', ']':
				return nil
			}
		}
		current.WriteRune(ch)
	}
	stages = append(stages, current.String())
	if inQuote || depth != 0 {
		return nil
	}
	for _, stage := range stages {
		if strings.TrimSpace(stage) == "" {
			return nil
		}
	}
	return stages
}

func rampFilterStages(inner string) []string {
	filters := splitTopLevelFilters(inner)
	if filters == nil {
		return nil
	}
	stages := make([]string, 0, len(filters))
	start := 0
	for index, filter := range filters {
		if index+1 < len(filters) {
			// Keep format conversions and dimension-restoring crop/scale pairs atomic.
			if strings.HasPrefix(filter, "format=") ||
				(strings.HasPrefix(filter, "crop=") && strings.HasPrefix(filters[index+1], "scale=")) {
				continue
			}
		}
		stages = append(stages, strings.Join(filters[start:index+1], ","))
		start = index + 1
	}
	return stages
}

func wrapRampStages(inner, expr, tag string) string {
	stages := rampFilterStages(inner)
	if len(stages) < 2 {
		return wrapIntensityFilter(inner, expr, tag)
	}
	wrapped := make([]string, 0, len(stages))
	for k, stage := range stages {
		wrapped = append(wrapped, wrapIntensityFilter(stage, expr, fmt.Sprintf("%ss%d", tag, k)))
	}
	return strings.Join(wrapped, ",")
}

// wrapRampIntensityFilter crossfades untouched and effected streams using
// sendcmd-driven blend all_mode=normal:all_opacity (native C/SIMD path),
// avoiding per-pixel blend=all_expr software evaluation.
// Input order [effected][original] maps all_opacity=0 -> original, 1 -> effected.
func wrapRampIntensityFilter(inner string, r ramp, segmentDuration float64, tag string) (string, bool) {
	target := "blend@" + tag
	cmd := commandRamp(target, "all_opacity", 0, 1, r, segmentDuration)
	if cmd == "" {
		return "", false
	}
	initial := rampInitialIntensity(r)
	innerPrefix := "format=rgb24,"
	if stagePreferredSpace(inner) == colorSpaceYUV444 {
		innerPrefix = "format=yuv444p,"
	} else if strings.HasPrefix(strings.TrimSpace(inner), "format=") {
		innerPrefix = ""
	}
	return "settb=AVTB,split[" + tag + "a][" + tag + "b];" +
		"[" + tag + "b]" + innerPrefix + inner + "[" + tag + "f];" +
		"[" + tag + "a]format=gbrp," + cmd + "[" + tag + "o];" +
		"[" + tag + "f]format=gbrp[" + tag + "e];" +
		"[" + tag + "e][" + tag + "o]" + target + "=all_mode=normal:all_opacity=" + ff(initial), true
}

func wrapRampStagesAnimated(inner string, r ramp, segmentDuration float64, tag string) (string, bool) {
	stages := rampFilterStages(inner)
	if len(stages) < 2 {
		return wrapRampIntensityFilter(inner, r, segmentDuration, tag)
	}
	wrapped := make([]string, 0, len(stages))
	for k, stage := range stages {
		part, ok := wrapRampIntensityFilter(stage, r, segmentDuration, fmt.Sprintf("%ss%d", tag, k))
		if !ok {
			return "", false
		}
		wrapped = append(wrapped, part)
	}
	return strings.Join(wrapped, ","), true
}

const (
	colorSpaceUnknown = ""
	colorSpaceYUV444  = "yuv444p"
	colorSpaceRGB24   = "rgb24"
)

// yuvNativeFilters operate natively in full-chroma planar YUV (yuv444p),
// avoiding redundant RGB24 <-> YUV444P swscale conversions between adjacent
// filters in a chain (e.g. creator-natural: hqdn3d -> eq -> cas -> noise).
var yuvNativeFilters = map[string]bool{
	"hqdn3d":         true,
	"eq":             true,
	"cas":            true,
	"noise":          true,
	"unsharp":        true,
	"hue":            true,
	"boxblur":        true,
	"gblur":          true,
	"dblur":          true,
	"deband":         true,
	"deflicker":      true,
	"median":         true,
	"chromashift":    true,
	"yadif":          true,
	"bilateral":      true,
	"tmix":           true,
	"pixelize":       true,
	"vignette":       true,
	"hflip":          true,
	"vflip":          true,
	"fps":            true,
	"crop":           true,
	"scale":          true,
	"negate":         true,
	"lenscorrection": true,
	"rotate":         true,
	"shear":          true,
	"geq":            true,
}

func leadingFilterName(stage string) string {
	trimmed := strings.TrimSpace(stage)
	for strings.HasPrefix(trimmed, "sendcmd=") {
		rest := strings.TrimPrefix(trimmed, "sendcmd=")
		if quote := strings.IndexByte(rest, '\''); quote >= 0 {
			rest = rest[quote+1:]
			if end := strings.IndexByte(rest, '\''); end >= 0 {
				rest = strings.TrimPrefix(rest[end+1:], ",")
				trimmed = strings.TrimSpace(rest)
				continue
			}
		}
		break
	}
	if idx := strings.IndexAny(trimmed, "=@,"); idx >= 0 {
		return trimmed[:idx]
	}
	return trimmed
}

func stagePreferredSpace(stage string) string {
	trimmed := strings.TrimSpace(stage)
	if strings.Contains(trimmed, "split[") || strings.Contains(trimmed, ";") {
		return colorSpaceRGB24
	}
	if strings.HasPrefix(trimmed, "format=rgb24") {
		return colorSpaceRGB24
	}
	if strings.HasPrefix(trimmed, "format=yuv444p") {
		return colorSpaceYUV444
	}
	if strings.HasPrefix(trimmed, "format=") {
		return colorSpaceUnknown
	}
	if yuvNativeFilters[leadingFilterName(trimmed)] {
		return colorSpaceYUV444
	}
	return colorSpaceRGB24
}

func normalizeStageColorSpace(stage, currentSpace string) (string, string) {
	trimmed := strings.TrimSpace(stage)
	if strings.HasPrefix(trimmed, "settb=") || strings.Contains(trimmed, "split[") || strings.Contains(trimmed, ";") {
		if strings.HasPrefix(trimmed, "settb=") {
			return trimmed, colorSpaceUnknown
		}
		if strings.HasPrefix(trimmed, "format=rgb24") || currentSpace == colorSpaceRGB24 {
			return trimmed, colorSpaceUnknown
		}
		return "format=rgb24," + trimmed, colorSpaceUnknown
	}
	if strings.HasPrefix(trimmed, "format=") {
		switch {
		case strings.HasPrefix(trimmed, "format=rgb24"):
			return trimmed, colorSpaceRGB24
		case strings.HasPrefix(trimmed, "format=yuv444p"):
			return trimmed, colorSpaceYUV444
		default:
			return trimmed, colorSpaceUnknown
		}
	}
	want := stagePreferredSpace(trimmed)
	if want == colorSpaceYUV444 {
		if currentSpace == colorSpaceYUV444 {
			return trimmed, colorSpaceYUV444
		}
		return "format=yuv444p," + trimmed, colorSpaceYUV444
	}
	if currentSpace == colorSpaceRGB24 {
		return trimmed, colorSpaceRGB24
	}
	return "format=rgb24," + trimmed, colorSpaceRGB24
}

// wrapIntensityFilter crossfades between the untouched stream and the fully
// effected stream: split -> effect -> blend with the per-frame intensity
// I(T). Both branches are normalized to gbrp (planar RGB, no chroma
// subsampling) because some effects change the pixel format, which blend
// would reject. gbrp keeps the blend in RGB so it matches the Pixi preview
// mix; yuv420p would subsample chroma and shift colors vs preview. tag must
// be unique within the surrounding filtergraph.
func wrapIntensityFilter(inner, expr, tag string) string {
	// blend evaluates T using its input time base, but framesync can choose AVTB.
	// Normalize before either branch (including inner blends) without resetting PTS.
	// Packed RGB first matches the chroma reconstruction of the decoded preview.
	// Force the effected branch to RGB as well so inner filters see rgb24 in
	// both ramped and constant blocks, matching the Pixi preview.
	return "settb=AVTB,split[" + tag + "a][" + tag + "b];" +
		"[" + tag + "b]format=rgb24," + inner + "[" + tag + "f];" +
		"[" + tag + "a]format=rgb24,format=gbrp[" + tag + "o];" +
		"[" + tag + "f]format=rgb24,format=gbrp[" + tag + "e];" +
		"[" + tag + "o][" + tag + "e]blend=all_expr='A*(1-(" + expr + "))+B*(" + expr + ")'"
}

type paramReader struct {
	effect  effect
	allowed map[string]bool
	err     error
}

func (r *paramReader) number(key string, fallback, minValue, maxValue float64, integer bool) float64 {
	r.allowed[key] = true
	value, exists := r.effect.Params[key]
	if !exists {
		return fallback
	}
	if math.IsNaN(value) || math.IsInf(value, 0) || value < minValue || value > maxValue || (integer && math.Trunc(value) != value) {
		if r.err == nil {
			r.err = fmt.Errorf("invalid parameter %s for effect %s", key, r.effect.ID)
		}
		return fallback
	}
	return value
}

func (r *paramReader) validate() error {
	if r.err != nil {
		return r.err
	}
	for key := range r.effect.Params {
		if !r.allowed[key] {
			return fmt.Errorf("unknown parameter %s for effect %s", key, r.effect.ID)
		}
	}
	return nil
}

func buildEffectFilter(effect effect) (string, error) {
	return buildEffectFilterTagged(effect, "r0i")
}

func buildEffectFilterTagged(effect effect, tag string) (string, error) {
	filter, ok := effectFilters[effect.ID]
	if !ok {
		return "", fmt.Errorf("unknown effect: %s", effect.ID)
	}
	params := &paramReader{effect: effect, allowed: make(map[string]bool)}
	number := params.number

	switch effect.ID {
	case "blur":
		lumaRadius := number("lumaRadius", 8, 0, 64, true)
		lumaPower := number("lumaPower", 1, 1, 6, true)
		chromaRadius := number("chromaRadius", 4, 0, 64, true)
		chromaPower := number("chromaPower", 1, 1, 6, true)
		filter = fmt.Sprintf("boxblur=luma_radius='min(%s,min(w,h)/2)':luma_power=%s:chroma_radius='min(%s,min(cw,ch)/2)':chroma_power=%s", ff(lumaRadius), ff(lumaPower), ff(chromaRadius), ff(chromaPower))
	case "gaussian-blur":
		sigma := number("sigma", 6, 0.1, 50, false)
		steps := number("steps", 2, 1, 6, true)
		filter = fmt.Sprintf("gblur=sigma=%s:steps=%s", ff(sigma), ff(steps))
	case "directional-blur":
		angle := number("angle", 45, 0, 360, false)
		radius := number("radius", 8, 1, 64, true)
		filter = fmt.Sprintf("dblur=angle=%s:radius=%s", ff(angle), ff(radius))
	case "mosaic-blur":
		width := number("width", 16, 2, 128, true)
		height := number("height", 16, 2, 128, true)
		filter = fmt.Sprintf("pixelize=width=%s:height=%s:mode=avg", ff(width), ff(height))
	case "soft-focus":
		sigma := number("sigma", 1.2, 0.1, 10, false)
		brightness := number("brightness", 0.03, -1, 1, false)
		saturation := number("saturation", 1.05, 0, 3, false)
		filter = fmt.Sprintf("gblur=sigma=%s,eq=brightness=%s:saturation=%s", ff(sigma), ff(brightness), ff(saturation))
	case "brightness":
		brightness := number("brightness", 0.12, -1, 1, false)
		saturation := number("saturation", 1.25, 0, 3, false)
		filter = fmt.Sprintf("eq=brightness=%s:saturation=%s", ff(brightness), ff(saturation))
	case "contrast-pop":
		contrast := number("contrast", 1.18, 0.1, 3, false)
		brightness := number("brightness", -0.02, -1, 1, false)
		saturation := number("saturation", 1.08, 0, 3, false)
		gamma := number("gamma", 1.03, 0.1, 10, false)
		filter = fmt.Sprintf("eq=contrast=%s:brightness=%s:saturation=%s:gamma=%s", ff(contrast), ff(brightness), ff(saturation), ff(gamma))
	case "color-boost":
		saturation := number("saturation", 1.45, 0, 3, false)
		contrast := number("contrast", 1.05, 0.1, 3, false)
		filter = fmt.Sprintf("eq=saturation=%s:contrast=%s", ff(saturation), ff(contrast))
	case "hue-shift":
		filter = "hue=h=" + ff(number("angle", 30, -180, 180, false))
	case "negative-strobe":
		rate := number("rate", 10, 2, 20, false)
		duty := number("duty", 0.4, 0.1, 0.8, false)
		filter = fmt.Sprintf("negate=enable='lt(mod(t*%s+0.0000001,1),%s)'", ff(rate), ff(duty))
	case "flash-hit":
		brightness := number("brightness", 0.38, 0.05, 0.8, false)
		contrast := number("contrast", 1.08, 0.6, 1.8, false)
		saturation := number("saturation", 0.45, 0, 2, false)
		filter = fmt.Sprintf("eq=brightness=%s:contrast=%s:saturation=%s", ff(brightness), ff(contrast), ff(saturation))
	case "rgb-punch":
		shift := number("shift", 7, 1, 40, true)
		contrast := number("contrast", 1.16, 0.6, 2, false)
		saturation := number("saturation", 1.2, 0, 3, false)
		filter = fmt.Sprintf("format=rgb24,rgbashift=rh=%s:bh=%s:edge=smear,eq=contrast=%s:saturation=%s", ff(shift), ff(-shift), ff(contrast), ff(saturation))
	case "analog-flicker":
		amount := number("amount", 0.035, 0, 0.15, false)
		rate := number("rate", 8, 1, 15, false)
		contrast := number("contrast", 1.03, 0.8, 1.4, false)
		grain := number("grain", 3, 0, 20, true)
		filter = fmt.Sprintf("eq=brightness='%s*sin(2*PI*%s*t)':contrast=%s:eval=frame,noise=alls=%s:allf=t+u:all_seed=29", ff(amount), ff(rate), ff(contrast), ff(grain))
	case "film-grain":
		strength := number("strength", 12, 0, 100, true)
		seed := number("seed", 12345, 0, 65535, true)
		filter = fmt.Sprintf("noise=alls=%s:allf=t+u:all_seed=%s", ff(strength), ff(seed))
	case "scanlines":
		spacing := number("spacing", 4, 2, 32, true)
		thickness := number("thickness", 1, 1, 12, true)
		opacity := number("opacity", 0.35, 0, 1, false)
		filter = fmt.Sprintf("drawgrid=width=iw:height=%s:thickness=%s:color=black@%s", ff(spacing), ff(thickness), ff(opacity))
	case "block-damage":
		blockSize := number("blockSize", 8, 2, 64, true)
		noise := number("noise", 4, 0, 100, true)
		filter = fmt.Sprintf("pixelize=width=%s:height=%s:mode=avg,noise=alls=%s:allf=u:all_seed=11", ff(blockSize), ff(blockSize), ff(noise))
	case "global-beauty":
		spatial := number("spatial", 2, 0.1, 20, false)
		temporal := number("temporal", 3, 0.1, 30, false)
		softness := number("softness", 0.35, 0, 3, false)
		detail := number("detail", 0.25, 0, 2, false)
		filter = fmt.Sprintf("hqdn3d=luma_spatial=%s:chroma_spatial=%s:luma_tmp=%s:chroma_tmp=%s,gblur=sigma=%s,unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=%s", ff(spatial), ff(spatial*0.75), ff(temporal), ff(temporal*0.75), ff(softness), ff(detail))
	case "deband":
		threshold := number("threshold", 0.02, 0.001, 0.5, false)
		sampleRange := number("range", 16, 1, 64, true)
		filter = fmt.Sprintf("deband=1thr=%s:2thr=%s:3thr=%s:4thr=%s:range=%s:blur=1:coupling=1", ff(threshold), ff(threshold), ff(threshold), ff(threshold), ff(sampleRange))
	case "denoise":
		lumaSpatial := number("lumaSpatial", 4, 0.1, 20, false)
		chromaSpatial := number("chromaSpatial", 3, 0.1, 20, false)
		lumaTemporal := number("lumaTemporal", 6, 0.1, 30, false)
		chromaTemporal := number("chromaTemporal", 4.5, 0.1, 30, false)
		filter = fmt.Sprintf("hqdn3d=luma_spatial=%s:chroma_spatial=%s:luma_tmp=%s:chroma_tmp=%s", ff(lumaSpatial), ff(chromaSpatial), ff(lumaTemporal), ff(chromaTemporal))
	case "dust-reduction":
		filter = "median=radius=" + ff(number("radius", 1, 1, 10, true))
	case "chromatic-correction":
		blueOffset := number("blueOffset", -2, -20, 20, true)
		redOffset := number("redOffset", 2, -20, 20, true)
		filter = fmt.Sprintf("chromashift=cbh=%s:crh=%s:edge=smear", ff(blueOffset), ff(redOffset))
	case "sharpen":
		lumaAmount := number("lumaAmount", 0.8, 0, 5, false)
		chromaAmount := number("chromaAmount", 0.2, 0, 5, false)
		filter = fmt.Sprintf("unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=%s:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=%s", ff(lumaAmount), ff(chromaAmount))
	case "sharpen-edges":
		filter = "cas=strength=" + ff(number("strength", 0.5, 0, 1, false))
	case "soften":
		lumaAmount := number("lumaAmount", -0.6, -2, 0, false)
		chromaAmount := number("chromaAmount", -0.3, -2, 0, false)
		filter = fmt.Sprintf("unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=%s:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=%s", ff(lumaAmount), ff(chromaAmount))
	case "posterize":
		levels := number("levels", 6, 2, 32, true)
		expression := posterizeExpr(levels)
		filter = fmt.Sprintf("format=rgb24,lutrgb=r=%s:g=%s:b=%s", expression, expression, expression)
	case "prism":
		shift := number("shift", 4, 0, 50, true)
		filter = fmt.Sprintf("format=rgb24,rgbashift=rh=%s:bh=%s:edge=smear", ff(shift), ff(-shift))
	case "watercolor":
		spatial := number("spatial", 5, 0.1, 20, false)
		sampleRange := number("range", 0.12, 0.01, 1, false)
		filter = fmt.Sprintf("bilateral=sigmaS=%s:sigmaR=%s", ff(spatial), ff(sampleRange))
	case "motion-trails":
		frames := int(number("frames", 5, 2, 20, true))
		weights := uniformWeights(frames)
		filter = fmt.Sprintf("tmix=frames=%d:weights=%s:scale=%s", frames, weights, ff(1/float64(frames)))
	case "frame-echo":
		delayFrames := int(number("delayFrames", 3, 1, 12, true))
		opacity := number("opacity", 0.55, 0.05, 1, false)
		weights := make([]string, delayFrames+1)
		for index := range weights {
			weights[index] = "0"
		}
		weights[0] = "1"
		weights[len(weights)-1] = ff(opacity)
		filter = fmt.Sprintf("tmix=frames=%d:weights=%s:scale=%s", len(weights), strings.Join(weights, " "), ff(1/(1+opacity)))
	case "stop-motion":
		filter = "fps=" + ff(number("fps", 12, 1, 30, true))
	case "rotate":
		filter = "rotate=angle=" + ff(number("angle", 5, -180, 180, false)) + "*PI/180:fillcolor=black"
	case "lens-distortion", "fisheye":
		defaultK1, defaultK2 := -0.2, 0.05
		if effect.ID == "fisheye" {
			defaultK1, defaultK2 = 0.35, 0.08
		}
		centerX := number("centerX", 0.5, 0, 1, false)
		centerY := number("centerY", 0.5, 0, 1, false)
		k1 := number("k1", defaultK1, -1, 1, false)
		k2 := number("k2", defaultK2, -1, 1, false)
		filter = fmt.Sprintf("lenscorrection=cx=%s:cy=%s:k1=%s:k2=%s:i=bilinear:fc=black", ff(centerX), ff(centerY), ff(k1), ff(k2))
	case "shear":
		horizontal := number("horizontal", 0.15, -1, 1, false)
		vertical := number("vertical", 0, -1, 1, false)
		filter = fmt.Sprintf("shear=shx=%s:shy=%s:fillcolor=black", ff(horizontal), ff(vertical))
	case "waviness":
		amplitude := number("amplitude", 8, 0, 50, false)
		wavelength := number("wavelength", 18, 2, 100, false)
		filter = fmt.Sprintf("geq=lum='lum(X+%s*sin(Y/%s),Y)':cb='cb(X+%s*sin(Y/%s),Y)':cr='cr(X+%s*sin(Y/%s),Y)'", ff(amplitude), ff(wavelength), ff(amplitude/2), ff(wavelength), ff(amplitude/2), ff(wavelength))
	case "camera-shake":
		amount := number("amount", 8, 0, 30, false)
		speed := number("speed", 1, 0.1, 4, false)
		margin := shakeMargin(amount)
		filter = fmt.Sprintf("crop=w=iw-%d:h=ih-%d:x=%d+%s*sin(%s*t):y=%d+%s*sin(%s*t),scale=w=iw+%d:h=ih+%d", margin*2, margin*2, margin, ff(amount), ff(13*speed), margin, ff(amount), ff(17*speed), margin*2, margin*2)
	case "glow-bloom":
		radius := number("radius", 8, 0.5, 40, false)
		opacity := number("opacity", 0.35, 0, 1, false)
		brightness := number("brightness", 0.08, -0.2, 0.5, false)
		saturation := number("saturation", 1.15, 0, 3, false)
		filter = fmt.Sprintf("format=gbrp,split[%sa][%sb];[%sb]gblur=sigma=%s,eq=brightness=%s:saturation=%s,format=gbrp[%sg];[%sa][%sg]blend=all_mode=screen:all_opacity=%s", tag, tag, tag, ff(radius), ff(brightness), ff(saturation), tag, tag, tag, ff(opacity))
	case "halation":
		radius := number("radius", 5, 0.5, 30, false)
		opacity := number("opacity", 0.24, 0, 1, false)
		red := number("red", 0.18, 0, 0.5, false)
		filter = fmt.Sprintf("split[%sa][%sb];[%sb]gblur=sigma=%s,colorbalance=rs=%s:gs=%s:bs=%s[%sh];[%sa][%sh]blend=all_mode=screen:all_opacity=%s", tag, tag, tag, ff(radius), ff(red), ff(-red*0.25), ff(-red*0.55), tag, tag, tag, ff(opacity))
	case "light-rays":
		threshold := number("threshold", 0.08, 0.01, 0.3, false)
		angle := number("angle", 45, 0, 360, false)
		length := number("length", 14, 1, 64, true)
		brightness := number("brightness", 0.04, -0.2, 0.4, false)
		filter = fmt.Sprintf("edgedetect=low=%s:high=%s:mode=colormix,dblur=angle=%s:radius=%s,eq=brightness=%s:contrast=1.08", ff(threshold), ff(math.Min(1, threshold*3)), ff(angle), ff(length), ff(brightness))
	case "radial-aberration":
		shift := number("shift", 5, 0, 40, true)
		vertical := number("vertical", 2, 0, 40, true)
		vignette := number("vignette", 5, 2, 12, false)
		filter = fmt.Sprintf("format=rgb24,rgbashift=rh=%s:rv=%s:bh=%s:bv=%s:edge=smear,vignette=angle=PI/%s", ff(shift), ff(vertical), ff(-shift), ff(-vertical), ff(vignette))
	case "vhs-tracking":
		amount := number("amount", 10, 0, 40, false)
		band := number("band", 18, 2, 80, false)
		speed := number("speed", 7, 0.5, 20, false)
		noise := number("noise", 6, 0, 30, true)
		filter = fmt.Sprintf("geq=lum='lum(X+%s*sin(Y/%s+T*%s),Y)':cb='cb(X+%s*sin(Y/%s+T*%s),Y)':cr='cr(X-%s*sin(Y/%s+T*%s),Y)',noise=alls=%s:allf=t+u:all_seed=41", ff(amount), ff(band), ff(speed), ff(amount/2), ff(band), ff(speed), ff(amount/2), ff(band), ff(speed), ff(noise))
	case "vhs-head-noise":
		start := number("start", 0.82, 0.5, 0.98, false)
		amount := number("amount", 14, 0, 50, true)
		noise := number("noise", 8, 0, 40, true)
		filter = fmt.Sprintf("geq=lum='lum(X+if(gt(Y,H*%s),%s*sin(Y/2+T*25),0),Y)':cb='cb(X+if(gt(Y,H*%s),%s,0),Y)':cr='cr(X-if(gt(Y,H*%s),%s,0),Y)',noise=alls=%s:allf=t:all_seed=53", ff(start), ff(amount), ff(start), ff(amount/2), ff(start), ff(amount/2), ff(noise))
	case "datamosh":
		frames := int(number("frames", 4, 2, 12, true))
		blockSize := number("blockSize", 6, 2, 32, true)
		saturation := number("saturation", 1.25, 0, 3, false)
		contrast := number("contrast", 1.08, 0.5, 2, false)
		weights := uniformWeights(frames)
		filter = fmt.Sprintf("tmix=frames=%d:weights=%s:scale=%s,pixelize=width=%s:height=%s:mode=avg,eq=saturation=%s:contrast=%s", frames, weights, ff(1/float64(frames)), ff(blockSize), ff(blockSize), ff(saturation), ff(contrast))
	case "glitch-bands":
		amount := number("amount", 18, 0, 80, true)
		spacing := number("spacing", 72, 16, 256, true)
		width := number("width", 10, 1, 64, true)
		speed := number("speed", 90, 1, 300, false)
		filter = fmt.Sprintf("geq=lum='lum(X+%s*if(lt(mod(Y+T*%s,%s),%s),sin(T*31),0),Y)':cb='cb(X+%s*if(lt(mod(Y+T*%s,%s),%s),1,0),Y)':cr='cr(X-%s*if(lt(mod(Y+T*%s,%s),%s),1,0),Y)',format=rgb24,rgbashift=rh=2:bh=-2:edge=smear", ff(amount), ff(speed), ff(spacing), ff(width), ff(amount/2), ff(speed), ff(spacing), ff(width), ff(amount/2), ff(speed), ff(spacing), ff(width))
	case "crt-curvature":
		curvature := number("curvature", 0.22, 0, 0.8, false)
		vignette := number("vignette", 4, 2, 12, false)
		filter = fmt.Sprintf("lenscorrection=cx=0.5:cy=0.5:k1=%s:k2=%s:i=bilinear:fc=black,vignette=angle=PI/%s", ff(curvature), ff(curvature*0.24), ff(vignette))
	case "crt-phosphor":
		pitch := number("pitch", 3, 2, 12, true)
		thickness := number("thickness", 1, 1, 4, true)
		scanline := number("scanline", 4, 2, 16, true)
		opacity := number("opacity", 0.3, 0, 0.8, false)
		filter = fmt.Sprintf("format=rgb24,rgbashift=rh=1:bh=-1:edge=smear,drawgrid=width=%s:height=ih:thickness=%s:color=black@%s,drawgrid=width=iw:height=%s:thickness=1:color=black@%s", ff(pitch), ff(thickness), ff(opacity), ff(scanline), ff(opacity*0.8))
	case "color-isolation":
		red := int(number("red", 220, 0, 255, true))
		green := int(number("green", 45, 0, 255, true))
		blue := int(number("blue", 40, 0, 255, true))
		similarity := number("similarity", 0.18, 0.01, 1, false)
		blend := number("blend", 0.08, 0, 1, false)
		filter = fmt.Sprintf("colorhold=color=0x%02x%02x%02x:similarity=%s:blend=%s", red, green, blue, ff(similarity), ff(blend))
	case "solarize":
		threshold := ff(number("threshold", 128, 0, 255, true))
		expression := fmt.Sprintf("'if(lt(val,%s),val,255-val)'", threshold)
		filter = fmt.Sprintf("format=rgb24,lutrgb=r=%s:g=%s:b=%s", expression, expression, expression)
	case "gate-weave":
		amount := number("amount", 2, 0, 12, false)
		speed := number("speed", 1, 0.1, 4, false)
		margin := shakeMargin(amount)
		filter = fmt.Sprintf("crop=w=iw-%d:h=ih-%d:x=%d+%s*sin(%s*t):y=%d+%s*sin(%s*t),scale=w=iw+%d:h=ih+%d", margin*2, margin*2, margin, ff(amount), ff(speed*7), margin, ff(amount*0.7), ff(speed*11), margin*2, margin*2)
	case "dust-scratches":
		dust := number("dust", 10, 0, 40, true)
		spacing := number("spacing", 173, 24, 512, true)
		thickness := number("thickness", 1, 1, 4, true)
		opacity := number("opacity", 0.12, 0, 0.6, false)
		filter = fmt.Sprintf("noise=alls=%s:allf=t+u:all_seed=79,format=rgb24,drawgrid=width=%s:height=ih:thickness=%s:color=white@%s", ff(dust), ff(spacing), ff(thickness), ff(opacity))
	case "film-flicker":
		amount := number("amount", 0.07, 0, 0.25, false)
		rate := number("rate", 5, 0.5, 15, false)
		contrast := number("contrast", 1.06, 0.7, 1.6, false)
		filter = fmt.Sprintf("eq=brightness='%s*(0.58*sin(2*PI*%s*t)+0.29*sin(2*PI*%s*t)+0.13*sin(2*PI*%s*t))':contrast=%s:eval=frame", ff(amount), ff(rate), ff(rate*2.37), ff(rate*5.11), ff(contrast))
	case "comic-book":
		levels := number("levels", 7, 2, 24, true)
		edgeLow := number("edgeLow", 0.06, 0, 1, false)
		edgeHigh := number("edgeHigh", 0.22, 0, 1, false)
		edgeOpacity := number("edgeOpacity", 0.82, 0, 1, false)
		expression := posterizeExpr(levels)
		filter = fmt.Sprintf("split[%sa][%sb];[%sa]format=rgb24,lutrgb=r=%s:g=%s:b=%s[%sp];[%sb]format=gray,edgedetect=low=%s:high=%s:mode=wires,negate[%se];[%sp][%se]blend=all_mode=multiply:all_opacity=%s", tag, tag, tag, expression, expression, expression, tag, tag, ff(edgeLow), ff(edgeHigh), tag, tag, tag, ff(edgeOpacity))
	case "oil-painting":
		spatial := number("spatial", 7, 0.1, 20, false)
		sampleRange := number("range", 0.16, 0.01, 1, false)
		median := number("median", 1, 1, 5, true)
		levels := number("levels", 12, 3, 32, true)
		expression := posterizeExpr(levels)
		filter = fmt.Sprintf("bilateral=sigmaS=%s:sigmaR=%s,median=radius=%s,format=rgb24,lutrgb=r=%s:g=%s:b=%s", ff(spatial), ff(sampleRange), ff(median), expression, expression, expression)
	case "neon-edges":
		low := number("low", 0.04, 0, 1, false)
		high := number("high", 0.18, 0, 1, false)
		contrast := number("contrast", 1.7, 0.5, 3, false)
		brightness := number("brightness", -0.08, -1, 1, false)
		saturation := number("saturation", 2, 0, 3, false)
		glow := number("glow", 0.7, 0, 5, false)
		filter = fmt.Sprintf("edgedetect=low=%s:high=%s:mode=colormix,eq=contrast=%s:brightness=%s:saturation=%s,gblur=sigma=%s", ff(low), ff(high), ff(contrast), ff(brightness), ff(saturation), ff(glow))
	case "tilt-shift":
		blur := number("blur", 9, 0.5, 40, false)
		focus := number("focus", 0.24, 0.05, 0.8, false)
		top := 0.5 - focus/2
		bottom := 0.5 + focus/2
		filter = fmt.Sprintf("split[%sa][%sb];[%sb]gblur=sigma=%s[%sg];[%sa][%sg]blend=all_expr='if(between(Y/H,%s,%s),A,B)'", tag, tag, tag, ff(blur), tag, tag, tag, ff(top), ff(bottom))
	}

	if err := params.validate(); err != nil {
		return "", err
	}
	return filter, nil
}

func buildFilter(effects []effect) (string, error) {
	return buildFilterForDuration(effects, 0)
}

func buildFilterForDuration(effects []effect, segmentDuration float64) (string, error) {
	type stage struct {
		graph  string
		ramped bool
	}
	stages := make([]stage, 0, len(effects))
	for i, effect := range effects {
		filter, err := buildEffectFilterTagged(effect, fmt.Sprintf("r%di", i))
		if err != nil {
			return "", err
		}
		if effect.Ramp != nil && !noRampEffects[effect.ID] {
			duration := segmentDuration
			if !(duration > 0) {
				duration = effect.Ramp.BlockDuration - effect.Ramp.Offset
			}
			if animated, labeled, ok := buildParameterRamp(effect, *effect.Ramp, duration, fmt.Sprintf("r%d", i)); ok {
				stages = append(stages, stage{graph: animated, ramped: labeled})
				continue
			}
			tag := fmt.Sprintf("r%d", i)
			if animated, ok := wrapRampStagesAnimated(filter, *effect.Ramp, duration, tag); ok {
				stages = append(stages, stage{graph: animated, ramped: true})
				continue
			}
			if expr := rampIntensityExpr(*effect.Ramp); expr != "" {
				stages = append(stages, stage{graph: wrapRampStages(filter, expr, tag), ramped: true})
				continue
			}
		}
		stages = append(stages, stage{graph: filter, ramped: strings.Contains(filter, "split[")})
	}

	ramped := false
	currentSpace := colorSpaceUnknown
	for index := range stages {
		// Keep full-chroma yuv444p across consecutive YUV-native stages to avoid
		// redundant RGB24 <-> YUV444P swscale conversions, while preserving rgb24
		// for RGB-native filters and complex graphs.
		if innerStages := rampFilterStages(stages[index].graph); len(innerStages) > 1 {
			normalized := make([]string, 0, len(innerStages))
			for _, innerStage := range innerStages {
				var out string
				out, currentSpace = normalizeStageColorSpace(innerStage, currentSpace)
				normalized = append(normalized, out)
			}
			stages[index].graph = strings.Join(normalized, ",")
		} else {
			stages[index].graph, currentSpace = normalizeStageColorSpace(stages[index].graph, currentSpace)
		}
		ramped = ramped || stages[index].ramped
	}
	if !ramped {
		graphs := make([]string, 0, len(stages))
		for _, s := range stages {
			graphs = append(graphs, s.graph)
		}
		return strings.Join(graphs, ","), nil
	}

	// Labeled filtergraph: each stage consumes the previous stage's output pad.
	parts := make([]string, 0, len(stages))
	for i, s := range stages {
		prefix := ""
		if i > 0 {
			prefix = fmt.Sprintf("[c%d]", i)
		}
		suffix := ""
		if i < len(stages)-1 {
			suffix = fmt.Sprintf("[c%d]", i+1)
		}
		parts = append(parts, prefix+s.graph+suffix)
	}
	return strings.Join(parts, ";"), nil
}
