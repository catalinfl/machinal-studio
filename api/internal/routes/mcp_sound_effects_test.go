package routes

import (
	"strings"
	"testing"
)

func TestSoundImportCannotUseAnotherOwnersProjectOrBypassApproval(t *testing.T) {
	fixture := newMCPFixture(t)
	args := map[string]any{"projectId": fixture.project.ID, "id": "3849018d-0ac8-4f6b-b44d-5ec26a4b32af", "sourceVersion": "sha256:" + strings.Repeat("a", 64), "userApproved": true}
	result, output := mcpTool(t, fixture, mcpBobKey, "import_sound_effect", args)
	if !result.IsError || output.StatusCode != 404 {
		t.Fatal("cross-owner sound import was not blocked", result, output)
	}
	args["userApproved"] = false
	result, _ = mcpTool(t, fixture, mcpAliceKey, "import_sound_effect", args)
	if !result.IsError {
		t.Fatal("sound import bypassed scope approval")
	}
	if len(fixture.jobs.items) != 0 {
		t.Fatal("denied sound import created work")
	}
}
