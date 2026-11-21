package render

import (
	"encoding/base64"
	"encoding/json"
	"image/png"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestFFFormatsFloatingPointNoise(t *testing.T) {
	tests := map[float64]string{
		1.4499999999999993: "1.45",
		0.3333333333333333: "0.333333",
		-0.0000001:         "0",
	}
	for input, want := range tests {
		if got := ff(input); got != want {
			t.Errorf("ff(%v) = %q, want %q", input, got, want)
		}
	}
}

func TestRequestPreservesChannelBoundaries(t *testing.T) {
	body := []byte(`{
		"resolution":{"w":1920,"h":1080},
		"fps":30,
		"videoChannels":[
			{"clips":[{"file":"first.mp4","inPoint":0,"outPoint":2,"start":0,"segments":[]}],"transitions":[]},
			{"clips":[{"file":"second.mp4","inPoint":0,"outPoint":2,"start":0,"segments":[]}],"transitions":[]}
		],
		"audioChannels":[
			{"clips":[{"file":"first.mp4","inPoint":0,"outPoint":2,"start":0,"segments":[]}]},
			{"clips":[{"file":"second.mp4","inPoint":0,"outPoint":2,"start":0,"segments":[]}]}
		]
	}`)

	var req renderRequest
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatalf("unmarshal render request: %v", err)
	}
	if got := len(req.VideoChannels); got != 2 {
		t.Fatalf("video channels = %d, want 2", got)
	}
	if got := len(req.AudioChannels); got != 2 {
		t.Fatalf("audio channels = %d, want 2", got)
	}
	if req.VideoChannels[0].Clips[0].File == req.VideoChannels[1].Clips[0].File {
		t.Fatal("clips from independent video channels were merged")
	}
}

func TestOutputSettingsMapFormatsAndQuality(t *testing.T) {
	tests := []struct {
		format, quality, videoQuality, audioBitrate string
		audioOnly                                   bool
	}{
		{format: "mp4", quality: "low", videoQuality: "30", audioBitrate: "96k"},
		{format: "avi", quality: "normal", videoQuality: "5", audioBitrate: "160k"},
		{format: "mp3", quality: "high", audioBitrate: "256k", audioOnly: true},
	}
	for _, test := range tests {
		settings, err := parseOutputSettings(test.format, test.quality)
		if err != nil {
			t.Fatalf("parse output %s/%s: %v", test.format, test.quality, err)
		}
		if settings.videoQuality != test.videoQuality || settings.audioBitrate != test.audioBitrate || settings.audioOnly != test.audioOnly {
			t.Errorf("settings for %s/%s = %#v", test.format, test.quality, settings)
		}
	}
}

func TestOutputSettingsRejectUnsupportedValues(t *testing.T) {
	if _, err := parseOutputSettings("webm", "normal"); err == nil {
		t.Fatal("unsupported output format was accepted")
	}
	if _, err := parseOutputSettings("mp4", "maximum"); err == nil {
		t.Fatal("unsupported output quality was accepted")
	}
}

func TestMP3RequestKeepsOnlyAudioChannels(t *testing.T) {
	req := renderRequest{
		Format:        "mp3",
		Quality:       "high",
		VideoChannels: []channel{{Clips: []clip{{File: "video.mp4"}}}},
		AudioChannels: []channel{{Clips: []clip{{File: "audio.wav"}}}},
		TextItems:     []textItem{{Image: "ignored"}},
	}

	normalized, err := normalizeOutputRequest(req)
	if err != nil {
		t.Fatalf("normalize MP3 request: %v", err)
	}
	if len(normalized.VideoChannels) != 0 || len(normalized.TextItems) != 0 {
		t.Fatalf("MP3 request retained visual content: %#v", normalized)
	}
	if len(normalized.AudioChannels) != 1 {
		t.Fatal("MP3 request removed its audio channels")
	}
}

func TestChannelActiveExpressionMergesOnlyOverlappingWindows(t *testing.T) {
	doubleSpeed := 2.0
	clips := []clip{
		{Start: 0, InPoint: 0, OutPoint: 4, PlaybackRate: &doubleSpeed},
		{Start: 1.5, InPoint: 0, OutPoint: 1.5},
		{Start: 5, InPoint: 0, OutPoint: 1},
	}

	got := channelActiveExpression(clips)
	want := "between(t,0,3)+between(t,5,6)"
	if got != want {
		t.Fatalf("active expression = %q, want %q", got, want)
	}
}

func TestPlaybackRateDefaultsAndChangesTimelineDuration(t *testing.T) {
	doubleSpeed := 2.0
	defaultRate := clip{Start: 3, InPoint: 2, OutPoint: 8}
	fast := clip{Start: 3, InPoint: 2, OutPoint: 8, PlaybackRate: &doubleSpeed}

	if got := clipPlaybackRate(defaultRate); got != 1 {
		t.Fatalf("default playback rate = %v, want 1", got)
	}
	if got := clipSourceDur(fast); got != 6 {
		t.Fatalf("source duration = %v, want 6", got)
	}
	if got := clipDurT(fast); got != 3 {
		t.Fatalf("timeline duration = %v, want 3", got)
	}
	if got := clipEndT(fast); got != 6 {
		t.Fatalf("timeline end = %v, want 6", got)
	}
}

