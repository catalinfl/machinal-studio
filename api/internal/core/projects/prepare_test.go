package projects

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

func editableFixture() PreparedComposition {
	caption := document.TextItem{}
	if err := json.Unmarshal([]byte(`{"id":"caption","text":"  Știință\nși țară! 🚀 <>& ","start":1.1,"duration":1.3,"fontFamily":"montserrat","fontWeight":700,"words":[{"text":" Știință","start":0,"end":0.5},{"text":"și țară! ","start":0.5,"end":1.3}]}`), &caption); err != nil {
		panic(err)
	}
	assets := []document.Asset{
		{ID: "scene", File: "ai_scene_0123456789abcdef0123456789abcdef_01.scene.json", Version: "sha256:scene", Kind: "video", Duration: 5 * document.Second},
		{ID: "voice", File: "voice_fixture.mp3", Version: "sha256:voice", Kind: "audio", Duration: 5 * document.Second},
		{ID: "artwork", File: "poster.png", Version: "sha256:art", Kind: "image", Duration: 10 * document.Second},
	}
	tracks := []document.Track{
		{ID: "video", Name: "Scenes", Type: "video", Clips: []document.Clip{
			{ID: "first", AssetID: "scene", Start: 0, InPoint: document.Second, OutPoint: 5 * document.Second,
				PlaybackRate: 1, Opacity: .8, FadeIn: document.Seconds(.2), Transform: document.IdentityTransform(), Motion: "slow-zoom-in"},
			{ID: "second", AssetID: "artwork", Start: 3 * document.Second, OutPoint: 4 * document.Second,
				PlaybackRate: 2, Transform: document.IdentityTransform()},
		}},
		{ID: "audio", Name: "Narration", Type: "audio", Clips: []document.Clip{
			{ID: "narration", AssetID: "voice", OutPoint: 5 * document.Second, PlaybackRate: 1, Volume: 85},
		}},
	}
	return PreparedComposition{JobID: "job", UpdatedAt: time.Now().UTC(), CompositionID: "compiled",
		Document: &document.Document{Version: 1, Mode: "assemble", Tracks: tracks, Texts: []document.TextItem{caption},
			Jobs: []document.Job{{ID: "captions", Type: "captions.generate", ResultTextIDs: []string{"caption"}}}},
		Bindings: document.Bindings{"shots": {"scene", "artwork"}},
		Composition: &composition.Composition{ID: "compiled", Duration: 5 * document.Second, Assets: assets, Tracks: tracks,
			Output:    document.Output{Aspect: "portrait", Fit: "cover", Resolution: "1080p", FPS: 24, Format: "mp4", Quality: "high"},
			TextItems: []document.TextItem{caption}, Effects: []document.EffectBlock{
				{ID: "grade", TrackID: "video", Preset: "contrast", Duration: 4 * document.Second, Params: map[string]float64{"amount": .5},
					OwnerClipID: "first", Provenance: &document.Provenance{Rule: "look:film", InstanceID: "first"}},
			}, Transitions: []document.Transition{{ID: "junction", TrackID: "video", LeftClipID: "first", RightClipID: "second", Preset: "fade", Duration: document.Second}},
		}}
}

