package mcpserver

import (
	"encoding/json"
	"io/fs"
	"os"
	"strings"
	"testing"
)

// Compiler/permission contract tests use the client package's examples as inputs.
// This filesystem is test-only and is never loaded by the API binary.
var clientReferenceFS = os.DirFS("../../../../packages/mcp-installer/library")

type clientReferenceFiles struct{}

func (clientReferenceFiles) ReadFile(path string) ([]byte, error) {
	return fs.ReadFile(clientReferenceFS, strings.TrimPrefix(path, "reference/"))
}

var clientReferenceFixtures clientReferenceFiles

func requireClientLibrary(t *testing.T) {
	t.Helper()
	if _, err := fs.Stat(clientReferenceFS, "guides/brief.md"); err != nil {
		t.Skip("external client library (@machinal/mcp) not present in standalone repo")
	}
}

func clientPolicyFixture(name string) string {
	content, err := fs.ReadFile(clientReferenceFS, "guides/"+name)
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(string(content), "\n")
}

func clientAuthoringGuide(t *testing.T, topic string) string {
	t.Helper()
	name := topic
	for _, entry := range referenceTopics {
		if entry.ID == topic {
			name = entry.Guide
			break
		}
	}
	content, err := fs.ReadFile(clientReferenceFS, "guides/"+name+".md")
	if err != nil {
		t.Skipf("client reference library not present in standalone repo: %v", err)
	}
	return string(content)
}

func clientAuthoringReference(input referenceInput, entries map[string][]json.RawMessage) (referenceResult, error) {
	result, err := editingReference(input, entries)
	if err != nil || result.Guide == "" || input.Topic == "scene-runtime" {
		return result, err
	}
	for _, topic := range referenceTopics {
		if topic.ID == input.Topic {
			content, err := fs.ReadFile(clientReferenceFS, "guides/"+topic.Guide+".md")
			result.Guide = string(content)
			return result, err
		}
	}
	return result, err
}

type exampleDefinition struct {
	ID           string `json:"id"`
	Requirements int    `json:"requirements"`
}

var referenceExamples = func() []exampleDefinition {
	content, err := fs.ReadFile(clientReferenceFS, "examples.json")
	if err != nil {
		return nil
	}
	var examples []exampleDefinition
	if err := json.Unmarshal(content, &examples); err != nil {
		panic(err)
	}
	return examples
}()
