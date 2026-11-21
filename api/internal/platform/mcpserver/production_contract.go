package mcpserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strings"

	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

const maxContractBeats = 64
const maxContractItems = 16
const maxContractFindings = 128
const maxContractText = 2000

type productionContract struct {
	Version            int              `json:"version"`
	CompositionVersion string           `json:"compositionVersion" jsonschema:"Exact productionReview.compositionVersion from compiling this YAML; any recipe edit invalidates it"`
	Beats              []productionBeat `json:"beats"`
}

type productionBeat struct {
	ID           string                `json:"id"`
	ClipID       string                `json:"clipId"`
	AssetVersion string                `json:"assetVersion" jsonschema:"Pinned version of the target clip's source asset"`
	Start        float64               `json:"start"`
	End          float64               `json:"end"`
	Message      string                `json:"message"`
	Subject      string                `json:"subject"`
	Action       string                `json:"action"`
	Objects      []string              `json:"objects" jsonschema:"Stable subject/object identities; declarations, not proof of visibility or movement"`
	Phases       []productionPhase     `json:"phases" jsonschema:"Ordered scene choreography boundaries in global timeline seconds: reveal, action, hold, exit"`
	Treatments   []productionTreatment `json:"treatments"`
	Handoff      *productionHandoff    `json:"handoff,omitempty"`
}

type productionPhase struct {
	Kind string  `json:"kind"`
	At   float64 `json:"at"`
}

type productionHandoff struct {
	NextBeatID string `json:"nextBeatId"`
	ObjectID   string `json:"objectId"`
}