func TestValidateClipCompositingRejectsUnsafeValues(t *testing.T) {
	invalidOpacity, invalidFade := 1.1, -0.1
	if err := validateClipCompositing([]clip{{InPoint: 0, OutPoint: 1, Opacity: &invalidOpacity}}); err == nil {
		t.Fatal("out-of-range opacity was accepted")
	}
	if err := validateClipCompositing([]clip{{InPoint: 0, OutPoint: 1, FadeIn: &invalidFade}}); err == nil {
		t.Fatal("negative fade duration was accepted")
	}
	tinyFade := 0.0000004
	if got := clipFadeInDuration(clip{InPoint: 0, OutPoint: 1, FadeIn: &tinyFade}); got != 0 {
		t.Fatalf("sub-precision fade = %v, want 0", got)
	}
}

func TestVideoMaskFilterPreservesLayerGeometryAndFade(t *testing.T) {
	opacity, fadeIn, fadeOut := 0.8, 0.5, 0.75
	transform := normalizeTransform(nil)
	transform.ZoomX = 0.5
	transform.ZoomY = 0.5
	transform.PositionX = 20
	clip := clip{
		InPoint: 0, OutPoint: 3, MediaKind: "image",
		Opacity: &opacity, FadeIn: &fadeIn, FadeOut: &fadeOut,
		Transform: &transform,
	}
	got := videoMaskFilter(clip, 1280, 720, 30, "")
	for _, fragment := range []string{
		"format=rgba,alphaextract",
		"scale=1280:720:force_original_aspect_ratio=decrease",
		"pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
		"lut=y='val*0.8'",
		"fade=t=in:st=0:d=0.5:color=black",
		"fade=t=out:st=2.25:d=0.75:color=black",
		"perspective=x0=",
		"shear@transform_shear=",
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("video mask filter %q does not contain %q", got, fragment)
		}
	}
}

func TestVideoSegmentFramesUseCumulativeTimelineBoundaries(t *testing.T) {
	clip := clip{InPoint: 0, OutPoint: 3}
	first := segment{SrcStart: 0, SrcEnd: 1.05}
	second := segment{SrcStart: 1.05, SrcEnd: 3}

	if got := videoSegmentFrameCount(clip, first, 30); got != 32 {
		t.Fatalf("first segment frames = %d, want 32", got)
	}
	if got := videoSegmentFrameCount(clip, second, 30); got != 58 {
		t.Fatalf("second segment frames = %d, want 58", got)
	}
	if got, want := exactVideoFrameFilter(30, 58), "tpad=stop_mode=clone:stop=-1,trim=end_frame=58,setpts=N/(30*TB)"; got != want {
		t.Fatalf("exact frame filter = %q, want %q", got, want)
	}
}

func TestValidatePlaybackRates(t *testing.T) {
	validRates := []float64{0.25, 1, 4}
	valid := make([]clip, len(validRates)+1)
	for i := range validRates {
		valid[i].PlaybackRate = &validRates[i]
	}
	if err := validatePlaybackRates(valid); err != nil {
		t.Fatalf("valid playback rates rejected: %v", err)
	}

	invalidRates := []float64{0, 0.249, 4.001, math.NaN(), math.Inf(1), math.Inf(-1)}
	for _, rate := range invalidRates {
		if err := validatePlaybackRates([]clip{{PlaybackRate: &rate}}); err == nil {
			t.Errorf("invalid playback rate %v was accepted", rate)
		}
	}
}

func TestRejectsPlaybackRateBeforeFileLookup(t *testing.T) {
	app := fiber.New()
	app.Post("/render", Export)
	body := `{
		"resolution":{"w":1920,"h":1080},
		"videoChannels":[{"clips":[{
			"file":"missing.mp4","inPoint":0,"outPoint":2,"start":0,"playbackRate":4.1
		}]}]
	}`

	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/render?session=test-session-1", strings.NewReader(body)))
	if err != nil {
		t.Fatalf("render request: %v", err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusBadRequest)
	}
}

func TestGroupOverlappingIsScopedToProvidedChannel(t *testing.T) {
	clips := []clip{
		{Start: 0, InPoint: 0, OutPoint: 2},
		{Start: 1.5, InPoint: 0, OutPoint: 2},
		{Start: 5, InPoint: 0, OutPoint: 1},
	}

	groups := groupOverlapping(clips)
	if len(groups) != 2 || groups[0] != [2]int{0, 1} || groups[1] != [2]int{2, 2} {
		t.Fatalf("groups = %#v, want [[0 1] [2 2]]", groups)
	}
}

func TestAudioVolumeFilterSupportsMuteAttenuationAndBoost(t *testing.T) {
	zero, half, boosted := 0.0, 50.0, 150.0
	tests := []struct {
		name   string
		volume *float64
		want   string
	}{
		{name: "default", want: "volume=1"},
		{name: "muted", volume: &zero, want: "volume=0"},
		{name: "attenuated", volume: &half, want: "volume=0.5"},
		{name: "boosted", volume: &boosted, want: "volume=1.5"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := audioVolumeFilter(clip{Volume: test.volume}); got != test.want {
				t.Fatalf("audio volume filter = %q, want %q", got, test.want)
			}
		})
	}
}