func TestPreparedCompositionIsPersistedAsEditableProjectBeforeBrowserOpens(t *testing.T) {
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	mediaOnly := json.RawMessage(`{"schemaVersion":1,"custom":{"keep":true},"timeline":{"channels":[],"documentSession":null},"media":[{"id":"old","name":"poster.png","displayName":"My artwork"},{"id":"extra","name":"music.mp3","kind":"audio","duration":10,"sourceMode":"wasm"}]}`)
	project, err = store.Update("alice", project.ID, project.Name, project.Version, mediaOnly)
	if err != nil {
		t.Fatal(err)
	}
	prepared := editableFixture()
	updated, err := store.ApplyPrepared("alice", project.SessionID, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Version != project.Version+1 {
		t.Fatal("timeline save did not invalidate stale editor versions")
	}
	restored, err := testStore(store.Root).Get("alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		PreparedCompositionID string `json:"preparedCompositionId"`
		Custom                struct {
			Keep bool `json:"keep"`
		} `json:"custom"`
		Timeline struct {
			Channels []struct {
				Clips []editorClip `json:"clips"`
			} `json:"channels"`
			TextItems       []document.TextItem `json:"textItems"`
			Effects         []map[string]any    `json:"effectBlocks"`
			Transitions     []map[string]any    `json:"transitions"`
			DocumentSession struct {
				Document    document.Document       `json:"document"`
				Composition composition.Composition `json:"composition"`
			} `json:"documentSession"`
		} `json:"timeline"`
		Media []map[string]any `json:"media"`
	}
	if err := json.Unmarshal(restored.State, &state); err != nil {
		t.Fatal(err)
	}
	if state.PreparedCompositionID != "compiled" || !state.Custom.Keep || len(state.Timeline.Channels) != 2 || len(state.Media) != 4 {
		t.Fatalf("incomplete project: %s", restored.State)
	}
	clip := state.Timeline.Channels[0].Clips[0]
	if clip.FileName != prepared.Composition.Assets[0].File || clip.SourceID != "scene" || clip.InPoint != document.Second || clip.OutPoint != 5*document.Second || clip.Opacity != .8 || clip.MotionPreset != "slow-zoom-in" {
		t.Fatalf("clip geometry or source lost: %+v", clip)
	}
	if state.Timeline.Channels[1].Clips[0].Volume != 85 || state.Timeline.Effects[0]["effectId"] != "contrast" || state.Timeline.Transitions[0]["effectId"] != "fade" {
		t.Fatal("audio or treatments missing from editable timeline")
	}
	expected, _ := json.Marshal(prepared.Composition.TextItems)
	actual, _ := json.Marshal(state.Timeline.TextItems)
	if string(actual) != string(expected) || state.Timeline.DocumentSession.Document.Jobs[0].ResultTextIDs[0] != "caption" {
		t.Fatal("caption entries or resolved job IDs changed")
	}
	if state.Media[2]["displayName"] != "My artwork" || state.Media[2]["sourceRevision"] != "sha256:art" || state.Media[3]["name"] != "music.mp3" {
		t.Fatal("project media or user display names lost")
	}
	if _, pristine := canPrepareEditorState(restored.State); !pristine {
		t.Fatal("server-prepared timeline is not recognized as untouched")
	}
	next := editableFixture()
	next.Composition.ID = "visual-pass"
	next.UpdatedAt = prepared.UpdatedAt.Add(time.Minute)
	advanced, err := store.ApplyPrepared("alice", project.SessionID, next)
	if err != nil || advanced.Version != restored.Version+1 {
		t.Fatalf("resolved visual pass did not update saved project: %+v %v", advanced.Summary, err)
	}
	idempotent, err := store.ApplyPrepared("alice", project.SessionID, next)
	if err != nil || idempotent.Version != advanced.Version {
		t.Fatal("opening the same edit should not keep incrementing project versions")
	}
	if _, err := store.Update("alice", project.ID, project.Name, project.Version, mediaOnly); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale browser overwrote generated timeline: %v", err)
	}
	if _, err := store.ApplyPrepared("bob", project.SessionID, next); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign project was writable: %v", err)
	}
	var edited map[string]any
	if err := json.Unmarshal(advanced.State, &edited); err != nil {
		t.Fatal(err)
	}
	edited["media"].([]any)[0].(map[string]any)["displayName"] = "My renamed scene"
	manualState, err := json.Marshal(edited)
	if err != nil {
		t.Fatal(err)
	}
	manual, err := store.Update("alice", project.ID, project.Name, advanced.Version, manualState)
	if err != nil {
		t.Fatal(err)
	}
	next.Composition.ID = "later-preparation"
	protected, err := store.ApplyPrepared("alice", project.SessionID, next)
	if err != nil || string(protected.State) != string(manual.State) || protected.Version != manual.Version {
		t.Fatal("a changed media entry was silently overwritten by a new preparation")
	}
}

