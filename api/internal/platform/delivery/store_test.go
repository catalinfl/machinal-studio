package delivery

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) (*Store, *time.Time) {
	t.Helper()
	root := t.TempDir()
	now := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	store := NewStore()
	store.root = func() string { return root }
	store.now = func() time.Time { return now }
	return store, &now
}

func testRecord() Record {
	return Record{Owner: "alice", KeyID: "key_alice", ProjectID: "p_owned", File: "render_test.mp4", Storage: "s3"}
}

func TestLinkPersistsOnlyScopeAndTokenDigest(t *testing.T) {
	store, now := testStore(t)
	link, err := store.Create(testRecord())
	if err != nil {
		t.Fatal(err)
	}
	if link.Token == link.ID || len(link.Token) != 64 || !link.ExpiresAt.Equal(now.Add(Lifetime)) {
		t.Fatal("invalid token or lifetime")
	}
	data, err := os.ReadFile(filepath.Join(store.root(), link.ID+".json"))
	if err != nil || strings.Contains(string(data), link.Token) {
		t.Fatal("bearer secret persisted", err)
	}
	restarted := NewStore()
	restarted.root, restarted.now = store.root, store.now
	resolved, err := restarted.Get(link.Token)
	if err != nil || resolved.Owner != "alice" || resolved.File != "render_test.mp4" {
		t.Fatal(resolved, err)
	}
	for _, token := range []string{link.ID, "../private", strings.Repeat("0", 64)} {
		if _, err := store.Get(token); !errors.Is(err, ErrNotFound) {
			t.Fatal("accepted another token", err)
		}
	}
	*now = link.ExpiresAt
	if _, err := store.Get(link.Token); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired link was usable", err)
	}
}

func TestRevokeIsAccountAndProjectScoped(t *testing.T) {
	store, _ := testStore(t)
	link, err := store.Create(testRecord())
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range [][2]string{{"bob", "p_owned"}, {"alice", "p_other"}} {
		if err := store.Revoke(scope[0], scope[1], link.ID); !errors.Is(err, ErrNotFound) {
			t.Fatal("foreign revocation accepted", err)
		}
	}
	if err := store.Revoke("alice", "p_owned", link.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(link.Token); !errors.Is(err, ErrNotFound) {
		t.Fatal("revoked link still usable")
	}
}

func TestLinkLimitsExpireWithoutDeletingMedia(t *testing.T) {
	store, now := testStore(t)
	for range maxOwnerLinks {
		if _, err := store.Create(testRecord()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Create(testRecord()); !errors.Is(err, ErrLimit) {
		t.Fatal("unbounded owner links", err)
	}
	*now = now.Add(Lifetime)
	if _, err := store.Create(testRecord()); err != nil {
		t.Fatal("expired records were not reclaimed", err)
	}
	entries, err := os.ReadDir(store.root())
	if err != nil || len(entries) != 1 {
		t.Fatal("unexpected retained records", len(entries), err)
	}
}

func TestInvalidScopeAndRandomnessFailureNeverIssueLink(t *testing.T) {
	store, _ := testStore(t)
	for _, record := range []Record{
		{Owner: "alice", KeyID: "key", ProjectID: "p_owned", File: "../secret.mp4", Storage: "s3"},
		{Owner: "alice", ProjectID: "p_owned", File: "video.mp4", Storage: "s3"},
	} {
		if _, err := store.Create(record); err == nil {
			t.Fatal("invalid scope accepted")
		}
	}
	store.random = strings.NewReader("")
	if _, err := store.Create(testRecord()); err == nil {
		t.Fatal("randomness failure ignored")
	}
}