func TestCoalesceContinuousAudioClips(t *testing.T) {
	fullVolume := 100.0
	halfVolume := 50.0
	clips := []clip{
		{File: "source.wav", MediaKind: "audio", Start: 0.917, InPoint: 0.917, OutPoint: 1.376, Volume: &fullVolume},
		{File: "source.wav", MediaKind: "audio", Start: 0, InPoint: 0, OutPoint: 0.431},
		{File: "source.wav", MediaKind: "audio", Start: 0.431, InPoint: 0.431, OutPoint: 0.917, Volume: &fullVolume},
		{File: "source.wav", MediaKind: "audio", Start: 1.376, InPoint: 1.376, OutPoint: 2, Volume: &halfVolume},
		{File: "source.wav", MediaKind: "audio", Start: 2, InPoint: 3, OutPoint: 4, Volume: &halfVolume},
	}

	got := coalesceContinuousAudioClips(clips)
	if len(got) != 3 {
		t.Fatalf("coalesced clips = %#v, want 3 runs", got)
	}
	if got[0].Start != 0 || got[0].InPoint != 0 || got[0].OutPoint != 1.376 {
		t.Fatalf("first coalesced run = %#v", got[0])
	}
	if got[1].Start != 1.376 || got[1].OutPoint != 2 {
		t.Fatalf("volume change was merged: %#v", got[1])
	}
	if got[2].Start != 2 || got[2].InPoint != 3 {
		t.Fatalf("source discontinuity was merged: %#v", got[2])
	}
	if clips[1].OutPoint != 0.431 {
		t.Fatal("input clips were mutated")
	}
}

func TestPlaybackFiltersUseValidTempoStagesAndVideoOrder(t *testing.T) {
	tests := []struct {
		rate float64
		want string
	}{
		{rate: 0.25, want: "atempo=0.5,atempo=0.5"},
		{rate: 0.3, want: "atempo=0.5,atempo=0.6"},
		{rate: 1, want: "atempo=1"},
		{rate: 3, want: "atempo=2,atempo=1.5"},
		{rate: 4, want: "atempo=2,atempo=2"},
	}
	for _, test := range tests {
		if got := audioTempoFilter(test.rate); got != test.want {
			t.Errorf("audio tempo filter for %v = %q, want %q", test.rate, got, test.want)
		}
	}

	halfVolume, doubleSpeed := 50.0, 2.0
	if got, want := audioClipFilter(clip{}), "volume=1"; got != want {
		t.Fatalf("default audio clip filter = %q, want %q", got, want)
	}
	clip := clip{PlaybackRate: &doubleSpeed, Volume: &halfVolume}
	if got, want := audioClipFilter(clip), "atempo=2,volume=0.5"; got != want {
		t.Fatalf("audio clip filter = %q, want %q", got, want)
	}
	if got, want := videoClipFilter(clip, "hue=s=0", "scale=1920:1080"), "setpts=(PTS-STARTPTS)/2,hue=s=0,scale=1920:1080"; got != want {
		t.Fatalf("video clip filter = %q, want %q", got, want)
	}
}

func TestPrepareTextItemsValidatesTimingAndPNG(t *testing.T) {
	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\ncontent"))
	items := []textItem{{Start: 1, Duration: 2, X: 10, Y: 20, Image: png}}
	if err := prepareTextItems(items); err != nil {
		t.Fatalf("valid text item rejected: %v", err)
	}
	if string(items[0].data) != "\x89PNG\r\n\x1a\ncontent" {
		t.Fatal("decoded PNG was not retained for rendering")
	}

	invalid := []textItem{{Start: 0, Duration: 0, Image: png}}
	if err := prepareTextItems(invalid); err == nil {
		t.Fatal("zero-duration text was accepted")
	}
	invalid = []textItem{{Start: 0, Duration: 1, Image: base64.StdEncoding.EncodeToString([]byte("not png"))}}
	if err := prepareTextItems(invalid); err == nil {
		t.Fatal("non-PNG text image was accepted")
	}
}

func TestTextOverlayXBuildsWhitelistedSlideMotion(t *testing.T) {
	item := textItem{Start: 1, Duration: 3, X: 120, Animation: "slide-right", AnimationDuration: 0.5}
	got := textOverlayX(item)
	if !strings.Contains(got, "120+(W-120)*pow(1-(t-1)/0.5,3)") {
		t.Fatalf("slide entrance expression missing from %q", got)
	}
	if !strings.Contains(got, "120+(W-120)*pow((t-3.5)/0.5,3)") {
		t.Fatalf("slide exit expression missing from %q", got)
	}
}

func TestTextOverlayYBuildsWhitelistedShortFormMotion(t *testing.T) {
	item := textItem{Start: 1, Duration: 3, Y: 220, Animation: "pop", AnimationDuration: 0.25}
	got := textOverlayY(item)
	for _, fragment := range []string{
		"220+0.07*H*pow(1-(t-1)/0.25,5)",
		"220+0.07*H*pow((t-3.75)/0.25,3)",
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("pop expression %q does not contain %q", got, fragment)
		}
	}
}

func TestTextOverlayBuildsExpandedShortFormMotion(t *testing.T) {
	motionStart, motionDuration := 1.0, 3.0
	bounce := textItem{
		Start: 2, Duration: 0.5, X: 120, Y: 220,
		Animation: "bounce", AnimationDuration: 0.25,
		MotionStart: &motionStart, MotionDuration: &motionDuration,
	}
	for _, fragment := range []string{
		"220+0.08*H*cos(3*PI*(t-1)/0.25)*pow(1-(t-1)/0.25,2)",
		"220+0.08*H*pow((t-3.75)/0.25,3)",
	} {
		if got := textOverlayY(bounce); !strings.Contains(got, fragment) {
			t.Fatalf("bounce expression %q does not contain %q", got, fragment)
		}
	}

	shake := textItem{Start: 1, Duration: 2, X: 120, Animation: "shake", AnimationDuration: 0.4}
	if got := textOverlayX(shake); !strings.Contains(got, "120-0.08*w*cos(6*PI*(t-1)/0.4)*pow(1-(t-1)/0.4,2)") {
		t.Fatalf("shake expression missing from %q", got)
	}

	float := textItem{Start: 1, Duration: 2, Y: 220, Animation: "float", AnimationDuration: 0.4}
	if got := textOverlayY(float); got != "'220+0.025*H*(1-2*(t-1)/2)'" {
		t.Fatalf("float expression = %q", got)
	}
}