func TestPreparedPublicationRejectsStaleSnapshotAndUnknownSources(t *testing.T) {
	store := testStore(t.TempDir())
	store.Presentations = &PresentationStore{Root: t.TempDir()}
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	newest := editableFixture()
	if err := store.Presentations.Save("alice", project.SessionID, newest); err != nil {
		t.Fatal(err)
	}
	older := editableFixture()
	older.UpdatedAt = newest.UpdatedAt.Add(-time.Minute)
	stale, err := store.ApplyPrepared("alice", project.SessionID, older)
	if err != nil || stale.Version != project.Version || string(stale.State) != "null" {
		t.Fatal("a delayed older snapshot was published over a newer retained edit")
	}
	newest.Composition.Tracks[0].Clips[0].AssetID = "missing"
	if _, err := store.ApplyPrepared("alice", project.SessionID, newest); err == nil {
		t.Fatal("an incomplete timeline was saved despite missing asset metadata")
	}
	unchanged, err := store.Get("alice", project.ID)
	if err != nil || unchanged.Version != project.Version || string(unchanged.State) != "null" {
		t.Fatal("failed timeline publication changed the saved project")
	}
}

func TestPreparedCompositionNeverOverwritesManualEditsOrIntentionalClears(t *testing.T) {
	for _, saved := range []string{
		`{"schemaVersion":1,"timeline":{"channels":[{"clips":[{"id":"manual"}]}]},"media":[]}`,
		`{"schemaVersion":1,"timeline":{"channels":[],"documentSession":{"kind":"dirty"}},"media":[]}`,
		`{"schemaVersion":1,"timeline":{"channels":[],"documentSession":{"kind":"ready","composition":{"id":"intentionally-empty"}}},"media":[]}`,
		`{"schemaVersion":1,"timeline":{"channels":[],"textItems":[{"text":"My title"}]},"media":[]}`,
	} {
		store := testStore(t.TempDir())
		project, err := store.Create("alice", "Keep my work")
		if err != nil {
			t.Fatal(err)
		}
		project, err = store.Update("alice", project.ID, project.Name, project.Version, json.RawMessage(saved))
		if err != nil {
			t.Fatal(err)
		}
		updated, err := store.ApplyPrepared("alice", project.SessionID, editableFixture())
		if err != nil || updated.Version != project.Version || string(updated.State) != string(project.State) {
			t.Fatalf("manual state replaced: %s %v", updated.State, err)
		}
	}
}

func TestProjectFingerprintMatchesBrowserCanonicalFixture(t *testing.T) {
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[],"text":"Știință <>& 🚀\u2028","numbers":[0.000001,100000000000000000000,1e-7],"10":true,"2":false},"media":[]}`)
	actual, err := editorStateFingerprint(state, true)
	if err != nil || actual != "v2:65dae530ca537bc4" {
		t.Fatalf("browser/server fingerprint mismatch: %q %v", actual, err)
	}
}

func TestProjectLoadLeavesLegacyRecoveryToBrowserWithoutRewritingState(t *testing.T) {
	previous := storage.DataDir
	storage.DataDir = t.TempDir()
	t.Cleanup(func() { storage.DataDir = previous })
	store := NewStore()
	project, err := store.Create("alice", "Legacy project")
	if err != nil {
		t.Fatal(err)
	}
	project, err = store.Update("alice", project.ID, project.Name, project.Version,
		json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[]},"media":[{"name":"poster.png","displayName":"Keep me"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Presentations.Save("alice", project.SessionID, editableFixture()); err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	app.Get("/projects/:projectID", func(c *fiber.Ctx) error { c.Locals("pbUserId", "alice"); return c.Next() }, store.GetHandler)
	response, err := app.Test(httptest.NewRequest("GET", "/projects/"+project.ID, nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var loaded Project
	if err := json.NewDecoder(response.Body).Decode(&loaded); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || loaded.Version != project.Version || string(loaded.State) != string(project.State) {
		t.Fatalf("viewing changed the saved project: %d %+v", response.StatusCode, loaded.Summary)
	}
	if loaded.Presentation == nil || loaded.Presentation.Prepared == nil || loaded.Presentation.Prepared.Composition.ID != "compiled" {
		t.Fatal("browser did not receive the retained composition for legacy recovery")
	}
	persisted, err := store.Get("alice", project.ID)
	if err != nil || string(persisted.State) != string(project.State) || persisted.Version != project.Version {
		t.Fatal("opening a project rewrote its timeline or version")
	}
}
