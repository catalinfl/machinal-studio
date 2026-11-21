package compositions

import (
	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/internal/core/editor/speech"
	"strings"
)

func needsTextService(input compiler.Input) bool {
	if input.Document.Output.Format == "mp3" {
		return false
	}
	for _, jobs := range [][]document.Job{input.Document.Jobs, input.Document.After} {
		for _, job := range jobs {
			if job.Type == "captions.generate" && len(job.ResultTextIDs) == 0 {
				return true
			}
		}
	}
	return len(input.Document.Texts) > 0 && input.PreparedText == nil
}

func speechJobRequest(job document.Job) speech.Request {
	input := strings.TrimSpace(job.Text)
	if input == "" {
		input = strings.TrimSpace(job.Input)
	}
	return speech.Request{Input: input, Language: job.Language, Instructions: job.Instructions, Model: job.Model, Voice: job.Voice, ReferenceName: job.ReferenceName, ReferenceTranscript: job.ReferenceTranscript}
}

func validateSpeechJobs(doc document.Document) (string, error) {
	for _, jobs := range [][]document.Job{doc.Before, doc.Jobs} {
		for _, job := range jobs {
			if job.Type != "speech.generate" || job.ResultAssetID != "" {
				continue
			}
			if err := speech.ValidateRequest(speechJobRequest(job)); err != nil {
				return job.ID, err
			}
		}
	}
	return "", nil
}