func TestPlanTextOverlayChunksCapsSequentialLayers(t *testing.T) {
	items := make([]textItem, 60)
	for index := range items {
		items[index] = textItem{Start: float64(index), Duration: 1}
	}

	chunks := planTextOverlayChunks(items, 30, 60, maxTextOverlaysPerPass)
	if len(chunks) != 3 {
		t.Fatalf("text overlay chunk count = %d, want 3", len(chunks))
	}
	if chunks[0].startFrame != 0 || chunks[len(chunks)-1].endFrame != 60*30 {
		t.Fatalf("text overlay chunks do not cover the timeline: %#v", chunks)
	}
	for index, chunk := range chunks {
		if len(chunk.itemIndices) > maxTextOverlaysPerPass {
			t.Errorf("chunk %d contains %d layers, limit %d", index, len(chunk.itemIndices), maxTextOverlaysPerPass)
		}
		if index > 0 && chunk.startFrame != chunks[index-1].endFrame {
			t.Errorf("chunk %d starts at frame %d after previous end %d", index, chunk.startFrame, chunks[index-1].endFrame)
		}
	}
}

func TestTextItemForOverlayChunkPreservesGlobalMotion(t *testing.T) {
	motionStart, motionDuration := 1.0, 8.0
	item := textItem{
		Start: 5, Duration: 2,
		MotionStart: &motionStart, MotionDuration: &motionDuration,
	}

	got := textItemForOverlayChunk(item, 4, 2)
	if got.Start != 1 || got.Duration != 1 {
		t.Fatalf("local text timing = %v/%v, want 1/1", got.Start, got.Duration)
	}
	if got.MotionStart == nil || *got.MotionStart != -3 || got.MotionDuration == nil || *got.MotionDuration != 8 {
		t.Fatalf("local motion window = %v/%v, want -3/8", got.MotionStart, got.MotionDuration)
	}
}

func TestFFmpegTextOverlayChunkingIntegration(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to validate text overlays with native FFmpeg")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Fatal("ffmpeg is required for text overlay integration tests")
	}

	work := t.TempDir()
	base := filepath.Join(work, "base.mp4")
	image := filepath.Join(work, "text.png")
	commands := [][]string{
		{"-f", "lavfi", "-i", "color=c=black:s=96x64:r=30:d=12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", base},
		{"-f", "lavfi", "-i", "color=c=red@0.5:s=20x10", "-frames:v", "1", "-threads", "1", "-y", image},
	}
	for _, args := range commands {
		if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
			t.Fatalf("create text overlay fixture: %v: %s", err, output)
		}
	}
	textPNG, err := os.ReadFile(image)
	if err != nil {
		t.Fatalf("read text overlay fixture: %v", err)
	}
	items := make([]textItem, 120)
	for index := range items {
		items[index] = textItem{Start: float64(index) / 10, Duration: 0.1, data: textPNG}
	}

	lastRatio := 0.0
	updates := 0
	progress := newRenderProgress(6, func(ratio float64, _ string) {
		if ratio < lastRatio {
			t.Errorf("text render progress regressed from %v to %v", lastRatio, ratio)
		}
		lastRatio = ratio
		updates++
	})
	output, err := overlayTextItems(base, items, 96, 64, 30, 12, work, progress)
	if err != nil {
		t.Fatalf("render chunked text overlays: %v", err)
	}
	if updates < 2 || lastRatio <= 0 {
		t.Fatalf("text render progress did not advance: updates=%d ratio=%v", updates, lastRatio)
	}
	probe, err := exec.Command(
		"ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
		"-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", output,
	).CombinedOutput()
	if err != nil {
		t.Fatalf("probe chunked text overlay: %v: %s", err, probe)
	}
	if got := strings.TrimSpace(string(probe)); got != "360" {
		t.Fatalf("chunked text overlay frame count = %s, want 360", got)
	}

	sample := filepath.Join(work, "sample.png")
	if output, err := exec.Command("ffmpeg", "-ss", "1.55", "-i", output, "-frames:v", "1", "-threads", "1", "-y", sample).CombinedOutput(); err != nil {
		t.Fatalf("extract repeated text overlay frame: %v: %s", err, output)
	}
	sampleFile, err := os.Open(sample)
	if err != nil {
		t.Fatalf("open repeated text overlay frame: %v", err)
	}
	defer sampleFile.Close()
	frame, err := png.Decode(sampleFile)
	if err != nil {
		t.Fatalf("decode repeated text overlay frame: %v", err)
	}
	red, green, blue, _ := frame.At(5, 5).RGBA()
	if red <= green*2 || red <= blue*2 {
		t.Fatalf("static text image was not repeated at 1.55s: rgb16=(%d,%d,%d)", red, green, blue)
	}
}

