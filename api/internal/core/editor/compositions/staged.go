package compositions

import (
	"context"
	"fmt"

	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
)

func compileStaged(ctx context.Context, input compiler.Input, root, session string) (composition.Result, error) {
	result := engine.Compile(input)
	if HasErrors(result) || result.Composition != nil {
		return result, nil
	}
	if id, err := validateSpeechJobs(input.Document); err != nil {
		return generationFailure(input, id, "invalid_speech", err)
	}
	preflight := input
	preflight.Document.Before, preflight.Document.After, preflight.Document.Placements = nil, nil, nil
	checked := engine.Preflight(preflight)
	if HasErrors(checked) {
		return checked, nil
	}

	doc, assets := input.Document, input.Assets
	doc, assets, failedID, err := materializeMediaJobs(ctx, root, session, doc, assets, doc.Before)
	if err != nil {
		input.Document, input.Assets = doc, assets
		return generationFailure(input, failedID, "generation_failed", err)
	}

	input.Document, input.Assets = doc, assets
	draft := input
	draft.Document.After = nil
	preview := engine.Compile(draft)
	if HasErrors(preview) || preview.Composition == nil {
		if len(doc.Before) > 0 && len(assets) > 0 && preview.Recovery == nil {
			preview.Recovery = recoveryEnvelope(doc, input.Bindings, assets)
		}
		return preview, nil
	}

	for _, job := range doc.After {
		if len(job.ResultTextIDs) > 0 {
			continue
		}
		transcription := doc
		transcription.Tracks = preview.Composition.Tracks
		materialized, err := materializeCaptionJob(ctx, root, session, transcription, assets, job)
		if err != nil {
			input.Document, input.Assets = doc, assets
			return generationFailure(input, job.ID, "generation_failed", err)
		}
		doc.Texts, doc.After = materialized.Texts, materialized.After
	}
	input.Document = doc
	return engine.Compile(input), nil
}

func generationFailure(input compiler.Input, id, code string, err error) (composition.Result, error) {
	result := engine.CompileDraft(input)
	result.Diagnostics = append(result.Diagnostics, document.Diagnostic{
		Path: "jobs." + id, Code: code, Message: fmt.Sprintf("generate %s: %v", id, err), Severity: "error",
	})
	result.Recovery = recoveryEnvelope(input.Document, input.Bindings, input.Assets)
	return result, fmt.Errorf("generate %s: %w", id, err)
}

func recoveryEnvelope(doc document.Document, bindings document.Bindings, assets []document.Asset) *composition.Recovery {
	if bindings == nil {
		bindings = document.Bindings{}
	}
	return &composition.Recovery{Document: doc, Bindings: bindings, Assets: append([]document.Asset{}, assets...)}
}
