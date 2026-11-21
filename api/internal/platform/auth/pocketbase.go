package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"ffmpeg-go-server/internal/platform/sessions"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

var httpClient = &http.Client{
	Timeout: 5 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		// PocketBase/OpenRouter hosts come from env, not user input, but never
		// follow more than 2 hops and strip Authorization on host change.
		if len(via) >= 2 {
			return http.ErrUseLastResponse
		}
		if len(via) > 0 && req.URL.Host != via[0].URL.Host {
			req.Header.Del("Authorization")
		}
		return nil
	},
}

// authCache short-TTLs auth-refresh results by sha256(token) so every paid
// request doesn't fan out to 1-3 PB roundtrips (was self-DoS + quota burn).
// Negative entries (invalid token) cached shorter to avoid hammering PB.
type authCacheEntry struct {
	uid      string
	record   map[string]any
	expires  time.Time
	negative bool
}

var (
	authCacheMu sync.Mutex
	authCache   = map[string]authCacheEntry{}
)

const (
	authCacheTTL         = 45 * time.Second
	authCacheNegativeTTL = 10 * time.Second
	maxAuthCacheEntries  = 10000
)

func authCacheGet(tokenHash string) (authCacheEntry, bool) {
	authCacheMu.Lock()
	defer authCacheMu.Unlock()
	e, ok := authCache[tokenHash]
	if !ok || time.Now().After(e.expires) {
		if ok {
			delete(authCache, tokenHash)
		}
		return authCacheEntry{}, false
	}
	return e, true
}

func authCachePut(tokenHash string, e authCacheEntry) {
	authCacheMu.Lock()
	defer authCacheMu.Unlock()
	// Bound map: evict expired, then oldest-ish if still huge.
	if len(authCache) >= maxAuthCacheEntries {
		now := time.Now()
		for k, v := range authCache {
			if now.After(v.expires) {
				delete(authCache, k)
			}
		}
		for key := range authCache {
			if len(authCache) < maxAuthCacheEntries {
				break
			}
			delete(authCache, key)
		}
	}
	authCache[tokenHash] = e
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func baseURL() string {
	return strings.TrimSuffix(strings.TrimSpace(os.Getenv("POCKETBASE_URL")), "/")
}

func RequirePBAuth(c *fiber.Ctx) error {
	token := bearer(c.Get(fiber.HeaderAuthorization))
	if token == "" || len(token) > 8192 || baseURL() == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}

	// Cache key binds token hash to the PB base URL so tests with different
	// mock servers but same "test-token" never collide.
	hash := tokenHash(baseURL() + "\x00" + token)
	if cached, ok := authCacheGet(hash); ok {
		if cached.negative {
			return c.Status(fiber.StatusUnauthorized).SendString("invalid session")
		}
		c.Locals("pbUserId", cached.uid)
		c.Locals("pbUserRecord", cached.record)
		return c.Next()
	}

	req, err := http.NewRequest(http.MethodPost, baseURL()+"/api/collections/users/auth-refresh", nil)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).SendString("auth service unavailable")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := httpClient.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).SendString("auth service unavailable")
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
		authCachePut(hash, authCacheEntry{negative: true, expires: time.Now().Add(authCacheNegativeTTL)})
		return c.Status(fiber.StatusUnauthorized).SendString("invalid session")
	default:
		return c.Status(fiber.StatusBadGateway).SendString("auth service unavailable")
	}

	var body struct {
		Record map[string]any `json:"record"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&body); err != nil || idOf(body.Record) == "" {
		return c.Status(fiber.StatusBadGateway).SendString("auth service unavailable")
	}

	authCachePut(hash, authCacheEntry{uid: idOf(body.Record), record: body.Record, expires: time.Now().Add(authCacheTTL)})
	c.Locals("pbUserId", idOf(body.Record))
	c.Locals("pbUserRecord", body.Record)
	return c.Next()
}

func idOf(record map[string]any) string {
	if record == nil {
		return ""
	}
	id, _ := record["id"].(string)
	return id
}

func resolveSessionID(c *fiber.Ctx) string {
	if id := sessions.FromRequest(c); id != "" {
		return id
	}

	return strings.TrimSpace(c.Params("id"))
}

func RequireOwnedSession(c *fiber.Ctx) error {
	uid, _ := c.Locals("pbUserId").(string)
	if uid == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}

	got := resolveSessionID(c)

	if got == "" {
		return c.Status(fiber.StatusForbidden).SendString("wrong project space")
	}

	// Legacy deterministic ids: must equal u_<uid> (guessable, so PB auth required).
	if sessions.IsLegacySession(got) {
		if got != "u_"+uid {
			return c.Status(fiber.StatusForbidden).SendString("wrong project space")
		}
		return c.Next()
	}

	// Random UUID sessions: must be owned by the caller (bound at Create).
	// Unknown ids could be another user's presigned URL — deny, don't provision.
	if owner, ok := sessions.OwnerOf(got); ok {
		if owner == uid {
			return c.Next()
		}
		return c.Status(fiber.StatusForbidden).SendString("wrong project space")
	}
	return c.Status(fiber.StatusForbidden).SendString("wrong project space")
}

func UserID(c *fiber.Ctx) string {
	uid, _ := c.Locals("pbUserId").(string)
	return uid
}

// UserRecord returns the full PocketBase user record captured by
// RequirePBAuth (nil when the request is unauthenticated).
func UserRecord(c *fiber.Ctx) map[string]any {
	record, _ := c.Locals("pbUserRecord").(map[string]any)
	return record
}

func bearer(h string) string {
	scheme, token, found := strings.Cut(strings.TrimSpace(h), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}

	return strings.TrimSpace(token)
}