func TestCatalogContainsAllBrowserPresets(t *testing.T) {
	if got := len(effectFilters); got != 84 {
		t.Fatalf("render effect count = %d, want 84", got)
	}
	if got := len(xfadeNames); got != 76 {
		t.Fatalf("xfade count = %d, want 76", got)
	}
}

func TestBuildFilterPreservesEffectOrder(t *testing.T) {
	got, err := buildFilter([]effect{{ID: "grayscale"}, {ID: "vignette"}})
	if err != nil {
		t.Fatalf("build render filter: %v", err)
	}
	for _, fragment := range []string{"hue=s=0", "vignette=angle=PI/4"} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("render filter = %q, want fragment %q", got, fragment)
		}
	}

	if _, err := buildFilter([]effect{{ID: "grayscale"}, {ID: "not-registered"}}); err == nil {
		t.Fatal("unknown effect was accepted")
	}
}

func TestBuildFilterValidatesAndAppliesEffectParameters(t *testing.T) {
	got, err := buildFilter([]effect{{
		ID: "blur",
		Params: map[string]float64{
			"lumaRadius": 20, "lumaPower": 3, "chromaRadius": 10, "chromaPower": 2,
		},
	}})
	if err != nil {
		t.Fatalf("build configurable blur: %v", err)
	}
	want := "boxblur=luma_radius='min(20,min(w,h)/2)':luma_power=3:chroma_radius='min(10,min(cw,ch)/2)':chroma_power=2"
	if !strings.Contains(got, want) {
		t.Fatalf("render filter = %q, want fragment %q", got, want)
	}

	invalid := []effect{{ID: "blur", Params: map[string]float64{"lumaRadius": 1000}}}
	if _, err := buildFilter(invalid); err == nil {
		t.Fatal("out-of-range parameter was accepted")
	}
	unknown := []effect{{ID: "blur", Params: map[string]float64{"filter": 1}}}
	if _, err := buildFilter(unknown); err == nil {
		t.Fatal("unknown parameter was accepted")
	}
	invalidAngle := []effect{{ID: "directional-blur", Params: map[string]float64{"angle": -1}}}
	if _, err := buildFilter(invalidAngle); err == nil {
		t.Fatal("negative directional blur angle was accepted")
	}
	zeroDenoise := []effect{{ID: "denoise", Params: map[string]float64{"lumaSpatial": 0}}}
	if _, err := buildFilter(zeroDenoise); err == nil {
		t.Fatal("zero hqdn3d strength was accepted")
	}
	posterize, err := buildFilter([]effect{{ID: "posterize", Params: map[string]float64{"levels": 3}}})
	if err != nil {
		t.Fatalf("build posterize: %v", err)
	}
	wantPosterize := "format=rgb24,lutrgb=r=floor(val*3/256)*255/2:g=floor(val*3/256)*255/2:b=floor(val*3/256)*255/2"
	if posterize != wantPosterize {
		t.Fatalf("posterize filter = %q, want %q", posterize, wantPosterize)
	}
	compound, err := buildFilter([]effect{
		{ID: "negative-strobe", Params: map[string]float64{"rate": 10, "duty": 0.4}},
		{ID: "frame-echo", Params: map[string]float64{"delayFrames": 3, "opacity": 0.5}},
	})
	if err != nil {
		t.Fatalf("build compound clip effects: %v", err)
	}
	for _, fragment := range []string{"negate=enable='lt(mod(t*10+0.0000001,1),0.4)'", "tmix=frames=4:weights=1 0 0 0.5:scale=0.666667"} {
		if !strings.Contains(compound, fragment) {
			t.Fatalf("compound filter %q does not contain %q", compound, fragment)
		}
	}
	shortForm, err := buildFilter([]effect{
		{ID: "flash-hit", Params: map[string]float64{"brightness": 0.5, "contrast": 1.1, "saturation": 0.4}},
		{ID: "rgb-punch", Params: map[string]float64{"shift": 9, "contrast": 1.2, "saturation": 1.3}},
		{ID: "analog-flicker", Params: map[string]float64{"amount": 0.04, "rate": 6, "contrast": 1.05, "grain": 4}},
	})
	if err != nil {
		t.Fatalf("build short-form effects: %v", err)
	}
	for _, fragment := range []string{"eq=brightness=0.5:contrast=1.1:saturation=0.4", "rgbashift=rh=9:bh=-9", "brightness='0.04*sin(2*PI*6*t)'"} {
		if !strings.Contains(shortForm, fragment) {
			t.Fatalf("short-form filter %q does not contain %q", shortForm, fragment)
		}
	}
	prism, err := buildFilter([]effect{{ID: "prism", Params: map[string]float64{"shift": 4}}})
	if err != nil {
		t.Fatalf("build prism split: %v", err)
	}
	if prism != "format=rgb24,rgbashift=rh=4:bh=-4:edge=smear" {
		t.Fatalf("prism filter = %q", prism)
	}
}

func TestBuildFilterAppliesNewLinearEffectParameters(t *testing.T) {
	got, err := buildFilter([]effect{{
		ID: "light-rays",
		Params: map[string]float64{
			"threshold":  0.2,
			"angle":      120,
			"length":     32,
			"brightness": -0.1,
		},
	}})
	if err != nil {
		t.Fatalf("build light-rays: %v", err)
	}
	want := "edgedetect=low=0.2:high=0.6:mode=colormix"
	if !strings.Contains(got, want) {
		t.Fatalf("light-rays filter = %q, want fragment %q", got, want)
	}
	for _, fragment := range []string{"dblur=angle=120:radius=32", "eq=brightness=-0.1:contrast=1.08"} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("light-rays filter = %q, want fragment %q", got, fragment)
		}
	}
}

