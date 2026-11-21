package compiler

import (
	"testing"

	"ffmpeg-go-server/editengine/document"
)

func TestOutputVideoFit(t *testing.T) {
	engine := New()
	input := reelInput(t)
	contained := successful(t, engine.Compile(input))
	if contained.Output.Fit != document.VideoFitContain {
		t.Fatalf("default fit = %q", contained.Output.Fit)
	}
	input.Document.Output.Fit = document.VideoFitCover
	input.Document.Output.Aspect = "portrait"
	result := engine.Compile(input)
	covered := successful(t, result)
	if covered.Output.Fit != document.VideoFitCover || result.Document.Output.Fit != document.VideoFitCover {
		t.Fatal("cover framing was lost during compilation")
	}
	input.Document = *result.Document
	if successful(t, engine.Compile(input)).ID != covered.ID {
		t.Fatal("saved framing did not compile deterministically")
	}
	input.Document.Output.Fit = "stretch"
	invalid := engine.Compile(input)
	for _, diagnostic := range invalid.Diagnostics {
		if diagnostic.Path == "output.fit" && diagnostic.Code == "invalid_output" {
			return
		}
	}
	t.Fatalf("invalid framing was accepted: %+v", invalid)
}

func TestOutputFitParticipatesInCompositionIdentity(t *testing.T) {
	input := reelInput(t)
	engine := New()
	contained := successful(t, engine.Compile(input))
	input.Document.Output.Fit = document.VideoFitCover
	covered := successful(t, engine.Compile(input))
	if contained.ID == covered.ID {
		t.Fatal("different framing reused the same composition identity")
	}
}
