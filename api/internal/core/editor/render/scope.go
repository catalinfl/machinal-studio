package render

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
)

// fileScope resolves timeline file names inside one volume root: the
// session's "/data/{user}" dir when a session token is present, otherwise the
// legacy shared DataDir. Clips are warmed from S3 once up front, so every
// ffmpeg invocation below keeps working on local files.
type fileScope struct {
	root    string
	session string
}

// legacyScope resolves names in the shared DataDir (pre-session clients).
func legacyScope() fileScope { return fileScope{root: storage.DataDir} }

// scopeForRequest resolves the volume for one export request.
func scopeForRequest(session string) fileScope {
	if session == "" {
		return legacyScope()
	}
	root, err := storage.EnsureUserDir(session)
	if err != nil {
		return legacyScope()
	}
	return fileScope{root: root, session: session}
}

func (s fileScope) join(name string) (string, error) {
	return storage.SafeJoinIn(s.root, name)
}

// warm pulls every named source from S3 on a cache miss (tmp + rename).
// Failures are left to the callers: validateReferencedFiles reports the
// missing file with a proper error. Tries owner prefix first, then raw.
func (s fileScope) warm(ctx context.Context, clips []clip) {
	if s.session == "" {
		return
	}
	for _, clip := range clips {
		if _, err := storage.SafeJoinIn(s.root, clip.File); err != nil {
			continue
		}
		for _, s3user := range sessions.S3Prefixes(s.session) {
			if _, err := objectstore.EnsureLocal(ctx, s3user, s.root, clip.File); err == nil {
				break
			}
		}
	}
}

// uniqueOutputName gives every render job its own file so concurrent renders
// (or two users) never overwrite each other: render_<12hex>.<ext>.
func uniqueOutputName(extension string) string {
	var random [6]byte
	if _, err := rand.Read(random[:]); err != nil {
		// No fallback: reusing a predictable name would let concurrent
		// renders overwrite each other, so fail fast instead.
		panic("render: no randomness: " + err.Error())
	}
	return "render_" + hex.EncodeToString(random[:]) + "." + extension
}