func TestBuildFilterUsesUniqueCompoundEffectLabels(t *testing.T) {
	got, err := buildFilter([]effect{{ID: "glow-bloom"}, {ID: "halation"}})
	if err != nil {
		t.Fatalf("build compound effects: %v", err)
	}
	for _, fragment := range []string{
		"split[r0ia][r0ib]",
		"[r0ia][r0ig]blend=all_mode=screen:all_opacity=0.35",
		"split[r1ia][r1ib]",
		"[r1ia][r1ih]blend=all_mode=screen:all_opacity=0.24",
	} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("compound filter %q does not contain %q", got, fragment)
		}
	}

	ramped, err := buildFilter([]effect{{
		ID: "tilt-shift",
		Ramp: &ramp{
			Mode: "in", Curve: "linear", Amount: 0.5,
			BlockDuration: 2, Offset: 0,
		},
	}})
	if err != nil {
		t.Fatalf("build ramped compound effect: %v", err)
	}
	for _, fragment := range []string{
		"split[r0a][r0b];[r0b]format=rgb24,split[r0ia][r0ib]",
		"[r0ib]gblur=sigma=9[r0ig]",
		"[r0ia][r0ig]blend=all_expr='if(between(Y/H,0.38,0.62),A,B)'[r0f]",
	} {
		if !strings.Contains(ramped, fragment) {
			t.Fatalf("ramped compound filter %q does not contain %q", ramped, fragment)
		}
	}
}

func TestBuildFilterRejectsInvalidNewEffectParameters(t *testing.T) {
	tests := []effect{
		{ID: "glow-bloom", Params: map[string]float64{"radius": 0.4}},
		{ID: "light-rays", Params: map[string]float64{"length": 3.5}},
		{ID: "color-isolation", Params: map[string]float64{"red": 12.5}},
		{ID: "tilt-shift", Params: map[string]float64{"focus": 0.9}},
	}
	for _, testEffect := range tests {
		t.Run(testEffect.ID, func(t *testing.T) {
			if _, err := buildFilter([]effect{testEffect}); err == nil {
				t.Fatal("invalid parameter was accepted")
			}
		})
	}
}

func TestBuildFilterAppliesIntensityRamp(t *testing.T) {
	ramp := &ramp{
		Mode: "in-out", Curve: "ease-in-out", Amount: 0.25,
		BlockDuration: 4, Offset: 1,
	}
	got, err := buildFilter([]effect{{ID: "sepia", Ramp: ramp}})
	if err != nil {
		t.Fatalf("build ramped effect: %v", err)
	}
	for _, fragment := range []string{"split[r0a][r0b]", "(T+1)", "min(", "blend=all_expr=", "format=gbrp"} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("ramped filter %q does not contain %q", got, fragment)
		}
	}
	if got := strings.Count(got, "blend=all_expr="); got != 1 {
		t.Fatalf("ramped sepia has %d blends, want one for the complete color operation", got)
	}

	stopMotion, err := buildFilter([]effect{{ID: "stop-motion", Ramp: ramp}})
	if err != nil {
		t.Fatalf("build stop-motion: %v", err)
	}
	if !strings.Contains(stopMotion, "fps=12") {
		t.Fatalf("stop-motion ramp changed filter to %q", stopMotion)
	}
}

func TestClipTransformFilterUsesCommandableShearValues(t *testing.T) {
	base := normalizeTransform(nil)
	static := clip{Transform: &base}
	staticFilter := clipTransformFilter(static, 640, 360, 0, 1.2, 30)
	if !strings.Contains(staticFilter, "shear@transform_shear=shx=0:shy=0:fillcolor=black") {
		t.Fatalf("static transform filter = %q", staticFilter)
	}
	if strings.Contains(staticFilter, "sendcmd=") {
		t.Fatalf("static transform unexpectedly uses commands: %q", staticFilter)
	}

	animated := base
	animated.Pitch = 10
	animated.Yaw = 20
	clip := clip{
		TransformKeyframes: []transformKeyframe{
			{Time: 0, Transform: base},
			{Time: 1.2, Transform: animated},
		},
	}
	animatedFilter := clipTransformFilter(clip, 640, 360, 0, 1.2, 30)
	if !strings.Contains(animatedFilter, "sendcmd=c='") {
		t.Fatalf("animated transform has no shear commands: %q", animatedFilter)
	}
	if !strings.Contains(animatedFilter, "shear@transform_shear shx -") || !strings.Contains(animatedFilter, "shear@transform_shear shy -") {
		t.Fatalf("animated transform has incomplete shear commands: %q", animatedFilter)
	}
	if strings.Contains(animatedFilter, "shear=shx='") {
		t.Fatalf("animated transform still uses a t expression in shear: %q", animatedFilter)
	}
	if !strings.Contains(animatedFilter, "perspective=x0='") {
		t.Fatalf("animated transform does not use a fixed-size perspective map: %q", animatedFilter)
	}
	if !strings.Contains(animatedFilter, "on/30") {
		t.Fatalf("animated transform does not use the output frame clock: %q", animatedFilter)
	}
	if !strings.Contains(animatedFilter, ":eval=frame:interpolation=cubic:sense=source") {
		t.Fatalf("animated transform does not use per-frame cubic interpolation: %q", animatedFilter)
	}
	if !strings.Contains(animatedFilter, "pad=648:368:4:4:color=black,perspective=") || !strings.Contains(animatedFilter, ",crop=640:360:4:4,rotate=") {
		t.Fatalf("animated transform has no black perspective guard: %q", animatedFilter)
	}
	if strings.Contains(animatedFilter, "scale=w='max(") {
		t.Fatalf("animated transform still uses dynamic scale/crop: %q", animatedFilter)
	}
}

