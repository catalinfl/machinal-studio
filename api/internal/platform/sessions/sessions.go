package sessions

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/objectstore"
	"ffmpeg-go-server/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
)

// TTL makes idle workspaces eligible for cache eviction. Only confirmed cloud
// copies and regenerable derived files are collected; sole originals survive.
const (
	DefaultTTL         = 10 * time.Minute
	DefaultGCInterval  = time.Minute
	DefaultDiskMaxFrac = 0.8
	// heartbeatGrace keeps freshly-seen sessions out of disk-pressure
	// eviction so an active upload is never reaped mid-request.
	heartbeatGrace = time.Minute
	// maxRendersPerSession caps retained render outputs per volume so
	// repeated re-renders after small tweaks cannot fill the disk.
	maxRendersPerSession = 3
	// sweepTimeout bounds the background S3 prefix listing/deletion so a
	// stalled network cannot leak goroutines past the purge request.
	sweepTimeout = 10 * time.Minute

	// DefaultMaxSessionBytes caps one session volume (uploads + cache + renders)
	// so a single user cannot fill the shared disk faster than the TTL/LRU
	// collector reclaims it. SESSION_MAX_BYTES overrides it; "0" disables.
	DefaultMaxSessionBytes = 10 << 30
)

type entry struct {
	id       string
	created  time.Time
	lastSeen time.Time
}

// Info is a snapshot of one tracked session.
type Info struct {
	ID       string    `json:"id"`
	Created  time.Time `json:"created"`
	LastSeen time.Time `json:"lastSeen"`
}

var (
	mu      sync.Mutex
	entries = map[string]*entry{}
	// owners binds random session ids to the PocketBase uid that created them.
	// Legacy "u_<uid>" ids are implicitly owned via string equality (see
	// auth.RequireOwnedSession) and need no entry here.
	owners            = map[string]string{}
	jobProtection     = map[string]bool{}
	jobInventoryReady bool
)

// Exists reports whether id is a currently tracked session (no provisioning).
func Exists(id string) bool {
	if !Valid(id) {
		return false
	}
	mu.Lock()
	defer mu.Unlock()
	_, ok := entries[id]
	return ok
}

// OwnerOf returns the uid that created a random session, if known.
func OwnerOf(id string) (string, bool) {
	if owner, ok := persistentProjectOwner(id); ok {
		return owner, true
	}
	mu.Lock()
	defer mu.Unlock()
	uid, ok := owners[id]
	return uid, ok
}

// IsLegacySession reports whether id uses the old deterministic "u_<pbId>"
// format. These are guessable from the PocketBase id and must always be
// paired with PB auth; random UUID sessions are bearer-capable presigned URLs.
func IsLegacySession(id string) bool {
	return len(id) > 2 && id[0] == 'u' && id[1] == '_'
}

// S3Prefix returns the S3 user prefix for a session. Legacy ids are already
// per-user ("u_<uid>"). Random UUID sessions map to their owner's stable
// prefix ("u_<ownerUid>") so a fresh UUID keeps finding the user's existing
// S3 objects (migration from legacy volumes). Unknown owner falls back to
// the raw session id.
func S3Prefix(session string) string {
	if session == "" {
		return ""
	}
	if IsLegacySession(session) {
		return session
	}
	if strings.HasPrefix(session, "p_") {
		return session
	}
	if owner, ok := OwnerOf(session); ok && owner != "" {
		return "u_" + owner
	}
	return session
}

// S3Prefixes returns the S3 prefixes to try for a session: owner prefix first
// (legacy data), then the raw session prefix when different (data uploaded
// under a fresh UUID before owner binding). Deduped.
func S3Prefixes(session string) []string {
	primary := S3Prefix(session)
	if primary == "" || primary == session {
		return []string{session}
	}
	return []string{primary, session}
}

// NewID generates an opaque session/user token (UUID v4 text).
func NewID() string {
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		panic("sessions: no randomness: " + err.Error())
	}
	random[6] = random[6]&0x0f | 0x40
	random[8] = random[8]&0x3f | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		random[0:4], random[4:6], random[6:8], random[8:10], random[10:16])
}

// Valid reports whether id is usable as a session token.
func Valid(id string) bool { return storage.ValidUserID(id) }

// FromRequest extracts the session token preferring the "X-Session-Id" header
// over "?session=" query. Query exists only because <video>/<img> tags cannot
// set headers; XHR/fetch must use the header so bearer URLs never land in
// access logs, browser history, or Referer headers.
//
// Security contract: the token is a BEARER secret (122-bit UUIDs minted by
// crypto/rand). Whoever holds it can read the "/data/{id}" volume plus its S3
// prefix. Treat session URLs like presigned URLs: never log, embed or forward
// them. Legacy deterministic "u_<pbId>" ids are guessable and must only be
// paired with owner authentication or a separately issued read capability.
func FromRequest(c *fiber.Ctx) string {
	id := strings.TrimSpace(c.Get("X-Session-Id"))
	if id == "" {
		id = strings.TrimSpace(c.Query("session"))
	}
	if !Valid(id) {
		return ""
	}
	return id
}

