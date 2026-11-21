package projects

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func projectWithLargeState(t testing.TB) (*Store, Project) {
	t.Helper()
	return projectWithStatePayload(t, 8<<20)
}

func projectWithStatePayload(t testing.TB, size int) (*Store, Project) {
	t.Helper()
	store := testStore(t.TempDir())
	project, err := store.Create("alice", "Film")
	if err != nil {
		t.Fatal(err)
	}
	state := json.RawMessage(`{"schemaVersion":1,"timeline":{"channels":[]},"media":[{"scene":{"javascript":"` + strings.Repeat("x", size) + `"}}]}`)
	project, err = store.Update("alice", project.ID, project.Name, project.Version, state)
	if err != nil {
		t.Fatal(err)
	}
	return store, project
}

func TestProjectListingReadsOnlySummaryHeader(t *testing.T) {
	store, project := projectWithLargeState(t)
	summary, err := store.readSummary("alice", project.ID)
	if err != nil || !reflect.DeepEqual(summary, project.Summary) {
		t.Fatalf("summary mismatch: %+v %v", summary, err)
	}
	items, err := store.List("alice")
	if err != nil || len(items) != 1 || !reflect.DeepEqual(items[0], project.Summary) {
		t.Fatalf("listing mismatch: %+v %v", items, err)
	}
	path, err := store.path("alice", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(data), strings.Repeat("x", 8<<20)) {
		t.Fatal("listing changed the saved project", err)
	}
}

func BenchmarkProjectSummaryLargeState(b *testing.B) {
	store, project := projectWithLargeState(b)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := store.readSummary("alice", project.ID); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkProjectReadLargeState(b *testing.B) {
	store, project := projectWithLargeState(b)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := store.read("alice", project.ID); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkProjectFingerprintLargeState(b *testing.B) {
	_, project := projectWithLargeState(b)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := editorStateFingerprint(project.State, true); err != nil {
			b.Fatal(err)
		}
	}
}