func TestBuildFilterAnimatesBlurParameters(t *testing.T) {
	ramp := &ramp{
		Mode: "in-out", Curve: "ease-in-out", Amount: 0.25,
		BlockDuration: 3.5, Offset: 0,
	}
	// blur stays a boxblur on both sides: the Pixi preview crossfades it, so
	// a sendcmd-driven gblur here would diverge mid-ramp.
	blur, err := buildFilterForDuration([]effect{{
		ID: "blur",
		Params: map[string]float64{
			"lumaRadius": 41, "lumaPower": 1, "chromaRadius": 4, "chromaPower": 1,
		},
		Ramp: ramp,
	}}, 3.5)
	if err != nil {
		t.Fatalf("build ramped blur: %v", err)
	}
	for _, fragment := range []string{"boxblur=", "blend=all_expr="} {
		if !strings.Contains(blur, fragment) {
			t.Fatalf("ramped blur %q does not contain %q", blur, fragment)
		}
	}
	if strings.Contains(blur, "sendcmd=") {
		t.Fatalf("ramped blur unexpectedly uses sendcmd: %q", blur)
	}

	// Only gaussian-blur animates its sigma on both sides.
	got, err := buildFilterForDuration([]effect{{
		ID:     "gaussian-blur",
		Params: map[string]float64{"sigma": 6, "steps": 2},
		Ramp:   ramp,
	}}, 3.5)
	if err != nil {
		t.Fatalf("build animated gaussian blur: %v", err)
	}
	for _, fragment := range []string{"sendcmd=c='0-0.875 [expr] gblur@r0 sigma", "[expr] gblur@r0 sigmaV", "gblur@r0=sigma=0:steps=2:planes=15:sigmaV=0", "(3-2*("} {
		if !strings.Contains(got, fragment) {
			t.Fatalf("animated gaussian blur %q does not contain %q", got, fragment)
		}
	}
	if strings.Contains(got, "blend=all_expr=") {
		t.Fatalf("animated gaussian blur unexpectedly contains a blend: %q", got)
	}
}