// ResolveRoot returns the volume directory for this request: "/data/{user}"
// when a valid session token is present (provisioned on demand), otherwise
// the legacy shared DataDir. It also refreshes the session heartbeat so
// plain media traffic keeps the session alive.
func ResolveRoot(c *fiber.Ctx) (root, session string) {
	session = FromRequest(c)
	if session == "" {
		return storage.DataDir, ""
	}
	root, err := Touch(session)
	if err != nil {
		// Swallowed errors surface as 401 "login required" downstream
		// (List/Download check session == ""), which misleads debugging.
		// Log the real cause (e.g. permission denied on /data).
		log.Printf("sessions: provision %q: %v", session, err)
		return storage.DataDir, ""
	}
	return root, session
}

// Touch provisions the session directory and refreshes its heartbeat.
func Touch(id string) (string, error) {
	return TouchOwned(id, "")
}

// TouchOwned provisions id and optionally binds it to a PocketBase uid.
// Empty uid means anonymous (backward compat); authed Create passes the uid.
func TouchOwned(id, uid string) (string, error) {
	release := UseWorkspace(id)
	defer release()
	root, err := storage.EnsureUserDir(id)
	if err != nil {
		return "", fmt.Errorf("provision session dir: %w", err)
	}
	now := time.Now()
	mu.Lock()
	existing, ok := entries[id]
	if !ok {
		existing = &entry{id: id, created: now}
		entries[id] = existing
	}
	existing.lastSeen = now
	if uid != "" {
		owners[id] = uid
	}
	mu.Unlock()
	return root, nil
}

// RefreshExisting refreshes lastSeen only if id is already tracked.
// It never provisions: reads must not create volumes for attacker-chosen ids.
func RefreshExisting(id string) bool {
	if !Valid(id) {
		return false
	}
	release := UseWorkspace(id)
	defer release()
	mu.Lock()
	defer mu.Unlock()
	e, ok := entries[id]
	if !ok {
		return false
	}
	e.lastSeen = time.Now()
	return true
}

// ResolveExistingRoot returns the volume only if the session is already
// tracked (or a legacy/persistent ID checked by the route's access middleware).
// Unlike ResolveRoot it never MkdirAlls for unknown ids.
func ResolveExistingRoot(c *fiber.Ctx) (root, session string, ok bool) {
	session = FromRequest(c)
	if session == "" {
		return "", "", false
	}
	mu.Lock()
	_, tracked := entries[session]
	mu.Unlock()
	if !tracked && !IsLegacySession(session) && !isPersistentProject(session) {
		return "", session, false
	}
	// Legacy IDs require the route's authenticated owner or media-token check.
	// This lookup never provisions directories.
	// Random ids tracked: refresh heartbeat without provisioning.
	if tracked {
		RefreshExisting(session)
	}
	root, err := storage.UserDir(session)
	if err != nil {
		return "", session, false
	}
	return root, session, true
}

// Evict deletes the session volume and forgets the session, but keeps the
// S3 prefix: S3 is persistent per-user storage. A returning user with the
// same id re-provisions an empty volume via Touch, sees the S3 objects in
// List, and re-hydrates them on demand via EnsureLocal (timeline/scrub).
// It is idempotent: evicting an unknown session still sweeps a stray dir.
func Evict(id string) error {
	if !Valid(id) {
		return fmt.Errorf("invalid session")
	}
	mu.Lock()
	delete(entries, id)
	delete(owners, id)
	mu.Unlock()
	dir, err := storage.UserDir(id)
	if err != nil {
		return fmt.Errorf("resolve session dir: %w", err)
	}
	if err := os.RemoveAll(dir); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove session dir: %w", err)
	}
	return nil
}

// Remove deletes the session volume, forgets the session and sweeps the S3
// prefix. It is the explicit user-requested purge ("delete my data"), never
// the automatic GC/pressure path — those must call Evict so S3 stays
// persistent. It is idempotent: removing an unknown session still sweeps a
// stray directory.
func Remove(id string) error {
	if err := Evict(id); err != nil {
		return err
	}
	// The S3 prefix must go too, or collected sessions keep billing forever.
	sweepSessionObjects(id)
	return nil
}

// sweepSessionObjects deletes every "<id>/..." object in the background.
// Best-effort and logged: it must never block the HTTP path on network I/O.
// Called only from the explicit purge path (Remove), never from GC/pressure
// eviction — S3 is persistent per-user storage.
func sweepSessionObjects(id string) {
	client := objectstore.Shared()
	if !client.Config.Enabled() {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), sweepTimeout)
		defer cancel()
		objects, err := client.List(ctx, id+"/")
		if err != nil {
			log.Printf("s3: sweep session %s: list: %v", id, err)
			return
		}
		for _, object := range objects {
			if err := client.Delete(ctx, object.Key); err != nil {
				log.Printf("s3: sweep session %s: delete %s: %v", id, object.Key, err)
			}
		}
	}()
}

