package storage

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeJoinAllowsPlainNames(t *testing.T) {
	for _, name := range []string{"movie.mp4", "clip final.mp4", "a1-b_c.mkv", "song.wav"} {
		path, err := SafeJoin(name)
		if err != nil {
			t.Fatalf("SafeJoin(%q) rejected a plain name: %v", name, err)
		}
		if path != filepath.Join(DataDir, name) {
			t.Fatalf("SafeJoin(%q) = %q, want %q", name, path, filepath.Join(DataDir, name))
		}
	}
}

func TestSafeJoinRejectsTraversal(t *testing.T) {
	for _, name := range []string{
		"..",
		"../..",
		"../../etc/passwd",
		"foo/../../etc/passwd",
		"foo/../../../tmp/x",
		"..\\..\\windows\\win.ini",
		"C:\\Windows\\System32\\config",
		"\\etc\\passwd",
		"/etc/passwd",
		".hidden",
		"./file.mp4",
		"a/b.mp4",
	} {
		if _, err := SafeJoin(name); err == nil {
			t.Fatalf("SafeJoin(%q) accepted a malicious name", name)
		}
	}
}

func TestSafeJoinRejectsControlCharacters(t *testing.T) {
	for _, name := range []string{
		"evil\r\nx.mp4",
		"tab\tname.mp4",
		"null\x00.mp4",
	} {
		if _, err := SafeJoin(name); err == nil {
			t.Fatalf("SafeJoin(%q) accepted a control character", name)
		}
	}
}

func TestSafeJoinResultStaysInsideDataDir(t *testing.T) {
	path, err := SafeJoin("render_output.mp4")
	if err != nil {
		t.Fatal(err)
	}
	rel, err := filepath.Rel(DataDir, path)
	if err != nil || rel == ".." || filepath.IsAbs(rel) {
		t.Fatalf("SafeJoin result %q escapes %q (rel=%q)", path, DataDir, rel)
	}
}

func TestValidUserID(t *testing.T) {
	for _, id := range []string{"550e8400-e29b-41d4-a716-446655440000", "user_1", "abc-XYZ-019"} {
		if !ValidUserID(id) {
			t.Fatalf("ValidUserID(%q) = false, want true", id)
		}
	}
	for _, id := range []string{"", "../x", "a/b", "a\\b", ".hidden", "a.b", "sp ace", "se$$", strings.Repeat("a", 65)} {
		if ValidUserID(id) {
			t.Fatalf("ValidUserID(%q) = true, want false", id)
		}
	}
}

func TestSafeJoinUserScopesToUserDir(t *testing.T) {
	path, err := SafeJoinUser("user-1", "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(DataDir, "user-1", "clip.mp4"); path != want {
		t.Fatalf("SafeJoinUser = %q, want %q", path, want)
	}
	if _, err := SafeJoinUser("../evil", "clip.mp4"); err == nil {
		t.Fatal("SafeJoinUser accepted a malicious user")
	}
	if _, err := SafeJoinUser("user-1", "../clip.mp4"); err == nil {
		t.Fatal("SafeJoinUser accepted a malicious name")
	}
}

func TestSafeJoinInScopesToRoot(t *testing.T) {
	root := t.TempDir()
	path, err := SafeJoinIn(root, "clip.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(root, "clip.mp4"); path != want {
		t.Fatalf("SafeJoinIn = %q, want %q", path, want)
	}
	if _, err := SafeJoinIn(root, "a/b.mp4"); err == nil {
		t.Fatal("SafeJoinIn accepted a separator")
	}
}