func TestSplitTopLevelFilters(t *testing.T) {
	joined := func(stages []string) string { return strings.Join(stages, ",") }
	if got := splitTopLevelFilters("gblur=sigma=1.2,eq=brightness=0.03:saturation=1.05"); !equalStrings(got, []string{"gblur=sigma=1.2", "eq=brightness=0.03:saturation=1.05"}) {
		t.Fatalf("simple chain split = %q", joined(got))
	}
	if got := splitTopLevelFilters("boxblur=luma_radius=8:luma_power=1"); !equalStrings(got, []string{"boxblur=luma_radius=8:luma_power=1"}) {
		t.Fatalf("single filter split = %q", joined(got))
	}
	if got := splitTopLevelFilters("blend=all_expr='if(between(Y/H,0.38,0.62),A,B)'"); len(got) != 1 {
		t.Fatalf("quoted commas must not split: %q", joined(got))
	}
	for _, complex := range []string{"split[a][b];[b]gblur=sigma=8[c]", "gblur=sigma=8,"} {
		if got := splitTopLevelFilters(complex); got != nil {
			t.Fatalf("complex graph %q must fall back to nil, got %q", complex, joined(got))
		}
	}
	// soft-focus crossfades every stage; split graphs keep one whole wrap.
	soft, err := buildFilterForDuration([]effect{{
		ID:   "soft-focus",
		Ramp: &ramp{Mode: "in", Curve: "linear", Amount: 0.5, BlockDuration: 3.5},
	}}, 3.5)
	if err != nil {
		t.Fatalf("build ramped soft-focus: %v", err)
	}
	if got := strings.Count(soft, "blend=all_expr="); got != 2 {
		t.Fatalf("ramped soft-focus has %d blends, want 2: %q", got, soft)
	}
	glow, err := buildFilterForDuration([]effect{{
		ID:   "glow-bloom",
		Ramp: &ramp{Mode: "in", Curve: "linear", Amount: 0.5, BlockDuration: 3.5},
	}}, 3.5)
	if err != nil {
		t.Fatalf("build ramped glow-bloom: %v", err)
	}
	if got := strings.Count(glow, "blend=all_expr="); got != 1 {
		t.Fatalf("ramped glow-bloom has %d blends, want 1: %q", got, glow)
	}
	// Every catalog filter round-trips through the splitter.
	for id := range effectFilters {
		inner, err := buildEffectFilterTagged(effect{ID: id}, "t0")
		if err != nil {
			t.Fatalf("build %s: %v", id, err)
		}
		if stages := splitTopLevelFilters(inner); stages != nil {
			if joined(stages) != inner {
				t.Fatalf("%s does not round-trip: %q", id, inner)
			}
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSendcmdArgumentsContainNoBareCommas(t *testing.T) {
	// sendcmd splits commands on bare commas with no parenthesis awareness
	// (f_sendcmd.c COMMAND_DELIMS): a single comma inside c='...' aborts the
	// segment with "No command specified in interval #0, command #1"
	// (ffmpeg exit 234). Easing fragments embedded in sendcmd args must stay
	// pure arithmetic — no clip()/min()/max()/if().
	modes := []string{"in", "out", "in-out"}
	curves := []string{"linear", "ease-in", "ease-out", "ease-in-out"}
	for _, mode := range modes {
		for _, curve := range curves {
			// Only gaussian-blur still animates parameters via sendcmd; blur
			// crossfades its boxblur like the Pixi preview.
			got, err := buildFilterForDuration([]effect{{
				ID:     "gaussian-blur",
				Params: map[string]float64{},
				Ramp: &ramp{
					Mode: mode, Curve: curve, Amount: 0.5,
					BlockDuration: 3.5, Offset: 0.25,
				},
			}}, 3.5)
			if err != nil {
				t.Fatalf("build gaussian-blur %s/%s: %v", mode, curve, err)
			}
			if !strings.Contains(got, "sendcmd=") {
				t.Fatalf("gaussian-blur %s/%s has no sendcmd: %q", mode, curve, got)
			}
			for partIndex, part := range strings.Split(got, "sendcmd=c='") {
				if partIndex == 0 {
					continue
				}
				value := part
				if i := strings.Index(value, "'"); i >= 0 {
					value = value[:i]
				} else {
					t.Fatalf("gaussian-blur %s/%s sendcmd value is unterminated: %q", mode, curve, got)
				}
				if strings.Contains(value, ",") {
					t.Fatalf("gaussian-blur %s/%s sendcmd value contains a bare comma: %q", mode, curve, got)
				}
			}
		}
	}
}

func TestSanitizeXfadeAcceptsCatalogAndRejectsUnknownNames(t *testing.T) {
	for name := range xfadeNames {
		if got := sanitizeXfade(name); got != name {
			t.Fatalf("sanitizeXfade(%q) = %q", name, got)
		}
	}
	if got := sanitizeXfade("custom=malicious"); got != "fade" {
		t.Fatalf("unknown transition = %q, want fade", got)
	}
}

func TestXfadeFilterBuildsOnlyWhitelistedOptions(t *testing.T) {
	const expression = `min(255,if(lt(X/W,(1-P)),B,A)+if(eq(PLANE,0),42*exp(-pow(X/W-(1-P),2)/0.0025)*sin(PI*(1-P)),0))`
	if got := sanitizeXfade("custom-whip-left"); got != "custom-whip-left" {
		t.Fatalf("custom transition token = %q", got)
	}
	if got, want := xfadeFilter("custom-whip-left"), "transition=custom:expr='"+expression+"'"; got != want {
		t.Fatalf("custom xfade option = %q, want %q", got, want)
	}
	if got, want := xfadeFilter("wipeleft"), "transition=wipeleft"; got != want {
		t.Fatalf("preset xfade option = %q, want %q", got, want)
	}
	if got, want := xfadeFilter("custom:expr=malicious"), "transition=fade"; got != want {
		t.Fatalf("unknown xfade option = %q, want %q", got, want)
	}
}

func TestFFmpegCatalogIntegration(t *testing.T) {
	if os.Getenv("FFMPEG_INTEGRATION") != "1" {
		t.Skip("set FFMPEG_INTEGRATION=1 to validate filters with native FFmpeg")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Fatal("ffmpeg is required for catalog integration tests")
	}

	for id, filter := range effectFilters {
		t.Run("effect/"+id, func(t *testing.T) {
			args := []string{
				"-hide_banner", "-loglevel", "error",
				"-f", "lavfi", "-i", "testsrc2=size=96x64:rate=30:duration=0.5",
				"-vf", filter,
				"-frames:v", "8", "-f", "null", "-",
			}
			if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
				t.Fatalf("ffmpeg rejected %q: %v: %s", filter, err, output)
			}
		})
	}

	t.Run("animated-blur-ramp", func(t *testing.T) {
		filter, err := buildFilterForDuration([]effect{{
			ID: "blur",
			Params: map[string]float64{
				"lumaRadius": 41, "lumaPower": 1, "chromaRadius": 4, "chromaPower": 1,
			},
			Ramp: &ramp{
				Mode: "in-out", Curve: "ease-in-out", Amount: 0.25,
				BlockDuration: 3.5, Offset: 0,
			},
		}}, 3.5)
		if err != nil {
			t.Fatalf("build animated blur: %v", err)
		}
		args := []string{
			"-hide_banner", "-loglevel", "error",
			// boxblur requires radius <= min(width, height)/2.
			"-f", "lavfi", "-i", "testsrc2=size=128x128:rate=30:duration=3.5",
			"-vf", filter,
			"-frames:v", "105", "-f", "null", "-",
		}
		if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
			t.Fatalf("ffmpeg rejected animated blur %q: %v: %s", filter, err, output)
		}
	})

	for name := range xfadeNames {
		t.Run("transition/"+name, func(t *testing.T) {
			filter := "[0:v][1:v]xfade=" + xfadeFilter(name) + ":duration=0.2:offset=0.2[v]"
			args := []string{
				"-hide_banner", "-loglevel", "error",
				"-f", "lavfi", "-i", "testsrc2=size=96x64:rate=30:duration=0.6",
				"-f", "lavfi", "-i", "smptebars=size=96x64:rate=30:duration=0.6",
				"-filter_complex", filter, "-map", "[v]",
				"-frames:v", "12", "-f", "null", "-",
			}
			if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
				t.Fatalf("ffmpeg rejected %q: %v: %s", name, err, output)
			}
		})
	}
}