// Snapshot lists tracked sessions, oldest heartbeat first.
func Snapshot() []Info {
	mu.Lock()
	defer mu.Unlock()
	out := make([]Info, 0, len(entries))
	for _, e := range entries {
		out = append(out, Info{ID: e.id, Created: e.created, LastSeen: e.lastSeen})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastSeen.Before(out[j].LastSeen) })
	return out
}

// PruneRenders keeps the newest keep "render_*" outputs in root so repeated
// re-renders after small tweaks do not fill the volume.
func PruneRenders(root string, keep int) {
	if keep < 1 {
		keep = 1
	}
	dir, err := os.ReadDir(root)
	if err != nil {
		return
	}
	type candidate struct {
		name    string
		modTime time.Time
	}
	var renders []candidate
	for _, e := range dir {
		if e.IsDir() || !isRenderOutput(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		renders = append(renders, candidate{name: e.Name(), modTime: info.ModTime()})
	}
	if len(renders) <= keep {
		return
	}
	sort.Slice(renders, func(i, j int) bool { return renders[i].modTime.After(renders[j].modTime) })
	for _, victim := range renders[keep:] {
		// Best-effort: a failed delete just leaves one extra render for the next prune.
		_ = os.Remove(filepath.Join(root, victim.name))
	}
}

// IsRenderOutput reports whether name is a final export (render_*.mp4/avi/mp3).
// Exported so /list and warm/download paths can tag renders separately from
// source media; the same predicate drives PruneRenders retention.
func IsRenderOutput(name string) bool {
	lower := strings.ToLower(name)
	switch {
	case lower == "render_output.mp4" || lower == "render_output.avi" || lower == "render_output.mp3":
		return true
	case strings.HasPrefix(lower, "render_") && (strings.HasSuffix(lower, ".mp4") || strings.HasSuffix(lower, ".avi") || strings.HasSuffix(lower, ".mp3")):
		return true
	default:
		return false
	}
}

func isRenderOutput(name string) bool { return IsRenderOutput(name) }

// StartGC evicts expired sessions every interval and, when disk usage above
// maxFraction, evicts least-recently-seen sessions until below it. Expired
// means no heartbeat for longer than ttl. Eviction deletes only the local
// volume — the S3 prefix is persistent per-user storage. It runs until ctx
// is done.
func StartGC(ctx context.Context, interval, ttl time.Duration, maxFraction float64) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			collectExpired(ttl)
			relievePressure(maxFraction)
		}
	}
}

func collectExpired(ttl time.Duration) {
	collectIdleWorkspaces(ttl)
}

func relievePressure(maxFraction float64) {
	mu.Lock()
	ready := jobInventoryReady
	mu.Unlock()
	if !ready {
		return
	}
	if maxFraction <= 0 || maxFraction >= 1 {
		return
	}
	used, err := diskUsageFraction(storage.DataDir)
	if err != nil || used < maxFraction {
		return
	}
	for _, info := range Snapshot() {
		if protectedByJob(info.ID) {
			continue
		}
		if time.Since(info.LastSeen) < heartbeatGrace {
			continue
		}
		// Best-effort: pressure relief retries survivors on the next tick.
		pruneIdleWorkspace(info.ID, time.Now().Add(-heartbeatGrace))
		used, err = diskUsageFraction(storage.DataDir)
		if err != nil || used < maxFraction {
			return
		}
	}
}

func ProtectJobSession(id string) {
	mu.Lock()
	defer mu.Unlock()
	jobProtection[id] = true
}

func SetJobSessions(ids []string) {
	mu.Lock()
	defer mu.Unlock()
	jobProtection = make(map[string]bool, len(ids))
	jobInventoryReady = true
	for _, id := range ids {
		jobProtection[id] = true
	}
}

func protectedByJob(id string) bool {
	mu.Lock()
	defer mu.Unlock()
	return jobProtection[id]
}

// PruneSessionRenders is the per-session render retention used after exports.
func PruneSessionRenders(root string) {}

// MaxSessionBytes reads the per-session quota from the environment.
func MaxSessionBytes() int64 {
	raw := strings.TrimSpace(os.Getenv("SESSION_MAX_BYTES"))
	if raw == "" {
		return DefaultMaxSessionBytes
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return DefaultMaxSessionBytes
	}
	return value
}

// DirSize sums regular files under root (including the derived media cache),
// ignoring unreadable entries. Best-effort accounting for quota checks.
func DirSize(root string) int64 {
	var total int64
	// Best-effort: unreadable entries just skew the quota estimate low and
	// are re-observed on the next check.
	_ = filepath.WalkDir(root, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		total += info.Size()
		return nil
	})
	return total
}