type productionTreatment struct {
	Kind     string  `json:"kind" jsonschema:"effect, look, motion, transition, cut or none; scene-internal effects remain source/visual review"`
	Preset   string  `json:"preset,omitempty"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Reason   string  `json:"reason,omitempty" jsonschema:"Required for an intentional cut or no additional treatment"`
}

type productionReview struct {
	Status             string                `json:"status"`
	CompositionVersion string                `json:"compositionVersion"`
	ContractVersion    string                `json:"contractVersion,omitempty"`
	VisualInspection   bool                  `json:"visualInspection"`
	Findings           []document.Diagnostic `json:"findings"`
	TotalFindings      int                   `json:"totalFindings"`
	Truncated          bool                  `json:"truncated"`
	Limitations        string                `json:"limitations"`
}

func contentVersion(data []byte) string {
	digest := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func compositionVersion(yaml string) string {
	return contentVersion([]byte(strings.ReplaceAll(yaml, "\r\n", "\n")))
}

func (contract productionContract) validate() error {
	if contract.Version != 1 || len(contract.Beats) < 1 || len(contract.Beats) > maxContractBeats {
		return fmt.Errorf("productionContract needs version 1 and 1-%d beats", maxContractBeats)
	}
	if !contractVersionPattern(contract.CompositionVersion) {
		return fmt.Errorf("use compositionVersion from compile_recipe's productionReview")
	}
	ids := make(map[string]bool)
	for index, beat := range contract.Beats {
		if ids[beat.ID] {
			return fmt.Errorf("duplicate production beat id: %s", beat.ID)
		}
		ids[beat.ID] = true
		if err := beat.validate(); err != nil {
			return contractFieldError(fmt.Sprintf("productionContract.beats[%d]", index), err)
		}
	}
	return nil
}

func (beat productionBeat) validate() error {
	for _, value := range []string{beat.ID, beat.ClipID, beat.AssetVersion, beat.Message, beat.Subject, beat.Action} {
		if !contractText(value) {
			return fmt.Errorf("each beat needs id, clipId, assetVersion, message, subject and action of at most %d bytes", maxContractText)
		}
	}
	if !contractTime(beat.Start) || !contractTime(beat.End) || beat.End <= beat.Start {
		return fmt.Errorf("beat %s needs a finite increasing start/end", beat.ID)
	}
	if len(beat.Objects) < 1 || len(beat.Objects) > maxContractItems || len(beat.Treatments) < 1 || len(beat.Treatments) > maxContractItems {
		return fmt.Errorf("beat %s needs 1-%d objects/treatments", beat.ID, maxContractItems)
	}
	objects := make(map[string]bool)
	for _, id := range beat.Objects {
		if !contractText(id) || objects[id] {
			return fmt.Errorf("beat %s has invalid or duplicate object identities", beat.ID)
		}
		objects[id] = true
	}
	if err := beat.validatePhases(); err != nil {
		return err
	}
	for index, treatment := range beat.Treatments {
		if err := beat.validateTreatment(treatment); err != nil {
			return contractFieldError(fmt.Sprintf("treatments[%d]", index), err)
		}
	}
	if beat.Handoff != nil && (!contractText(beat.Handoff.NextBeatID) || !contractText(beat.Handoff.ObjectID)) {
		return fmt.Errorf("beat %s has an invalid handoff", beat.ID)
	}
	return nil
}

func (beat productionBeat) validatePhases() error {
	kinds := []string{"reveal", "action", "hold", "exit"}
	if len(beat.Phases) != len(kinds) {
		return fmt.Errorf("beat %s needs reveal/action/hold/exit phases", beat.ID)
	}
	for i, phase := range beat.Phases {
		if phase.Kind != kinds[i] || !contractTime(phase.At) || document.Seconds(phase.At) < document.Seconds(beat.Start) || document.Seconds(phase.At) > document.Seconds(beat.End) || i > 0 && document.Seconds(phase.At) < document.Seconds(beat.Phases[i-1].At) {
			return fmt.Errorf("beat %s phases must be reveal/action/hold/exit in timeline order inside the beat", beat.ID)
		}
	}
	return nil
}

func (beat productionBeat) validateTreatment(treatment productionTreatment) error {
	if !slices.Contains([]string{"effect", "look", "motion", "transition", "cut", "none"}, treatment.Kind) {
		return invalidContractField("kind", "invalid_treatment_kind", fmt.Sprintf("Got %q; use effect, look, motion, transition, cut or none.", treatment.Kind))
	}
	if !contractTime(treatment.Start) {
		return invalidContractField("start", "invalid_treatment_time", "Treatment start must be a finite nonnegative global timeline time.")
	}
	if !contractTime(treatment.Duration) || treatment.Kind != "cut" && treatment.Duration == 0 {
		return invalidContractField("duration", "invalid_treatment_duration", "Treatment duration must be finite and positive; only a cut may have zero duration.")
	}
	end := treatment.Start + treatment.Duration
	if !contractTime(end) || document.Seconds(treatment.Start) < document.Seconds(beat.Start) || document.Seconds(end) > document.Seconds(beat.End) {
		return invalidContractField("duration", "treatment_outside_beat", fmt.Sprintf("Beat %q covers [%.6f, %.6f]s; treatment covers [%.6f, %.6f]s. Use global seconds inside the beat, compared at microsecond precision.", beat.ID, beat.Start, beat.End, treatment.Start, end))
	}
	if treatment.Kind == "none" || treatment.Kind == "cut" {
		if !contractText(treatment.Reason) {
			return fmt.Errorf("beat %s needs a reason for cut/none", beat.ID)
		}
	} else if !contractText(treatment.Preset) {
		return fmt.Errorf("beat %s treatment needs its exact preset", beat.ID)
	}
	if len(treatment.Reason) > maxContractText || len(treatment.Preset) > maxContractText {
		return fmt.Errorf("beat %s has overlong treatment text", beat.ID)
	}
	return nil
}

func contractText(value string) bool {
	return strings.TrimSpace(value) != "" && len(value) <= maxContractText
}
func contractTime(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= document.MaxTime.Seconds()
}
func contractVersionPattern(value string) bool {
	if len(value) != len("sha256:")+sha256.Size*2 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func attachProductionReview(output Output, yaml string, contract *productionContract) Output {
	if output.StatusCode != 200 {
		return output
	}
	fields, ok := output.Data.(map[string]any)
	if !ok {
		return output
	}
	encoded, err := json.Marshal(fields)
	if err != nil {
		return output
	}
	var result composition.Result
	if json.Unmarshal(encoded, &result) != nil {
		return output
	}
	review := productionReview{Status: "contract_required", CompositionVersion: compositionVersion(yaml), Findings: []document.Diagnostic{}, Limitations: "Deterministic contract/plan checks only, not aesthetic approval. Object/action declarations, choreography and scene-internal effects need source and sampled-frame review. Scene evidence must match each pinned asset version; thumbnails do not verify final compositing, motion or audio. No render authorization is granted."}
	if result.Composition == nil || len(result.Requirements) > 0 || hasEditorialCompileErrors(result.Diagnostics) {
		review.Status = "not_ready"
	} else if contract != nil {
		contractJSON, err := json.Marshal(contract)
		if err != nil {
			return output
		}
		review.ContractVersion = contentVersion(contractJSON)
		review.Status = "review_required"
		if contract.CompositionVersion != review.CompositionVersion {
			review.add("stale_contract", "productionContract.compositionVersion", "Recipe bytes changed; reconcile the contract with this exact YAML revision.")
		}
		review.checkPlan(*result.Composition, *contract)
		if review.TotalFindings > 0 {
			review.Status = "revision_required"
		}
	}
	reviewJSON, err := json.Marshal(review)
	if err != nil || len(encoded)+len(reviewJSON)+len(`,"productionReview":`) > MaxResultBytes {
		return output
	}
	fields["productionReview"] = review
	return output
}

func (review *productionReview) add(code, path, message string) {
	review.TotalFindings++
	if len(review.Findings) >= maxContractFindings {
		review.Truncated = true
		return
	}
	review.Findings = append(review.Findings, document.Diagnostic{Severity: "error", Code: code, Path: path, Message: message})
}

type contractClip struct {
	clip  document.Clip
	track string
}

type productionPlanIndex struct {
	clips     map[string]contractClip
	assets    map[string]string
	junctions map[string]editorialJunction
}

func indexProductionPlan(plan composition.Composition) productionPlanIndex {
	clips := make(map[string]contractClip)
	assets := make(map[string]string)
	junctions := make(map[string]editorialJunction)
	for _, asset := range plan.Assets {
		assets[asset.ID] = asset.Version
	}
	for _, track := range plan.Tracks {
		if track.Type != "video" || track.Hidden {
			continue
		}
		visible := slices.DeleteFunc(slices.Clone(track.Clips), func(clip document.Clip) bool { return clip.Opacity <= 0 })
		slices.SortFunc(visible, func(a, b document.Clip) int {
			if a.Start < b.Start {
				return -1
			}
			if a.Start > b.Start {
				return 1
			}
			return strings.Compare(a.ID, b.ID)
		})
		for i, clip := range visible {
			clips[clip.ID] = contractClip{clip, track.ID}
			if i > 0 {
				junctions[visible[i-1].ID] = reviewJunction(track.ID, visible[i-1], clip, plan.Transitions)
			}
		}
	}
	return productionPlanIndex{clips, assets, junctions}
}

func (review *productionReview) checkPlan(plan composition.Composition, contract productionContract) {
	index := indexProductionPlan(plan)
	beats := make(map[string]productionBeat)
	for _, beat := range contract.Beats {
		beats[beat.ID] = beat
	}
	for _, beat := range contract.Beats {
		target, exists := index.clips[beat.ClipID]
		path := "productionContract.beats." + beat.ID
		if !exists {
			review.add("missing_beat_clip", path, "Target clip is missing, hidden or fully transparent.")
			continue
		}
		clip := target.clip
		if index.assets[clip.AssetID] != beat.AssetVersion {
			review.add("stale_beat_asset", path, "The beat's assetVersion does not match its pinned source asset.")
		}
		if document.Seconds(beat.Start) < clip.Start || document.Seconds(beat.End) > clip.End() {
			review.add("beat_outside_clip", path, "Beat interval is not covered by its target clip.")
		}
		for _, treatment := range beat.Treatments {
			if !matchesProductionTreatment(plan, target, index.junctions, treatment) {
				review.add("missing_promised_treatment", path, fmt.Sprintf("Missing %s %q at %.6fs for %.6fs on the target clip/junction.", treatment.Kind, treatment.Preset, treatment.Start, treatment.Duration))
			}
		}
		if beat.Handoff != nil {
			next, exists := beats[beat.Handoff.NextBeatID]
			if !exists || next.ID == beat.ID || next.Start <= beat.Start || !slices.Contains(beat.Objects, beat.Handoff.ObjectID) || !slices.Contains(next.Objects, beat.Handoff.ObjectID) {
				review.add("broken_object_handoff", path, "Handoff must reference a later beat declaring the same stable object identity.")
			}
		}
	}
}

func matchesProductionTreatment(plan composition.Composition, target contractClip, junctions map[string]editorialJunction, wanted productionTreatment) bool {
	if wanted.Kind == "none" {
		return true
	}
	start, duration := document.Seconds(wanted.Start), document.Seconds(wanted.Duration)
	if wanted.Kind == "look" || wanted.Kind == "motion" {
		preset := target.clip.Look
		if wanted.Kind == "motion" {
			preset = target.clip.Motion
		}
		return preset == wanted.Preset && start == target.clip.Start && duration == target.clip.End()-target.clip.Start
	}
	if wanted.Kind == "effect" {
		return slices.ContainsFunc(plan.Effects, func(effect document.EffectBlock) bool {
			if effect.TrackID != target.track || effect.Preset != wanted.Preset {
				return false
			}
			if effect.OwnerClipID == "" {
				return effect.Start <= start && effect.Start+effect.Duration >= document.Seconds(wanted.Start+wanted.Duration)
			}
			return effect.OwnerClipID == target.clip.ID && effect.Start == start && effect.Duration == duration
		})
	}
	junction, exists := junctions[target.clip.ID]
	return exists && document.Seconds(junction.Start) == start && document.Seconds(junction.Duration) == duration && (wanted.Kind == "cut" && junction.Kind == "cut" || wanted.Kind == "transition" && junction.Preset == wanted.Preset)
}
